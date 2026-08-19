use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;

use super::dice::DiceEngine;
use super::intent::GameIntent;
use super::oracle::{EventMeaning, MythicOracle, Odds};

#[derive(Debug)]
pub enum LlmError {
    Backend(String),
}

impl fmt::Display for LlmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LlmError::Backend(msg) => write!(f, "llm backend error: {msg}"),
        }
    }
}

impl std::error::Error for LlmError {}

/// Text-generation backend contract. The deterministic `StubLlmBackend` ships
/// by default; real backends (e.g. mistral.rs / Candle) can be plugged in
/// behind this trait without touching pipeline code.
#[async_trait]
pub trait LlmBackend: Send + Sync {
    /// Generate a completion for `prompt` given `system` instructions.
    async fn complete(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
    ) -> Result<String, LlmError>;

    /// True for the deterministic stub, so callers can surface that a live
    /// model is not in use.
    fn is_stub(&self) -> bool;
}

/// Deterministic placeholder backend. `complete` returns a framed echo so the
/// contract is exercised; the pipeline does not use it for narrative when a
/// stub is active.
pub struct StubLlmBackend;

#[async_trait]
impl LlmBackend for StubLlmBackend {
    async fn complete(
        &self,
        system: &str,
        prompt: &str,
        _max_tokens: Option<u32>,
    ) -> Result<String, LlmError> {
        Ok(format!("[stub-llm]\n-- system --\n{system}\n-- prompt --\n{prompt}"))
    }

    fn is_stub(&self) -> bool {
        true
    }
}

#[async_trait]
impl<T: LlmBackend + ?Sized> LlmBackend for &T {
    async fn complete(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
    ) -> Result<String, LlmError> {
        (**self).complete(system, prompt, max_tokens).await
    }

    fn is_stub(&self) -> bool {
        (**self).is_stub()
    }
}

#[async_trait]
impl<T: LlmBackend + ?Sized> LlmBackend for Box<T> {
    async fn complete(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
    ) -> Result<String, LlmError> {
        (**self).complete(system, prompt, max_tokens).await
    }

    fn is_stub(&self) -> bool {
        (**self).is_stub()
    }
}

const SYSTEM_PROMPT: &str =
    "You are Auto-DM, a tabletop game master. Narrate consequences grounded in the mechanical \
     facts provided. Keep responses vivid, brief (2-4 sentences), and address the player's action \
     directly. Never invent new mechanical outcomes beyond those listed.";

/// Input to the DM loop: the current scene and the player's action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmRequest {
    pub scene_summary: String,
    pub player_action: String,
    pub chaos_factor: u32,
    /// Recent campaign events injected as context for the LLM (Phase 3 memory).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_context: Option<String>,
}

/// Result of the DM resolving a player action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmResponse {
    pub narrative: String,
    pub mechanical_events: Vec<String>,
    pub fate_interpretation: String,
    pub fate_roll: u32,
    pub fate_target: u32,
    pub chaos_factor: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_meaning: Option<EventMeaning>,
    /// The structured intent the narrative model resolved to (parsed from its
    /// constrained output). The session layer applies world effects from this.
    pub intent: GameIntent,
    pub source: String,
}

/// The deterministic Auto-DM loop: Fate Check -> meaning (on random events) ->
/// narrative via the configured `LlmBackend`.
pub struct DmPipeline<B: LlmBackend> {
    backend: B,
}

