//! Server library — exposes embedded presets for MCP and other consumers.

pub mod presets;

pub use presets::{
    find_preset_action, find_preset_monster, find_preset_class, seed_content,
    all_preset_actions, preset_actions, preset_stat_blocks,
};