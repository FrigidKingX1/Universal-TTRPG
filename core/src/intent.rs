use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A single structured instruction emitted by the narrative model when it resolves
/// a player action. The DM pipeline parses this and applies the effect to the
/// world before delivering the spoken prose to the player.
///
/// The model is constrained with a JSON schema (via Ollama's `format` parameter)
/// to emit exactly: `{"type": <one of the variants>, "payload": { ... }}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameIntent {
    /// Pure prose the DM speaks to the table.
    Narration { text: String },
    /// A change to the current scene's description (set-dressing, new exits, etc.).
    SceneDelta { delta: String },
    /// A line spoken by a non-player character.
    NpcSpeech { npc_id: Option<String>, line: String },
    /// Request to roll a skill/attribute check (resolved by the engine).
    DiceRoll { skill: String, modifier: Option<i32>, reason: Option<String> },
    /// A rules question the engine should answer from its data.
    RuleCheck { question: String },
    /// A Mythic Fate-question the oracle should resolve.
    FateQuestion { question: String },
    /// Out-of-character chatter with the human (meta, not in-world).
    Ooc { message: String },
}

impl GameIntent {
    /// The prose the player should hear for this intent (used by the frontend).
    pub fn narration_text(&self) -> String {
        match self {
            GameIntent::Narration { text } => text.clone(),
            GameIntent::SceneDelta { delta } => delta.clone(),
            GameIntent::NpcSpeech { npc_id, line } => match npc_id {
                Some(id) => format!("{id}: {line}"),
                None => line.clone(),
            },
            GameIntent::DiceRoll { skill, .. } => format!("({skill} check)"),
            GameIntent::RuleCheck { question } => question.clone(),
            GameIntent::FateQuestion { question } => question.clone(),
            GameIntent::Ooc { message } => message.clone(),
        }
    }

    /// A short mechanical label for the event log.
    pub fn label(&self) -> &'static str {
        match self {
            GameIntent::Narration { .. } => "narration",
            GameIntent::SceneDelta { .. } => "scene_delta",
            GameIntent::NpcSpeech { .. } => "npc_speech",
            GameIntent::DiceRoll { .. } => "dice_roll",
            GameIntent::RuleCheck { .. } => "rule_check",
            GameIntent::FateQuestion { .. } => "fate_question",
            GameIntent::Ooc { .. } => "ooc",
        }
    }

    /// Parse the model's raw text into a [`GameIntent`]. Code fences (```json)
    /// are tolerated, and any unparseable output degrades gracefully to a plain
    /// [`GameIntent::Narration`] so the DM loop never stalls.
    pub fn from_llm_text(raw: &str) -> GameIntent {
        let trimmed = raw.trim();
        let json_candidate = stripped_json(trimmed).unwrap_or(trimmed);

        match serde_json::from_str::<RawIntent>(json_candidate) {
            Ok(raw_intent) => raw_intent.into_game_intent(),
            Err(_) => GameIntent::Narration {
                text: trimmed.to_string(),
            },
        }
    }
}

#[derive(Deserialize)]
struct RawIntent {
    #[serde(rename = "type")]
    kind: String,
    payload: Value,
}

impl RawIntent {
    fn into_game_intent(self) -> GameIntent {
        let p = &self.payload;
        match self.kind.as_str() {
            "narration" => GameIntent::Narration {
                text: get_str(p, "text"),
            },
            "scene_delta" => GameIntent::SceneDelta {
                delta: get_str(p, "delta"),
            },
            "npc_speech" => GameIntent::NpcSpeech {
                npc_id: get_opt_str(p, "npc_id"),
                line: get_str(p, "line"),
            },
            "dice_roll" => GameIntent::DiceRoll {
                skill: get_str(p, "skill"),
                modifier: get_i32_opt(p, "modifier"),
                reason: get_opt_str(p, "reason"),
            },
            "rule_check" => GameIntent::RuleCheck {
                question: get_str(p, "question"),
            },
            "fate_question" => GameIntent::FateQuestion {
                question: get_str(p, "question"),
            },
            "ooc" => GameIntent::Ooc {
                message: get_str(p, "message"),
            },
            _ => GameIntent::Narration {
                text: self.kind.clone(),
            },
        }
    }
}

/// If `s` is wrapped in a ```json (or bare ```) fence, return the inner body.
fn stripped_json(s: &str) -> Option<&str> {
    let body = s
        .strip_prefix("```json")
        .or_else(|| s.strip_prefix("```"))?;
    Some(body.trim_end_matches("```").trim())
}

fn get_str(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string()
}

fn get_opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn get_i32_opt(v: &Value, key: &str) -> Option<i32> {
    v.get(key).and_then(|x| x.as_i64()).map(|n| n as i32)
}

