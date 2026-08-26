//! MCP server for Universal TTRPG — exposes the deterministic engine
//! as tools so any MCP client (Claude Desktop, Cursor, etc.) can DM.
//!
//! V1 ships the deterministic core: dice, Mythic oracle, intent parsing,
//! campaign-JSON repair, preset content lookup, and hybrid lore recall.
//! Stateful session tools (combat, memory persistence) land next once
//! wired to the async engine session layer.
//!
//! Mirrors LoreKit's `server.py` tool surface. Runs over stdio by default.

use auto_dm_core::{dice::DiceError, llm::LlmError};
use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, JsonObject, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo,
    },
    service::{serve_server, RequestContext, RoleServer},
    transport::stdio,
    ErrorData,
};
use thiserror::Error;

pub mod tools;

pub use tools::{all_tools, handle_call};

#[derive(Debug, Error)]
pub enum McpServerError {
    #[error("dice error: {0}")]
    Dice(#[from] DiceError),
    #[error("llm error: {0}")]
    Llm(#[from] LlmError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unknown tool: {0}")]
    UnknownTool(String),
}

/// Public server struct implementing the rmcp handler. Stateless — every
/// tool is a pure function over core types (DiceEngine/MythicOracle seed
/// from entropy per call).
pub struct TtrpgMcpServer;

impl Default for TtrpgMcpServer {
    fn default() -> Self {
        Self
    }
}

impl ServerHandler for TtrpgMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.instructions = Some(
            "Universal TTRPG automated DM engine. Deterministic dice, Mythic GME oracle, \
             intent parsing, campaign JSON repair/schemas, bestiary and action-vault \
             lookups, plus TF-IDF hybrid lore recall."
                .into(),
        );
        info
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(all_tools()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let name: String = request.name.to_string();
        let args = JsonObject::from_iter(request.arguments.unwrap_or_default());

        match handle_call(&name, serde_json::Value::Object(args)).await {
            Ok(ok) => Ok(CallToolResponse::from(ok)),
            // Bad arguments and unknown tool names are the CALLER's fault —
            // report them as invalid params so agents can self-correct,
            // instead of a generic internal error.
            Err(McpServerError::Json(e)) => {
                Err(ErrorData::invalid_params(format!("invalid arguments: {e}"), None))
            }
            Err(McpServerError::UnknownTool(t)) => {
                Err(ErrorData::invalid_params(format!("unknown tool: {t}"), None))
            }
            Err(e) => Err(ErrorData::internal_error(e.to_string(), None)),
        }
    }
}

/// Run the MCP server over stdio (the standard transport for local tools).
pub async fn run_stdio() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let running = serve_server(TtrpgMcpServer, stdio()).await?;
    running.waiting().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        let mut fut = std::pin::pin!(f);
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
    fn catalog_lists_eleven_tools() {
        assert_eq!(all_tools().len(), 11);
    }

    #[test]
    fn roll_dice_returns_total_and_detail() {
        let out =
            block_on(handle_call("roll_dice", serde_json::json!({ "expr": "2d6+3" }))).unwrap();
        let text = out.content[0].as_text().unwrap().text.clone();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        let total = v["total"].as_i64().unwrap();
        assert!((5..=15).contains(&total), "total {total} outside 2d6+3");
        assert!(v["detail"].as_str().unwrap().contains('+'));
    }

    #[test]
    fn fate_check_shape() {
        let out = block_on(handle_call(
            "oracle_fate_check",
            serde_json::json!({ "odds_rank": 5, "chaos_factor": 5 }),
        ))
        .unwrap();
        let text = out.content[0].as_text().unwrap().text.clone();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        // FATE_CHART[FiftyFifty][CF=5] == 48
        assert_eq!(v["target"].as_u64().unwrap(), 48);
        assert!(v.get("outcome").is_some());
        assert!(v.get("roll").is_some());
    }

    #[test]
    fn parse_intent_narration() {
        let out = block_on(handle_call(
            "parse_intent",
            serde_json::json!({ "text": "The tavern falls silent." }),
        ))
        .unwrap();
        let text = out.content[0].as_text().unwrap().text.clone();
        assert!(text.contains("narration") || text.contains("Narration"), "{text}");
    }

    #[test]
    fn preset_action_roundtrip_via_list() {
        let out = block_on(handle_call("list_preset_actions", serde_json::json!({}))).unwrap();
        let text = out.content[0].as_text().unwrap().text.clone();
        let list: Vec<serde_json::Value> = serde_json::from_str(&text).unwrap();
        assert!(list.len() >= 90, "got {}", list.len());
        let first_id = list[0]["id"].as_str().unwrap().to_string();

        let out = block_on(handle_call(
            "get_preset_action",
            serde_json::json!({ "action_id": first_id }),
        ))
        .unwrap();
        let text = out.content[0].as_text().unwrap().text.clone();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["id"].as_str().unwrap(), first_id);
    }

    #[test]
    fn unknown_tool_errors() {
        let res = block_on(handle_call("nope", serde_json::json!({})));
        assert!(matches!(res, Err(McpServerError::UnknownTool(_))));
    }

    #[test]
    fn lore_recall_ranks_relevant_doc_first() {
        let docs = vec![
            "Bob betrayed the party".to_string(),
            "The tavern serves ale".to_string(),
            "Bob's betrayal caused the war".to_string(),
        ];
        let out = block_on(handle_call(
            "lore_recall",
            serde_json::json!({ "query": "Bob betrayal", "docs": docs, "k": 1 }),
        ))
        .unwrap();
        let text = out.content[0].as_text().unwrap().text.clone();
        let hits: Vec<serde_json::Value> = serde_json::from_str(&text).unwrap();
        assert_eq!(hits.len(), 1);
        // Doc 0 ("betrayed") and doc 2 ("betrayal") both match; doc 2 wins on
        // the exact query term. Either is a valid top hit.
        let idx = hits[0]["index"].as_u64().unwrap();
        assert!(idx == 0 || idx == 2, "unexpected top index {idx}");
    }
}
