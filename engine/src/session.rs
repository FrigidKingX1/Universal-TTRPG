//! Session layer: world-effect application for intents that need state
//! access, plus campaign-memory recording. Lives in the engine crate so both
//! the Tauri client and the future Axum server share one implementation.

use auto_dm_core::intent::GameIntent;
use auto_dm_core::llm::{DmRequest, DmResponse};

use crate::state::{GameState, Repository};

/// Record a campaign event in both the in-memory ring buffer and SQLite so
/// the DM's context survives restarts. DB failures are non-fatal.
pub async fn remember(state: &GameState, speaker: &str, content: &str) {
    if let Ok(mut mem) = state.memory.lock() {
        mem.push(speaker, content);
    }
    let _ = state.repo.append_memory(speaker, content).await;
}

/// Session layer: apply world effects for intents the pure pipeline cannot
/// resolve (it has no DB access). Mutates campaign state and appends
/// mechanical-event lines describing what was applied.
pub async fn apply_session_effects(
    state: &GameState,
    request: &DmRequest,
    response: &mut DmResponse,
) {
    match &response.intent {
        GameIntent::SceneDelta { delta } => {
            let (Some(scene_id), delta) = (&request.scene_id, delta) else {
                return;
            };
            if delta.trim().is_empty() {
                return;
            }
            // Single-row fetch instead of loading all scenes (O(1) vs O(N) parse).
            let existing = state
                .repo
                .get_scene_summary(scene_id)
                .await
                .ok()
                .flatten()
                .unwrap_or_default();
            let mut merged =
                if existing.is_empty() { delta.clone() } else { format!("{existing}\n{delta}") };
            let char_count = merged.chars().count();
            if char_count > 2000 {
                merged = merged.chars().skip(char_count - 2000).collect();
            }
            if state.repo.update_scene_summary(scene_id, Some(&merged)).await.is_ok() {
                response.mechanical_events.push("Scene record updated.".to_string());
            }
        }
        GameIntent::NpcSpeech { npc_id, line } => {
            // Resolve the speaker against the NPC roster (by id or name) and
            // persist the line as a log entry attributed to that NPC.
            let npcs = state.repo.list_npc_characters().await.unwrap_or_default();
            let speaker = npc_id
                .as_ref()
                .and_then(|id| npcs.iter().find(|n| &n.id == id || &n.name == id))
                .map(|n| n.name.clone())
                .or_else(|| npc_id.clone())
                .unwrap_or_else(|| "NPC".to_string());
            if let Some(scene_id) = &request.scene_id {
                let _ = state.repo.append_log(scene_id, &speaker, line, None).await;
            }
            response.mechanical_events.push(format!("{speaker} speaks."));
        }
        GameIntent::RuleCheck { question } => {
            // Answer from world data: look for actions / stat blocks whose
            // names appear in the question.
            let q = question.to_lowercase();
            let mut answers: Vec<String> = Vec::new();
            if let Ok(actions) = state.repo.list_actions().await {
                for a in &actions {
                    let name = a.name.to_lowercase();
                    if !name.is_empty() && q.contains(&name) {
                        let formula = a
                            .resolution
                            .roll_formula
                            .clone()
                            .unwrap_or_else(|| "no roll".to_string());
                        answers.push(format!(
                            "Action '{}': {:?} resolution, rolls {}.",
                            a.name, a.resolution.resolution_type, formula,
                        ));
                    }
                }
            }
            if let Ok(blocks) = state.repo.list_stat_blocks().await {
                for b in &blocks {
                    let name = b.name.to_lowercase();
                    if name.len() > 2 && q.contains(&name) {
                        answers.push(format!(
                            "Stat block '{}': CR {}, AC {}, HP {}/{}.",
                            b.name,
                            b.challenge_rating,
                            b.armor_class,
                            b.hit_points.current,
                            b.hit_points.maximum,
                        ));
                    }
                }
            }
            if answers.is_empty() {
                response.mechanical_events.push(format!(
                    "Rule query '{question}': no matching rules data found in the vault."
                ));
            } else {
                for a in answers {
                    response.mechanical_events.push(a);
                }
            }
        }
        _ => {}
    }
}