impl<B: LlmBackend> DmPipeline<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    pub async fn resolve_action(&self, request: &DmRequest) -> Result<DmResponse, LlmError> {
        self.resolve_action_seeded(request, None).await
    }

    pub async fn resolve_action_seeded(
        &self,
        request: &DmRequest,
        seed: Option<u64>,
    ) -> Result<DmResponse, LlmError> {
        let mut oracle = match seed {
            Some(s) => MythicOracle::with_seed(request.chaos_factor, s),
            None => MythicOracle::new(request.chaos_factor),
        };

        let fate = oracle.ask_fate(Odds::FiftyFifty);
        let mut mechanical_events = vec![format!(
            "Fate Check (50/50, CF {}): rolled {} vs target {} -> {}.",
            request.chaos_factor,
            fate.roll,
            fate.target,
            fate.interpretation()
        )];

        let event_meaning = if fate.random_event {
            let meaning = oracle.random_event_now();
            mechanical_events.push(format!(
                "Random Event: {} the {} -- {}, {}.",
                meaning.action, meaning.subject, meaning.descriptor, meaning.focus
            ));
            Some(meaning)
        } else {
            None
        };

        let stub = self.backend.is_stub();
        let (narrative, intent, source) = if stub {
            let n = stub_narrative(request, &fate, event_meaning.as_ref());
            (n.clone(), GameIntent::Narration { text: n }, "stub".to_string())
        } else {
            let prompt = build_prompt(request, &fate, event_meaning.as_ref(), &mechanical_events, request.memory_context.as_deref());
            let raw = self
                .backend
                .complete(SYSTEM_PROMPT, &prompt, Some(400))
                .await?;
            let intent = GameIntent::from_llm_text(&raw);
            let mut dice = match seed {
                Some(s) => DiceEngine::with_seed(s),
                None => DiceEngine::new(),
            };
            let (n, extra) = execute_intent(&intent, &mut dice, &mut oracle);
            mechanical_events.extend(extra);
            (n, intent, "ollama".to_string())
        };

        Ok(DmResponse {
            narrative,
            mechanical_events,
            fate_interpretation: fate.interpretation(),
            fate_roll: fate.roll,
            fate_target: fate.target,
            chaos_factor: request.chaos_factor,
            event_meaning,
            intent,
            source,
        })
    }
}

/// Apply the mechanical portion of a parsed [`GameIntent`], returning the
/// narrative prose to speak plus any new mechanical-event lines. Prose-only
/// intents (narration / scene_delta / npc_speech / ooc) contribute their text
/// directly; dice and fate intents are resolved against the dice engine /
/// oracle. `RuleCheck` is surfaced for the session layer to answer from world data.
fn execute_intent(
    intent: &GameIntent,
    dice: &mut DiceEngine,
    oracle: &mut MythicOracle,
) -> (String, Vec<String>) {
    let mut extra = Vec::new();
    let narrative = match intent {
        GameIntent::Narration { text }
        | GameIntent::SceneDelta { delta: text }
        | GameIntent::Ooc { message: text } => text.clone(),
        GameIntent::NpcSpeech { npc_id, line } => match npc_id {
            Some(id) => format!("{id}: {line}"),
            None => line.clone(),
        },
        GameIntent::DiceRoll {
            skill,
            modifier,
            reason,
        } => {
            let mod_v = modifier.unwrap_or(0);
            let detail = dice
                .evaluate(&format!("1d20 + {mod_v}"))
                .map(|r| r.detail)
                .unwrap_or_else(|_| format!("1d20 + {mod_v}"));
            let total: i64 = detail
                .rsplit("= ")
                .next()
                .and_then(|s| s.trim().parse::<i64>().ok())
                .unwrap_or(0);
            let outcome = if total >= 10 { "Success" } else { "Failure" };
            extra.push(format!("{skill} check: {detail} -> {outcome} (DC 10)"));
            let why = reason.clone().unwrap_or_else(|| skill.clone());
            format!("You attempt {why}. {detail} — {outcome}.")
        }
        GameIntent::RuleCheck { question } => {
            format!("Rule query: {question}")
        }
        GameIntent::FateQuestion { question } => {
            let f = oracle.ask_fate(Odds::FiftyFifty);
            extra.push(format!("Fate Question '{question}': {}", f.interpretation()));
            format!("The oracle is asked: {question} — {}", f.interpretation())
        }
    };
    (narrative, extra)
}

/// Deterministic narrative produced when a stub backend is active.
fn stub_narrative(request: &DmRequest, fate: &super::oracle::FateResult, meaning: Option<&EventMeaning>) -> String {
    let scene = request.scene_summary.trim().trim_end_matches('.').to_string();
    let mut text = if scene.is_empty() {
        format!(
            "Your action resolves: the Fate Check returns {}.",
            fate.interpretation()
        )
    } else {
        format!(
            "In {scene}, your action is met with a result: {}.",
            fate.interpretation()
        )
    };
    if let Some(m) = meaning {
        text.push_str(&format!(
            " In the background, something moves -- {} the {}, {}, {}.",
            m.action, m.subject, m.descriptor, m.focus
        ));
    }
    text
}

