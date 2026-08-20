pub mod commands;
pub mod db;

use auto_dm_core::llm::{DmPipeline, LlmBackend, StubLlmBackend};
use auto_dm_core::memory::CampaignMemory;
use auto_dm_core::ollama::OllamaLlmBackend;
use db::{open_pool, run_migrations, AppState, SqliteRepository};
use std::sync::Mutex;
use tauri::Manager;

/// Try to start the `ollama serve` child process. Returns the Child handle
/// if successfully spawned, or None if Ollama was already reachable.
fn try_start_ollama() -> Option<std::process::Child> {
    if OllamaLlmBackend::reachable() {
        println!("Auto-DM: Ollama already running");
        return None;
    }
    println!("Auto-DM: attempting to start `ollama serve`...");
    match std::process::Command::new("ollama")
        .arg("serve")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            println!("Auto-DM: ollama serve started (pid {})", child.id());
            Some(child)
        }
        Err(e) => {
            println!("Auto-DM: failed to start ollama serve: {e}");
            None
        }
    }
}

/// Select the DM narrative backend: connect to Ollama when reachable,
/// otherwise fall back to the deterministic stub so the app is always usable.
fn choose_dm_backend() -> Box<dyn LlmBackend> {
    if OllamaLlmBackend::reachable() {
        println!("Auto-DM: using Ollama backend @ localhost:11434");
        Box::new(OllamaLlmBackend::new(None))
    } else {
        println!("Auto-DM: Ollama not reachable; using stub backend");
        Box::new(StubLlmBackend)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("campaign_data.db");

            let pool = tauri::async_runtime::block_on(async {
                let pool = open_pool(&db_path).await?;
                run_migrations(&pool).await?;
                Ok::<_, Box<dyn std::error::Error>>(pool)
            })?;

            let ollama_child = try_start_ollama();

            app.manage(AppState {
                repo: SqliteRepository::new(pool),
                dm: tokio::sync::Mutex::new(Some(DmPipeline::new(choose_dm_backend()))),
                memory: Mutex::new(CampaignMemory::new()),
                ollama_child: Mutex::new(ollama_child),
                current_model: Mutex::new("llama3.2".to_string()),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut child) = state.ollama_child.lock() {
                        if let Some(ref mut c) = *child {
                            println!("Auto-DM: killing ollama serve (pid {})", c.id());
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
            commands::combat_attack,
            commands::initiative,
            commands::dm_resolve,
            commands::seed_defaults,
            commands::ping,
            commands::ollama_models,
            commands::get_ollama_model,
            commands::set_ollama_model,
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
        ])
        .run(tauri::generate_context!())
        .expect("fatal: Tauri runtime failed to start");
}
