//! DM guardrails: input sanitization and system-prompt assembly.
//!
//! These are pure functions so they can be golden-file tested without a
//! database or LLM. The sanitizer restructures declarative player claims
//! into attempt-framing; the prompt builder layers puppeteering defense,
//! sensory state, tone, lines & veils, and memory onto the base prompt.

/// Player-declarative patterns that must never be taken as fact — the model
/// should treat them as attempts that the engine/oracle adjudicates.
const DECLARATIVE_MARKERS: &[&str] = &[
    " is now ",
    " abdicates",
    " agrees to ",
    " gives me ",
    " hands me ",
    " falls in love with me",
    " kneels before me",
    " dies instantly",
    " drops dead",
    " immediately obeys",
];

/// Detect whether a player action reads as a declarative world-claim rather
/// than a first-person attempt ("I persuade the guard" is fine; "the king
/// abdicates to me" is a claim).
pub fn is_declarative_claim(input: &str) -> bool {
    let lower = input.to_lowercase();
    DECLARATIVE_MARKERS.iter().any(|m| lower.contains(m))
}

/// Rewrite a player action into attempt-framing. Pure — golden-tested.
pub fn sanitize_player_input(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if is_declarative_claim(trimmed) {
        format!("The player attempts to bring this about (subject to the outcome of a check): {trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Sensory context injected into the prompt so the model cannot describe
/// visual detail the party cannot perceive.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SensoryState {
    /// e.g. "bright", "dim", "darkness", "pitch black".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light_level: Option<String>,
    /// Senses currently usable, e.g. ["hearing", "smell"] in darkness.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub active_senses: Vec<String>,
}

impl SensoryState {
    /// The instruction block appended to the system prompt, if any.
    pub fn to_prompt(&self) -> Option<String> {
        if self.light_level.is_none() && self.active_senses.is_empty() {
            return None;
        }
        let mut parts: Vec<String> = Vec::new();
        if let Some(light) = &self.light_level {
            let dark = matches!(light.to_lowercase().as_str(), "darkness" | "pitch black");
            if dark {
                parts.push(format!(
                    "LIGHTING: {light}. Visual descriptions are impossible — describe only sound, touch, smell, and spatial awareness."
                ));
            } else {
                parts.push(format!("LIGHTING: {light}."));
            }
        }
        if !self.active_senses.is_empty() {
            parts.push(format!(
                "ACTIVE SENSES: {}. Do not narrate through any other senses.",
                self.active_senses.join(", ")
            ));
        }
        Some(parts.join(" "))
    }
}

/// Narrative tone presets selectable in Settings.
pub const TONE_PRESETS: &[&str] = &["classic", "gritty", "heroic", "comedic", "cosmic"];

fn tone_prompt(tone: &str) -> Option<&'static str> {
    match tone.to_lowercase().as_str() {
        "gritty" => Some(
            "TONE: Gritty realism. Consequences are lasting; resources are scarce; victories cost something.",
        ),
        "heroic" => Some(
            "TONE: Cinematic heroic fantasy. Favor dramatic reversals and bold action; the Rule of Cool applies.",
        ),
        "comedic" => Some(
            "TONE: Comedic and casual. Absurdity is welcome; keep stakes light.",
        ),
        "cosmic" => Some(
            "TONE: Cosmic horror. Emphasize dread, the unknowable, and the smallness of mortals.",
        ),
        _ => None, // "classic" or unknown → default voice
    }
}

/// Base persona constraints. The model narrates; it never computes and it
/// never puppets the player.
pub const SYSTEM_PROMPT: &str = "You are Auto-DM, a tabletop game master. Narrate consequences grounded in the mechanical \
     facts provided. Keep responses vivid, brief (2-4 sentences), and address the player's action \
     directly. Never invent new mechanical outcomes beyond those listed. \
     Never write dialogue, emotions, decisions, or actions for the player character — describe the \
     world's reaction only, and end by leaving space for the player's next move. \
     If the player's stated action would require luck or opposition, treat it as an attempt for you \
     to adjudicate, never as an accomplished fact.";

/// Assemble the full system prompt from all guardrail layers. Pure — golden-tested.
pub fn build_system_prompt(
    lines: &[String],
    veils: &[String],
    sensory: Option<&SensoryState>,
    tone: Option<&str>,
    memory_context: Option<&str>,
) -> String {
    let mut sys = SYSTEM_PROMPT.to_string();
    if !lines.is_empty() {
        sys.push_str("\n\nHARD SAFETY LINES (never describe these, no exceptions): ");
        sys.push_str(&lines.join(", "));
    }
    if !veils.is_empty() {
        sys.push_str("\n\nVEILS (these topics exist but must be faded to black / implied off-screen, never depicted in detail): ");
        sys.push_str(&veils.join(", "));
    }
    if let Some(s) = sensory {
        if let Some(block) = s.to_prompt() {
            sys.push_str("\n\n");
            sys.push_str(&block);
        }
    }
    if let Some(t) = tone.and_then(tone_prompt) {
        sys.push_str("\n\n");
        sys.push_str(t);
    }
    if let Some(mem) = memory_context {
        if !mem.trim().is_empty() {
            sys.push_str("\n\nRECENT CAMPAIGN EVENTS (for continuity):\n");
            sys.push_str(mem);
        }
    }
    sys
}

#[cfg(test)]
mod golden_tests {
    use super::*;

    #[test]
    fn sanitizer_passes_through_first_person_attempts() {
        assert_eq!(
            sanitize_player_input("I persuade the guard to open the gate"),
            "I persuade the guard to open the gate"
        );
        assert_eq!(
            sanitize_player_input("  I search the alchemist's desk  "),
            "I search the alchemist's desk"
        );
    }

    #[test]
    fn sanitizer_rewrites_declarative_claims() {
        let out = sanitize_player_input("The king abdicates to me immediately");
        assert!(out.starts_with("The player attempts to bring this about"));
        assert!(out.contains("The king abdicates"));

        let out = sanitize_player_input("She agrees to give me the crown is now mine");
        assert!(out.contains("attempts to bring this about"));
    }

    #[test]
    fn sanitizer_handles_each_marker() {
        for claim in [
            "The guard gives me his sword",
            "He hands me the keys",
            "The dragon dies instantly",
            "Everyone immediately obeys my command",
        ] {
            assert!(
                is_declarative_claim(claim),
                "should detect claim: {claim}"
            );
            assert!(sanitize_player_input(claim).starts_with("The player attempts"));
        }
    }

    #[test]
    fn empty_input_stays_empty() {
        assert_eq!(sanitize_player_input("   "), "");
    }

    #[test]
    fn sensory_darkness_blocks_visuals() {
        let s = SensoryState {
            light_level: Some("pitch black".into()),
            active_senses: vec!["hearing".into(), "smell".into()],
        };
        let block = s.to_prompt().expect("should produce a block");
        assert!(block.contains("Visual descriptions are impossible"));
        assert!(block.contains("hearing, smell"));
    }

    #[test]
    fn sensory_bright_light_is_informational() {
        let s = SensoryState { light_level: Some("bright".into()), active_senses: vec![] };
        let block = s.to_prompt().unwrap();
        assert!(!block.contains("impossible"));
        assert!(block.contains("LIGHTING: bright"));
    }

    #[test]
    fn sensory_none_produces_no_block() {
        assert!(SensoryState::default().to_prompt().is_none());
    }

    #[test]
    fn prompt_assembles_all_layers() {
        let sensory =
            SensoryState { light_level: Some("darkness".into()), active_senses: vec![] };
        let out = build_system_prompt(
            &["torture".to_string()],
            &["romance".to_string()],
            Some(&sensory),
            Some("cosmic"),
            Some("[Player]: I kick the door"),
        );
        assert!(out.contains("Never write dialogue, emotions, decisions, or actions for the player"));
        assert!(out.contains("HARD SAFETY LINES"));
        assert!(out.contains("torture"));
        assert!(out.contains("VEILS"));
        assert!(out.contains("faded to black"));
        assert!(out.contains("Visual descriptions are impossible"));
        assert!(out.contains("TONE: Cosmic horror"));
        assert!(out.contains("RECENT CAMPAIGN EVENTS"));
        // Order stability: base prompt first, memory last.
        let base_idx = out.find("You are Auto-DM").unwrap();
        let mem_idx = out.find("RECENT CAMPAIGN EVENTS").unwrap();
        assert!(base_idx < mem_idx);
    }

    #[test]
    fn tone_classic_is_neutral() {
        let out = build_system_prompt(&[], &[], None, Some("classic"), None);
        assert!(!out.contains("TONE:"));
        // Unknown tones fall back to neutral too.
        let out = build_system_prompt(&[], &[], None, Some("weird"), None);
        assert!(!out.contains("TONE:"));
    }

    #[test]
    fn prompt_without_extras_is_base_only() {
        let out = build_system_prompt(&[], &[], None, None, None);
        assert_eq!(out, SYSTEM_PROMPT);
        assert!(out.contains("What do you do") == false); // we don't hardcode it; model ends naturally
        assert!(out.contains("never puppets") == false);
        assert!(out.contains("player character"));
    }
}
