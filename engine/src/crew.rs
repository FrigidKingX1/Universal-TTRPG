//! Crew integration — wires `core::agents::CrewOrchestrator` into the
//! engine's session loop. This is the "engine owns truth" seam:
//! the crew proposes via LLM, the engine validates via `apply_session_effects`
//! and the event store.

use auto_dm_core::agents::{CrewOrchestrator, CrewState};
use auto_dm_core::llm::{DmRequest, DmResponse, LlmBackend};

use crate::state::GameState;

/// Result of one crew turn, ready to be remembered and broadcast.
#[derive(Debug, Clone)]
pub struct CrewTurnOutput {
    pub response: DmResponse,
    pub lore_used: Vec<String>,
}

/// Run a full 5-agent turn using the shared `GameState` backend.
///
/// - `player_input` is the raw utterance
/// - `intent_hint` is an optional hidden DM goal (Theory-of-Mind)
/// - `state` provides `repo` for future vector recall and `memory` for context
///
/// Currently sequential and offline-first: Lorekeeper is deterministic
/// (TF-IDF), the other three agents share one `LlmBackend` (Ollama).
/// No Python, no Docker.
pub async fn run_crew_turn<B>(
    orchestrator: &CrewOrchestrator<B>,
    game_state: &GameState,
    request: &DmRequest,
) -> Result<CrewTurnOutput, auto_dm_core::llm::LlmError>
where
    B: LlmBackend,
{
    // Snapshot deterministic state for the crew
    let memory_slice = {
        let mem = game_state.memory.lock().unwrap_or_else(|e| e.into_inner());
        mem.to_context(20)
    };
    let engine_snapshot = format!(
        "chaos={} scene={:?} memory_len={}",
        request.chaos_factor,
        request.scene_summary.chars().take(80).collect::<String>(),
        memory_slice.lines().count()
    );

    let crew_state = CrewState {
        player_input: request.player_action.clone(),
        engine_snapshot,
        memory_slice,
        intent: None, // Future: caller passes the hidden intent string here
    };

    let crew_out = orchestrator.run_turn(crew_state).await?;

    // For now, wrap the crew's narration as a DmResponse via the existing
    // pipeline shape. The session layer will still call
    // `apply_session_effects` to validate and persist, so the engine remains
    // authoritative. This keeps the event store contract intact.
    //
    // Minimal mapping: narration + empty mechanical events; the full
    // Rules Arbiter → GameIntent parsing will replace this stub in the next
    // iteration (parsing crew_out.rule_decision as GameIntent).
    let response = DmResponse {
        narrative: crew_out.narration.clone(),
        mechanical_events: vec![],
        fate_interpretation: String::new(),
        fate_roll: 0,
        fate_target: 0,
        chaos_factor: request.chaos_factor,
        event_meaning: None,
        intent: auto_dm_core::intent::GameIntent::Narration { text: crew_out.narration.clone() },
        source: "crew".to_string(),
    };

    Ok(CrewTurnOutput { response, lore_used: crew_out.lore_citations })
}

#[cfg(test)]
mod tests {
    use super::*;
    use auto_dm_core::agents::AgentRole;

    #[test]
    fn crew_module_exports_are_accessible() {
        // Smoke: the module compiles and re-exports core agents.
        let _role = AgentRole::Narrator;
        assert!(matches!(_role, AgentRole::Narrator));
    }

    #[test]
    fn crew_state_default_is_empty() {
        let s = CrewState::default();
        assert!(s.memory_slice.is_empty());
        assert!(s.intent.is_none());
    }
}
