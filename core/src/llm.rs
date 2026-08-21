use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;

use super::dice::DiceEngine;
use super::intent::GameIntent;
use super::oracle::{EventMeaning, MythicOracle, Odds};

/// Error type for the LLM backend.
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

    /// Streaming variant: invokes `on_token` for each incremental token as it
    /// arrives and returns the full text. The default implementation falls
    /// back to [`LlmBackend::complete`] and emits the whole text at once.
    async fn complete_streaming(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
        on_token: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<String, LlmError> {
        let full = self.complete(system, prompt, max_tokens).await?;
        on_token(&full);
        Ok(full)
    }

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
        Ok(format!(
            "[stub-llm]\n-- system --\n{system}\n-- prompt --\n{prompt}"
        ))
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

    async fn complete_streaming(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
        on_token: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<String, LlmError> {
        (**self)
            .complete_streaming(system, prompt, max_tokens, on_token)
            .await
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

    async fn complete_streaming(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
        on_token: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<String, LlmError> {
        (**self)
            .complete_streaming(system, prompt, max_tokens, on_token)
            .await
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
    /// Hard-ban topics that must never appear in generated narrative.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<String>,
    /// Topics that should be faded to black / implied off-screen.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub veils: Vec<String>,
    /// Scene the action takes place in; lets the session layer apply
    /// SceneDelta world effects. Optional for backward compatibility.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<String>,
}

impl Default for DmRequest {
    fn default() -> Self {
        Self {
            scene_summary: String::new(),
            player_action: String::new(),
            chaos_factor: 5,
            memory_context: None,
            lines: Vec::new(),
            veils: Vec::new(),
            scene_id: None,
        }
    }
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
        self.resolve_inner(request, seed, None).await
    }

    /// Like [`resolve_action`], but streams tokens from the backend as they
    /// arrive via `on_token`. Backends without native streaming emit the full
    /// text once at completion.
    pub async fn resolve_action_streaming(
        &self,
        request: &DmRequest,
        seed: Option<u64>,
        on_token: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<DmResponse, LlmError> {
        self.resolve_inner(request, seed, Some(on_token)).await
    }

    async fn resolve_inner(
        &self,
        request: &DmRequest,
        seed: Option<u64>,
        on_token: Option<&mut (dyn for<'a> FnMut(&'a str) + Send)>,
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
        // Build a dynamic system prompt that includes Lines & Veils.
        let mut sys = SYSTEM_PROMPT.to_string();
        if !request.lines.is_empty() {
            sys.push_str("\n\nHARD SAFETY LINES (never describe these, no exceptions): ");
            sys.push_str(&request.lines.join(", "));
        }
        if !request.veils.is_empty() {
            sys.push_str("\n\nVEILS (these topics exist but must be faded to black / implied off-screen, never depicted in detail): ");
            sys.push_str(&request.veils.join(", "));
        }
        let (narrative, intent, source) = if stub {
            let n = stub_narrative(request, &fate, event_meaning.as_ref());
            (
                n.clone(),
                GameIntent::Narration { text: n },
                "stub".to_string(),
            )
        } else {
            let prompt = build_prompt(
                request,
                &fate,
                event_meaning.as_ref(),
                &mechanical_events,
                request.memory_context.as_deref(),
            );
            let raw = if let Some(cb) = on_token {
                self.backend
                    .complete_streaming(&sys, &prompt, Some(512), cb)
                    .await?
            } else {
                self.backend.complete(&sys, &prompt, Some(512)).await?
            };
            let intent = GameIntent::from_llm_text(&raw);
            let mut dice = match seed {
                Some(s) => DiceEngine::with_seed(s.wrapping_add(1)),
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
            dc,
            reason,
        } => {
            let mod_v = modifier.unwrap_or(0);
            let target_dc = clamp_dc(dc.unwrap_or(10));
            let roll = dice.evaluate(&format!("1d20 + {mod_v}"));
            let (total, detail) = match &roll {
                Ok(r) => (r.total, r.detail.clone()),
                Err(_) => (mod_v as i64, format!("1d20 + {mod_v} (roll failed)")),
            };
            let outcome = if total >= target_dc as i64 {
                "Success"
            } else {
                "Failure"
            };
            extra.push(format!(
                "{skill} check: {detail} -> {outcome} (DC {target_dc})"
            ));
            let why = reason.clone().unwrap_or_else(|| skill.clone());
            format!("You attempt {why}. {detail} — {outcome}.")
        }
        GameIntent::RuleCheck { question } => {
            format!("Rule query: {question}")
        }
        GameIntent::FateQuestion { question } => {
            let f = oracle.ask_fate(Odds::FiftyFifty);
            extra.push(format!(
                "Fate Question '{question}': {}",
                f.interpretation()
            ));
            format!("The oracle is asked: {question} — {}", f.interpretation())
        }
    };
    (narrative, extra)
}

/// Clamp a DC to the sane range 1..=30. LLMs may invent extreme values;
/// this prevents game-breaking DCs while keeping the LLM flexible.
fn clamp_dc(raw: i32) -> i32 {
    raw.clamp(1, 30)
}

/// Deterministic narrative produced when a stub backend is active.
fn stub_narrative(
    request: &DmRequest,
    fate: &super::oracle::FateResult,
    meaning: Option<&EventMeaning>,
) -> String {
    let scene = request
        .scene_summary
        .trim()
        .trim_end_matches('.')
        .to_string();
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
        format!(
            "Scene: {}",
            if scene.is_empty() { "(empty)" } else { scene }
        ),
        format!("Player action: {}", request.player_action.trim()),
        format!(
            "Fate result: {} (roll {}, target {})",
            fate.interpretation(),
            fate.roll,
            fate.target
        ),
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
            ..Default::default()
        };
        let out =
            futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(42))).unwrap();
        assert_eq!(out.source, "stub");
        assert!(!out.narrative.is_empty());
        assert!(out.fate_roll >= 1 && out.fate_roll <= 100);
        assert!(out.fate_target > 0);
        assert!(out
            .mechanical_events
            .iter()
            .any(|e| e.contains("Fate Check")));
        assert_eq!(out.chaos_factor, 5);
    }

    #[test]
    fn pipeline_meaning_present_only_on_random_event() {
        let pipeline = DmPipeline::new(StubLlmBackend);
        let request = DmRequest {
            scene_summary: String::new(),
            player_action: "I wait.".to_string(),
            chaos_factor: 5,
            ..Default::default()
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
        async fn complete(&self, _s: &str, _p: &str, _m: Option<u32>) -> Result<String, LlmError> {
            Ok(self.0.to_string())
        }

        fn is_stub(&self) -> bool {
            false
        }
    }

    #[test]
    fn pipeline_parses_dice_roll_intent_and_resolves() {
        let pipeline = DmPipeline::new(StaticLlmBackend(
            r#"{"type":"dice_roll","payload":{"skill":"Stealth","modifier":3,"dc":15}}"#,
        ));
        let request = DmRequest {
            scene_summary: "A torchlit hall.".to_string(),
            player_action: "I sneak past the guard.".to_string(),
            chaos_factor: 5,
            ..Default::default()
        };
        let out = futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert_eq!(out.source, "ollama");
        assert!(out
            .mechanical_events
            .iter()
            .any(|e| e.contains("Stealth check")));
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
            ..Default::default()
        };
        let out = futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert_eq!(out.source, "ollama");
        assert_eq!(out.narrative, "The guard nods, unseeing.");
        assert_eq!(out.intent.label(), "narration");
    }

    #[test]
    fn pipeline_dice_roll_uses_llm_specified_dc() {
        let pipeline = DmPipeline::new(StaticLlmBackend(
            r#"{"type":"dice_roll","payload":{"skill":"Athletics","modifier":5,"dc":20,"reason":"cliff"}}"#,
        ));
        let request = DmRequest {
            scene_summary: "A sheer cliff face.".to_string(),
            player_action: "I climb the cliff.".to_string(),
            chaos_factor: 5,
            ..Default::default()
        };
        let out = futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert!(out.mechanical_events.iter().any(|e| e.contains("DC 20")));
        assert!(out
            .mechanical_events
            .iter()
            .any(|e| e.contains("Athletics check")));
    }

    #[test]
    fn pipeline_dice_roll_defaults_dc_to_10_when_missing() {
        let pipeline = DmPipeline::new(StaticLlmBackend(
            r#"{"type":"dice_roll","payload":{"skill":"Perception"}}"#,
        ));
        let request = DmRequest {
            scene_summary: String::new(),
            player_action: "I look around.".to_string(),
            chaos_factor: 5,
            ..Default::default()
        };
        let out = futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert!(out.mechanical_events.iter().any(|e| e.contains("DC 10")));
    }

    #[test]
    fn dc_clamped_to_valid_range() {
        assert_eq!(clamp_dc(0), 1);
        assert_eq!(clamp_dc(-5), 1);
        assert_eq!(clamp_dc(15), 15);
        assert_eq!(clamp_dc(30), 30);
        assert_eq!(clamp_dc(99), 30);
    }

    #[test]
    fn pipeline_clamps_extreme_dc() {
        let pipeline = DmPipeline::new(StaticLlmBackend(
            r#"{"type":"dice_roll","payload":{"skill":"Luck","dc":999}}"#,
        ));
        let request = DmRequest {
            scene_summary: String::new(),
            player_action: "I try my luck.".to_string(),
            chaos_factor: 5,
            ..Default::default()
        };
        let out = futures_test_block_on(pipeline.resolve_action_seeded(&request, Some(1))).unwrap();
        assert!(out.mechanical_events.iter().any(|e| e.contains("DC 30")));
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
