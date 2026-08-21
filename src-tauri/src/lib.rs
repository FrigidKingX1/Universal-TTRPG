pub mod commands;
pub mod db;

use auto_dm_core::llm::{DmPipeline, LlmBackend, StubLlmBackend};
use auto_dm_core::memory::CampaignMemory;
use auto_dm_core::ollama::OllamaLlmBackend;
use db::{
    backup_before_migrate, open_pool, run_migrations, AppState, Repository, SqliteRepository,
};
use std::panic;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind, TimezoneStrategy};

fn setup_panic_hook() {
    panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Box<Any> panic payload".to_string()
        };
        log::error!("CRITICAL PANIC at [{location}]: {payload}");
    }));
}

/// Try to start the `ollama serve` child process. Returns the Child handle
/// if successfully spawned, or None if Ollama was already reachable.
fn try_start_ollama() -> Option<std::process::Child> {
    if OllamaLlmBackend::reachable() {
        log::info!("Ollama already running");
        return None;
    }
    log::info!("Attempting to start `ollama serve`...");
    match std::process::Command::new("ollama")
        .arg("serve")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            log::info!("ollama serve started (pid {})", child.id());
            Some(child)
        }
        Err(e) => {
            log::warn!("Failed to start ollama serve: {e}");
            None
        }
    }
}

/// Wait for Ollama to become reachable after a cold start, probing with
/// exponential backoff. Returns true if it became reachable within `max_wait`.
fn wait_for_ollama(max_wait: std::time::Duration) -> bool {
    let started = std::time::Instant::now();
    let mut delay = std::time::Duration::from_millis(250);
    loop {
        if OllamaLlmBackend::reachable() {
            return true;
        }
        if started.elapsed() >= max_wait {
            return false;
        }
        std::thread::sleep(delay);
        delay = (delay * 2).min(std::time::Duration::from_secs(1));
    }
}

/// Select the DM narrative backend: connect to Ollama when reachable,
/// otherwise fall back to the deterministic stub so the app is always usable.
#[allow(dead_code)]
fn choose_dm_backend() -> Box<dyn LlmBackend> {
    choose_dm_backend_with(None)
}

