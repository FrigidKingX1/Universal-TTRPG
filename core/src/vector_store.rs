//! Vector store stub — API-compatible with a future `sqlite-vec` backend.
//!
//! Mirrors LoreKit's `support/vectordb.py` + `support/recall.py` but starts
//! as pure Rust TF-IDF so it runs with zero deps / no embedding model.
//! Swap the scorer for cosine over `nomic-embed-text` later without changing
//! call sites: `HybridStore::search(query, k)` keeps the same signature.

use crate::memory_vec::hybrid_recall;

/// In-memory hybrid store. Add docs with `insert`, search with `search`.
/// When `sqlite-vec` lands, this becomes a thin wrapper around the extension.
#[derive(Debug, Default, Clone)]
pub struct VectorStore {
    docs: Vec<(String, String)>, // (id, text)
}

impl VectorStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, id: impl Into<String>, text: impl Into<String>) {
        self.docs.push((id.into(), text.into()));
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    /// Hybrid TF-IDF search — returns top-k (id, score) sorted descending.
    pub fn search(&self, query: &str, k: usize) -> Vec<(String, f32)> {
        let texts: Vec<String> = self.docs.iter().map(|(_, t)| t.clone()).collect();
        hybrid_recall(query, &texts, k)
            .into_iter()
            .map(|(idx, score)| (self.docs[idx].0.clone(), score))
            .collect()
    }

    /// Direct TF-IDF over an ad-hoc slice (no insert needed) — useful for
    /// one-off CampaignMemory queries.
    pub fn recall_over_slice(query: &str, docs: &[String], k: usize) -> Vec<(usize, f32)> {
        hybrid_recall(query, docs, k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_search_roundtrip() {
        let mut store = VectorStore::new();
        store.insert("a", "Bob betrayed the party in Chapter 3");
        store.insert("b", "The tavern serves ale");
        store.insert("c", "Bob's betrayal caused the war");
        let hits = store.search("Bob betrayal", 1);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].0 == "a" || hits[0].0 == "c");
    }

    #[test]
    fn empty_store_returns_empty() {
        let store = VectorStore::new();
        assert!(store.search("dragon", 3).is_empty());
    }

    #[test]
    fn recall_over_slice_delegates() {
        let docs = vec!["bob bob bob".to_string(); 5];
        assert_eq!(VectorStore::recall_over_slice("bob", &docs, 2).len(), 2);
    }
}
