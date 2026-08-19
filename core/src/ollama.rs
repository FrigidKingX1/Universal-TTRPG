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
        std::net::TcpStream::connect("127.0.0.1:11434").is_ok()
    }
}

#[async_trait]
impl LlmBackend for OllamaLlmBackend {
    async fn complete(
        &self,
        system: &str,
        prompt: &str,
        _max_tokens: Option<u32>,
    ) -> Result<String, LlmError> {
        let url = format!("{OLLAMA_URL}/api/generate");
        let body = GenerateRequest {
            model: self.model.clone(),
            prompt: prompt.to_string(),
            system: system.to_string(),
            format: super::intent::game_intent_json_schema(),
            stream: false,
            options: GenerateOptions {
                temperature: 0.7,
                num_ctx: 4096,
                num_predict: _max_tokens,
            },
        };

        let resp: GenerateResponse = self
            .client
            .post(&url)
            .json(&body)
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| LlmError::Backend(format!("ollama generate failed: {e}")))?
            .json()
            .await
            .map_err(|e| LlmError::Backend(format!("ollama response parse failed: {e}")))?;

        if !resp.done {
            return Err(LlmError::Backend("ollama response incomplete".to_string()));
        }

        Ok(resp.response)
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
