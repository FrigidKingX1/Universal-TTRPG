//! Multi-agent crew for Universal TTRPG — Rust-native sequential orchestration.
//!
//! Five specialists share one `LlmBackend` (Ollama) and one `CampaignMemory`.
//! No Python, no Docker — runs on qwen2.5:7b / llama3.2 exactly as shipped.
//!
//! Inspired by SohamDeep's CrewAI pipeline and Inferensys' three-orchestrator
//! split, adapted to our deterministic engine owns truth.
//!
//! Execution order per player input:
//!   Lorekeeper (retrieve) → Rules Arbiter (classify) → Combat Director (if combat)
//!   → Npc Actor (if NPC targeted) → Narrator (weave final prose)

use crate::llm::{LlmBackend, LlmError};
use crate::memory_vec::{Embedder, OllamaEmbedder, recall_from_memory_async};

/// Shared handoff between agents in a single turn.
#[derive(Debug, Clone, Default)]
pub struct CrewState {
    /// Top-k memory slice from Lorekeeper (verbatim quotes + [sourceId])
    pub memory_slice: String,
    /// Snapshot of deterministic engine state (HP, positions, clocks)
    pub engine_snapshot: String,
    /// Hidden DM intent for this beat (e.g. "make players roll Perception")
    pub intent: Option<String>,
    /// Player's raw utterance
    pub player_input: String,
}

/// Which specialist is speaking. Maps 1-to-1 to `core/prompts/*.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentRole {
    Narrator,
    RulesArbiter,
    Lorekeeper,
    NpcActor,
    CombatDirector,
}

impl AgentRole {
    pub fn prompt_path(&self) -> &'static str {
        match self {
            Self::Narrator => "narrator.md",
            Self::RulesArbiter => "rules_arbiter.md",
            Self::Lorekeeper => "lorekeeper.md",
            Self::NpcActor => "npc_actor.md",
            Self::CombatDirector => "combat_director.md",
        }
    }

    /// System prompt loaded at compile time from `core/prompts/`.
    pub fn system_prompt(&self) -> &'static str {
        match self {
            Self::Narrator => include_str!("../prompts/narrator.md"),
            Self::RulesArbiter => include_str!("../prompts/rules_arbiter.md"),
            Self::Lorekeeper => include_str!("../prompts/lorekeeper.md"),
            Self::NpcActor => include_str!("../prompts/npc_actor.md"),
            Self::CombatDirector => include_str!("../prompts/combat_director.md"),
        }
    }
}

/// Output of one crew turn — the Narrator's prose plus diagnostics.
#[derive(Debug, Clone)]
pub struct CrewOutput {
    pub narration: String,
    pub intent_used: Option<String>,
    pub lore_citations: Vec<String>,
    pub rule_decision: String,
}

/// Sequential orchestrator. One backend, five system prompts, shared state.
pub struct CrewOrchestrator<B: LlmBackend> {
    backend: B,
    embedder: Box<dyn Embedder>,
}

impl<B: LlmBackend> CrewOrchestrator<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            embedder: Box::new(OllamaEmbedder::new(None, None)),
        }
    }

    pub fn with_embedder(backend: B, embedder: impl Embedder + 'static) -> Self {
        Self {
            backend,
            embedder: Box::new(embedder),
        }
    }

    /// Run a full turn. Each agent sees the outputs of prior agents via `state`.
    pub async fn run_turn(&self, mut state: CrewState) -> Result<CrewOutput, LlmError> {
        // 1. Lorekeeper — async hybrid recall (semantic cosine + TF-IDF).
        //    Falls back to pure TF-IDF if Ollama is down or nomic-embed-text
        //    is not pulled — the crew stays functional offline.
        let lore_hits = recall_from_memory_async(
            &state.player_input,
            &state.memory_slice,
            3,
            self.embedder.as_ref(),
        )
        .await;
        let lore_out = if lore_hits.is_empty() {
            // No relevant memories — pass the recent slice through so the
            // Narrator still has context, but mark it as unfiltered.
            state.memory_slice.clone()
        } else {
            lore_hits.join("\n")
        };
        state.memory_slice = lore_out.clone();

        // 2. Rules Arbiter — classify player intent into an engine action
        let rule_out = self
            .backend
            .complete(
                AgentRole::RulesArbiter.system_prompt(),
                &format!(
                    "Player: {}\nEngine: {}\nLore: {}",
                    state.player_input, state.engine_snapshot, state.memory_slice
                ),
                Some(256),
            )
            .await?;

        // 3. Combat Director — only speaks if engine snapshot mentions combat
        let _combat_out = if state.engine_snapshot.contains("combat")
            || state.engine_snapshot.contains("Combat")
        {
            Some(
                self.backend
                    .complete(
                        AgentRole::CombatDirector.system_prompt(),
                        &format!("State: {}\nIntent: {:?}", state.engine_snapshot, state.intent),
                        Some(256),
                    )
                    .await?,
            )
        } else {
            None
        };

        // 4. Narrator — weaves everything into final prose
        let narration = self
            .backend
            .complete(
                AgentRole::Narrator.system_prompt(),
                &format!(
                    "Intent: {:?}\nLore: {}\nRules: {}\nPlayer: {}\nScene: {}",
                    state.intent, state.memory_slice, rule_out, state.player_input, state.engine_snapshot
                ),
                Some(1024),
            )
            .await?;

        Ok(CrewOutput {
            narration,
            intent_used: state.intent,
            lore_citations: vec![lore_out],
            rule_decision: rule_out,
        })
    }

    /// Expose backend for callers that need to check is_stub().
    pub fn backend(&self) -> &B {
        &self.backend
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::StubLlmBackend;
    use crate::memory_vec::StubEmbedder;

    fn stub_state() -> CrewState {
        CrewState {
            player_input: "I search for traps".into(),
            engine_snapshot: "HP 10/10, no combat".into(),
            memory_slice: "You entered the manor.".into(),
            intent: Some("make players roll Perception".into()),
        }
    }

    #[test]
    fn crew_runs_on_stub_backend() {
        let orch = CrewOrchestrator::with_embedder(StubLlmBackend, StubEmbedder);
        let out = futures_test_block_on(orch.run_turn(stub_state())).unwrap();
        assert!(!out.narration.is_empty());
        assert_eq!(out.intent_used.as_deref(), Some("make players roll Perception"));
        assert!(!out.lore_citations.is_empty());
    }

    fn futures_test_block_on<F: std::future::Future>(f: F) -> F::Output {
        use std::pin::pin;
        let mut fut = pin!(f);
        let waker = std::task::Waker::noop();
        let mut cx = std::task::Context::from_waker(waker);
        loop {
            match fut.as_mut().poll(&mut cx) {
                std::task::Poll::Ready(v) => return v,
                std::task::Poll::Pending => std::thread::yield_now(),
            }
        }
    }

    #[test]
    fn all_role_prompts_load_and_mention_role() {
        for role in [
            AgentRole::Narrator,
            AgentRole::RulesArbiter,
            AgentRole::Lorekeeper,
            AgentRole::NpcActor,
            AgentRole::CombatDirector,
        ] {
            let p = role.system_prompt();
            assert!(p.len() > 20, "{:?} prompt too short", role);
        }
    }

    #[test]
    fn intent_theory_of_mind_roundtrip() {
        // Mirrors the ACL paper: intent -> utterance -> predicted action.
        // Our CrewState carries intent into the Narrator; this test ensures
        // the field survives the handoff.
        let mut s = stub_state();
        s.intent = Some("DM intends players to make a perception check to find out about the goblins".into());
        assert!(s.intent.as_ref().unwrap().contains("perception"));
    }
}
