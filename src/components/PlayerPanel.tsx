import { useState } from "react";
import { Shield, Sword, Package, Heart, Crosshair } from "lucide-react";
import { useStore } from "../store";
import { getMultiplayerClient, useMultiplayerStore } from "../multiplayer/store";
import type { CharacterProfile, EncounterStatBlock, InventoryItem, ResourcePool, AttributeState } from "../types";
import "../App.css";

export function PlayerPanel() {
  const characters = useStore((s) => s.characters);
  const activeCharacter = useStore((s) => s.activeCharacter);
  const setActiveCharacter = useStore((s) => s.setActiveCharacter);
  const actions = useStore((s) => s.actions);
  const statBlocks = useStore((s) => s.statBlocks);
  const runAttack = useStore((s) => s.runAttack);
  const playerId = useMultiplayerStore((s) => s.playerId);
  const players = useMultiplayerStore((s) => s.players);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetKey, setTargetKey] = useState("");

  const client = getMultiplayerClient();

  // Find which character is linked to this player.
  const myPlayerInfo = players.find((p) => p.id === playerId);
  const myCharacterId = (myPlayerInfo as any)?.character_id ?? null;

  // If we have a linked character, use it; otherwise fall back to activeCharacter.
  const character = myCharacterId
    ? characters.find((c) => c.id === myCharacterId) ?? activeCharacter
    : activeCharacter;

  const attrMod = (attr: AttributeState): number =>
    attr.derived_modifier ?? Math.floor((attr.base_value - 10) / 2);

  const hpPool = character?.resource_pools?.["hp"];
  const hpCurrent = hpPool?.current ?? 0;
  const hpMax = hpPool?.maximum ?? 0;
  const hpPct = hpMax > 0 ? (hpCurrent / hpMax) * 100 : 0;

  const withLoading = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(e.message ?? "Action failed");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleEquip = async (item: InventoryItem) => {
    if (!client) return;
    const result = await withLoading(() =>
      client.equipItem(item.id, item.state === "stowed"),
    );
    if (result?.character) {
      setActiveCharacter(result.character);
    }
  };

  const handleUseItem = async (item: InventoryItem) => {
    if (!client) return;
    const result = await withLoading(() => client.useItem(item.id));
    if (result?.character) {
      setActiveCharacter(result.character);
    }
  };

  const handleRest = async (long: boolean) => {
    if (!client) return;
    const result = await withLoading(() => client.rest(long));
    if (result?.character) {
      setActiveCharacter(result.character);
    }
  };

  const handleCreateCharacter = async () => {
    if (!client) return;
    const newProfile: CharacterProfile = {
      id: crypto.randomUUID(),
      system_id: "universal",
      identity: {
        name: "New Character",
        ancestry: "Human",
        archetype: "Adventurer",
        level_or_rank: 1,
      },
      attributes: {
        STR: { base_value: 10, current_value: 10 },
        DEX: { base_value: 10, current_value: 10 },
        CON: { base_value: 10, current_value: 10 },
        INT: { base_value: 10, current_value: 10 },
        WIS: { base_value: 10, current_value: 10 },
        CHA: { base_value: 10, current_value: 10 },
      },
      resource_pools: {
        hp: { current: 10, maximum: 10, temporary: 0, reset_condition: "long_rest" },
      },
      inventory: [],
      abilities: [],
    };
    const result = await withLoading(() => client.createCharacter(newProfile));
    if (result?.character) {
      setActiveCharacter(result.character);
    }
  };

  // Cast/attack straight from the panel: known abilities resolved to
  // definitions, with a shared target picker and live slot counts.
  const knownActions = character
    ? character.abilities
        .map((id) => actions.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
    : [];
  const targets = [
    ...characters
      .filter((c) => c.id !== character?.id)
      .map((c) => ({ key: `char:${c.id}`, name: c.identity.name })),
    ...statBlocks.map((b) => ({ key: `block:${b.id}`, name: b.name })),
  ];
  const resolveTarget = (key: string): CharacterProfile | EncounterStatBlock | null => {
    if (key.startsWith("char:")) {
      return characters.find((c) => `char:${c.id}` === key) ?? null;
    }
    if (key.startsWith("block:")) {
      return statBlocks.find((b) => `block:${b.id}` === key) ?? null;
    }
    return null;
  };
  const canUse = (a: NonNullable<typeof knownActions[number]>): boolean => {
    if (!character || !targetKey || !resolveTarget(targetKey)) return false;
    const cost = a.slot_cost;
    if (!cost) return true;
    return (character.resource_pools[cost.pool]?.current ?? 0) >= cost.amount;
  };
  const handleUseAbility = async (actionId: string) => {
    if (!character) return;
    const target = resolveTarget(targetKey);
    if (!target) {
      setError("Pick a target first.");
      return;
    }
    await withLoading(() => runAttack(character, target, actionId));
  };

  if (!client) return null;

  return (
    <aside className="panel player-panel">
      <div className="panel-header">
        <span className="panel-icon" aria-hidden="true"><Shield size={16} strokeWidth={1.7} /></span>
        <span className="panel-title">My Character</span>
        {loading && <span className="loading-spinner" />}
      </div>

      {error && <div className="panel-error">{error}</div>}

      {character ? (
        <div className="character-view">
          {/* Vitals */}
          <div className="vitals-header">
            <div className="vitals-name">{character.identity.name}</div>
            <div className="vitals-meta">
              <span>{character.identity.archetype ?? character.identity.ancestry ?? "Adventurer"}</span>
              <span>Lvl {character.identity.level_or_rank}</span>
            </div>
          </div>

          {/* HP Bar */}
          <div className="health-bar">
            <div className="health-track">
              <div
                className="health-fill"
                style={{ transform: `scaleX(${hpPct / 100})` }}
              />
            </div>
            <div className="health-label">
              <Heart size={12} /> HP {hpCurrent}/{hpMax}
              {hpPool?.temporary ? <span className="temp-hp"> (+{hpPool.temporary})</span> : null}
            </div>
          </div>

          {/* Attributes */}
          {Object.keys(character.attributes).length > 0 && (
            <div className="attribute-grid">
              {Object.entries(character.attributes).map(([name, attr]) => (
                <div key={name} className="attr-cell">
                  <span className="attr-name">{name}</span>
                  <span className="attr-value">{attr.base_value}</span>
                  <span className={`attr-mod ${attrMod(attr) >= 0 ? "positive" : "negative"}`}>
                    {attrMod(attr) >= 0 ? "+" : ""}{attrMod(attr)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Inventory */}
          {character.inventory.length > 0 && (
            <div className="inventory-section">
              <h4><Package size={14} /> Inventory</h4>
              <div className="inventory-list">
                {character.inventory.map((item) => (
                  <div key={item.id} className="inventory-item">
                    <div className="item-info">
                      <span className="item-name">{item.name}</span>
                      <span className="item-qty">×{item.quantity}</span>
                      {item.state === "equipped" && (
                        <span className="item-equipped"><Crosshair size={10} /> Equipped</span>
                      )}
                    </div>
                    <div className="item-actions">
                      <button
                        className="btn btn-tiny btn-outline"
                        onClick={() => handleEquip(item)}
                        title={item.state === "equipped" ? "Stow" : "Equip"}
                      >
                        {item.state === "equipped" ? "Stow" : "Equip"}
                      </button>
                      <button
                        className="btn btn-tiny btn-outline"
                        onClick={() => handleUseItem(item)}
                        title="Use item"
                      >
                        Use
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Abilities — pick a target, then cast/attack */}
          {knownActions.length > 0 && (
            <div className="abilities-section">
              <h4><Sword size={14} /> Abilities</h4>
              <select
                className="cast-target-select"
                value={targetKey}
                onChange={(e) => setTargetKey(e.currentTarget.value)}
                aria-label="Ability target"
              >
                <option value="">Cast target…</option>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
              <div className="abilities-list">
                {knownActions.map((a) => {
                  const cost = a.slot_cost;
                  const pool = cost ? character!.resource_pools[cost.pool] : undefined;
                  const usable = canUse(a);
                  return (
                    <button
                      key={a.id}
                      className="ability-chip cast-row"
                      type="button"
                      disabled={!usable || loading}
                      title={
                        !targetKey
                          ? "Pick a target first"
                          : cost && (pool?.current ?? 0) < cost.amount
                            ? `No ${cost.pool.replace(/_/g, " ")} left`
                            : a.resolution.outcomes?.on_success?.formula ?? ""
                      }
                      onClick={() => void handleUseAbility(a.id)}
                    >
                      <span>{a.name}</span>
                      {cost && (
                        <span className="cast-cost">
                          {pool ? `${pool.current}/${pool.maximum}` : "0"} {cost.pool.replace(/_/g, " ")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resource Pools (non-HP) */}
          {Object.entries(character.resource_pools)
            .filter(([name]) => name !== "hp")
            .map(([name, pool]: [string, ResourcePool]) => {
              const pct = pool.maximum > 0 ? (pool.current / pool.maximum) * 100 : 0;
              return (
                <div key={name} className="resource-cell">
                  <span className="resource-name">{name.toUpperCase()}</span>
                  <div className="resource-track">
                    <div
                      className="resource-fill"
                      style={{ transform: `scaleX(${pct / 100})` }}
                    />
                  </div>
                  <span className="resource-value">{pool.current}/{pool.maximum}</span>
                </div>
              );
            })}

          {/* Rest Controls */}
          <div className="rest-controls">
            <button
              className="btn btn-small btn-outline"
              onClick={() => handleRest(false)}
              disabled={loading}
            >
              Short Rest
            </button>
            <button
              className="btn btn-small btn-outline"
              onClick={() => handleRest(true)}
              disabled={loading}
            >
              Long Rest
            </button>
          </div>
        </div>
      ) : (
        <div className="no-character">
          <p>No character linked.</p>
          <button
            className="btn btn-small btn-primary"
            onClick={handleCreateCharacter}
            disabled={loading}
          >
            Create Character
          </button>
        </div>
      )}
    </aside>
  );
}