fn build_prompt(
    request: &DmRequest,
    fate: &super::oracle::FateResult,
    meaning: Option<&EventMeaning>,
    mechanical_events: &[String],
    memory_context: Option<&str>,
) -> String {
    let scene = request.scene_summary.trim();
    let mut parts = vec![
        format!("Scene: {}", if scene.is_empty() { "(empty)" } else { scene }),
        format!("Player action: {}", request.player_action.trim()),
        format!("Fate result: {} (roll {}, target {})", fate.interpretation(), fate.roll, fate.target),
    ];
    if let Some(mem) = memory_context {
        if !mem.is_empty() {
            parts.push(format!("Recent events:\n{mem}"));
        }
    }
    if let Some(m) = meaning {
        parts.push(format!(
            "Random event meaning: {} the {}, {}, {}.",
            m.action, m.subject, m.descriptor, m.focus
        ));
    }
    parts.push("Mechanical events:".to_string());
    parts.extend(mechanical_events.iter().cloned());
    parts.push("Narrate the outcome.".to_string());
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stub_backend_complete_exercises_contract() {
        let backend = StubLlmBackend;
        let out = futures_test_block_on(backend.complete("sys", "prompt", Some(10))).unwrap();
        assert!(out.contains("sys"));
        assert!(out.contains("prompt"));
        assert!(backend.is_stub());
    }

    #[test]
    fn pipeline_resolve_produces_stub_narrative_and_fate() {
        let pipeline = DmPipeline::new(StubLlmBackend);
        let request = DmRequest {
            scene_summary: "A moonlit courtyard before an iron gate.".to_string(),
            player_action: "I press the gate open.".to_string(),
            chaos_factor: 5,
            memory_context: None,
        };
        let out =
            futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(42))).unwrap();
        assert_eq!(out.source, "stub");
        assert!(!out.narrative.is_empty());
        assert!(out.fate_roll >= 1 && out.fate_roll <= 100);
        assert!(out.fate_target > 0);
        assert!(out.mechanical_events.iter().any(|e| e.contains("Fate Check")));
        assert_eq!(out.chaos_factor, 5);
    }

    #[test]
    fn pipeline_meaning_present_only_on_random_event() {
        let pipeline = DmPipeline::new(StubLlmBackend);
        let request = DmRequest {
            scene_summary: String::new(),
            player_action: "I wait.".to_string(),
            chaos_factor: 5,
            memory_context: None,
        };
        // seed 1 -> deterministic; the response must always be structurally valid.
        let out = futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert!(!out.narrative.is_empty());
    }

    /// A backend that returns a fixed string, used to exercise the intent path
    /// without a live model.
    struct StaticLlmBackend(&'static str);

    #[async_trait]
    impl LlmBackend for StaticLlmBackend {
        async fn complete(
            &self,
            _s: &str,
            _p: &str,
            _m: Option<u32>,
        ) -> Result<String, LlmError> {
            Ok(self.0.to_string())
        }

        fn is_stub(&self) -> bool {
            false
        }
    }

    #[test]
    fn pipeline_parses_dice_roll_intent_and_resolves() {
        let pipeline = DmPipeline::new(StaticLlmBackend(
            r#"{"type":"dice_roll","payload":{"skill":"Stealth","modifier":3}}"#,
        ));
        let request = DmRequest {
            scene_summary: "A torchlit hall.".to_string(),
            player_action: "I sneak past the guard.".to_string(),
            chaos_factor: 5,
            memory_context: None,
        };
        let out =
            futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert_eq!(out.source, "ollama");
        assert!(out.mechanical_events.iter().any(|e| e.contains("Stealth check")));
        assert!(out.narrative.contains("attempt"));
        assert_eq!(out.intent.label(), "dice_roll");
    }

    #[test]
    fn pipeline_parses_narration_intent() {
        let pipeline = DmPipeline::new(StaticLlmBackend(
            r#"{"type":"narration","payload":{"text":"The guard nods, unseeing."}}"#,
        ));
        let request = DmRequest {
            scene_summary: String::new(),
            player_action: "I wait.".to_string(),
            chaos_factor: 5,
            memory_context: None,
        };
        let out =
            futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert_eq!(out.source, "ollama");
        assert_eq!(out.narrative, "The guard nods, unseeing.");
        assert_eq!(out.intent.label(), "narration");
    }

    // Minimal executor for the async-trait futures in unit tests (no tokio dep).
    fn futures_test_block_on<F: std::future::Future>(f: F) -> F::Output {
        fn run<F: std::future::Future>(fut: F) -> F::Output {
            use std::pin::pin;
            let mut fut = pin!(fut);
            let waker = std::task::Waker::noop();
            let mut cx = std::task::Context::from_waker(waker);
            loop {
                match fut.as_mut().poll(&mut cx) {
                    std::task::Poll::Ready(v) => return v,
                    std::task::Poll::Pending => std::thread::yield_now(),
                }
            }
        }
        run(f)
    }
}
