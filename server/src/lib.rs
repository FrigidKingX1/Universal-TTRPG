//! Server library — exposes embedded presets and the session model for
//! the binary, MCP, and other consumers. `main.rs` reuses these modules
//! instead of recompiling its own copies.

pub mod presets;
pub mod session;

pub use presets::{
    find_preset_action, find_preset_monster, find_preset_class, seed_content,
    all_preset_actions, preset_actions, preset_stat_blocks,
};
