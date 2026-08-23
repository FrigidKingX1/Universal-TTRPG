use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Discriminates which entity pool a target descriptor should resolve against.
/// The LLM proposes a descriptor ("the cultist", "him") and the engine matches
/// it against the live roster of the given kind — never the other way around.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    Npc,
    Monster,
    Combatant,
}

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
    DiceRoll { skill: String, modifier: Option<i32>, dc: Option<i32>, reason: Option<String> },
    /// A rules question the engine should answer from its data.
    RuleCheck { question: String },
    /// A Mythic Fate-question the oracle should resolve.
    FateQuestion { question: String },
    /// Out-of-character chatter with the human (meta, not in-world).
    Ooc { message: String },
    /// A world mutation: add loot/an item to the active scene's stash.
    AddItem { name: String, quantity: i32 },
    /// Advance a doom clock (None id = the first active clock).
    AdvanceClock { clock_id: Option<String>, ticks: i32 },
    /// Attach a condition tag to an actor by name or id.
    ApplyCondition {
        target: String,
        condition: String,
        /// Entity pool to resolve `target` against. Defaults to `Npc` when absent
        /// (backward-compat with old LLM output that omits it).
        #[serde(default)]
        kind: Option<TargetKind>,
    },
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
            GameIntent::AddItem { name, quantity } => format!("({quantity}× {name} added)"),
            GameIntent::AdvanceClock { ticks, .. } => format!("(clock +{ticks})"),
            GameIntent::ApplyCondition { target, condition, .. } => {
                format!("({target} is {condition})")
            }
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
            GameIntent::AddItem { .. } => "add_item",
            GameIntent::AdvanceClock { .. } => "advance_clock",
            GameIntent::ApplyCondition { .. } => "apply_condition",
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
            Err(_) => GameIntent::Narration { text: trimmed.to_string() },
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
            "narration" => GameIntent::Narration { text: get_str(p, "text") },
            "scene_delta" => GameIntent::SceneDelta { delta: get_str(p, "delta") },
            "npc_speech" => {
                GameIntent::NpcSpeech { npc_id: get_opt_str(p, "npc_id"), line: get_str(p, "line") }
            }
            "dice_roll" => GameIntent::DiceRoll {
                skill: get_str(p, "skill"),
                modifier: get_i32_opt(p, "modifier"),
                dc: get_i32_opt(p, "dc"),
                reason: get_opt_str(p, "reason"),
            },
            "rule_check" => GameIntent::RuleCheck { question: get_str(p, "question") },
            "fate_question" => GameIntent::FateQuestion { question: get_str(p, "question") },
            "ooc" => GameIntent::Ooc { message: get_str(p, "message") },
            "add_item" => GameIntent::AddItem {
                name: get_str(p, "name"),
                quantity: get_i32_opt(p, "quantity").unwrap_or(1),
            },
            "advance_clock" => GameIntent::AdvanceClock {
                clock_id: get_opt_str(p, "clock_id"),
                ticks: get_i32_opt(p, "ticks").unwrap_or(1),
            },
            "apply_condition" => GameIntent::ApplyCondition {
                target: get_str(p, "target"),
                condition: get_str(p, "condition"),
                kind: p.get("kind").and_then(|v| serde_json::from_value(v.clone()).ok()),
            },
            other => GameIntent::Narration { text: format!("[unknown intent: {other}]\n{}", p) },
        }
    }
}

/// If `s` is wrapped in a ```json (or bare ```) fence, return the inner body.
/// Also handles fences with leading/trailing whitespace.
pub fn stripped_json(s: &str) -> Option<&str> {
    let body = s.strip_prefix("```json").or_else(|| s.strip_prefix("```"))?;
    Some(body.trim_end_matches("```").trim())
}

#[cfg(test)]
mod stripped_json_tests {
    use super::*;

    #[test]
    fn strips_json_fence() {
        let s = "```json\n{\"type\":\"narration\",\"payload\":{\"text\":\"hi\"}}\n```";
        assert_eq!(
            stripped_json(s),
            Some("{\"type\":\"narration\",\"payload\":{\"text\":\"hi\"}}")
        );
    }

