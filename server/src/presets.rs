//! Preset content library embedded in the server binary.
//!
//! The JSON payloads are generated from the frontend's TypeScript preset
//! library (`src/presets/{actions,bestiary}.ts`) by
//! `scripts/export_presets.ts` and committed here, so every hosted session
//! ships with the full bestiary and action vault without importing a
//! campaign file first.
//!
//! To refresh after changing TS presets:
//! ```text
//! npx esbuild scripts/export_presets.ts --bundle --platform=node --format=esm --outfile=.tmp-export/export.mjs
//! node .tmp-export/export.mjs && rm -rf .tmp-export
//! ```

use auto_dm_core::models::{ActionDefinition, EncounterStatBlock};
use auto_dm_engine::{DbError, Repository};

pub const PRESET_ACTIONS_JSON: &str = include_str!("../assets/preset_actions.json");
pub const PRESET_MONSTERS_JSON: &str = include_str!("../assets/preset_monsters.json");

/// Parse the embedded action library (panics on corruption — build-time data).
pub fn preset_actions() -> Vec<ActionDefinition> {
    serde_json::from_str(PRESET_ACTIONS_JSON).expect("embedded preset actions are valid JSON")
}

/// Parse the embedded monster library. Every entry carries a deterministic
/// `preset_<key>` id assigned at export time.
pub fn preset_stat_blocks() -> Vec<EncounterStatBlock> {
    serde_json::from_str(PRESET_MONSTERS_JSON).expect("embedded preset monsters are valid JSON")
}

/// Idempotently seed any missing preset content into a session repository.
///
/// Actions are matched by id; stat blocks are skipped when either their id
/// or their name already exists (so a host-imported campaign keeps its own
/// copies without creating duplicates). Returns `(actions, monsters)` inserted.
pub async fn seed_content(
    repo: &auto_dm_engine::SqliteRepository,
) -> Result<(usize, usize), DbError> {
    let mut actions_inserted = 0usize;
    let existing_action_ids: std::collections::HashSet<String> =
        repo.list_actions().await?.into_iter().map(|a| a.id).collect();
    for action in preset_actions() {
        if existing_action_ids.contains(&action.id) {
            continue;
        }
        repo.save_action(&action).await?;
        actions_inserted += 1;
    }

    let mut monsters_inserted = 0usize;
    let existing = repo.list_stat_blocks().await?;
    let existing_ids: std::collections::HashSet<String> =
        existing.iter().map(|b| b.id.clone()).collect();
    let existing_names: std::collections::HashSet<String> =
        existing.iter().map(|b| b.name.clone()).collect();
    for block in preset_stat_blocks() {
        if existing_ids.contains(&block.id) || existing_names.contains(&block.name) {
            continue;
        }
        repo.save_stat_block(&block).await?;
        monsters_inserted += 1;
    }

    Ok((actions_inserted, monsters_inserted))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_libraries_parse_and_are_substantial() {
        let actions = preset_actions();
        let monsters = preset_stat_blocks();
        assert!(actions.len() >= 90, "expected ~100 actions, got {}", actions.len());
        assert!(monsters.len() >= 180, "expected ~188 monsters, got {}", monsters.len());
    }

    #[test]
    fn every_monster_has_a_deterministic_preset_id() {
        for m in preset_stat_blocks() {
            assert!(m.id.starts_with("preset_"), "{} has id {}", m.name, m.id);
        }
    }

    #[test]
    fn every_monster_action_reference_resolves() {
        let actions = preset_actions();
        let ids: std::collections::HashSet<&str> =
            actions.iter().map(|a| a.id.as_str()).collect();
        let missing: Vec<String> = preset_stat_blocks()
            .iter()
            .flat_map(|m| m.actions.iter().map(move |a| (m.name.clone(), a.clone())))
            .filter(|(_, a)| !ids.contains(a.as_str()))
            .map(|(name, a)| format!("{name}: {a}"))
            .collect();
        assert!(missing.is_empty(), "unresolved action refs: {missing:?}");
    }

    #[tokio::test]
    async fn seeding_is_idempotent_and_respects_imported_names() {
        let dir = std::env::temp_dir().join(format!("auto-dm-seed-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let pool = auto_dm_engine::open_pool(&dir.join("test.db")).await.unwrap();
        auto_dm_engine::run_migrations(&pool).await.unwrap();
        let repo = auto_dm_engine::SqliteRepository::new(pool);

        // First run seeds everything; second run inserts nothing.
        let (a1, m1) = seed_content(&repo).await.unwrap();
        assert!(a1 >= 90, "seeded {a1} actions");
        assert!(m1 >= 180, "seeded {m1} monsters");
        let (a2, m2) = seed_content(&repo).await.unwrap();
        assert_eq!((a2, m2), (0, 0), "second seed must be a no-op");

        // A host-imported copy under a different id suppresses reseed by name.
        let mut goblin = preset_stat_blocks()
            .into_iter()
            .find(|m| m.name == "Goblin")
            .expect("preset library contains a Goblin");
        goblin.id = "host_own_goblin".to_string();
        assert!(repo.delete_stat_block("preset_goblin").await.unwrap());
        repo.save_stat_block(&goblin).await.unwrap();
        let (_, m3) = seed_content(&repo).await.unwrap();
        assert_eq!(m3, 0, "same-named imported block must not be duplicated");

        std::fs::remove_dir_all(&dir).ok();
    }
}
