//! Session layer: world-effect application for intents that need state
//! access, plus campaign-memory recording. Lives in the engine crate so both
//! the Tauri client and the future Axum server share one implementation.

use auto_dm_core::intent::GameIntent;
use auto_dm_core::llm::{DmRequest, DmResponse};

use crate::events::GameEvent;
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
/// resolve (it has no DB access). Mutates campaign state, appends
/// mechanical-event lines describing what was applied, and returns the
/// structured [`GameEvent`]s (the future broadcast/audit stream).
pub async fn apply_session_effects(
    state: &GameState,
    request: &DmRequest,
    response: &mut DmResponse,
) -> Vec<GameEvent> {
    let mut events: Vec<GameEvent> = Vec::new();
    match &response.intent {
        GameIntent::SceneDelta { delta } => {
            let (Some(scene_id), delta) = (&request.scene_id, delta) else {
                return events;
            };
            if delta.trim().is_empty() {
                return events;
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
                events.push(GameEvent::SceneUpdated { scene_id: scene_id.clone() });
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
            events.push(GameEvent::NpcSpoke { speaker });
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
                events.push(GameEvent::RuleAnswered { question: question.clone() });
            }
        }
        GameIntent::AddItem { name, quantity } => {
            let sid = request.scene_id.clone().unwrap_or_default();
            if *quantity > 0
                && !sid.is_empty()
                && state.repo.save_loot(&sid, name, *quantity, "DM").await.is_ok()
            {
                events.push(GameEvent::ItemAdded { name: name.clone(), quantity: *quantity });
            }
            response.mechanical_events.push(format!("Item added to scene loot: {quantity}x {name}"));
        }
        GameIntent::AdvanceClock { clock_id, ticks } => {
            let ticks_u = (*ticks).max(0) as u32;
            // Generic disambiguation (shared shape with Phase B narrative
            // pronouns): resolve by exact id/name; if ambiguous or missing,
            // surface candidates instead of guessing.
            let clocks = state.repo.list_doom_clocks().await.unwrap_or_default();
            let active: Vec<_> = clocks.iter().filter(|cl| cl.active).collect();
            let resolution = match clock_id {
                Some(id) => {
                    let matches: Vec<_> =
                        active.iter().filter(|cl| cl.id == *id || cl.label == *id).collect();
                    match matches.len() {
                        1 => Ok(*matches[0]),
                        0 => Err(active.iter().map(|cl| cl.label.clone()).collect::<Vec<_>>()),
                        _ => Err(matches.iter().map(|cl| cl.label.clone()).collect::<Vec<_>>()),
                    }
                }
                None => {
                    if active.len() == 1 {
                        Ok(active[0])
                    } else {
                        Err(active.iter().map(|cl| cl.label.clone()).collect::<Vec<_>>())
                    }
                }
            };
            match resolution {
                Ok(cl) => {
                    if let Ok(Some((current, max))) =
                        state.repo.advance_doom_clock(&cl.id, ticks_u).await
                    {
                        events.push(GameEvent::ClockAdvanced { clock_id: cl.id.clone(), ticks: *ticks });
                        if current == 0 {
                            response.mechanical_events.push("DOOM CLOCK EXPIRED".to_string());
                        } else {
                            response.mechanical_events.push(format!("Doom clock: {current}/{max}"));
                        }
                    }
                }
                Err(candidates) if !candidates.is_empty() => {
                    events.push(GameEvent::AmbiguousTarget {
                        kind: "clock".into(),
                        message: "Multiple doom clocks are active — specify which one.".into(),
                        candidates,
                    });
                }
                Err(_) => {
                    response.mechanical_events.push("No active doom clock to advance.".to_string());
                }
            }
        }
        GameIntent::ApplyCondition { target, condition } => {
            // Tag-only effect for now; combat-engine integration lands in Phase B.
            events.push(GameEvent::ConditionApplied {
                target: target.clone(),
                condition: condition.clone(),
            });
            response.mechanical_events.push(format!("Condition '{condition}' marked on {target}."));
        }
        _ => {}
    }
    for e in &events {
        response.mechanical_events.push(e.describe());
    }
    events
}
