//! Server library — exposes embedded presets and the session model for
//! the binary, MCP, and other consumers. `main.rs` reuses these modules
//! instead of recompiling its own copies.

pub mod presets;
pub mod session;

pub use presets::{
    all_preset_actions, find_preset_action, find_preset_monster, preset_actions,
    preset_stat_blocks, seed_content,
};
