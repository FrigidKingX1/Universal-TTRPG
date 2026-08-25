//! Tool definitions and dispatch for the TTRPG MCP server.
//!
//! Every tool is a pure function over `auto-dm-core` types — deterministic,
//! no network, no DB. Stateful session tools arrive with the engine bridge.

use crate::McpServerError;
use auto_dm_core::{
    dice::DiceEngine,
    intent::{GameIntent, campaign_json_schema, repair_campaign_json},
    memory_vec::hybrid_recall,
    oracle::{MythicOracle, Odds},
};
use auto_dm_server::{all_preset_actions, find_preset_action, find_preset_monster};
use rmcp::model::{CallToolResult, ContentBlock, JsonObject, Tool};
use serde::Deserialize;
use serde_json::{Value, json};

/// Convert a json! object into the Arc<JsonObject> Tool::new expects.
fn schema(value: Value) -> std::sync::Arc<JsonObject> {
    match value {
        Value::Object(map) => std::sync::Arc::new(map),
        _ => std::sync::Arc::new(JsonObject::new()),
    }
}

fn text_result(v: impl Into<String>) -> Result<CallToolResult, McpServerError> {
    Ok(CallToolResult::success(vec![ContentBlock::text(v)]))
}

fn json_result(v: Value) -> Result<CallToolResult, McpServerError> {
    text_result(v.to_string())
}

fn parse_args<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, McpServerError> {
    serde_json::from_value(args).map_err(McpServerError::Json)
}

// ------------------------------------------------------------------
// Tool catalog
// ------------------------------------------------------------------

pub fn all_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            "roll_dice",
            "Evaluate a dice expression: 2d6+3, 4d6kh3 (keep highest), 1d20kl1 (keep lowest).",
            schema(json!({
                "type": "object",
                "properties": { "expr": { "type": "string" } },
                "required": ["expr"]
            })),
        ),
        Tool::new(
            "oracle_fate_check",
            "Mythic GME fate chart. odds_rank 1-10 (Impossible..A Sure Thing), chaos_factor 1-9. Returns roll/target/outcome/exceptional/random_event.",
            schema(json!({
                "type": "object",
                "properties": {
                    "odds_rank": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 },
                    "chaos_factor": { "type": "integer", "minimum": 1, "maximum": 9, "default": 5 }
                }
            })),
        ),
        Tool::new(
            "oracle_random_event",
            "Roll a Mythic random-event meaning (action/subject/descriptor/focus).",
            schema(json!({ "type": "object", "properties": {} })),
        ),
        Tool::new(
            "scene_test",
            "Mythic scene test vs a chaos factor (as_expected / altered / interrupted).",
            schema(json!({
                "type": "object",
                "properties": {
                    "chaos_factor": { "type": "integer", "minimum": 1, "maximum": 9, "default": 5 }
                }
            })),
        ),
        Tool::new(
            "parse_intent",
            "Parse free-text LLM output into a structured GameIntent (narration / dice / npc speech).",
            schema(json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })),
        ),
        Tool::new(
            "repair_campaign_json",
            "Repair truncated or malformed campaign JSON salvaged from an LLM response.",
            schema(json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            })),
        ),
        Tool::new(
            "campaign_json_schema",
            "Return the JSON schema campaigns must satisfy (feed to an LLM as format hint).",
            schema(json!({ "type": "object", "properties": {} })),
        ),
        Tool::new(
            "list_preset_actions",
            "List every preset action id + name (~112 entries: weapons, spells, class actions, monster attacks).",
            schema(json!({ "type": "object", "properties": {} })),
        ),
        Tool::new(
            "get_preset_action",
            "Fetch one preset action by id.",
            schema(json!({
                "type": "object",
                "properties": { "action_id": { "type": "string" } },
                "required": ["action_id"]
            })),
        ),
        Tool::new(
            "get_preset_monster",
            "Fetch one stat block by its deterministic preset id (preset_<key>).",
            schema(json!({
                "type": "object",
                "properties": { "monster_id": { "type": "string" } },
                "required": ["monster_id"]
            })),
        ),
        Tool::new(
            "lore_recall",
            "TF-IDF hybrid recall: rank lore lines against a query; returns top-k index/score/doc triples.",
            schema(json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "docs": { "type": "array", "items": { "type": "string" } },
                    "k": { "type": "integer", "default": 3 }
                },
                "required": ["query", "docs"]
            })),
        ),
    ]
}

