//! Session layer: world-effect application for intents that need state
//! access, plus campaign-memory recording. Lives in the engine crate so both
//! the Tauri client and the future Axum server share one implementation.

use auto_dm_core::intent::GameIntent;
use auto_dm_core::llm::{DmRequest, DmResponse};

use crate::events::GameEvent;
use crate::state::{GameState, Repository};

// ── Target resolution (the "pronoun interceptor") ────────────────────

/// Lightweight entity reference used for descriptor matching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityRef {
    pub id: String,
    pub name: String,
}

/// Result of resolving a free-text descriptor against a live entity roster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveResult {
    /// Exactly one entity matched.
    Resolved(EntityRef),
    /// Two or more entities matched — the caller should emit `AmbiguousTarget`.
    Ambiguous { candidates: Vec<String> },
    /// No entities matched — the caller should surface a clean rejection.
    NotFound,
}

/// Strip common filler and normalise for case-insensitive matching.
fn normalize(s: &str) -> String {
    let t = s.to_lowercase();
    let t = t.trim();
    // Strip leading "the " / "a " / "an " — the LLM often prepends articles.
    let t = t.strip_prefix("the ").unwrap_or(t);
    let t = t.strip_prefix("a ").unwrap_or(t);
    let t = t.strip_prefix("an ").unwrap_or(t);
    t.trim().to_string()
}

/// Match a free-text descriptor against a list of live entities.
///
/// Matching strategy (intentionally simple — no prose parsing):
/// 1. **Exact** normalised name match → single result (fast path).
/// 2. **Substring** — descriptor is contained in the entity name (or vice
///    versa) after normalisation → collect all hits.
/// 3. Nothing matches → `NotFound`.
///
/// This is the engine-side equivalent of the clock resolution already used
/// in `AdvanceClock`: the LLM proposes a descriptor, the engine resolves
/// it against what's actually present.
pub fn resolve_entity_descriptor(descriptor: &str, entities: &[EntityRef]) -> ResolveResult {
    let needle = normalize(descriptor);
    if needle.is_empty() {
        return ResolveResult::NotFound;
    }

    // 1. Exact match (fast path).
    let exact: Vec<&EntityRef> =
        entities.iter().filter(|e| normalize(&e.name) == needle).collect();
    if exact.len() == 1 {
        return ResolveResult::Resolved(exact[0].clone());
    }

    // 2. Substring match (needle ⊆ name  OR  name ⊆ needle).
    let hits: Vec<&EntityRef> = entities
        .iter()
        .filter(|e| {
            let hay = normalize(&e.name);
            hay.contains(&needle) || needle.contains(&hay)
        })
        .collect();

    match hits.len() {
        0 => ResolveResult::NotFound,
        1 => ResolveResult::Resolved(hits[0].clone()),
        _ => ResolveResult::Ambiguous {
            candidates: hits.into_iter().map(|e| e.name.clone()).collect(),
        },
    }
}

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
        GameIntent::ApplyCondition { target, condition, kind } => {
            // Resolve the descriptor against the live entity roster before
            // applying.  `kind` defaults to Npc (backward-compat with old
            // LLM output that omits it).
            let target_kind = kind.unwrap_or(auto_dm_core::intent::TargetKind::Npc);
            let resolved_name: Option<String> = match target_kind {
                auto_dm_core::intent::TargetKind::Npc => {
                    let npcs = state.repo.list_npc_characters().await.unwrap_or_default();
                    let entities: Vec<EntityRef> = npcs
                        .iter()
                        .filter(|n| n.alive)
                        .map(|n| EntityRef { id: n.id.clone(), name: n.name.clone() })
                        .collect();
                    match resolve_entity_descriptor(target, &entities) {
                        ResolveResult::Resolved(e) => Some(e.name),
                        ResolveResult::Ambiguous { candidates } => {
                            events.push(GameEvent::AmbiguousTarget {
                                kind: "npc".into(),
                                message: format!(
                                    "Multiple NPCs match '{target}' — specify which one."
                                ),
                                candidates,
                            });
                            return events;
                        }
                        ResolveResult::NotFound => {
                            response.mechanical_events.push(format!(
                                "No NPC matching '{target}' is present."
                            ));
                            return events;
                        }
                    }
                }
                _ => Some(target.clone()),
            };
            let resolved = resolved_name.unwrap();
            events.push(GameEvent::ConditionApplied {
                target: resolved.clone(),
                condition: condition.clone(),
            });
            response
                .mechanical_events
                .push(format!("Condition '{condition}' marked on {resolved}."));
        }
        _ => {}
    }
    for e in &events {
        response.mechanical_events.push(e.describe());
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cultist(id: &str, name: &str) -> EntityRef {
        EntityRef { id: id.into(), name: name.into() }
    }

    // ── Golden tests: the three canonical cases ──────────────────────

    #[test]
    fn ambiguous_n_cultists() {
        let entities = vec![
            cultist("c1", "Cultist"),
            cultist("c2", "Cultist"),
            cultist("c3", "Cultist"),
        ];
        match resolve_entity_descriptor("the cultist", &entities) {
            ResolveResult::Ambiguous { candidates } => assert_eq!(candidates.len(), 3),
            other => panic!("expected Ambiguous, got {other:?}"),
        }
    }

    #[test]
    fn resolves_single_match() {
        let entities = vec![cultist("c1", "Cultist")];
        match resolve_entity_descriptor("the cultist", &entities) {
            ResolveResult::Resolved(e) => assert_eq!(e.id, "c1"),
            other => panic!("expected Resolved, got {other:?}"),
        }
    }

    #[test]
    fn not_found_when_empty() {
        let entities = vec![];
        assert_eq!(
            resolve_entity_descriptor("the cultist", &entities),
            ResolveResult::NotFound
        );
    }

    // ── Matching subtleties ─────────────────────────────────────────

    #[test]
    fn exact_match_beats_substring() {
        // "Guard" is exact; "Captain Guard" is substring — exact wins.
        let entities = vec![cultist("g1", "Guard"), cultist("g2", "Captain Guard")];
        match resolve_entity_descriptor("guard", &entities) {
            ResolveResult::Resolved(e) => assert_eq!(e.name, "Guard"),
            other => panic!("expected Resolved(Guard), got {other:?}"),
        }
    }

    #[test]
    fn substring_matches_subset() {
        // Descriptor "cultist" is contained in "Lead Cultist".
        let entities = vec![cultist("c1", "Lead Cultist")];
        match resolve_entity_descriptor("cultist", &entities) {
            ResolveResult::Resolved(e) => assert_eq!(e.id, "c1"),
            other => panic!("expected Resolved, got {other:?}"),
        }
    }

    #[test]
    fn articles_stripped() {
        let entities = vec![cultist("c1", "Cultist")];
        match resolve_entity_descriptor("a cultist", &entities) {
            ResolveResult::Resolved(e) => assert_eq!(e.id, "c1"),
            other => panic!("expected Resolved, got {other:?}"),
        }
    }

    #[test]
    fn case_insensitive() {
        let entities = vec![cultist("c1", "CULTIST")];
        match resolve_entity_descriptor("The Cultist", &entities) {
            ResolveResult::Resolved(e) => assert_eq!(e.id, "c1"),
            other => panic!("expected Resolved, got {other:?}"),
        }
    }

    #[test]
    fn empty_descriptor_is_not_found() {
        let entities = vec![cultist("c1", "Cultist")];
        assert_eq!(resolve_entity_descriptor("", &entities), ResolveResult::NotFound);
    }
}