fn choose_dm_backend_with(model: Option<String>) -> Box<dyn LlmBackend> {
    if OllamaLlmBackend::reachable() {
        log::info!(
            "Using Ollama backend @ localhost:11434 (model {})",
            model.as_deref().unwrap_or("default")
        );
        Box::new(OllamaLlmBackend::new(model))
    } else {
        log::warn!("Ollama not reachable; using stub backend");
        Box::new(StubLlmBackend)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_panic_hook();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_frame::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir { file_name: Some("auto_dm".into()) }),
                    Target::new(TargetKind::Stdout),
                ])
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(2_000_000)
                .build(),
        );

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("campaign_data.db");

            let pool = tauri::async_runtime::block_on(async {
                let pool = open_pool(&db_path).await?;
                backup_before_migrate(&pool, &db_path).await;
                run_migrations(&pool).await?;
                Ok::<_, Box<dyn std::error::Error>>(pool)
            })?;

            let ollama_child = try_start_ollama();
            if ollama_child.is_some() {
                // A cold-started `ollama serve` needs time to bind its port;
                // probe with backoff before choosing the backend so we don't
                // permanently fall back to the stub on first launch.
                if wait_for_ollama(std::time::Duration::from_secs(10)) {
                    log::info!("Ollama became reachable after cold start");
                } else {
                    log::warn!("Ollama not reachable within 10s of cold start; using stub backend");
                }
            }

            let repo = SqliteRepository::new(pool);

            // Restore the DM's campaign memory from SQLite so context
            // survives restarts.
            let memory = tauri::async_runtime::block_on(async {
                let mem = CampaignMemory::new();
                match repo.list_memory(50).await {
                    Ok(events) => {
                        let mut mem = mem;
                        for (speaker, content) in events {
                            mem.push(&speaker, &content);
                        }
                        if !mem.is_empty() {
                            log::info!("Restored DM memory from database");
                        }
                        mem
                    }
                    Err(e) => {
                        log::warn!("Could not load DM memory: {e}");
                        mem
                    }
                }
            });

            // Restore persisted Ollama preferences (model + num_predict) so
            // Settings survive restarts.
            let persisted_model = tauri::async_runtime::block_on(async {
                repo.get_setting("ollama_model")
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "llama3.2".to_string())
            });
            let persisted_num_predict = tauri::async_runtime::block_on(async {
                repo.get_setting("ollama_num_predict")
                    .await
                    .ok()
                    .flatten()
                    .and_then(|v| v.parse::<u32>().ok())
                    .map(|n| n.clamp(64, 2048))
                    .unwrap_or(512)
            });

            app.manage(AppState {
                repo,
                dm: tokio::sync::Mutex::new(Some(DmPipeline::new(choose_dm_backend_with(
                    Some(persisted_model.clone()),
                )))),
                memory: Mutex::new(memory),
                ollama_child: Mutex::new(ollama_child),
                current_model: Mutex::new(persisted_model),
                current_num_predict: Mutex::new(persisted_num_predict),
            });

            #[cfg(target_os = "windows")]
            {
                use tauri_plugin_frame::WebviewWindowExt;
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.create_overlay_titlebar() {
                        log::warn!("Failed to create overlay titlebar: {e}");
                    }
                }
            }

            // Global shortcut: CommandOrControl+Shift+D toggles focus to the main window.
            #[cfg(desktop)]
            {
                use tauri::Emitter as _;
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                if let Err(e) = app.global_shortcut().on_shortcut(
                    "CommandOrControl+Shift+D",
                    |app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                            let _ = app.emit("global:toggle-focus", ());
                        }
                    },
                ) {
                    log::warn!("Failed to register global shortcut: {e}");
                }
            }

            log::info!("Auto-DM started successfully");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut child) = state.ollama_child.lock() {
                        if let Some(ref mut c) = *child {
                            log::info!("Killing ollama serve (pid {})", c.id());
                            let _ = c.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::save_character,
            commands::load_character,
            commands::list_characters,
            commands::delete_character,
            commands::save_action,
            commands::list_actions,
            commands::delete_action,
            commands::save_stat_block,
            commands::list_stat_blocks,
            commands::delete_stat_block,
            commands::create_scene,
            commands::list_scenes,
            commands::active_scene,
            commands::set_active_scene,
            commands::delete_scene,
            commands::update_scene_summary,
            commands::update_scene_chaos_factor,
            commands::append_log,
            commands::list_logs,
            commands::roll_dice,
            commands::fate_check,
            commands::random_event,
            commands::scene_test_cmd,
            commands::get_lines_veils,
            commands::set_lines_veils,
            commands::create_doom_clock,
            commands::list_doom_clocks,
            commands::tick_doom_clock,
            commands::advance_doom_clock,
            commands::reset_doom_clock,
            commands::delete_doom_clock,
            commands::create_exploration_zone,
            commands::list_exploration_zones,
            commands::delete_exploration_zone,
            commands::create_exploration_node,
            commands::list_exploration_nodes,
            commands::update_exploration_node,
            commands::delete_exploration_node,
            commands::combat_attack,
            commands::initiative,
            commands::dm_resolve,
            commands::seed_defaults,
            commands::ping,
            commands::ollama_models,
            commands::get_ollama_model,
            commands::set_ollama_model,
            commands::get_ollama_num_predict,
            commands::set_ollama_num_predict,
            commands::ingest_memory,
            commands::export_campaign,
            commands::import_campaign,
            commands::save_loot,
            commands::assign_loot,
            commands::list_loot,
            commands::clear_loot,
            commands::save_npc_note,
            commands::list_npc_notes,
            commands::delete_npc_note,
            commands::save_combat_state,
            commands::load_combat_state,
            commands::roll_monster_loot,
            commands::save_thread,
            commands::update_thread_status,
            commands::list_threads,
            commands::delete_thread,
            commands::save_npc_character,
            commands::update_npc_character,
            commands::list_npc_characters,
            commands::delete_npc_character,
            commands::generate_campaign,
            commands::process_dm_intent,
            commands::get_random_encounter,
        ])
        .run(tauri::generate_context!())
        .expect("fatal: Tauri runtime failed to start");
}