    #[test]
    fn strips_bare_fence() {
        let s = "```\n{\"type\":\"narration\",\"payload\":{\"text\":\"hi\"}}\n```";
        assert_eq!(
            stripped_json(s),
            Some("{\"type\":\"narration\",\"payload\":{\"text\":\"hi\"}}")
        );
    }

    #[test]
    fn returns_none_for_plain_json() {
        let s = "{\"type\":\"narration\",\"payload\":{\"text\":\"hi\"}}";
        assert_eq!(stripped_json(s), None);
    }

    #[test]
    fn handles_empty_fence() {
        let s = "```json\n```";
        assert_eq!(stripped_json(s), Some(""));
    }
}

fn get_str(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or_default().to_string()
}

fn get_opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn get_i32_opt(v: &Value, key: &str) -> Option<i32> {
    v.get(key).and_then(|x| x.as_i64()).and_then(|n| i32::try_from(n).ok())
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
- dice_roll: {\"skill\": \"Acrobatics\", \"modifier\": 2, \"dc\": 15, \"reason\": \"...why...\"}
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
                "enum": ["narration","scene_delta","npc_speech","dice_roll","rule_check","fate_question","ooc","add_item","advance_clock","apply_condition"]
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
        let g =
            GameIntent::from_llm_text(&sample("narration", "{\"text\":\"The gate groans open.\"}"));
        assert_eq!(g, GameIntent::Narration { text: "The gate groans open.".to_string() });
    }

    #[test]
    fn parses_npc_speech_without_id() {
        let g = GameIntent::from_llm_text(&sample(
            "npc_speech",
            "{\"line\":\"Halt! Who goes there?\"}",
        ));
        assert_eq!(
            g,
            GameIntent::NpcSpeech { npc_id: None, line: "Halt! Who goes there?".to_string() }
        );
    }

    #[test]
    fn parses_dice_roll_with_modifier() {
        let g = GameIntent::from_llm_text(&sample(
            "dice_roll",
            "{\"skill\":\"Stealth\",\"modifier\":3,\"dc\":15,\"reason\":\"sneaking\"}",
        ));
        assert_eq!(
            g,
            GameIntent::DiceRoll {
                skill: "Stealth".to_string(),
                modifier: Some(3),
                dc: Some(15),
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
        assert_eq!(g, GameIntent::Narration { text: "The goblin lunges!".to_string() });
    }
}

/// Normalize an LLM's near-miss campaign JSON into the strict shape
/// `CampaignGenerationResult` deserializes from. Small models routinely
/// rename keys ("title" for "campaign_title"), omit optional-ish fields,
/// or emit strings where numbers belong; this pass repairs all of that.
/// Input that is not JSON at all is returned unchanged (the caller's
/// strict parse then produces the authoritative error).
/// Slice the first balanced `{ ... }` block out of `s`, ignoring braces
/// inside string literals. Returns None when no complete object exists.
fn extract_first_json_object(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (idx, ch) in s[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[start..=start + idx]);
                }
            }
            _ => {}
        }
    }
    None
}

