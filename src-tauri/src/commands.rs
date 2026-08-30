use auto_dm_core::agents::CrewOrchestrator;
use auto_dm_core::dice::DiceEngine;
use auto_dm_core::engine::{
    execute_attack, roll_initiative, Combatant, EngineOutcome, PrerequisiteCheck,
};
use auto_dm_core::llm::{DmRequest, DmResponse};
use auto_dm_core::models::{ActionDefinition, CharacterProfile, EncounterStatBlock};
use auto_dm_core::oracle::{
    EnrichedEvent, EventMeaning, MythicOracle, NpcRef, Odds, OracleContext, ThreadRef,
};
use auto_dm_engine::crew::run_crew_turn;
use auto_dm_engine::{
    apply_session_effects, combatant_from_value, remember, tick_idle_clocks, GameState, Repository,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn emit(app: &AppHandle, event: &str, payload: &impl Serialize) {
    let _ = app.emit(event, payload);
}

// ---------- Characters -------------------------------------------------

#[tauri::command]
pub async fn save_character(
    state: State<'_, GameState>,
    profile: CharacterProfile,
) -> CmdResult<CharacterProfile> {
    state.repo.save_character(&profile).await.map_err(err)?;
    Ok(profile)
}

#[tauri::command]
pub async fn load_character(
    state: State<'_, GameState>,
    id: String,
) -> CmdResult<Option<CharacterProfile>> {
    match state.repo.load_character(&id).await {
        Ok(p) => Ok(Some(p)),
        Err(auto_dm_engine::DbError::NotFound(_)) => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
pub async fn list_characters(state: State<'_, GameState>) -> CmdResult<Vec<CharacterProfile>> {
    state.repo.list_characters().await.map_err(err)
}

#[tauri::command]
pub async fn delete_character(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_character(&id).await.map_err(err)
}

// ---------- Actions ----------------------------------------------------

#[tauri::command]
pub async fn save_action(
    state: State<'_, GameState>,
    action: ActionDefinition,
) -> CmdResult<ActionDefinition> {
    state.repo.save_action(&action).await.map_err(err)?;
    Ok(action)
}

#[tauri::command]
pub async fn list_actions(state: State<'_, GameState>) -> CmdResult<Vec<ActionDefinition>> {
    state.repo.list_actions().await.map_err(err)
}

#[tauri::command]
pub async fn delete_action(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_action(&id).await.map_err(err)
}

// ---------- Stat blocks ------------------------------------------------

#[tauri::command]
pub async fn save_stat_block(
    state: State<'_, GameState>,
    block: EncounterStatBlock,
) -> CmdResult<EncounterStatBlock> {
    state.repo.save_stat_block(&block).await.map_err(err)?;
    Ok(block)
}

#[tauri::command]
pub async fn list_stat_blocks(state: State<'_, GameState>) -> CmdResult<Vec<EncounterStatBlock>> {
    state.repo.list_stat_blocks().await.map_err(err)
}

#[tauri::command]
pub async fn delete_stat_block(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_stat_block(&id).await.map_err(err)
}

// ---------- Scenes -----------------------------------------------------

#[tauri::command]
pub async fn create_scene(
    state: State<'_, GameState>,
    app: AppHandle,
    title: String,
    chaos_factor: i32,
) -> CmdResult<auto_dm_engine::Scene> {
    let scene = state.repo.create_scene(&title, chaos_factor).await.map_err(err)?;
    emit(&app, "scene:created", &scene);
    Ok(scene)
}

#[tauri::command]
pub async fn list_scenes(state: State<'_, GameState>) -> CmdResult<Vec<auto_dm_engine::Scene>> {
    state.repo.list_scenes().await.map_err(err)
}

#[tauri::command]
pub async fn active_scene(state: State<'_, GameState>) -> CmdResult<Option<auto_dm_engine::Scene>> {
    state.repo.active_scene().await.map_err(err)
}

#[tauri::command]
pub async fn set_active_scene(state: State<'_, GameState>, id: String) -> CmdResult<()> {
    state.repo.set_active_scene(&id).await.map_err(err)
}

#[tauri::command]
pub async fn delete_scene(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_scene(&id).await.map_err(err)
}

#[tauri::command]
pub async fn update_scene_summary(
    state: State<'_, GameState>,
    id: String,
    summary: Option<String>,
) -> CmdResult<()> {
    state.repo.update_scene_summary(&id, summary.as_deref()).await.map_err(err)
}

#[tauri::command]
pub async fn update_scene_chaos_factor(
    state: State<'_, GameState>,
    id: String,
    chaos_factor: i32,
) -> CmdResult<()> {
    state.repo.update_scene_chaos_factor(&id, chaos_factor).await.map_err(err)
}

// ---------- Log --------------------------------------------------------

#[tauri::command]
pub async fn append_log(
    state: State<'_, GameState>,
    app: AppHandle,
    scene_id: String,
    speaker: String,
    content: String,
) -> CmdResult<auto_dm_engine::LogEntry> {
    let entry = state.repo.append_log(&scene_id, &speaker, &content, None).await.map_err(err)?;
    emit(&app, "log:new", &entry);
    Ok(entry)
}

#[tauri::command]
pub async fn list_logs(
    state: State<'_, GameState>,
    scene_id: String,
    limit: i64,
) -> CmdResult<Vec<auto_dm_engine::LogEntry>> {
    state.repo.list_logs(&scene_id, limit).await.map_err(err)
}

// ---------- Dice -------------------------------------------------------

/// Dice roll response for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct RollResponse {
    pub expression: String,
    pub total: i64,
    pub detail: String,
}

#[tauri::command]
pub fn roll_dice(app: AppHandle, expression: String, seed: Option<u64>) -> CmdResult<RollResponse> {
    let mut dice = match seed {
        Some(s) => DiceEngine::with_seed(s),
        None => DiceEngine::new(),
    };
    let roll = dice.evaluate(&expression).map_err(err)?;
    let response = RollResponse { expression, total: roll.total, detail: roll.detail };
    emit(&app, "dice:rolled", &response);
    Ok(response)
}

// ---------- Oracle -----------------------------------------------------

/// Fate Check response for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct FateCheckResponse {
    pub roll: u32,
    pub target: u32,
    pub chaos_factor: u32,
    pub odds: String,
    pub outcome: String,
    pub exceptional: bool,
    pub random_event: bool,
    pub interpretation: String,
}

impl From<auto_dm_core::oracle::FateResult> for FateCheckResponse {
    fn from(f: auto_dm_core::oracle::FateResult) -> Self {
        FateCheckResponse {
            roll: f.roll,
            target: f.target,
            chaos_factor: f.chaos_factor,
            odds: f.odds.label().to_string(),
            outcome: if f.is_yes() { "Yes" } else { "No" }.to_string(),
            exceptional: f.exceptional,
            random_event: f.random_event,
            interpretation: f.interpretation(),
        }
    }
}

#[tauri::command]
pub fn fate_check(
    app: AppHandle,
    odds: Odds,
    chaos_factor: u32,
    seed: Option<u64>,
) -> CmdResult<FateCheckResponse> {
    let mut oracle = match seed {
        Some(s) => MythicOracle::with_seed(chaos_factor, s),
        None => MythicOracle::new(chaos_factor),
    };
    let result = oracle.ask_fate(odds);
    let response = FateCheckResponse::from(result);
    emit(&app, "oracle:fate", &response);
    Ok(response)
}

#[tauri::command]
pub fn random_event(
    app: AppHandle,
    chaos_factor: u32,
    seed: Option<u64>,
) -> CmdResult<EventMeaning> {
    let mut oracle = match seed {
        Some(s) => MythicOracle::with_seed(chaos_factor, s),
        None => MythicOracle::new(chaos_factor),
    };
    let meaning = oracle.random_event_now();
    emit(&app, "oracle:event", &meaning);
    Ok(meaning)
}

/// Response from a Scene Test, including the outcome and optional enriched event.
#[derive(Serialize)]
pub struct SceneTestResponse {
    pub outcome: String,
    pub event: Option<EnrichedEvent>,
}

/// Perform a Mythic Scene Test: d10 vs Chaos Factor.
/// If Altered or Interrupted, a Random Event is generated using
/// the current Threads and Characters lists for context.
#[tauri::command]
pub fn scene_test_cmd(
    app: AppHandle,
    state: State<'_, GameState>,
    chaos_factor: u32,
    _seed: Option<u64>,
) -> CmdResult<SceneTestResponse> {
    let cf = (chaos_factor as u8).clamp(1, 9);
    // Use a timestamp-based seed for the scene test RNG.
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let mut oracle = MythicOracle::with_seed(chaos_factor, seed);
    // We need a separate rng for scene_test; extract from oracle via seed.
    let mut rng_seed = seed.wrapping_add(1);
    // Simple xorshift for scene_test d10.
    rng_seed ^= rng_seed << 13;
    rng_seed ^= rng_seed >> 7;
    rng_seed ^= rng_seed << 17;
    let roll = (rng_seed % 10 + 1) as u8;
    let outcome = if roll <= cf / 2 {
        auto_dm_core::oracle::SceneOutcome::Interrupted
    } else if roll <= cf {
        auto_dm_core::oracle::SceneOutcome::Altered
    } else {
        auto_dm_core::oracle::SceneOutcome::AsExpected
    };

    let mut event = None;
    if outcome != auto_dm_core::oracle::SceneOutcome::AsExpected {
        // Build OracleContext from current threads and NPCs.
        let threads = tokio::runtime::Handle::current().block_on(state.repo.list_threads());
        let npcs = tokio::runtime::Handle::current().block_on(state.repo.list_npc_characters());
        let ctx = OracleContext {
            open_threads: threads
                .unwrap_or_default()
                .into_iter()
                .filter(|t| t.status == "open")
                .map(|t| ThreadRef { id: t.id, description: t.description })
                .collect(),
            npcs: npcs
                .unwrap_or_default()
                .into_iter()
                .filter(|n| n.alive)
                .map(|n| NpcRef { id: n.id, name: n.name, disposition: n.disposition })
                .collect(),
        };
        let table = auto_dm_core::oracle::MeaningTable::default_table();
        event = Some(table.random_event_with_context(oracle.rng_mut(), &ctx));
        if let Some(ref ev) = event {
            emit(&app, "oracle:event", &ev.meaning);
        }
    }

    let outcome_str = match outcome {
        auto_dm_core::oracle::SceneOutcome::AsExpected => "as_expected",
        auto_dm_core::oracle::SceneOutcome::Altered => "altered",
        auto_dm_core::oracle::SceneOutcome::Interrupted => "interrupted",
    };
    Ok(SceneTestResponse { outcome: outcome_str.to_string(), event })
}

// ---------- Lines & Veils / Safety Settings ---------------------------

/// Get the Lines (hard bans) and Veils (fade-to-black) as JSON arrays of strings.
#[tauri::command]
pub async fn get_lines_veils(state: State<'_, GameState>) -> CmdResult<serde_json::Value> {
    let lines = state
        .repo
        .get_setting("lines")
        .await
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default();
    let veils = state
        .repo
        .get_setting("veils")
        .await
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default();
    Ok(serde_json::json!({ "lines": lines, "veils": veils }))
}

/// Set the Lines (hard bans) and Veils (fade-to-black) as JSON arrays of strings.
#[tauri::command]
pub async fn set_lines_veils(
    state: State<'_, GameState>,
    lines: Vec<String>,
    veils: Vec<String>,
) -> CmdResult<()> {
    state
        .repo
        .set_setting("lines", &serde_json::to_string(&lines).unwrap_or_else(|_| "[]".into()))
        .await
        .map_err(|e| e.to_string())?;
    state
        .repo
        .set_setting("veils", &serde_json::to_string(&veils).unwrap_or_else(|_| "[]".into()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Doom Clocks ------------------------------------------------

#[derive(Serialize)]
pub struct DoomClockResponse {
    pub id: String,
    pub label: String,
    pub current: u32,
    pub max: u32,
    pub consequence: String,
    pub scene_id: Option<String>,
    pub active: bool,
}

#[tauri::command]
pub async fn create_doom_clock(
    state: State<'_, GameState>,
    label: String,
    max: u32,
    consequence: String,
    scene_id: Option<String>,
) -> CmdResult<DoomClockResponse> {
    let id = uuid::Uuid::new_v4().to_string();
    state
        .repo
        .save_doom_clock(&id, &label, max.max(1), &consequence, scene_id.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    Ok(DoomClockResponse {
        id,
        label,
        current: max.max(1),
        max: max.max(1),
        consequence,
        scene_id,
        active: true,
    })
}

#[tauri::command]
pub async fn list_doom_clocks(state: State<'_, GameState>) -> CmdResult<Vec<DoomClockResponse>> {
    let rows = state.repo.list_doom_clocks().await.map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| DoomClockResponse {
            id: r.id,
            label: r.label,
            current: r.current,
            max: r.max,
            consequence: r.consequence,
            scene_id: r.scene_id,
            active: r.active,
        })
        .collect())
}

#[tauri::command]
pub async fn tick_doom_clock(
    state: State<'_, GameState>,
    id: String,
) -> CmdResult<Option<(u32, u32)>> {
    state.repo.tick_doom_clock(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn advance_doom_clock(
    state: State<'_, GameState>,
    id: String,
    ticks: u32,
) -> CmdResult<Option<(u32, u32)>> {
    state.repo.advance_doom_clock(&id, ticks).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reset_doom_clock(state: State<'_, GameState>, id: String) -> CmdResult<()> {
    state.repo.reset_doom_clock(&id).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_doom_clock(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_doom_clock(&id).await.map_err(|e| e.to_string())
}

// ---------- Exploration --------------------------------------------------

#[derive(Serialize)]
pub struct ExplorationZoneResponse {
    pub id: String,
    pub name: String,
    pub zone_type: String,
    pub description: Option<String>,
    pub danger_level: u32,
    pub mapped: bool,
}

#[derive(Serialize)]
pub struct ExplorationNodeResponse {
    pub id: String,
    pub zone_id: String,
    pub name: String,
    pub discovered: bool,
    pub safe: bool,
    pub description: Option<String>,
    pub connections: Vec<String>,
    pub contents: Vec<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn create_exploration_zone(
    state: State<'_, GameState>,
    name: String,
    zone_type: String,
    description: Option<String>,
    danger_level: Option<u32>,
) -> CmdResult<ExplorationZoneResponse> {
    let id = uuid::Uuid::new_v4().to_string();
    state
        .repo
        .save_exploration_zone(
            &id,
            &name,
            &zone_type,
            description.as_deref(),
            danger_level.unwrap_or(0),
            false,
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(ExplorationZoneResponse {
        id,
        name,
        zone_type,
        description,
        danger_level: danger_level.unwrap_or(0),
        mapped: false,
    })
}

#[tauri::command]
pub async fn list_exploration_zones(
    state: State<'_, GameState>,
) -> CmdResult<Vec<ExplorationZoneResponse>> {
    let rows = state.repo.list_exploration_zones().await.map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| ExplorationZoneResponse {
            id: r.id,
            name: r.name,
            zone_type: r.zone_type,
            description: r.description,
            danger_level: r.danger_level,
            mapped: r.mapped,
        })
        .collect())
}

#[tauri::command]
pub async fn delete_exploration_zone(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_exploration_zone(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_exploration_node(
    state: State<'_, GameState>,
    zone_id: String,
    name: String,
    description: Option<String>,
) -> CmdResult<ExplorationNodeResponse> {
    let id = uuid::Uuid::new_v4().to_string();
    state
        .repo
        .save_exploration_node(&id, &zone_id, &name, description.as_deref(), "[]", "[]")
        .await
        .map_err(|e| e.to_string())?;
    Ok(ExplorationNodeResponse {
        id,
        zone_id,
        name,
        discovered: false,
        safe: false,
        description,
        connections: vec![],
        contents: vec![],
        notes: None,
    })
}

#[tauri::command]
pub async fn list_exploration_nodes(
    state: State<'_, GameState>,
    zone_id: String,
) -> CmdResult<Vec<ExplorationNodeResponse>> {
    let rows = state.repo.list_exploration_nodes(&zone_id).await.map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let connections: Vec<String> =
                serde_json::from_str(&r.connections_json).unwrap_or_default();
            let contents: Vec<String> = serde_json::from_str(&r.contents_json).unwrap_or_default();
            ExplorationNodeResponse {
                id: r.id,
                zone_id: r.zone_id,
                name: r.name,
                discovered: r.discovered,
                safe: r.safe,
                description: r.description,
                connections,
                contents,
                notes: r.notes,
            }
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_exploration_node(
    state: State<'_, GameState>,
    id: String,
    discovered: Option<bool>,
    safe: Option<bool>,
    description: Option<String>,
    connections_json: Option<String>,
    contents_json: Option<String>,
    notes: Option<String>,
) -> CmdResult<()> {
    state
        .repo
        .update_exploration_node(
            &id,
            discovered,
            safe,
            description.as_deref(),
            connections_json.as_deref(),
            contents_json.as_deref(),
            notes.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_exploration_node(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_exploration_node(&id).await.map_err(|e| e.to_string())
}

// ---------- Combat -----------------------------------------------------

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn combat_attack(
    state: State<'_, GameState>,
    app: AppHandle,
    attacker: Value,
    target: Value,
    action_id: String,
    prereq: Option<PrerequisiteCheck>,
    scene_id: Option<String>,
    attacker_conditions: Option<Vec<String>>,
    target_conditions: Option<Vec<String>>,
) -> CmdResult<EngineOutcome> {
    let mut dice = DiceEngine::new();
    let mut actor = combatant_from_value(&attacker)?;
    let mut victim = combatant_from_value(&target)?;
    // Thread live condition tags into the engine so advantage/disadvantage
    // semantics actually fire (Poisoned → disadv, Invisible → adv, etc.).
    actor.conditions = attacker_conditions.unwrap_or_default();
    victim.conditions = target_conditions.unwrap_or_default();
    let action = state
        .repo
        .load_action(&action_id)
        .await
        .map_err(err)?
        .ok_or_else(|| format!("action `{action_id}` not found"))?;

    let outcome =
        execute_attack(&mut dice, &actor, &mut victim, &action, prereq.as_ref()).map_err(err)?;

    if outcome.check_roll.is_some() || outcome.attack_roll.is_some() || outcome.damage_dealt > 0 {
        let narrative = format!(
            "{} attacks {} with {}: {} ({} dmg, {} HP remain).",
            actor.name,
            victim.name,
            action.name,
            outcome.attack_result,
            outcome.damage_dealt,
            outcome.target_hp_remaining
        );
        if let Some(sid) = scene_id.as_ref() {
            let _ = state.repo.append_log(sid, "Combat", &narrative, None).await;
        }
    }

    // Auto-loot: when a monster is defeated and carries a loot table, roll it
    // immediately so the spoils land in the scene's loot list.
    if outcome.target_status == "DEFEATED" {
        if let Ok(block) =
            serde_json::from_value::<auto_dm_core::models::EncounterStatBlock>(target.clone())
        {
            if !block.loot_table.is_empty() {
                let rolled = auto_dm_core::models::roll_loot_table(&mut dice, &block.loot_table);
                for item in rolled {
                    if item.quantity <= 0 {
                        continue;
                    }
                    let sid = scene_id.clone().unwrap_or_default();
                    if !sid.is_empty() {
                        let _ = state
                            .repo
                            .save_loot(&sid, &item.name, item.quantity, &victim.name)
                            .await;
                    }
                }
                emit(&app, "loot:rolled", &victim.name);
            }
        }
    }

    emit(&app, "combat:outcome", &outcome);
    // Route combat HP mutations through the unified GameEvent stream so the
    // Phase C broadcast sees them without a bespoke integration.
    if let Some(dr) = &outcome.damage_result {
        let event = auto_dm_engine::GameEvent::DamageApplied {
            target_id: victim.id.clone(),
            target_name: victim.name.clone(),
            amount: outcome.damage_dealt,
            temp_absorbed: dr.temp_absorbed,
            hp_remaining: dr.hp_remaining,
            defeated: dr.defeated,
            shock: dr.shock,
        };
        emit(&app, "game:events", &[auto_dm_engine::VersionedEvent::new(event)]);
    }
    emit(
        &app,
        "combatant:state",
        &serde_json::json!({
            "id": victim.id,
            "name": victim.name,
            "hit_points": victim.hit_points,
            "status": victim.status,
        }),
    );
    Ok(outcome)
}

#[tauri::command]
pub async fn initiative(
    app: AppHandle,
    combatants: Vec<Value>,
    formula: String,
) -> CmdResult<Vec<auto_dm_core::engine::InitiativeEntry>> {
    let mut dice = DiceEngine::new();
    let mut participants: Vec<Combatant> = Vec::new();
    for v in &combatants {
        participants.push(combatant_from_value(v)?);
    }
    let entries = roll_initiative(&mut dice, &participants, &formula).map_err(err)?;
    emit(&app, "combat:initiative", &entries);
    Ok(entries)
}

/// Heal a combatant through the engine (max-clamped, revives at >0 HP).
/// Does not clear conditions — healing restores HP only (use a long rest
/// or an explicit condition-remove to clear them). Returns the new HP/status.
#[tauri::command]
pub async fn combat_heal(
    app: AppHandle,
    target: Value,
    amount: i32,
) -> CmdResult<serde_json::Value> {
    let mut victim = combatant_from_value(&target)?;
    let healed = auto_dm_core::engine::apply_healing(&mut victim, amount);
    emit(
        &app,
        "combatant:state",
        &serde_json::json!({
            "id": victim.id,
            "name": victim.name,
            "hit_points": victim.hit_points,
            "status": victim.status,
        }),
    );
    Ok(serde_json::json!({
        "healed": healed,
        "hit_points": victim.hit_points,
        "status": victim.status,
    }))
}

/// Expose the engine's canonical Mythic meaning tables so the UI reference
/// always matches what the oracle actually samples.
#[tauri::command]
pub fn meaning_table_words() -> CmdResult<auto_dm_core::oracle::MeaningTable> {
    Ok(auto_dm_core::oracle::MeaningTable::default_table())
}

// ---------- Misc -------------------------------------------------------

/// Run the Auto-DM loop for a player action.
#[tauri::command]
pub async fn dm_resolve(
    state: State<'_, GameState>,
    app: AppHandle,
    mut request: DmRequest,
) -> CmdResult<DmResponse> {
    // Inject recent campaign events as memory context for the LLM.
    {
        let mem = state.memory.lock().map_err(err)?;
        if !mem.is_empty() {
            request.memory_context = Some(mem.to_context(20));
        }
    }
    // Inject Lines & Veils from campaign settings.
    if let Ok(Some(lines_json)) = state.repo.get_setting("lines").await {
        if let Ok(lv) = serde_json::from_str::<Vec<String>>(&lines_json) {
            request.lines = lv;
        }
    }
    if let Ok(Some(tone)) = state.repo.get_setting("tone").await {
        request.tone = Some(tone);
    }
    if let Ok(Some(veils_json)) = state.repo.get_setting("veils").await {
        if let Ok(vv) = serde_json::from_str::<Vec<String>>(&veils_json) {
            request.veils = vv;
        }
    }
    let pipeline = {
        let dm = state.dm.lock().await;
        dm.as_ref().cloned().ok_or_else(|| "DM backend not initialized".to_string())?
    };
    // Try the 5-agent crew first (offline-first, same Ollama binary); fall
    // back to the single-agent pipeline if the crew fails for any reason.
    let mut response = {
        let crew_orch = CrewOrchestrator::new(
            pipeline.backend().as_ref() as &dyn auto_dm_core::llm::LlmBackend
        );
        match run_crew_turn(&crew_orch, &state, &request).await {
            Ok(out) => {
                if !out.lore_used.is_empty() {
                    log::debug!("crew lore citations: {:?}", out.lore_used);
                }
                out.response
            }
            Err(e) => {
                log::warn!("crew turn failed ({e}), falling back to single-agent pipeline");
                pipeline.resolve_action(&request).await.map_err(err)?
            }
        }
    };
    let mut events = apply_session_effects(&state, &request, &mut response).await;
    // Idle clock ticking: if the log tail shows N consecutive idle
    // entries, advance all active doom clocks by 1.
    if let Some(ref scene_id) = request.scene_id {
        let idle_events = tick_idle_clocks(&state, scene_id).await;
        if !idle_events.is_empty() {
            for e in &idle_events {
                response.mechanical_events.push(e.describe());
            }
            events.extend(idle_events);
        }
    }
    if !events.is_empty() {
        emit(&app, "game:events", &events);
    }
    emit(&app, "dm:response", &response);
    Ok(response)
}

// ---------- Seed -------------------------------------------------------

use auto_dm_core::models::{
    ActionCost, CostType, HitPoints, Identity, Outcomes, Resolution, ResolutionType,
    SuccessOutcome, TargetType, Targeting,
};

/// Populate starter SRD-aligned sample data (clean-room mechanics only) when
/// the vault is empty: a hero, a goblin, weapon actions, and an opening scene.
#[tauri::command]
pub async fn seed_defaults(state: State<'_, GameState>) -> CmdResult<()> {
    let repo = &state.repo;
    let chars = repo.list_characters().await.map_err(err)?;
    let blocks = repo.list_stat_blocks().await.map_err(err)?;
    let actions = repo.list_actions().await.map_err(err)?;
    let scenes = repo.list_scenes().await.map_err(err)?;

    if !chars.is_empty() || !blocks.is_empty() || !actions.is_empty() || !scenes.is_empty() {
        return Ok(());
    }

    let longsword = ActionDefinition {
        id: "act_longsword".to_string(),
        name: "Longsword".to_string(),
        action_cost: ActionCost { cost_type: CostType::Action, amount: 1 },
        targeting: Some(Targeting {
            range_feet: Some(5),
            target_type: TargetType::SingleEntity,
            shape: None,
            size_feet: 0,
        }),
        slot_cost: None,
        resolution: Resolution {
            resolution_type: ResolutionType::TargetDc,
            primary_attribute: Some("STR".to_string()),
            roll_formula: Some("1d20 + @attributes.STR.derived_modifier".to_string()),
            vs_defense: Some("armor_class".to_string()),
            outcomes: Some(Outcomes {
                on_success: Some(SuccessOutcome {
                    formula: Some("1d8 + @attributes.STR.derived_modifier".to_string()),
                    damage_type: Some("slashing".to_string()),
                    applied_status: None,
                    heal: false,
                }),
                on_failure: None,
            }),
        },
    };
    repo.save_action(&longsword).await.map_err(err)?;

    let shortsword = ActionDefinition {
        id: "act_shortsword".to_string(),
        name: "Shortsword".to_string(),
        action_cost: ActionCost { cost_type: CostType::Action, amount: 1 },
        targeting: Some(Targeting {
            range_feet: Some(5),
            target_type: TargetType::SingleEntity,
            shape: None,
            size_feet: 0,
        }),
        slot_cost: None,
        resolution: Resolution {
            resolution_type: ResolutionType::TargetDc,
            primary_attribute: Some("DEX".to_string()),
            roll_formula: Some("1d20 + @attributes.DEX.derived_modifier".to_string()),
            vs_defense: Some("armor_class".to_string()),
            outcomes: Some(Outcomes {
                on_success: Some(SuccessOutcome {
                    formula: Some("1d6 + @attributes.DEX.derived_modifier".to_string()),
                    damage_type: Some("piercing".to_string()),
                    applied_status: None,
                    heal: false,
                }),
                on_failure: None,
            }),
        },
    };
    repo.save_action(&shortsword).await.map_err(err)?;

    let hero = CharacterProfile {
        id: "pc_hero_01".to_string(),
        system_id: "dnd5e_srd".to_string(),
        identity: Identity {
            name: "Rook".to_string(),
            ancestry: Some("Human".to_string()),
            archetype: Some("Fighter".to_string()),
            background: Some("Knight".to_string()),
            level_or_rank: 3,
        },
        attributes: std::collections::HashMap::from([
            (
                "STR".to_string(),
                auto_dm_core::models::AttributeState {
                    base_value: 16,
                    current_value: 16,
                    derived_modifier: Some(3),
                },
            ),
            (
                "DEX".to_string(),
                auto_dm_core::models::AttributeState {
                    base_value: 14,
                    current_value: 14,
                    derived_modifier: Some(2),
                },
            ),
            (
                "CON".to_string(),
                auto_dm_core::models::AttributeState {
                    base_value: 14,
                    current_value: 14,
                    derived_modifier: Some(2),
                },
            ),
        ]),
        resource_pools: std::collections::HashMap::from([(
            "hp".to_string(),
            auto_dm_core::models::ResourcePool {
                current: 24,
                maximum: 24,
                temporary: 0,
                reset_condition: auto_dm_core::models::ResetCondition::LongRest,
            },
        )]),
        inventory: vec![],
        abilities: vec!["act_longsword".to_string()],
    };
    repo.save_character(&hero).await.map_err(err)?;

    let goblin = EncounterStatBlock {
        id: "npc_goblin_01".to_string(),
        name: "Goblin".to_string(),
        challenge_rating: 0.25,
        size: Some(auto_dm_core::models::Size::Small),
        creature_type: Some("humanoid".to_string()),
        alignment: Some("neutral evil".to_string()),
        armor_class: 15,
        hit_points: HitPoints { current: 7, maximum: 7, formula: Some("2d6".to_string()) },
        speed_feet: Some(30),
        attributes: std::collections::HashMap::from([
            ("STR".to_string(), 8),
            ("DEX".to_string(), 14),
            ("CON".to_string(), 10),
            ("INT".to_string(), 10),
            ("WIS".to_string(), 8),
            ("CHA".to_string(), 8),
        ]),
        actions: vec!["act_shortsword".to_string()],
        loot_table: vec![auto_dm_core::models::LootTableEntry {
            name: "Gold Coins".to_string(),
            quantity_formula: "2d6".to_string(),
            chance: 80,
        }],
        resistances: Vec::new(),
        vulnerabilities: Vec::new(),
        immunities: Vec::new(),
        senses: vec!["darkvision 60 ft.".to_string()],
        languages: vec!["Common".to_string(), "Goblin".to_string()],
        condition_immunities: Vec::new(),
        traits: Vec::new(),
        multiattack: None,
        reactions: Vec::new(),
        description: Some("Goblins are small, black-hearted humanoids that lair in despoiled dungeons and other dismal settings. Individually weak, they gather in large numbers to torment other creatures.".to_string()),
        portrait: None,
        key: Some("goblin".to_string()),
    };
    repo.save_stat_block(&goblin).await.map_err(err)?;

    let scene = repo.create_scene("The Iron Gate", 5).await.map_err(err)?;
    repo.set_active_scene(&scene.id).await.map_err(err)?;
    repo.append_log(
        &scene.id,
        "Narrator",
        "Rain drums on the iron gate of the keep at Duskhollow. Your company stands at the threshold.",
        None,
    )
    .await
    .map_err(err)?;

    Ok(())
}

/// A stub endpoint used by the UI to verify the app's backend is reachable.
#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

// ---------- Campaign Generation (Zero-to-Campaign) -------------------------

/// Input describing the seed concept for campaign generation.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignSeedInput {
    pub concept: String,
    #[serde(default = "default_level_range")]
    pub level_range: String,
    #[serde(default = "default_scene_count")]
    pub scene_count: u32,
}

fn default_level_range() -> String {
    "1-3".to_string()
}

fn default_scene_count() -> u32 {
    3
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct GeneratedScene {
    pub title: String,
    pub chaos_factor: i32,
    pub summary: String,
    pub hook: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct GeneratedNpc {
    pub name: String,
    pub disposition: String,
    pub notes: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct GeneratedDoomClock {
    pub id: String,
    pub label: String,
    pub tick_max: u32,
    pub consequence: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct GeneratedPlotThread {
    pub description: String,
    pub status: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CampaignGenerationResult {
    pub campaign_title: String,
    pub campaign_theme: String,
    pub campaign_summary: String,
    pub scenes: Vec<GeneratedScene>,
    pub npcs: Vec<GeneratedNpc>,
    pub doom_clocks: Vec<GeneratedDoomClock>,
    pub plot_threads: Vec<GeneratedPlotThread>,
    pub lines: Vec<String>,
    pub veils: Vec<String>,
}

const CAMPAIGN_GENERATION_PROMPT: &str = "\
You are Auto-DM's campaign architect. Generate a complete opening campaign for a tabletop RPG session in JSON. The campaign should be self-contained and ready to play.

Return ONLY a JSON object with this exact structure:
{\"campaign_title\":\"string\",\"campaign_theme\":\"string\",\"campaign_summary\":\"2-3 sentence overview\",\"scenes\":[{\"title\":\"Scene name\",\"chaos_factor\":1,\"summary\":\"Brief description\",\"hook\":\"What draws the PCs in\"}],\"npcs\":[{\"name\":\"NPC name\",\"disposition\":\"neutral\",\"notes\":\"Key trait + secret\"}],\"doom_clocks\":[{\"id\":\"clocks:1\",\"label\":\"Clock name\",\"tick_max\":4,\"consequence\":\"What happens when full\"}],\"plot_threads\":[{\"description\":\"Thread name\",\"status\":\"open\"}],\"lines\":[\"banned topic\"],\"veils\":[\"faded topic\"]}
Do not include any explanatory text — only the JSON object.";

/// Zero-to-Campaign: generate a campaign from a seed concept using the
/// configured Ollama backend, then persist it atomically within a single
/// SQLite transaction.
#[tauri::command]
pub async fn generate_campaign(
    state: State<'_, GameState>,
    input: CampaignSeedInput,
) -> Result<CampaignGenerationResult, String> {
    let seed = format!(
        "Campaign concept: {}\nPlayer level range: {}\nNumber of opening scenes: {}",
        input.concept, input.level_range, input.scene_count
    );

    let raw = {
        let pipeline = {
            let dm = state.dm.lock().await;
            dm.as_ref().cloned().ok_or_else(|| "DM backend not initialized".to_string())?
        };
        pipeline
            .backend()
            .complete(CAMPAIGN_GENERATION_PROMPT, &seed, Some(8192))
            .await
            .map_err(|e| e.to_string())?
    };

    let cleaned = auto_dm_core::intent::stripped_json(raw.trim()).unwrap_or(raw.trim());
    // Small models drift from the schema (renamed keys, missing optional
    // fields, prose after the JSON). Repair what we can before strict parse.
    let repaired = auto_dm_core::intent::repair_campaign_json(cleaned);
    let result: CampaignGenerationResult = serde_json::from_str(&repaired).map_err(|e| {
        let snippet: String = repaired.chars().take(300).collect();
        format!("Failed to parse campaign JSON from LLM: {e}\n— model output began: {snippet}")
    })?;

    if result.scenes.is_empty() {
        return Err(
            "Generated campaign contained no scenes; try rephrasing the concept.".to_string()
        );
    }

    let mut tx = state.repo.begin_tx().await.map_err(err)?;

    let mut first_scene_id = String::new();
    for scene in &result.scenes {
        let created = state
            .repo
            .db_create_scene_txn(&mut tx, &scene.title, scene.chaos_factor)
            .await
            .map_err(err)?;
        if first_scene_id.is_empty() {
            first_scene_id = created.id;
        }
    }

    for npc in &result.npcs {
        state
            .repo
            .db_save_npc_txn(&mut tx, &npc.name, &npc.disposition, &npc.notes)
            .await
            .map_err(err)?;
    }

    for clock in &result.doom_clocks {
        state
            .repo
            .db_save_doom_clock_txn(
                &mut tx,
                &clock.id,
                &clock.label,
                clock.tick_max,
                &clock.consequence,
                None,
            )
            .await
            .map_err(err)?;
    }

    for (idx, thread) in result.plot_threads.iter().enumerate() {
        let desc = format!("{idx}: {}", thread.description);
        state
            .repo
            .db_save_thread_txn(&mut tx, &desc, &thread.status, Some(&first_scene_id))
            .await
            .map_err(err)?;
    }

    if !result.lines.is_empty() {
        state
            .repo
            .db_set_setting_txn(
                &mut tx,
                "lines",
                &serde_json::to_string(&result.lines).map_err(err)?,
            )
            .await
            .map_err(err)?;
    }
    if !result.veils.is_empty() {
        state
            .repo
            .db_set_setting_txn(
                &mut tx,
                "veils",
                &serde_json::to_string(&result.veils).map_err(err)?,
            )
            .await
            .map_err(err)?;
    }

    state
        .repo
        .db_set_setting_txn(&mut tx, "campaign_title", &result.campaign_title)
        .await
        .map_err(err)?;
    state
        .repo
        .db_set_setting_txn(&mut tx, "campaign_theme", &result.campaign_theme)
        .await
        .map_err(err)?;
    state
        .repo
        .db_set_setting_txn(&mut tx, "campaign_summary", &result.campaign_summary)
        .await
        .map_err(err)?;

    tx.commit().await.map_err(err)?;

    remember(&state, "Campaign", &result.campaign_summary).await;

    Ok(result)
}

/// Resolve a player intent into structured narrative via the DM pipeline.
#[tauri::command]
pub async fn process_dm_intent(
    state: State<'_, GameState>,
    app: AppHandle,
    request: DmRequest,
) -> Result<DmResponse, String> {
    let mut req = request;
    {
        let mem = state.memory.lock().map_err(err)?;
        if !mem.is_empty() {
            req.memory_context = Some(mem.to_context(20));
        }
    }
    if let Ok(Some(lines_json)) = state.repo.get_setting("lines").await {
        if let Ok(lv) = serde_json::from_str::<Vec<String>>(&lines_json) {
            req.lines = lv;
        }
    }
    if let Ok(Some(tone)) = state.repo.get_setting("tone").await {
        req.tone = Some(tone);
    }
    if let Ok(Some(veils_json)) = state.repo.get_setting("veils").await {
        if let Ok(vv) = serde_json::from_str::<Vec<String>>(&veils_json) {
            req.veils = vv;
        }
    }

    // Stream tokens to the UI as they arrive so the narrative appears live
    // instead of after a long silent wait. Every ~20 tokens (or on paragraph
    // breaks) the Rust task also writes an intermediate checkpoint to SQLite
    // so a webview crash mid-generation can be recovered without re-querying.
    let app_for_tokens = app.clone();
    let repo_for_checkpoint = state.repo.clone();
    let checkpoint_id = req.scene_id.clone().unwrap_or_else(|| "global".to_string());
    let mut token_buffer = String::new();
    let mut token_count = 0usize;
    let pipeline = {
        let dm = state.dm.lock().await;
        dm.as_ref().cloned().ok_or_else(|| "DM backend not initialized".to_string())?
    };
    let response = pipeline
        .resolve_action_streaming(&req, None, &mut |token: &str| {
            token_buffer.push_str(token);
            token_count += 1;
            let should_checkpoint = token_count.is_multiple_of(20) || token.contains("\n\n");
            let _ = app_for_tokens.emit("dm:token", token);
            if should_checkpoint {
                let content = token_buffer.clone();
                let repo = repo_for_checkpoint.clone();
                let id = checkpoint_id.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = repo.save_stream_checkpoint(&id, &content).await;
                });
            }
        })
        .await
        .map_err(|e| e.to_string())?;

    // Clear the checkpoint now that the full response is in hand.
    let _ = state.repo.clear_stream_checkpoint(&checkpoint_id).await;

    let mut response = response;
    let events = apply_session_effects(&state, &req, &mut response).await;
    if !events.is_empty() {
        emit(&app, "game:events", &events);
    }

    remember(&state, "Player", &req.player_action).await;
    remember(&state, "Dungeon Master", &response.narrative).await;

    emit(&app, "dm:intent", &response);
    Ok(response)
}

/// Roll on a random encounter table using the deterministic dice engine.
#[tauri::command]
pub async fn get_random_encounter(
    _state: State<'_, GameState>,
    difficulty: String,
) -> Result<String, String> {
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let mut dice = DiceEngine::with_seed(seed);

    let roll = dice.evaluate("1d100").map_err(|e| e.to_string())?;
    let total = roll.total as usize;

    let table: &[&str] = match difficulty.as_str() {
        "easy" => &auto_dm_engine::combat::EASY_ENCOUNTERS,
        "hard" => &auto_dm_engine::combat::HARD_ENCOUNTERS,
        _ => &auto_dm_engine::combat::STANDARD_ENCOUNTERS,
    };

    let idx = if total == 0 { 0 } else { total.min(table.len()) - 1 };
    Ok(format!("[{}] d100={}: {}", difficulty.to_uppercase(), total, table[idx]))
}

// ---------- Ollama integration ------------------------------------------

/// List installed Ollama model names.
#[tauri::command]
pub async fn ollama_models() -> CmdResult<Vec<String>> {
    auto_dm_core::ollama::list_models().await.map_err(err)
}

/// Get the currently selected Ollama model name.
#[tauri::command]
pub async fn get_ollama_model(state: State<'_, GameState>) -> CmdResult<String> {
    let model = state.current_model.lock().map_err(err)?;
    Ok(model.clone())
}

/// Switch the Ollama model used by the DM backend. Rebuilds the pipeline.
#[tauri::command]
pub async fn set_ollama_model(state: State<'_, GameState>, model: String) -> CmdResult<()> {
    {
        let mut current = state.current_model.lock().map_err(err)?;
        *current = model.clone();
    }
    // Persist so the choice survives restarts.
    let _ = state.repo.set_setting("ollama_model", &model).await;
    // Rebuild the DM pipeline with the new model.
    let backend: Box<dyn auto_dm_core::llm::LlmBackend> =
        Box::new(auto_dm_core::ollama::OllamaLlmBackend::new(Some(model)));
    let mut dm = state.dm.lock().await;
    *dm = Some(std::sync::Arc::new(auto_dm_core::llm::DmPipeline::new(backend)));
    Ok(())
}

#[tauri::command]
pub async fn get_ollama_num_predict(state: State<'_, GameState>) -> CmdResult<u32> {
    if let Ok(Some(v)) = state.repo.get_setting("ollama_num_predict").await {
        if let Ok(n) = v.parse::<u32>() {
            return Ok(n.clamp(64, 2048));
        }
    }
    Ok(512)
}

#[tauri::command]
pub async fn set_ollama_num_predict(state: State<'_, GameState>, n: u32) -> CmdResult<()> {
    let clamped = n.clamp(64, 2048);
    if let Ok(mut cur) = state.current_num_predict.lock() {
        *cur = clamped;
    }
    let _ = state.repo.set_setting("ollama_num_predict", &clamped.to_string()).await;
    Ok(())
}

/// Push a campaign event into the local memory log (best-effort).
#[tauri::command]
pub async fn get_tone(state: State<'_, GameState>) -> CmdResult<String> {
    Ok(state.repo.get_setting("tone").await.ok().flatten().unwrap_or_else(|| "classic".to_string()))
}

#[tauri::command]
pub async fn set_tone(state: State<'_, GameState>, tone: String) -> CmdResult<()> {
    let _ = state.repo.set_setting("tone", &tone).await;
    Ok(())
}

#[tauri::command]
pub async fn ingest_memory(
    state: State<'_, GameState>,
    speaker: String,
    content: String,
) -> CmdResult<()> {
    remember(&state, &speaker, &content).await;
    Ok(())
}

// ---------- Export / Import ----------------------------------------------

/// Export the full campaign data as JSON.
#[tauri::command]
pub async fn export_campaign(
    state: State<'_, GameState>,
) -> CmdResult<auto_dm_engine::CampaignExport> {
    state.repo.export_campaign().await.map_err(err)
}

/// Import campaign data from JSON (overwrites existing data).
#[tauri::command]
pub async fn import_campaign(
    state: State<'_, GameState>,
    data: auto_dm_engine::CampaignExport,
) -> CmdResult<()> {
    state.repo.import_campaign(&data).await.map_err(err)
}

// ---------- Loot -----------------------------------------------------------

/// Save a loot entry for the current scene.
#[tauri::command]
pub async fn save_loot(
    state: State<'_, GameState>,
    scene_id: String,
    name: String,
    quantity: i32,
    source_entity: String,
) -> CmdResult<auto_dm_engine::LootRow> {
    state.repo.save_loot(&scene_id, &name, quantity, &source_entity).await.map_err(err)
}

/// Assign a loot entry to a character.
#[tauri::command]
pub async fn assign_loot(
    state: State<'_, GameState>,
    loot_id: String,
    character_id: String,
) -> CmdResult<()> {
    state.repo.assign_loot(&loot_id, &character_id).await.map_err(err)
}

/// List all loot for a scene.
#[tauri::command]
pub async fn list_loot(
    state: State<'_, GameState>,
    scene_id: String,
) -> CmdResult<Vec<auto_dm_engine::LootRow>> {
    state.repo.list_loot(&scene_id).await.map_err(err)
}

/// Clear all loot for a scene.
#[tauri::command]
pub async fn clear_loot(state: State<'_, GameState>, scene_id: String) -> CmdResult<()> {
    state.repo.clear_loot(&scene_id).await.map_err(err)
}

// ---------- NPC Notes -------------------------------------------------------

/// Save an NPC note for the current scene.
#[tauri::command]
pub async fn save_npc_note(
    state: State<'_, GameState>,
    scene_id: String,
    npc_name: String,
    relation: String,
    note: String,
) -> CmdResult<auto_dm_engine::NpcNoteRow> {
    state.repo.save_npc_note(&scene_id, &npc_name, &relation, &note).await.map_err(err)
}

/// List NPC notes for a scene.
#[tauri::command]
pub async fn list_npc_notes(
    state: State<'_, GameState>,
    scene_id: String,
) -> CmdResult<Vec<auto_dm_engine::NpcNoteRow>> {
    state.repo.list_npc_notes(&scene_id).await.map_err(err)
}

/// Delete an NPC note by ID.
#[tauri::command]
pub async fn delete_npc_note(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_npc_note(&id).await.map_err(err)
}

// ---------- Combat State Persistence ----------------------------------------

/// Save combat state for the current scene.
#[tauri::command]
pub async fn save_combat_state(
    state: State<'_, GameState>,
    scene_id: String,
    state_json: String,
) -> CmdResult<()> {
    state.repo.save_combat_state(&scene_id, &state_json).await.map_err(err)
}

/// Load combat state for the current scene.
#[tauri::command]
pub async fn load_combat_state(
    state: State<'_, GameState>,
    scene_id: String,
) -> CmdResult<Option<String>> {
    state.repo.load_combat_state(&scene_id).await.map_err(err)
}

// ---------- Loot Roll (monster kill) ----------------------------------------

/// Roll loot from a monster's loot table when it's defeated.
#[tauri::command]
pub async fn roll_monster_loot(
    state: State<'_, GameState>,
    stat_block_id: String,
    scene_id: String,
) -> CmdResult<Vec<auto_dm_engine::LootRow>> {
    use auto_dm_core::dice::DiceEngine;
    use auto_dm_core::models::roll_loot_table;

    let block = state.repo.load_stat_block(&stat_block_id).await.map_err(err)?;
    let block = block.ok_or_else(|| err("stat block not found"))?;
    // Use timestamp-based seed for quasi-randomness.
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let mut dice = DiceEngine::with_seed(seed);
    let rolled = roll_loot_table(&mut dice, &block.loot_table);

    let mut results = Vec::new();
    for item in rolled {
        let row = state
            .repo
            .save_loot(&scene_id, &item.name, item.quantity, &block.name)
            .await
            .map_err(err)?;
        results.push(row);
    }
    Ok(results)
}

// ── Plot Threads ────────────────────────────────────────────────────────

/// Create a new plot thread.
#[tauri::command]
pub async fn save_thread(
    state: State<'_, GameState>,
    description: String,
    status: String,
    opened_scene_id: String,
    resolved_scene_id: Option<String>,
) -> CmdResult<auto_dm_engine::ThreadRow> {
    state
        .repo
        .save_thread(&description, &status, &opened_scene_id, resolved_scene_id.as_deref())
        .await
        .map_err(err)
}

/// Update a thread's status.
#[tauri::command]
pub async fn update_thread_status(
    state: State<'_, GameState>,
    id: String,
    status: String,
    resolved_scene_id: Option<String>,
) -> CmdResult<()> {
    state.repo.update_thread_status(&id, &status, resolved_scene_id.as_deref()).await.map_err(err)
}

/// List all plot threads.
#[tauri::command]
pub async fn list_threads(
    state: State<'_, GameState>,
) -> CmdResult<Vec<auto_dm_engine::ThreadRow>> {
    state.repo.list_threads().await.map_err(err)
}

/// Delete a plot thread.
#[tauri::command]
pub async fn delete_thread(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_thread(&id).await.map_err(err)
}

// ── NPC Characters ─────────────────────────────────────────────────────

/// Create a new NPC character.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn save_npc_character(
    state: State<'_, GameState>,
    name: String,
    disposition: String,
    alive: bool,
    location: Option<String>,
    knows_json: String,
    notes: Option<String>,
    last_seen_scene_id: Option<String>,
    drive: Option<String>,
    leverage: Option<String>,
    flaw: Option<String>,
    flaw_revealed: Option<bool>,
) -> CmdResult<auto_dm_engine::NpcCharacterRow> {
    state
        .repo
        .save_npc_character(
            &name,
            &disposition,
            alive,
            location.as_deref(),
            &knows_json,
            notes.as_deref(),
            last_seen_scene_id.as_deref(),
            drive.as_deref(),
            leverage.as_deref(),
            flaw.as_deref(),
            flaw_revealed.unwrap_or(false),
        )
        .await
        .map_err(err)
}

/// Update an NPC character.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_npc_character(
    state: State<'_, GameState>,
    id: String,
    disposition: Option<String>,
    alive: Option<bool>,
    location: Option<String>,
    knows_json: Option<String>,
    notes: Option<String>,
    last_seen_scene_id: Option<String>,
) -> CmdResult<()> {
    state
        .repo
        .update_npc_character(
            &id,
            disposition.as_deref(),
            alive,
            location.as_deref(),
            knows_json.as_deref(),
            notes.as_deref(),
            last_seen_scene_id.as_deref(),
        )
        .await
        .map_err(err)
}

/// List all NPC characters.
#[tauri::command]
pub async fn list_npc_characters(
    state: State<'_, GameState>,
) -> CmdResult<Vec<auto_dm_engine::NpcCharacterRow>> {
    state.repo.list_npc_characters().await.map_err(err)
}

/// Update an NPC's three pillars (drive / leverage / flaw).
#[tauri::command]
pub async fn update_npc_pillars(
    state: State<'_, GameState>,
    id: String,
    drive: Option<String>,
    leverage: Option<String>,
    flaw: Option<String>,
) -> CmdResult<()> {
    state
        .repo
        .update_npc_pillars(&id, drive.as_deref(), leverage.as_deref(), flaw.as_deref())
        .await
        .map_err(err)
}

/// Reveal an NPC's flaw (flip flaw_revealed to true).
#[tauri::command]
pub async fn reveal_flaw(state: State<'_, GameState>, id: String) -> CmdResult<()> {
    state.repo.reveal_flaw(&id).await.map_err(err)
}

/// Delete an NPC character.
#[tauri::command]
pub async fn delete_npc_character(state: State<'_, GameState>, id: String) -> CmdResult<bool> {
    state.repo.delete_npc_character(&id).await.map_err(err)
}

/// Generate an episodic summary for a scene by compressing its log entries
/// into prose.  The LLM call lives here (command layer) rather than in the
/// engine crate so the deterministic core stays free of Ollama dependencies.
#[tauri::command]
pub async fn summarize_scene(
    state: State<'_, GameState>,
    scene_id: String,
) -> CmdResult<auto_dm_engine::EpisodicSummary> {
    let logs = state.repo.list_logs(&scene_id, 500).await.map_err(err)?;

    if logs.is_empty() {
        return Err("No log entries to summarize.".into());
    }

    let last_log_id = logs.last().unwrap().id.clone();

    let log_text: String = logs
        .iter()
        .map(|l| format!("[{}] {}: {}", l.timestamp, l.speaker, l.content))
        .collect::<Vec<_>>()
        .join("\n");

    let system = "You are a concise RPG session recorder. Compress the following \
        campaign log into a short episodic summary (2-4 paragraphs). Focus on \
        key events, decisions, and consequences. Write in past tense. \
        Do NOT invent events not present in the log.";

    let pipeline = {
        let dm = state.dm.lock().await;
        dm.as_ref().cloned().ok_or_else(|| "DM backend not initialized".to_string())?
    };

    let summary_text =
        pipeline.backend().complete(system, &log_text, Some(512)).await.map_err(err)?;

    let record = state
        .repo
        .save_episodic_summary(&scene_id, &summary_text, &last_log_id)
        .await
        .map_err(err)?;

    Ok(record)
}

/// List episodic summaries for a scene.
#[tauri::command]
pub async fn list_episodic_summaries(
    state: State<'_, GameState>,
    scene_id: String,
) -> CmdResult<Vec<auto_dm_engine::EpisodicSummary>> {
    state.repo.list_episodic_summaries(&scene_id).await.map_err(err)
}

/// Check whether an episodic summary is stale (its last_log_id was deleted).
#[tauri::command]
pub async fn check_summary_stale(
    state: State<'_, GameState>,
    scene_id: String,
    last_log_id: String,
) -> CmdResult<bool> {
    let logs = state.repo.list_logs(&scene_id, 10_000).await.map_err(err)?;
    let ids: Vec<String> = logs.into_iter().map(|l| l.id).collect();
    Ok(auto_dm_engine::is_summary_stale(&last_log_id, &ids))
}

/// Rewind the audit log to a target entry: restore entity state from
/// snapshots, delete rewound entries, and invalidate stale summaries.
#[tauri::command]
pub async fn rewind_to_log(
    state: State<'_, GameState>,
    scene_id: String,
    target_log_id: String,
) -> CmdResult<Vec<String>> {
    auto_dm_engine::rewind_to_log(&state, &scene_id, &target_log_id).await.map_err(err)
}
