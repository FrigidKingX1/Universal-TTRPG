use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use super::llm::{LlmBackend, LlmError};

const DEFAULT_MODEL: &str = "llama3.2";
const OLLAMA_URL: &str = "http://localhost:11434";

pub struct OllamaLlmBackend {
    client: Client,
    model: String,
}

#[derive(Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    system: String,
    format: serde_json::Value,
    stream: bool,
    options: GenerateOptions,
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f64,
    num_ctx: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
    done: bool,
}

#[derive(Deserialize)]
struct TagResponse {
    models: Vec<TagModel>,
}

#[derive(Deserialize)]
struct TagModel {
    name: String,
}

impl OllamaLlmBackend {
    pub fn new(model: Option<String>) -> Self {
        Self {
            client: Client::new(),
            model: model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        }
    }

    /// Fast TCP reachability probe — does not load a model.
    pub fn reachable() -> bool {
        let addr = OLLAMA_URL
            .strip_prefix("http://")
            .or_else(|| OLLAMA_URL.strip_prefix("https://"))
            .unwrap_or("127.0.0.1:11434");
        std::net::TcpStream::connect(addr).is_ok()
    }
}

#[async_trait]
impl LlmBackend for OllamaLlmBackend {
    async fn complete(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
    ) -> Result<String, LlmError> {
        self.complete_streaming(system, prompt, max_tokens, &mut |_| {})
            .await
    }

    async fn complete_streaming(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
        on_token: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<String, LlmError> {
        let url = format!("{OLLAMA_URL}/api/generate");
        let body = GenerateRequest {
            model: self.model.clone(),
            prompt: prompt.to_string(),
            system: system.to_string(),
            format: super::intent::game_intent_json_schema(),
            stream: true,
            options: GenerateOptions {
                temperature: 0.7,
                num_ctx: 4096,
                num_predict: max_tokens,
            },
        };

        let response = self
            .client
            .post(&url)
            .json(&body)
            .timeout(Duration::from_secs(180))
            .send()
            .await
            .map_err(|e| LlmError::Backend(format!("ollama generate failed: {e}")))?;

        if !response.status().is_success() {
            return Err(LlmError::Backend(format!(
                "ollama returned status {}",
                response.status()
            )));
        }

        // Ollama streams NDJSON chunks: one JSON object per line with a
        // `response` token field and a final `done: true` marker.
        let mut full = String::new();
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;
        let mut buffer = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|e| LlmError::Backend(format!("ollama stream failed: {e}")))?;
            buffer.extend_from_slice(&chunk);
            // Process complete lines out of the buffer.
            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=pos).collect();
                let line = std::str::from_utf8(&line).unwrap_or("").trim();
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_str::<GenerateResponse>(line) {
                    Ok(parsed) => {
                        if !parsed.response.is_empty() {
                            on_token(&parsed.response);
                            full.push_str(&parsed.response);
                        }
                        if parsed.done {
                            return Ok(full);
                        }
                    }
                    Err(_) => { /* skip malformed line */ }
                }
            }
        }

        if full.is_empty() {
            return Err(LlmError::Backend("ollama stream produced no output".to_string()));
        }
        Ok(full)
    }

    fn is_stub(&self) -> bool {
        false
    }
}

/// List installed model names from Ollama's `/api/tags` endpoint.
pub async fn list_models() -> Result<Vec<String>, LlmError> {
    let client = Client::new();
    let resp: TagResponse = client
        .get(format!("{OLLAMA_URL}/api/tags"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| LlmError::Backend(format!("ollama tags request failed: {e}")))?
        .json()
        .await
        .map_err(|e| LlmError::Backend(format!("ollama tags parse failed: {e}")))?;
    Ok(resp.models.into_iter().map(|m| m.name).collect())
}
