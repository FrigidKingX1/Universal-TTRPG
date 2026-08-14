use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;

use super::intent::{GAME_INTENT_GBNF, GAME_INTENT_INSTRUCTIONS};
use super::llm::{LlmBackend, LlmError};

/// A.L.I.S.O.N.'s IPC control socket (see alison_ipc.AlisonIPC).
pub const CONTROL_ENDPOINT: &str = "tcp://127.0.0.1:5555";

const PROBE_TIMEOUT: Duration = Duration::from_millis(2000);
const GENERATE_TIMEOUT: Duration = Duration::from_millis(60_000);

#[derive(Serialize)]
struct TtrpgResolve {
    action: &'static str,
    prompt: String,
    system_prompt: String,
    grammar: String,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Serialize)]
struct TtrpgAffect {
    action: &'static str,
}

/// `LlmBackend` that resolves narration through A.L.I.S.O.N. over ZMQ.
///
/// Each `complete` opens a fresh REQ socket (REQ sockets are single-shot), sends
/// a `ttrpg_resolve` control command with the GameIntent GBNF grammar, and returns
/// the constrained model text. The caller (the DM pipeline) parses that text into
/// a [`super::intent::GameIntent`].
pub struct AlisonLlmBackend {
    context: Arc<zmq::Context>,
    endpoint: String,
}

impl AlisonLlmBackend {
    pub fn new(endpoint: impl Into<String>) -> Result<Self, LlmError> {
        let context = zmq::Context::new();
        Ok(Self {
            context: Arc::new(context),
            endpoint: endpoint.into(),
        })
    }

    pub fn default_endpoint() -> &'static str {
        CONTROL_ENDPOINT
    }

    /// Model-free reachability probe: does A.L.I.S.O.N.'s control socket answer?
    /// Uses `ttrpg_affect` (telemetry read) so it does not spin up generation.
    pub fn reachable(endpoint: &str) -> bool {
        let ctx = zmq::Context::new();
        let socket = match ctx.socket(zmq::REQ) {
            Ok(s) => s,
            Err(_) => return false,
        };
        if socket.connect(endpoint).is_err() {
            return false;
        }
        let _ = socket.set_rcvtimeo(PROBE_TIMEOUT.as_millis() as i32);
        let _ = socket.set_sndtimeo(PROBE_TIMEOUT.as_millis() as i32);
        let msg = match serde_json::to_string(&TtrpgAffect {
            action: "ttrpg_affect",
        }) {
            Ok(m) => m,
            Err(_) => return false,
        };
        if socket.send(msg.as_bytes(), 0).is_err() {
            return false;
        }
        match socket.recv_string(0) {
            Ok(Ok(reply)) => reply.replace(' ', "").contains("\"ok\":true"),
            _ => false,
        }
    }
}

#[async_trait]
impl LlmBackend for AlisonLlmBackend {
    async fn complete(
        &self,
        system: &str,
        prompt: &str,
        max_tokens: Option<u32>,
    ) -> Result<String, LlmError> {
        let socket = self
            .context
            .socket(zmq::REQ)
            .map_err(|e| LlmError::Backend(format!("zmq socket: {e}")))?;
        socket
            .connect(&self.endpoint)
            .map_err(|e| LlmError::Backend(format!("zmq connect {}: {}", self.endpoint, e)))?;
        socket
            .set_rcvtimeo(GENERATE_TIMEOUT.as_millis() as i32)
            .map_err(|e| LlmError::Backend(format!("rcvtimeo: {e}")))?;
        socket
            .set_sndtimeo(5_000)
            .map_err(|e| LlmError::Backend(format!("sndtimeo: {e}")))?;

        let system_prompt = format!("{GAME_INTENT_INSTRUCTIONS}\n\n{system}");
        let req = TtrpgResolve {
            action: "ttrpg_resolve",
            prompt: prompt.to_string(),
            system_prompt,
            grammar: GAME_INTENT_GBNF.to_string(),
            max_tokens: max_tokens.unwrap_or(400),
            temperature: 0.7,
        };
        let msg = serde_json::to_string(&req)
            .map_err(|e| LlmError::Backend(format!("serde: {e}")))?;

        socket
            .send(msg.as_bytes(), 0)
            .map_err(|e| LlmError::Backend(format!("zmq send: {e}")))?;

        let reply = socket
            .recv_string(0)
            .map_err(|e| LlmError::Backend(format!("zmq recv: {e}")))?
            .map_err(|e| LlmError::Backend(format!("zmq reply not utf8: {:?}", e)))?;

        let val: Value = serde_json::from_str(&reply)
            .map_err(|e| LlmError::Backend(format!("alison reply not json: {e}")))?;
        if val.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            let err = val
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown alison error");
            return Err(LlmError::Backend(err.to_string()));
        }
        let text = val
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(text)
    }

    fn is_stub(&self) -> bool {
        false
    }
}