pub fn repair_campaign_json(input: &str) -> String {
    let fenced = stripped_json(input.trim()).unwrap_or(input.trim());
    // Models love appending commentary ("Hope this helps!") after the JSON;
    // slice out the first balanced { ... } block, string-aware.
    let sliced = extract_first_json_object(fenced).unwrap_or(fenced);
    let mut v: Value = match serde_json::from_str(sliced) {
        Ok(v) => v,
        // Truncated output (EOF mid-string/mid-object): close what the
        // model left open and re-parse.
        Err(_) => match salvage_truncated(sliced) {
            Some(repaired) => serde_json::from_str(&repaired).unwrap_or(Value::Null),
            None => Value::Null,
        },
    };
    if !v.is_object() {
        return input.to_string();
    }
    // Some models wrap everything in an intent-style {"type","payload"}
    // envelope; descend into payload when it dominates the object.
    if let Some(inner) = v.get("payload") {
        if inner.is_object()
            && v.as_object().unwrap().iter().all(|(k, _)| k == "payload" || k == "type")
        {
            v = inner.clone();
        }
    }
    let obj = v.as_object_mut().unwrap();

    // -- top-level identity -------------------------------------------------
    if !obj.contains_key("campaign_title") {
        let alias = ["title", "name", "campaign"]
            .iter()
            .find_map(|k| obj.get(*k).and_then(|x| x.as_str()).map(String::from));
        obj.insert(
            "campaign_title".into(),
            Value::String(alias.unwrap_or_else(|| "Untitled Campaign".into())),
        );
    }
    if !obj.contains_key("campaign_theme") {
        let t = obj.get("theme").and_then(|x| x.as_str()).map(String::from);
        obj.insert("campaign_theme".into(), Value::String(t.unwrap_or_default()));
    }
    if !obj.contains_key("campaign_summary") {
        let s = ["summary", "overview", "description"]
            .iter()
            .find_map(|k| obj.get(*k).and_then(|x| x.as_str()).map(String::from));
        obj.insert("campaign_summary".into(), Value::String(s.unwrap_or_default()));
    }

    // -- scenes -------------------------------------------------------------
    let scenes = obj.entry("scenes").or_insert_with(|| Value::Array(vec![]));
    if let Some(arr) = scenes.as_array_mut() {
        for (i, s) in arr.iter_mut().enumerate() {
            if let Some(o) = s.as_object_mut() {
                if !o.contains_key("title") {
                    let alias = ["name", "scene_title", "scene_name"]
                        .iter()
                        .find_map(|k| o.get(*k).and_then(|x| x.as_str()).map(String::from));
                    o.insert("title".into(), Value::String(alias.unwrap_or_else(|| format!("Scene {}", i + 1))));
                }
                if !o.contains_key("chaos_factor") {
                    let cf = o.get("chaos").and_then(|x| x.as_i64()).unwrap_or(5);
                    o.insert("chaos_factor".into(), Value::from(cf as i32));
                }
                for k in ["summary", "hook"] {
                    o.entry(k).or_insert(Value::String(String::new()));
                }
            }
        }
    }

    // -- npcs ---------------------------------------------------------------
    let npcs = obj.entry("npcs").or_insert_with(|| Value::Array(vec![]));
    if let Some(arr) = npcs.as_array_mut() {
        for n in arr.iter_mut() {
            if let Some(o) = n.as_object_mut() {
                o.entry("name").or_insert(Value::String("Unnamed NPC".into()));
                o.entry("disposition").or_insert(Value::String("neutral".into()));
                o.entry("notes").or_insert(Value::String(String::new()));
            }
        }
    }

    // -- doom clocks --------------------------------------------------------
    let clocks = obj.entry("doom_clocks").or_insert_with(|| Value::Array(vec![]));
    if let Some(arr) = clocks.as_array_mut() {
        for (i, c) in arr.iter_mut().enumerate() {
            if let Some(o) = c.as_object_mut() {
                o.entry("id").or_insert(Value::String(format!("clocks:{}", i + 1)));
                o.entry("label").or_insert(Value::String(format!("Doom Clock {}", i + 1)));
                let ticks = o.get("tick_max").and_then(|x| x.as_u64()).unwrap_or(4).max(1);
                o.insert("tick_max".into(), Value::from(ticks));
                o.entry("consequence").or_insert(Value::String(String::new()));
            }
        }
    }

    // -- plot threads, lines, veils -----------------------------------------
    let threads = obj.entry("plot_threads").or_insert_with(|| Value::Array(vec![]));
    if let Some(arr) = threads.as_array_mut() {
        for t in arr.iter_mut() {
            if let Some(o) = t.as_object_mut() {
                o.entry("description").or_insert(Value::String(String::new()));
                o.entry("status").or_insert(Value::String("open".into()));
            }
        }
    }
    for key in ["lines", "veils"] {
        obj.entry(key).or_insert_with(|| Value::Array(vec![]));
    }

    serde_json::to_string(&v).unwrap_or_else(|_| input.to_string())
}

#[cfg(test)]
mod repair_campaign_json_tests {
    use super::repair_campaign_json;