// ------------------------------------------------------------------
// Dispatch
// ------------------------------------------------------------------

#[derive(Deserialize)]
struct ExprArgs {
    expr: String,
}

#[derive(Deserialize)]
struct FateArgs {
    #[serde(default = "d5")]
    odds_rank: u32,
    #[serde(default = "d5")]
    chaos_factor: u32,
}
fn d5() -> u32 {
    5
}

#[derive(Deserialize)]
struct CfArgs {
    #[serde(default = "d5")]
    chaos_factor: u32,
}

#[derive(Deserialize)]
struct TextArgs {
    text: String,
}

#[derive(Deserialize)]
struct IdArgs {
    action_id: String,
}

#[derive(Deserialize)]
struct MonsterIdArgs {
    monster_id: String,
}

#[derive(Deserialize)]
struct RecallArgs {
    query: String,
    docs: Vec<String>,
    #[serde(default = "dk")]
    k: usize,
}
fn dk() -> usize {
    3
}

/// Route one tool call by name. Returns the tool's JSON payload as text.
pub async fn handle_call(name: &str, args: Value) -> Result<CallToolResult, McpServerError> {
    match name {
        "roll_dice" => {
            let a: ExprArgs = parse_args(args)?;
            let mut dice = DiceEngine::new();
            let r = dice.evaluate(&a.expr)?;
            json_result(json!({
                "expr": a.expr,
                "total": r.total,
                "detail": r.detail,
                "kept_rolls": r.kept_rolls
            }))
        }
        "oracle_fate_check" => {
            let a: FateArgs = parse_args(args)?;
            let odds = Odds::all()
                .get(a.odds_rank.saturating_sub(1) as usize)
                .copied()
                .unwrap_or(Odds::FiftyFifty);
            let mut oracle = MythicOracle::new(a.chaos_factor);
            let r = oracle.ask_fate(odds);
            json_result(serde_json::to_value(&r)?)
        }
        "oracle_random_event" => {
            let mut oracle = MythicOracle::new(5);
            let m = oracle.random_event_now();
            json_result(serde_json::to_value(&m)?)
        }
        "scene_test" => {
            let a: CfArgs = parse_args(args)?;
            let mut oracle = MythicOracle::new(a.chaos_factor);
            let outcome = auto_dm_core::oracle::scene_test(
                a.chaos_factor.clamp(1, 9) as u8,
                oracle.rng_mut(),
            );
            json_result(serde_json::to_value(&outcome)?)
        }
        "parse_intent" => {
            let a: TextArgs = parse_args(args)?;
            let intent = GameIntent::from_llm_text(&a.text);
            json_result(serde_json::to_value(&intent)?)
        }
        "repair_campaign_json" => {
            let a: TextArgs = parse_args(args)?;
            text_result(repair_campaign_json(&a.text))
        }
        "campaign_json_schema" => json_result(campaign_json_schema()),
        "list_preset_actions" => {
            let list: Vec<Value> = all_preset_actions()
                .iter()
                .map(|a| json!({ "id": a.id, "name": a.name }))
                .collect();
            json_result(Value::Array(list))
        }
        "get_preset_action" => {
            let a: IdArgs = parse_args(args)?;
            match find_preset_action(&a.action_id) {
                Some(action) => json_result(serde_json::to_value(&action)?),
                None => text_result(format!("No preset action with id {}", a.action_id)),
            }
        }
        "get_preset_monster" => {
            let a: MonsterIdArgs = parse_args(args)?;
            match find_preset_monster(&a.monster_id) {
                Some(block) => json_result(serde_json::to_value(&block)?),
                None => text_result(format!("No preset monster with id {}", a.monster_id)),
            }
        }
        "lore_recall" => {
            let a: RecallArgs = parse_args(args)?;
            let hits: Vec<Value> = hybrid_recall(&a.query, &a.docs, a.k.max(1))
                .into_iter()
                .filter_map(|(i, s)| {
                    a.docs.get(i).map(|doc| json!({ "index": i, "score": s, "doc": doc }))
                })
                .collect();
            json_result(Value::Array(hits))
        }
        other => Err(McpServerError::UnknownTool(other.to_string())),
    }
}
