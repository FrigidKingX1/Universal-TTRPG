import { useStore } from "../store";
import type { CharacterProfile, AttributeState, ResourcePool } from "../types";
import "../App.css";

export function PlayerCommandDeck({ character }: { character: CharacterProfile | null }) {
  const scenes = useStore((s) => s.scenes);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const activeScene = scenes.find((s) => s.id === activeSceneId);

  const resourcePools = character?.resource_pools ?? {};
  const attributes = character?.attributes ?? {};
  const abilities = character?.abilities ?? [];

  const hpPool = resourcePools["hp"];
  const acValue = resourcePools["ac"];

  const attrMod = (attr: AttributeState): number => {
    return attr.derived_modifier ?? Math.floor((attr.base_value - 10) / 2);
  };

  const hpCurrent = hpPool?.current ?? 0;
  const hpMax = hpPool?.maximum ?? 0;
  const hpPct = hpMax > 0 ? (hpCurrent / hpMax) * 100 : 0;

  return (
    <aside className="panel player-deck">
      <div className="panel-header">
        <span className="panel-icon">🛡️</span>
        <span className="panel-title">Command Deck</span>
      </div>

      {character ? (
        <div className="command-deck">
          <div className="character-vitals">
            <div className="vitals-name">{character.identity.name}</div>
            <div className="vitals-details">
              <span>{character.identity.archetype ?? character.identity.ancestry ?? "Adventurer"}</span>
              <span>Lvl {character.identity.level_or_rank}</span>
            </div>
          </div>

          <div className="health-bar">
            <div className="health-track">
              <div
                className="health-fill"
                style={{ width: `${hpPct}%` }}
              />
            </div>
            <div className="health-label">HP {hpCurrent}/{hpMax}</div>
          </div>

          {acValue && (
            <div className="ac-display">AC {acValue.current}</div>
          )}

          {Object.keys(attributes).length > 0 && (
            <div className="attribute-grid">
              {Object.entries(attributes).map(([name, attr]) => (
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

          {abilities.length > 0 && (
            <div className="abilities-section">
              <h4>Abilities</h4>
              <div className="abilities-list">
                {abilities.map((ability, i) => (
                  <button key={i} className="ability-chip" type="button">
                    {ability}
                  </button>
                ))}
              </div>
            </div>
          )}

          {Object.keys(resourcePools).length > 0 && (
            <div className="resources-section">
              <h4>Resources</h4>
              <div className="resources-grid">
                {Object.entries(resourcePools)
                  .filter(([name]) => !["hp", "ac"].includes(name))
                  .map(([name, pool]: [string, ResourcePool]) => {
                    const pct = pool.maximum > 0
                      ? (pool.current / pool.maximum) * 100
                      : 0;
                    return (
                      <div key={name} className="resource-cell">
                        <span className="resource-name">{name.toUpperCase()}</span>
                        <div className="resource-track">
                          <div
                            className="resource-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="resource-value">{pool.current}/{pool.maximum}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="rest-controls">
            <button className="btn btn-small btn-outline" type="button">
              Short Rest
            </button>
            <button className="btn btn-small btn-outline" type="button">
              Long Rest
            </button>
          </div>
        </div>
      ) : (
        <div className="no-character">
          <p>No character selected.</p>
          <p>Select a character to view their stats here.</p>
        </div>
      )}

      {activeScene && (
        <div className="scene-context">
          <div className="scene-context-header">
            <span>Active Scene</span>
          </div>
          <div className="scene-context-body">
            <div className="scene-title">{activeScene.title}</div>
            <div className="scene-meta">
              <span>Chaos: {activeScene.chaos_factor}</span>
              <span>Scene #{activeScene.scene_number}</span>
            </div>
            {activeScene.summary_text && (
              <div className="scene-summary">{activeScene.summary_text}</div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