/// A.L.I.S.O.N.'s current affective read-out: the active-inference precision
/// (`gamma`) and the 6-element drive vector.
#[derive(Debug, Clone)]
pub struct AffectReading {
    pub gamma: f32,
    pub drives: Vec<f32>,
}

/// One campaign event pushed into A.L.I.S.O.N.'s hippocampal buffer (Phase 3
/// memory sync) so later narration can draw on what actually happened.
#[derive(Serialize)]
struct IngestEntry {
    speaker: String,
    content: String,
    scene_id: Option<String>,
}

#[derive(Serialize)]
struct TtrpgIngest {
    action: &'static str,
    entry: IngestEntry,
}

/// Read A.L.I.S.O.N.'s affective state via the `ttrpg_affect` control verb.
pub fn query_affect(endpoint: &str) -> Result<AffectReading, LlmError> {
    let ctx = zmq::Context::new();
    let socket = ctx
        .socket(zmq::REQ)
        .map_err(|e| LlmError::Backend(format!("zmq socket: {e}")))?;
    socket
        .connect(endpoint)
        .map_err(|e| LlmError::Backend(format!("zmq connect {endpoint}: {e}")))?;
    socket
        .set_rcvtimeo(5_000)
        .map_err(|e| LlmError::Backend(format!("rcvtimeo: {e}")))?;
    socket
        .set_sndtimeo(5_000)
        .map_err(|e| LlmError::Backend(format!("sndtimeo: {e}")))?;

    let msg = serde_json::to_string(&serde_json::json!({ "action": "ttrpg_affect" }))
        .map_err(|e| LlmError::Backend(format!("serde: {e}")))?;
    socket
        .send(msg.as_bytes(), 0)
        .map_err(|e| LlmError::Backend(format!("zmq send: {e}")))?;
    let reply = socket
        .recv_string(0)
        .map_err(|e| LlmError::Backend(format!("zmq recv: {e}")))?
        .map_err(|e| LlmError::Backend(format!("zmq reply not utf8: {:?}", e)))?;
    let val: Value = serde_json::from_str(&reply)
        .map_err(|e| LlmError::Backend(format!("alison reply not json: {e}")))?;
    if val.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let err = val
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown alison error");
        return Err(LlmError::Backend(err.to_string()));
    }
    let gamma = val
        .get("gamma")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;
    let drives = val
        .get("drives")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect())
        .unwrap_or_default();
    Ok(AffectReading { gamma, drives })
}

/// Push a campaign event into A.L.I.S.O.N.'s memory via the `ttrpg_ingest` verb.
/// Returns the number of events currently held.
pub fn push_ingest(
    endpoint: &str,
    speaker: &str,
    content: &str,
    scene_id: Option<&str>,
) -> Result<u32, LlmError> {
    let ctx = zmq::Context::new();
    let socket = ctx
        .socket(zmq::REQ)
        .map_err(|e| LlmError::Backend(format!("zmq socket: {e}")))?;
    socket
        .connect(endpoint)
        .map_err(|e| LlmError::Backend(format!("zmq connect {endpoint}: {e}")))?;
    socket
        .set_rcvtimeo(5_000)
        .map_err(|e| LlmError::Backend(format!("rcvtimeo: {e}")))?;
    socket
        .set_sndtimeo(5_000)
        .map_err(|e| LlmError::Backend(format!("sndtimeo: {e}")))?;

    let req = TtrpgIngest {
        action: "ttrpg_ingest",
        entry: IngestEntry {
            speaker: speaker.to_string(),
            content: content.to_string(),
            scene_id: scene_id.map(|s| s.to_string()),
        },
    };
    let msg = serde_json::to_string(&req)
        .map_err(|e| LlmError::Backend(format!("serde: {e}")))?;
    socket
        .send(msg.as_bytes(), 0)
        .map_err(|e| LlmError::Backend(format!("zmq send: {e}")))?;
    let reply = socket
        .recv_string(0)
        .map_err(|e| LlmError::Backend(format!("zmq recv: {e}")))?
        .map_err(|e| LlmError::Backend(format!("zmq reply not utf8: {:?}", e)))?;
    let val: Value = serde_json::from_str(&reply)
        .map_err(|e| LlmError::Backend(format!("alison reply not json: {e}")))?;
    if val.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let err = val
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown alison error");
        return Err(LlmError::Backend(err.to_string()));
    }
    Ok(val
        .get("count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32)
}
