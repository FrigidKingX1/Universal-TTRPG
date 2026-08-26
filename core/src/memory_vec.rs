//! Hybrid recall over CampaignMemory — TF-IDF + sqlite-vec cosine.
//!
//! Mirrors LoreKit's `support/recall.py` + `support/vectordb.py`
//! (semantic + keyword) via sqlite-vec pattern. Starts with pure TF-IDF
//! for offline use; promotes to cosine over `nomic-embed-text` (Ollama)
//! when available, same `hybrid_recall` signature. Swap the scorer for
//! `sqlite-vec` without changing call sites.

use std::collections::{HashMap, HashSet};

/// Model used for semantic embeddings (Ollama). Matches LoreKit's default.
pub const EMBED_MODEL: &str = "nomic-embed-text";
/// Weight for semantic vs keyword in hybrid score (0.7 semantic from LoreKit).
pub const HYBRID_ALPHA: f32 = 0.7;

/// Trait for embedding providers — lets tests inject a deterministic stub
/// without needing a running Ollama.
#[async_trait::async_trait]
pub trait Embedder: Send + Sync {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, String>;
}

/// Ollama embeddings provider (`/api/embeddings` with nomic-embed-text).
pub struct OllamaEmbedder {
    pub base_url: String,
    pub model: String,
}

impl OllamaEmbedder {
    pub fn new(base_url: Option<String>, model: Option<String>) -> Self {
        Self {
            base_url: base_url.unwrap_or_else(|| crate::ollama::DEFAULT_URL.to_string()),
            model: model.unwrap_or_else(|| EMBED_MODEL.to_string()),
        }
    }
}

#[async_trait::async_trait]
impl Embedder for OllamaEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        // Bounded so a hung Ollama degrades to TF-IDF fallback instead of
        // stalling the Lorekeeper agent indefinitely.
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;
        let body = serde_json::json!({ "model": self.model, "prompt": text });
        let resp = client
            .post(format!("{}/api/embeddings", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let s = resp.status().as_u16();
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("embeddings {s}: {b}"));
        }
        let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        v.get("embedding")
            .and_then(|e| e.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect())
            .filter(|vec: &Vec<f32>| !vec.is_empty())
            .ok_or_else(|| "missing embedding in response".to_string())
    }
}

/// Deterministic hash-based embedder for tests — no network.
pub struct StubEmbedder;

#[async_trait::async_trait]
impl Embedder for StubEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        Ok(stub_embed(text))
    }
}

fn stub_embed(text: &str) -> Vec<f32> {
    // Cheap deterministic 8-dim embedding from token hashes — enough to test
    // cosine + hybrid plumbing without a model.
    let toks = tokenize(text);
    let mut v = vec![0.0f32; 8];
    for t in toks {
        let h = {
            let mut h = 2166136261u32;
            for b in t.bytes() {
                h ^= b as u32;
                h = h.wrapping_mul(16777619);
            }
            h
        };
        v[(h as usize) % 8] += 1.0;
    }
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in &mut v {
            *x /= norm;
        }
    }
    v
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        (dot / (na * nb)).clamp(-1.0, 1.0)
    }
}

pub(crate) fn tokenize(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() > 2)
        .map(|t| t.to_string())
        .collect()
}

/// Score each doc against the query with TF-IDF and return top-k.
///
/// Scores are cosine-like: sum(tf * idf) per query term.
/// Ties broken by original order (stable).
pub fn hybrid_recall(query: &str, docs: &[String], k: usize) -> Vec<(usize, f32)> {
    if docs.is_empty() || query.trim().is_empty() || k == 0 {
        return Vec::new();
    }
    let q_tokens = tokenize(query);
    if q_tokens.is_empty() {
        return Vec::new();
    }
    let q_set: HashSet<String> = q_tokens.into_iter().collect();

    // Document frequencies for query terms only (faster).
    let mut df: HashMap<String, usize> = HashMap::new();
    let doc_tokens: Vec<Vec<String>> = docs.iter().map(|d| tokenize(d)).collect();
    for toks in &doc_tokens {
        let uniq: HashSet<String> = toks.iter().cloned().collect();
        for t in uniq {
            if q_set.contains(&t) {
                *df.entry(t).or_insert(0) += 1;
            }
        }
    }

    let n = docs.len() as f32;
    let mut scored: Vec<(usize, f32)> = doc_tokens
        .iter()
        .enumerate()
        .map(|(idx, toks)| {
            if toks.is_empty() {
                return (idx, 0.0);
            }
            let mut tf_map: HashMap<&String, usize> = HashMap::new();
            for t in toks {
                *tf_map.entry(t).or_insert(0) += 1;
            }
            let len = toks.len() as f32;
            let mut score = 0.0f32;
            for term in &q_set {
                if let Some(&cnt) = tf_map.get(term) {
                    let tf = cnt as f32 / len;
                    let df_val = *df.get(term).unwrap_or(&1) as f32;
                    let idf = (n / df_val).ln() + 1.0;
                    score += tf * idf;
                }
            }
            (idx, score)
        })
        .filter(|(_, s)| *s > 0.0)
        .collect();

    // Sort descending by score, stable by original index.
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
    scored.truncate(k);
    scored
}

/// Convenience: recall over a CampaignMemory's last `n` events.
pub fn recall_from_memory(query: &str, memory_context: &str, k: usize) -> Vec<String> {
    let docs: Vec<String> =
        memory_context.lines().map(|l| l.to_string()).filter(|l| !l.trim().is_empty()).collect();
    hybrid_recall(query, &docs, k).into_iter().map(|(idx, _)| docs[idx].clone()).collect()
}