    #[test]
    fn repairs_missing_campaign_title_from_title_alias() {
        let raw = r#"{"title":"The Sunken Crown","campaign_theme":"nautical","campaign_summary":"s","scenes":[],"npcs":[],"doom_clocks":[],"plot_threads":[],"lines":[],"veils":[]}"#;
        let fixed = repair_campaign_json(raw);
        let v: serde_json::Value = serde_json::from_str(&fixed).unwrap();
        assert_eq!(v["campaign_title"], "The Sunken Crown");
    }

    #[test]
    fn synthesizes_title_when_no_alias_exists() {
        let raw = r#"{"scenes":[]}"#;
        let v: serde_json::Value = serde_json::from_str(&repair_campaign_json(raw)).unwrap();
        assert_eq!(v["campaign_title"], "Untitled Campaign");
        assert_eq!(v["lines"], serde_json::json!([]));
    }

    #[test]
    fn aliases_scene_names_and_defaults_chaos_factor() {
        let raw = r#"{"campaign_title":"C","campaign_theme":"t","campaign_summary":"s","scenes":[{"name":"Docks at Dusk"}],"npcs":[],"doom_clocks":[],"plot_threads":[],"lines":[],"veils":[]}"#;
        let v: serde_json::Value = serde_json::from_str(&repair_campaign_json(raw)).unwrap();
        assert_eq!(v["scenes"][0]["title"], "Docks at Dusk");
        assert_eq!(v["scenes"][0]["chaos_factor"], 5);
        assert_eq!(v["scenes"][0]["hook"], "");
    }

    #[test]
    fn fills_npc_disposition_and_notes() {
        let raw = r#"{"campaign_title":"C","campaign_theme":"t","campaign_summary":"s","scenes":[{"title":"S","chaos_factor":3,"summary":"x","hook":"y"}],"npcs":[{"name":"Vex"}],"doom_clocks":[],"plot_threads":[],"lines":[],"veils":[]}"#;
        let v: serde_json::Value = serde_json::from_str(&repair_campaign_json(raw)).unwrap();
        assert_eq!(v["npcs"][0]["disposition"], "neutral");
        assert_eq!(v["npcs"][0]["notes"], "");
    }

    #[test]
    fn strips_fences_and_trailing_prose_before_repair() {
        let raw = "```json\n{\"title\":\"Fenced\"}\n```\nThe end.";
        let v: serde_json::Value = serde_json::from_str(&repair_campaign_json(raw)).unwrap();
        assert_eq!(v["campaign_title"], "Fenced");
    }

    #[test]
    fn non_json_input_passes_through_unchanged() {
        let raw = "the model rambled about dragons instead";
        assert_eq!(repair_campaign_json(raw), raw);
    }
}

/// Attempt to recover a parseable JSON object from truncated LLM output:
/// remember every position just past a completed value, then try closing
/// all open containers from the latest safe cut backwards. A dangling
/// string gets a synthetic closing quote.
fn salvage_truncated(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut in_string = false;
    let mut escaped = false;
    let mut candidates: Vec<(usize, bool)> = Vec::new(); // (cut, needs quote)

    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
                candidates.push((i + 1, false));
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'}' | b']' => candidates.push((i + 1, false)),
            _ => {}
        }
    }

    // Truncated *inside* a string value: trim trailing whitespace/control
    // chars first; a synthetic closing quote may be all that's needed.
    if in_string {
        let mut cut = bytes.len();
        while cut > 0 && (bytes[cut - 1] as char).is_whitespace() {
            cut -= 1;
        }
        candidates.push((cut, true));
    }

    for &(end, needs_quote) in candidates.iter().rev().take(500) {
        let mut candidate = s[..end].to_string();
        while matches!(candidate.chars().last(), Some(',') | Some(' ') | Some('\n') | Some('\r')) {
            candidate.pop();
        }
        if needs_quote {
            candidate.push('"');
        }

        // Close whatever containers are still open.
        let mut stack: Vec<u8> = Vec::new();
        let mut s2_in = false;
        let mut s2_esc = false;
        for &b in candidate.as_bytes() {
            if s2_in {
                if s2_esc {
                    s2_esc = false;
                } else if b == b'\\' {
                    s2_esc = true;
                } else if b == b'"' {
                    s2_in = false;
                }
                continue;
            }
            match b {
                b'"' => s2_in = true,
                b'{' | b'[' => stack.push(b),
                b'}' | b']' => { stack.pop(); }
                _ => {}
            }
        }
        let mut closers = String::new();
        while let Some(open) = stack.pop() {
            closers.push(if open == b'{' { '}' } else { ']' });
        }
        candidate.push_str(&closers);

        if serde_json::from_str::<serde_json::Value>(&candidate).is_ok() {
            return Some(candidate);
        }
    }
    None
}

