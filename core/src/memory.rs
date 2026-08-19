use std::collections::VecDeque;

const MAX_EVENTS: usize = 50;

/// In-memory ring buffer of recent campaign events. Fed to the LLM as context
/// so it can reference prior actions and narration without a separate memory system.
pub struct CampaignMemory {
    events: VecDeque<String>,
}

impl CampaignMemory {
    pub fn new() -> Self {
        Self {
            events: VecDeque::with_capacity(MAX_EVENTS),
        }
    }

    /// Append a speaker + content pair as `"[speaker]: content"`.
    pub fn push(&mut self, speaker: &str, content: &str) {
        let entry = format!("[{speaker}]: {content}");
        if self.events.len() >= MAX_EVENTS {
            self.events.pop_front();
        }
        self.events.push_back(entry);
    }

    /// Format the last `n` events as a context block for prompt injection.
    pub fn to_context(&self, n: usize) -> String {
        let len = self.events.len();
        let skip = len.saturating_sub(n);
        self.events
            .iter()
            .skip(skip)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

impl Default for CampaignMemory {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_context() {
        let mut mem = CampaignMemory::new();
        mem.push("Player", "I open the gate");
        mem.push("Auto-DM", "The gate groans open.");
        let ctx = mem.to_context(10);
        assert!(ctx.contains("Player"));
        assert!(ctx.contains("Auto-DM"));
    }

    #[test]
    fn respects_max_events() {
        let mut mem = CampaignMemory::new();
        for i in 0..60 {
            mem.push("Sys", &format!("event {i}"));
        }
        assert_eq!(mem.events.len(), MAX_EVENTS);
        let ctx = mem.to_context(100);
        assert!(!ctx.contains("event 0"));
        assert!(ctx.contains("event 59"));
    }

    #[test]
    fn empty_memory_produces_empty_context() {
        let mem = CampaignMemory::new();
        assert!(mem.to_context(10).is_empty());
        assert!(mem.is_empty());
    }

    #[test]
    fn to_context_zero_returns_empty() {
        let mut mem = CampaignMemory::new();
        mem.push("Player", "I attack the goblin.");
        assert!(mem.to_context(0).is_empty());
    }
}
