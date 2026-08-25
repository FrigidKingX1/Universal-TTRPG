//! MCP server implementation using rmcp 3.x manual ServerHandler impl.

use super::*;
use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolResult, ContentBlock, ListToolsResult, ServerCapabilities, Tool,
        PaginatedRequestParams, CallToolRequestParams, ServerInfo, ResultType, CacheScope,
    },
    service::RequestContext,
    transport::stdio,
    ErrorData as McpError,
    RoleServer,
};
use std::sync::Arc;

pub struct McpServer {
    state: ServerState,
}

impl McpServer {
    pub fn new(state: ServerState) -> Self {
        Self { state }
    }
}

impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            name: "universal-ttrpg".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            protocol_version: rmcp::model::ProtocolVersion::LATEST,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            instructions: Some("Universal TTRPG MCP Server - exposes the deterministic game engine as tools".into()),
        }
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = tools::all_tools();
        Ok(ListToolsResult {
            result_type: Some(ResultType::COMPLETE),
            tools,
            meta: None,
            next_cursor: None,
            ttl_ms: None,
            cache_scope: None,
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let name = request.name.as_str();
        let args = request.arguments.unwrap_or_default();

        let result = match name {
            // Dice
            "roll_dice" => {
                let args: tools::RollDiceArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_roll_dice(args).await
            }
            // Combat
            "resolve_entity" => {
                let args: tools::ResolveEntityArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_resolve_entity(&self.state, args).await
            }
            "create_combatant" => {
                let args: tools::CreateCombatantArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_create_combatant(args).await
            }
            "apply_attack" => {
                let args: tools::ApplyAttackArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_apply_attack(&self.state, args).await
            }
            // Session/State
            "apply_session_effects" => {
                let args: tools::ApplyEffectsArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_apply_effects(&self.state, args).await
            }
            "remember" => {
                let args: tools::RememberArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_remember(&self.state, args).await
            }
            "get_memory" => {
                let args: tools::GetMemoryArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_get_memory(&self.state, args).await
            }
            "rewind_to_log" => {
                let args: tools::RewindArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_rewind(&self.state, args).await
            }
            "tick_idle_clocks" => {
                let args: tools::TickClocksArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_tick_clocks(&self.state, args).await
            }
            "count_idle_trail" => {
                let args: tools::CountIdleArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_count_idle(&self.state, args).await
            }
            // Oracle
            "oracle_query" => {
                let args: tools::OracleQueryArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_oracle_query(&self.state, args).await
            }
            // Intent/LLM
            "parse_intent" => {
                let args: tools::ParseIntentArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_parse_intent(&self.state, args).await
            }
            "repair_campaign_json" => {
                let args: tools::RepairCampaignJsonArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_repair_campaign_json(&self.state, args).await
            }
            "campaign_json_schema" => {
                let args: tools::CampaignSchemaArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_campaign_schema(&self.state, args).await
            }
            // Presets
            "get_preset_action" => {
                let args: tools::GetPresetActionArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_get_preset_action(&self.state, args).await
            }
            "get_preset_monster" => {
                let args: tools::GetPresetMonsterArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_get_preset_monster(&self.state, args).await
            }
            "get_preset_class" => {
                let args: tools::GetPresetClassArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_get_preset_class(&self.state, args).await
            }
            "list_preset_actions" => {
                let args: tools::ListPresetActionsArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_list_preset_actions(&self.state, args).await
            }
            // Export
            "export_campaign" => {
                let args: tools::ExportCampaignArgs = match serde_json::from_value(args) {
                    Ok(a) => a,
                    Err(e) => return Err(McpError::internal_error(e.to_string(), None)),
                };
                tools::handle_export_campaign(&self.state, args).await
            }
            _ => return Err(McpError::method_not_found(format!("Unknown tool: {name}"))),
        };

        result.map_err(|e| McpError::internal_error(e.to_string(), None))
    }
}

pub async fn run_stdio(state: ServerState) -> Result<(), McpServerError> {
    let server = McpServer::new(state);
    let transport = stdio();
    rmcp::service::serve_server(server, transport).await?;
    Ok(())
}