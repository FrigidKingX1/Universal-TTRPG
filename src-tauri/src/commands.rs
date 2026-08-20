use crate::db::{AppState, Repository};
use auto_dm_core::dice::DiceEngine;
use auto_dm_core::engine::{
    execute_attack, roll_initiative, Combatant, EngineOutcome, PrerequisiteCheck,
};
use auto_dm_core::llm::{DmRequest, DmResponse};
use auto_dm_core::models::{ActionDefinition, CharacterProfile, EncounterStatBlock};
use auto_dm_core::oracle::{EventMeaning, MythicOracle, Odds};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Build a `Combatant` from a JSON value that is either a CharacterProfile or
/// an EncounterStatBlock (as serialized by the frontend store).
fn combatant_from_value(v: &Value) -> CmdResult<Combatant> {
    if let Ok(profile) = serde_json::from_value::<CharacterProfile>(v.clone()) {
        return Ok(Combatant::from(&profile));
    }
    if let Ok(block) = serde_json::from_value::<EncounterStatBlock>(v.clone()) {
        return Ok(Combatant::from(&block));
    }
    Err("combatant payload must be a CharacterProfile or EncounterStatBlock".to_string())
}

fn emit(app: &AppHandle, event: &str, payload: &impl Serialize) {
    let _ = app.emit(event, payload);
}

// ---------- Characters -------------------------------------------------

#[tauri::command]
pub async fn save_character(
    state: State<'_, AppState>,
    profile: CharacterProfile,
) -> CmdResult<CharacterProfile> {
    state.repo.save_character(&profile).await.map_err(err)?;
    Ok(profile)
}

