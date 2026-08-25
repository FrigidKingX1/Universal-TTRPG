//! MCP server binary — runs over stdio so MCP clients (Claude Desktop,
//! Cursor, etc.) can drive the Universal TTRPG engine.
//!
//! Usage: auto-dm-mcp   (stdio transport; logs go to stderr)

#[tokio::main]
async fn main() {
    eprintln!("universal-ttrpg MCP server starting (stdio)…");
    if let Err(e) = auto_dm_mcp::run_stdio().await {
        eprintln!("mcp server error: {e}");
        std::process::exit(1);
    }
}