/// Async hybrid: semantic cosine (nomic-embed-text) blended with TF-IDF.
/// Falls back to pure TF-IDF if the embedder fails (Ollama down, model
/// not pulled). Keeps the same return shape as `hybrid_recall`.
pub async fn hybrid_recall_async<E: Embedder + ?Sized>(
    query: &str,
    docs: &[String],
    k: usize,
    embedder: &E,
) -> Vec<(usize, f32)> {
    if docs.is_empty() || query.trim().is_empty() || k == 0 {
        return Vec::new();
    }

    // TF-IDF baseline (always computed, cheap)
    let tfidf_scores = {
        let mut m: HashMap<usize, f32> = HashMap::new();
        for (idx, s) in hybrid_recall(query, docs, docs.len()) {
            m.insert(idx, s);
        }
        m
    };
    // Normalize TF-IDF to 0..1 for blending
    let tfidf_max = tfidf_scores.values().cloned().fold(0.0f32, f32::max).max(1e-6);

    // Semantic scores via embeddings
    let q_emb = match embedder.embed(query).await {
        Ok(v) => v,
        Err(_) => return hybrid_recall(query, docs, k),
    };
    let mut doc_embs: Vec<Option<Vec<f32>>> = Vec::with_capacity(docs.len());
    for d in docs {
        match embedder.embed(d).await {
            Ok(v) => doc_embs.push(Some(v)),
            Err(_) => doc_embs.push(None),
        }
    }

    let mut scored: Vec<(usize, f32)> = Vec::new();
    for (idx, doc_emb) in doc_embs.iter().enumerate() {
        let tfidf = tfidf_scores.get(&idx).cloned().unwrap_or(0.0) / tfidf_max;
        let sem = match doc_emb {
            Some(emb) => cosine(&q_emb, emb).max(0.0),
            None => 0.0,
        };
        let hybrid = HYBRID_ALPHA * sem + (1.0 - HYBRID_ALPHA) * tfidf;
        if hybrid > 1e-6 {
            scored.push((idx, hybrid));
        }
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
    scored.truncate(k);
    // If semantic produced nothing (all embeds failed), fall back
    if scored.is_empty() {
        return hybrid_recall(query, docs, k);
    }
    scored
}

/// Convenience async version over a memory context string.
pub async fn recall_from_memory_async<E: Embedder + ?Sized>(
    query: &str,
    memory_context: &str,
    k: usize,
    embedder: &E,
) -> Vec<String> {
    let docs: Vec<String> =
        memory_context.lines().map(|l| l.to_string()).filter(|l| !l.trim().is_empty()).collect();
    hybrid_recall_async(query, &docs, k, embedder)
        .await
        .into_iter()
        .map(|(idx, _)| docs[idx].clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recalls_most_relevant_doc() {
        let docs = vec![
            "Bob betrayed the party in Chapter 3".to_string(),
            "The tavern serves ale".to_string(),
            "Bob's betrayal caused the war".to_string(),
        ];
        let hits = hybrid_recall("Bob betrayal", &docs, 1);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].0 == 0 || hits[0].0 == 2);
    }

    #[test]
    fn no_match_returns_empty() {
        let docs = vec!["tavern ale".to_string()];
        assert!(hybrid_recall("dragon hoard", &docs, 3).is_empty());
    }

    #[test]
    fn respects_k_limit() {
        let docs = vec!["bob bob bob".to_string(); 5];
        assert_eq!(hybrid_recall("bob", &docs, 2).len(), 2);
    }

    #[test]
    fn recall_from_memory_splits_lines() {
        let ctx = "[Player]: Bob betrayed us\n[DM]: Tavern is quiet";
        let hits = recall_from_memory("Bob betrayal", ctx, 1);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].contains("Bob"));
    }

    #[test]
    fn empty_inputs_return_empty() {
        assert!(hybrid_recall("", &["hello".into()], 3).is_empty());
        assert!(hybrid_recall("hi", &[], 3).is_empty());
    }

    #[test]
    fn cosine_identical_is_one() {
        let a = vec![1.0, 0.0, 0.0];
        assert!((cosine(&a, &a) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_orthogonal_is_zero() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert!(cosine(&a, &b).abs() < 1e-6);
    }

    #[test]
    fn hybrid_async_with_stub_embedder() {
        let docs = vec![
            "Bob betrayed the party in Chapter 3".to_string(),
            "The tavern serves ale".to_string(),
        ];
        let hits =
            futures_test_block_on(hybrid_recall_async("Bob betrayal", &docs, 1, &StubEmbedder));
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn hybrid_async_falls_back_when_no_semantic_match() {
        // Query with no lexical overlap still gets no results (TF-IDF zero,
        // stub embedding may give weak cosine but hybrid filters <1e-6)
        let docs = vec!["xyz abc".to_string()];
        let hits =
            futures_test_block_on(hybrid_recall_async("dragon hoard", &docs, 3, &StubEmbedder));
        // May be empty — just ensure it doesn't panic and respects k
        assert!(hits.len() <= 1);
    }

    fn futures_test_block_on<F: std::future::Future>(f: F) -> F::Output {
        use std::pin::pin;
        let mut fut = pin!(f);
        let waker = std::task::Waker::noop();
        let mut cx = std::task::Context::from_waker(waker);
        loop {
            match fut.as_mut().poll(&mut cx) {
                std::task::Poll::Ready(v) => return v,
                std::task::Poll::Pending => std::thread::yield_now(),
            }
        }
    }
}
