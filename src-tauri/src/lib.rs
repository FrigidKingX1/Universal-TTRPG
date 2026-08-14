pub mod commands;
pub mod db;

use auto_dm_core::llm::{DmPipeline, LlmBackend, StubLlmBackend};
use db::{open_pool, run_migrations, AppState, SqliteRepository};
use tauri::Manager;

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

            app.manage(AppState {
                repo: SqliteRepository::new(pool),
                dm: DmPipeline::new(Box::new(StubLlmBackend) as Box<dyn LlmBackend>),
            });
            Ok(())
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
            commands::append_log,
            commands::list_logs,
            commands::roll_dice,
            commands::fate_check,
            commands::random_event,
            commands::combat_attack,
            commands::initiative,
            commands::dm_resolve,
            commands::ping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