/// JSON Schema constraining Ollama structured output to the exact shape
/// CampaignGenerationResult deserializes from. Using the generic intent
/// schema here caused models to wrap campaigns inside {"payload": ...}.
pub fn campaign_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "campaign_title":   { "type": "string" },
            "campaign_theme":   { "type": "string" },
            "campaign_summary": { "type": "string" },
            "scenes": { "type": "array", "items": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "chaos_factor": { "type": "integer" },
                    "summary": { "type": "string" },
                    "hook": { "type": "string" }
                },
                "required": ["title"]
            }},
            "npcs": { "type": "array", "items": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "disposition": { "type": "string" },
                    "notes": { "type": "string" }
                },
                "required": ["name"]
            }},
            "doom_clocks": { "type": "array", "items": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "label": { "type": "string" },
                    "tick_max": { "type": "integer" },
                    "consequence": { "type": "string" }
                },
                "required": ["label"]
            }},
            "plot_threads": { "type": "array", "items": {
                "type": "object",
                "properties": {
                    "description": { "type": "string" },
                    "status": { "type": "string" }
                },
                "required": ["description"]
            }},
            "lines": { "type": "array", "items": { "type": "string" } },
            "veils": { "type": "array", "items": { "type": "string" } }
        },
        "required": [
            "campaign_title","campaign_theme","campaign_summary",
            "scenes","npcs","doom_clocks","plot_threads","lines","veils"
        ]
    })
}

#[cfg(test)]
mod llm_json_hardening_tests {
    use super::{repair_campaign_json, campaign_json_schema};

    #[test]
    fn unwraps_intent_style_payload_envelope() {
        let inner = r#"{"campaign_title":"Chip","campaign_theme":"spy","campaign_summary":"s",
            "scenes":[{"title":"Bar"}],"npcs":[],"doom_clocks":[],"plot_threads":[],"lines":[],"veils":[]}"#;
        let raw = format!(r#"{{"type":"narration","payload":{inner}}}"#);
        let v: serde_json::Value = serde_json::from_str(&repair_campaign_json(&raw)).unwrap();
        assert_eq!(v["campaign_title"], "Chip");
    }

    #[test]
    fn salvages_truncation_cut_mid_array() {
        let mut raw = String::from(
            r#"{"campaign_title":"Wastes","campaign_theme":"dust","campaign_summary":"s","scenes":["#,
        );
        raw.push_str(r#"{"title":"One","chaos_factor":5,"summary":"x","hook":"y"},"#);
        raw.push_str(r#"{"title":"Two","chaos_factor":4,"summary":"y","hook":"z"}"#);
        raw.push(',');
        raw.push_str(r#"{"title":"Three","summary":"unfinis"#);
        let v: serde_json::Value = serde_json::from_str(&repair_campaign_json(&raw)).unwrap();
        assert_eq!(v["campaign_title"], "Wastes");
        assert!(v["scenes"].as_array().unwrap().len() >= 2);
    }

    #[test]
    fn salvages_truncation_inside_a_string_value() {
        let raw = r#"{"campaign_title":"Broken Str"#;
        let v: serde_json::Value = serde_json::from_str(&repair_campaign_json(raw)).unwrap();
        assert_eq!(v["campaign_title"], "Broken Str");
    }

    #[test]
    fn campaign_schema_requires_campaign_title_and_has_no_payload() {
        let schema = campaign_json_schema();
        assert!(schema["required"].as_array().unwrap().iter().any(|r| r == "campaign_title"));
        assert!(schema["properties"]["payload"].is_null());
    }
}