#[tauri::command]
pub async fn load_character(
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<Option<CharacterProfile>> {
    match state.repo.load_character(&id).await {
        Ok(p) => Ok(Some(p)),
        Err(crate::db::DbError::NotFound(_)) => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
pub async fn list_characters(state: State<'_, AppState>) -> CmdResult<Vec<CharacterProfile>> {
    state.repo.list_characters().await.map_err(err)
}

#[tauri::command]
pub async fn delete_character(state: State<'_, AppState>, id: String) -> CmdResult<bool> {
    state.repo.delete_character(&id).await.map_err(err)
}

// ---------- Actions ----------------------------------------------------

#[tauri::command]
pub async fn save_action(
    state: State<'_, AppState>,
    action: ActionDefinition,
) -> CmdResult<ActionDefinition> {
    state.repo.save_action(&action).await.map_err(err)?;
    Ok(action)
}

#[tauri::command]
pub async fn list_actions(state: State<'_, AppState>) -> CmdResult<Vec<ActionDefinition>> {
    state.repo.list_actions().await.map_err(err)
}

#[tauri::command]
pub async fn delete_action(state: State<'_, AppState>, id: String) -> CmdResult<bool> {
    state.repo.delete_action(&id).await.map_err(err)
}

// ---------- Stat blocks ------------------------------------------------

#[tauri::command]
pub async fn save_stat_block(
    state: State<'_, AppState>,
    block: EncounterStatBlock,
) -> CmdResult<EncounterStatBlock> {
    state.repo.save_stat_block(&block).await.map_err(err)?;
    Ok(block)
}

#[tauri::command]
pub async fn list_stat_blocks(state: State<'_, AppState>) -> CmdResult<Vec<EncounterStatBlock>> {
    state.repo.list_stat_blocks().await.map_err(err)
}

#[tauri::command]
pub async fn delete_stat_block(state: State<'_, AppState>, id: String) -> CmdResult<bool> {
    state.repo.delete_stat_block(&id).await.map_err(err)
}

// ---------- Scenes -----------------------------------------------------

#[tauri::command]
pub async fn create_scene(
    state: State<'_, AppState>,
    app: AppHandle,
    title: String,
    chaos_factor: i32,
) -> CmdResult<crate::db::Scene> {
    let scene = state
        .repo
        .create_scene(&title, chaos_factor)
        .await
        .map_err(err)?;
    emit(&app, "scene:created", &scene);
    Ok(scene)
}

#[tauri::command]
pub async fn list_scenes(state: State<'_, AppState>) -> CmdResult<Vec<crate::db::Scene>> {
    state.repo.list_scenes().await.map_err(err)
}

#[tauri::command]
pub async fn active_scene(state: State<'_, AppState>) -> CmdResult<Option<crate::db::Scene>> {
    state.repo.active_scene().await.map_err(err)
}

#[tauri::command]
pub async fn set_active_scene(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.repo.set_active_scene(&id).await.map_err(err)
}

#[tauri::command]
pub async fn delete_scene(state: State<'_, AppState>, id: String) -> CmdResult<bool> {
    state.repo.delete_scene(&id).await.map_err(err)
}

#[tauri::command]
pub async fn update_scene_summary(
    state: State<'_, AppState>,
    id: String,
    summary: Option<String>,
) -> CmdResult<()> {
    state
        .repo
        .update_scene_summary(&id, summary.as_deref())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn update_scene_chaos_factor(
    state: State<'_, AppState>,
    id: String,
    chaos_factor: i32,
) -> CmdResult<()> {
    state
        .repo
        .update_scene_chaos_factor(&id, chaos_factor)
        .await
        .map_err(err)
}

// ---------- Log --------------------------------------------------------

#[tauri::command]
pub async fn append_log(
    state: State<'_, AppState>,
    app: AppHandle,
    scene_id: String,
    speaker: String,
    content: String,
) -> CmdResult<crate::db::LogEntry> {
    let entry = state
        .repo
        .append_log(&scene_id, &speaker, &content, None)
        .await
        .map_err(err)?;
    emit(&app, "log:new", &entry);
    Ok(entry)
}

#[tauri::command]
pub async fn list_logs(
    state: State<'_, AppState>,
    scene_id: String,
    limit: i64,
) -> CmdResult<Vec<crate::db::LogEntry>> {
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
    let response = RollResponse {
        expression,
        total: roll.total,
        detail: roll.detail,
    };
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

// ---------- Combat -----------------------------------------------------

#[tauri::command]
pub async fn combat_attack(
    state: State<'_, AppState>,
    app: AppHandle,
    attacker: Value,
    target: Value,
    action_id: String,
    prereq: Option<PrerequisiteCheck>,
    scene_id: Option<String>,
) -> CmdResult<EngineOutcome> {
    let mut dice = DiceEngine::new();
    let actor = combatant_from_value(&attacker)?;
    let mut victim = combatant_from_value(&target)?;
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
        if let Some(sid) = scene_id {
            let _ = state
                .repo
                .append_log(&sid, "Combat", &narrative, None)
                .await;
        }
    }

    emit(&app, "combat:outcome", &outcome);
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

// ---------- Misc -------------------------------------------------------

/// Run the Auto-DM loop for a player action.
#[tauri::command]
pub async fn dm_resolve(
    state: State<'_, AppState>,
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
    let response = state
        .dm
        .lock()
        .await
        .as_ref()
        .ok_or_else(|| "DM backend not initialized".to_string())?
        .resolve_action(&request)
        .await
        .map_err(err)?;
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
pub async fn seed_defaults(state: State<'_, AppState>) -> CmdResult<()> {
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
        action_cost: ActionCost {
            cost_type: CostType::Action,
            amount: 1,
        },
        targeting: Some(Targeting {
            range_feet: Some(5),
            target_type: TargetType::SingleEntity,
            shape: None,
            size_feet: 0,
        }),
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
                }),
                on_failure: None,
            }),
        },
    };
    repo.save_action(&longsword).await.map_err(err)?;

    let shortsword = ActionDefinition {
        id: "act_shortsword".to_string(),
        name: "Shortsword".to_string(),
        action_cost: ActionCost {
            cost_type: CostType::Action,
            amount: 1,
        },
        targeting: Some(Targeting {
            range_feet: Some(5),
            target_type: TargetType::SingleEntity,
            shape: None,
            size_feet: 0,
        }),
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
        hit_points: HitPoints {
            current: 7,
            maximum: 7,
            formula: Some("2d6".to_string()),
        },
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

// ---------- Ollama integration ------------------------------------------

/// List installed Ollama model names.
#[tauri::command]
pub async fn ollama_models() -> CmdResult<Vec<String>> {
    auto_dm_core::ollama::list_models().await.map_err(err)
}

/// Get the currently selected Ollama model name.
#[tauri::command]
pub async fn get_ollama_model(state: State<'_, AppState>) -> CmdResult<String> {
    let model = state.current_model.lock().map_err(err)?;
    Ok(model.clone())
}

/// Switch the Ollama model used by the DM backend. Rebuilds the pipeline.
#[tauri::command]
pub async fn set_ollama_model(state: State<'_, AppState>, model: String) -> CmdResult<()> {
    {
        let mut current = state.current_model.lock().map_err(err)?;
        *current = model.clone();
    }
    // Rebuild the DM pipeline with the new model.
    let backend: Box<dyn auto_dm_core::llm::LlmBackend> =
        Box::new(auto_dm_core::ollama::OllamaLlmBackend::new(Some(model)));
    let mut dm = state.dm.lock().await;
    *dm = Some(auto_dm_core::llm::DmPipeline::new(backend));
    Ok(())
}

/// Push a campaign event into the local memory log (best-effort).
#[tauri::command]
pub fn ingest_memory(
    state: State<'_, AppState>,
    speaker: String,
    content: String,
) -> CmdResult<()> {
    let mut mem = state.memory.lock().map_err(err)?;
    mem.push(&speaker, &content);
    Ok(())
}

// ---------- Export / Import ----------------------------------------------

/// Export the full campaign data as JSON.
#[tauri::command]
pub async fn export_campaign(state: State<'_, AppState>) -> CmdResult<crate::db::CampaignExport> {
    state.repo.export_campaign().await.map_err(err)
}

/// Import campaign data from JSON (overwrites existing data).
#[tauri::command]
pub async fn import_campaign(
    state: State<'_, AppState>,
    data: crate::db::CampaignExport,
) -> CmdResult<()> {
    state.repo.import_campaign(&data).await.map_err(err)
}

// ---------- Loot -----------------------------------------------------------

/// Save a loot entry for the current scene.
#[tauri::command]
pub async fn save_loot(
    state: State<'_, AppState>,
    scene_id: String,
    name: String,
    quantity: i32,
    source_entity: String,
) -> CmdResult<crate::db::LootRow> {
    state
        .repo
        .save_loot(&scene_id, &name, quantity, &source_entity)
        .await
        .map_err(err)
}

/// Assign a loot entry to a character.
#[tauri::command]
pub async fn assign_loot(
    state: State<'_, AppState>,
    loot_id: String,
    character_id: String,
) -> CmdResult<()> {
    state
        .repo
        .assign_loot(&loot_id, &character_id)
        .await
        .map_err(err)
}

/// List all loot for a scene.
#[tauri::command]
pub async fn list_loot(
    state: State<'_, AppState>,
    scene_id: String,
) -> CmdResult<Vec<crate::db::LootRow>> {
    state.repo.list_loot(&scene_id).await.map_err(err)
}

/// Clear all loot for a scene.
#[tauri::command]
pub async fn clear_loot(state: State<'_, AppState>, scene_id: String) -> CmdResult<()> {
    state.repo.clear_loot(&scene_id).await.map_err(err)
}

// ---------- NPC Notes -------------------------------------------------------

/// Save an NPC note for the current scene.
#[tauri::command]
pub async fn save_npc_note(
    state: State<'_, AppState>,
    scene_id: String,
    npc_name: String,
    relation: String,
    note: String,
) -> CmdResult<crate::db::NpcNoteRow> {
    state
        .repo
        .save_npc_note(&scene_id, &npc_name, &relation, &note)
        .await
        .map_err(err)
}

/// List NPC notes for a scene.
#[tauri::command]
pub async fn list_npc_notes(
    state: State<'_, AppState>,
    scene_id: String,
) -> CmdResult<Vec<crate::db::NpcNoteRow>> {
    state.repo.list_npc_notes(&scene_id).await.map_err(err)
}

/// Delete an NPC note by ID.
#[tauri::command]
pub async fn delete_npc_note(state: State<'_, AppState>, id: String) -> CmdResult<bool> {
    state.repo.delete_npc_note(&id).await.map_err(err)
}

// ---------- Combat State Persistence ----------------------------------------

/// Save combat state for the current scene.
#[tauri::command]
pub async fn save_combat_state(
    state: State<'_, AppState>,
    scene_id: String,
    state_json: String,
) -> CmdResult<()> {
    state
        .repo
        .save_combat_state(&scene_id, &state_json)
        .await
        .map_err(err)
}

/// Load combat state for the current scene.
#[tauri::command]
pub async fn load_combat_state(
    state: State<'_, AppState>,
    scene_id: String,
) -> CmdResult<Option<String>> {
    state.repo.load_combat_state(&scene_id).await.map_err(err)
}

// ---------- Loot Roll (monster kill) ----------------------------------------

/// Roll loot from a monster's loot table when it's defeated.
#[tauri::command]
pub async fn roll_monster_loot(
    state: State<'_, AppState>,
    stat_block_id: String,
    scene_id: String,
) -> CmdResult<Vec<crate::db::LootRow>> {
    use auto_dm_core::dice::DiceEngine;
    use auto_dm_core::models::roll_loot_table;

    let block = state
        .repo
        .load_stat_block(&stat_block_id)
        .await
        .map_err(err)?;
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