/// GBNF grammar (llama.cpp / llama-cpp grammar format) that constrains the
/// model to emit a single GameIntent JSON object. `payload` is a free object so
/// the model can attach whatever fields its `type` needs; the Rust parser
/// tolerates missing fields rather than failing hard.
pub const GAME_INTENT_GBNF: &str = r#"
root ::= "{" space "\"type\"" space ":" space type space "," space "\"payload\"" space ":" space object space "}"
type ::= "\"narration\"" | "\"scene_delta\"" | "\"npc_speech\"" | "\"dice_roll\"" | "\"rule_check\"" | "\"fate_question\"" | "\"ooc\""
object ::= "{" space (pair (space "," space pair)*)? space "}"
pair ::= string space ":" space value
value ::= string | number | "true" | "false" | "null" | object | array
array ::= "[" space (value (space "," space value)*)? space "]"
string ::= "\"" ( [^"\\] | "\\" ( [""] | [\\] | [/] | [b] | [f] | [n] | [r] | [t] ) )* "\""
number ::= "-"? [0-9]+ ( "." [0-9]+ )? ( [eE] "-"? [0-9]+ )?
space ::= [ ]*
"#;

/// System-prompt instructions telling the model how to shape its GameIntent.
pub const GAME_INTENT_INSTRUCTIONS: &str = "\
You are the narrative intelligence of Auto-DM, a tabletop role-playing game engine. \
When you resolve a player action you MUST reply with a single JSON object and nothing else:

{\"type\": <one of: narration, scene_delta, npc_speech, dice_roll, rule_check, fate_question, ooc>, \
\"payload\": { ... }}

Guidelines for the payload:
- narration: {\"text\": \"...prose the DM speaks to the table...\"}
- scene_delta: {\"delta\": \"...a factual change to the scene...\"}
- npc_speech: {\"npc_id\": \"name-or-id\", \"line\": \"...what they say...\"}
- dice_roll: {\"skill\": \"Acrobatics\", \"modifier\": 2, \"reason\": \"...why...\"}
- rule_check: {\"question\": \"Does the rule X apply here?\"}
- fate_question: {\"question\": \"Is the stranger an ally?\"}
- ooc: {\"message\": \"...out-of-character note to the human...\"}

Never invent mechanical outcomes. Ground every payload in the scene and the player's action.";

/// JSON Schema for Ollama's `format` parameter. Constrains the model to emit
/// exactly one `{"type": ..., "payload": {...}}` object matching a GameIntent.
pub fn game_intent_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "type": {
                "type": "string",
                "enum": ["narration","scene_delta","npc_speech","dice_roll","rule_check","fate_question","ooc"]
            },
            "payload": { "type": "object" }
        },
        "required": ["type", "payload"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(kind: &str, payload: &str) -> String {
        format!("{{\"type\":\"{kind}\",\"payload\":{payload}}}")
    }

    #[test]
    fn parses_narration() {
        let g = GameIntent::from_llm_text(&sample(
            "narration",
            "{\"text\":\"The gate groans open.\"}",
        ));
        assert_eq!(
            g,
            GameIntent::Narration {
                text: "The gate groans open.".to_string()
            }
        );
    }

    #[test]
    fn parses_npc_speech_without_id() {
        let g = GameIntent::from_llm_text(&sample(
            "npc_speech",
            "{\"line\":\"Halt! Who goes there?\"}",
        ));
        assert_eq!(
            g,
            GameIntent::NpcSpeech {
                npc_id: None,
                line: "Halt! Who goes there?".to_string()
            }
        );
    }

    #[test]
    fn parses_dice_roll_with_modifier() {
        let g = GameIntent::from_llm_text(&sample(
            "dice_roll",
            "{\"skill\":\"Stealth\",\"modifier\":3,\"reason\":\"sneaking\"}",
        ));
        assert_eq!(
            g,
            GameIntent::DiceRoll {
                skill: "Stealth".to_string(),
                modifier: Some(3),
                reason: Some("sneaking".to_string())
            }
        );
    }

    #[test]
    fn tolerates_code_fence_and_missing_payload_fields() {
        let raw = "```json\n{\"type\":\"scene_delta\",\"payload\":{}}\n```";
        let g = GameIntent::from_llm_text(raw);
        assert_eq!(g, GameIntent::SceneDelta { delta: String::new() });
    }

    #[test]
    fn degrades_to_narration_on_garbage() {
        let g = GameIntent::from_llm_text("The goblin lunges!");
        assert_eq!(
            g,
            GameIntent::Narration {
                text: "The goblin lunges!".to_string()
            }
        );
    }
}
