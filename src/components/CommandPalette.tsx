import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore } from "../store";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "../App.css";

interface Command {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  icon?: string;
  category: string;
  action: () => void;
  disabled?: boolean;
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const paletteRef = useFocusTrap(isOpen);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  const appMode = useStore((s) => s.appMode);
  const setAppMode = useStore((s) => s.setAppMode);
  const activeCharacter = useStore((s) => s.activeCharacter);
  const characters = useStore((s) => s.characters);
  const scenes = useStore((s) => s.scenes);
  const npcs = useStore((s) => s.npcCharacters);
  const statBlocks = useStore((s) => s.statBlocks);
  const logs = useStore((s) => s.logs);
  const setActiveScene = useStore((s) => s.setActiveScene);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const ollamaReachable = useStore((s) => s.ollama.reachable);
  const showToast = useStore((s) => s.showToast);
  const generateCampaign = useStore((s) => s.generateCampaign);
  const processDmIntent = useStore((s) => s.processDmIntent);
  const addStoryEntry = useStore((s) => s.addStoryEntry);
  const clearStoryLog = useStore((s) => s.clearStoryLog);
  const autoSave = useStore((s) => s.autoSave);
  const exportCampaign = useStore((s) => s.exportCampaign);
  const importCampaign = useStore((s) => s.importCampaign);

  const commands = useMemo<Command[]>(() => {
    const baseCommands: Command[] = [
      // Navigation
      {
        id: "nav.setup",
        label: "Switch to Setup Mode",
        description: "Open campaign wizard",
        shortcut: "Ctrl+M",
        icon: "🧙",
        category: "Navigation",
        action: () => setAppMode("setup"),
        disabled: appMode === "setup",
      },
      {
        id: "nav.tabletop",
        label: "Switch to Tabletop Mode",
        description: "Open three-panel layout",
        shortcut: "Ctrl+M",
        icon: "🏰",
        category: "Navigation",
        action: () => setAppMode("tabletop"),
        disabled: appMode === "tabletop",
      },
      {
        id: "nav.settings",
        label: "Open Settings",
        description: "Configure Ollama, safety tools, app options",
        shortcut: "⚙️",
        icon: "⚙️",
        category: "Navigation",
        action: () => { /* handled by App */ },
      },

      // Character
      {
        id: "char.new",
        label: "Create New Character",
        description: "Add a player character",
        shortcut: "",
        icon: "👤",
        category: "Character",
        action: () => { /* would trigger character creation */ },
      },
      {
        id: "char.select",
        label: "Select Active Character",
        description: activeCharacter ? `Current: ${activeCharacter.identity.name}` : "No character selected",
        shortcut: "",
        icon: "🎯",
        category: "Character",
        action: () => { /* would open character picker */ },
        disabled: characters.length === 0,
      },

      // Scene
      {
        id: "scene.new",
        label: "Create New Scene",
        description: "Start a new scene with chaos factor",
        shortcut: "",
        icon: "📖",
        category: "Scene",
        action: () => { /* would open scene creator */ },
      },
      {
        id: "scene.list",
        label: "List All Scenes",
        description: `${scenes.length} scene${scenes.length !== 1 ? "s" : ""} available`,
        shortcut: "1",
        icon: "📋",
        category: "Scene",
        action: () => { /* would navigate to scenes */ },
      },

      // Campaign
      {
        id: "campaign.generate",
        label: "Generate Campaign (Zero-to-Campaign)",
        description: "Create a full campaign from a concept using Ollama",
        shortcut: "",
        icon: "✨",
        category: "Campaign",
        action: () => { /* would trigger wizard */ },
        disabled: !ollamaReachable,
      },
      {
        id: "campaign.autosave",
        label: "Force Auto-save",
        description: "Save campaign to localStorage now",
        shortcut: "",
        icon: "💾",
        category: "Campaign",
        action: async () => {
          try {
            await autoSave();
            showToast("Campaign auto-saved", "success");
          } catch {
            showToast("Auto-save failed", "error");
          }
        },
      },
      {
        id: "campaign.export",
        label: "Export Campaign",
        description: "Download full campaign as JSON",
        shortcut: "",
        icon: "📤",
        category: "Campaign",
        action: async () => {
          try {
            const json = await exportCampaign();
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `autodm-campaign-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("Campaign exported", "success");
          } catch {
            showToast("Export failed", "error");
          }
        },
      },
      {
        id: "campaign.import",
        label: "Import Campaign",
        description: "Load campaign from JSON file",
        shortcut: "",
        icon: "📥",
        category: "Campaign",
        action: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json";
          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
              const text = await file.text();
              try {
                await importCampaign(text);
                showToast("Campaign imported", "success");
              } catch {
                showToast("Import failed", "error");
              }
            }
          };
          input.click();
        },
      },

      // DM
      {
        id: "dm.process",
        label: "Send Action to DM",
        description: "Process player intent through the DM pipeline",
        shortcut: "Enter (in input)",
        icon: "🎤",
        category: "DM",
        action: () => { /* focus DM input */ },
      },
      {
        id: "dm.refresh",
        label: "Refresh Logs",
        description: "Reload story log from database",
        shortcut: "R",
        icon: "🔄",
        category: "DM",
        action: () => { /* would trigger refresh */ },
      },
      {
        id: "dm.clear",
        label: "Clear Story Log",
        description: "Remove all narrative entries",
        shortcut: "",
        icon: "🗑️",
        category: "DM",
        action: () => {
          if (confirm("Clear entire story log?")) {
            clearStoryLog();
            showToast("Story log cleared", "info");
          }
        },
      },

      // Tools
      {
        id: "tools.dice",
        label: "Roll Dice",
        description: "Open dice roller (e.g. 2d6+3)",
        shortcut: "",
        icon: "🎲",
        category: "Tools",
        action: () => { /* would open dice roller */ },
      },
      {
        id: "tools.oracle",
        label: "Ask Oracle",
        description: "Mythic Fate Chart question",
        shortcut: "",
        icon: "🔮",
        category: "Tools",
        action: () => { /* would open oracle */ },
      },
      {
        id: "tools.combat",
        label: "Start Combat",
        description: "Roll initiative and track combat",
        shortcut: "4",
        icon: "⚔️",
        category: "Tools",
        action: () => { /* would open combat */ },
      },
    ];

    return baseCommands;
  }, [
    appMode,
    setAppMode,
    activeCharacter,
    characters,
    scenes,
    activeSceneId,
    ollamaReachable,
    generateCampaign,
    processDmIntent,
    autoSave,
    exportCampaign,
    importCampaign,
    showToast,
    addStoryEntry,
    clearStoryLog,
  ]);

  // Global entity search: characters, scenes, NPCs, monsters, log entries
  const entityResults = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const results: Command[] = [];
    const limit = 5;

    for (const c of characters) {
      if (c.identity.name.toLowerCase().includes(q)) {
        results.push({
          id: `entity.char.${c.id}`,
          label: c.identity.name,
          description: `Character · Lv ${c.identity.level_or_rank} · HP ${c.resource_pools.hp?.current ?? 0}/${c.resource_pools.hp?.maximum ?? 0}`,
          icon: "👤",
          category: "Results",
          action: () => { /* character sheet opens in Characters view */ },
        });
      }
      if (results.length >= limit) break;
    }

    let sceneCount = 0;
    for (const sc of scenes) {
      if (sceneCount >= limit) break;
      if (sc.title.toLowerCase().includes(q)) {
        sceneCount++;
        results.push({
          id: `entity.scene.${sc.id}`,
          label: `#${sc.scene_number} ${sc.title}`,
          description: `Scene · CF ${sc.chaos_factor}${sc.is_active ? " · active" : ""}`,
          icon: "📖",
          category: "Results",
          action: () => { void setActiveScene(sc.id); },
        });
      }
    }

    let npcCount = 0;
    for (const n of npcs) {
      if (npcCount >= limit) break;
      if (n.name.toLowerCase().includes(q)) {
        npcCount++;
        results.push({
          id: `entity.npc.${n.id}`,
          label: n.name,
          description: `NPC · ${n.disposition}${n.alive ? "" : " · deceased"}${n.location ? ` · ${n.location}` : ""}`,
          icon: "🧝",
          category: "Results",
          action: () => { /* NPC details open in Scenes view */ },
        });
      }
    }

    let monsterCount = 0;
    for (const b of statBlocks) {
      if (monsterCount >= limit) break;
      if (b.name.toLowerCase().includes(q)) {
        monsterCount++;
        results.push({
          id: `entity.monster.${b.id}`,
          label: b.name,
          description: `Monster · CR ${b.challenge_rating} · AC ${b.armor_class}`,
          icon: "🐉",
          category: "Results",
          action: () => { /* stat block opens in Bestiary view */ },
        });
      }
    }

    let logCount2 = 0;
    for (const l of logs) {
      if (logCount2 >= limit) break;
      if (l.content.toLowerCase().includes(q)) {
        logCount2++;
        results.push({
          id: `entity.log.${l.id}`,
          label: l.content.length > 60 ? `${l.content.slice(0, 60)}…` : l.content,
          description: `Log · ${l.speaker} · ${l.timestamp}`,
          icon: "📜",
          category: "Results",
          action: () => { /* log entry visible in Session Log view */ },
        });
      }
    }

    return results;
  }, [query, characters, scenes, npcs, statBlocks, logs, setActiveScene]);

  const filteredCommands = useMemo(() => {
    const entities = entityResults;
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    const matched = commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.shortcut?.toLowerCase().includes(q),
    );
    return [...entities, ...matched];
  }, [commands, entityResults, query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setQuery("");
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
            setIsOpen(false);
            setQuery("");
          }
          break;
        case "Tab":
          e.preventDefault();
          break;
      }
    },
    [isOpen, filteredCommands, selectedIndex],
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
        setSelectedIndex(0);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (filteredCommands[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, filteredCommands]);

  if (!isOpen) return null;

  return (
    <div ref={paletteRef} className="command-palette-overlay" onClick={() => setIsOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-header">
          <span className="palette-icon">⌘</span>
          <input
            type="text"
            className="palette-input"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            aria-label="Command search"
          />
          <span className="palette-hint">↑↓ Navigate • Enter Execute • Esc Close</span>
        </div>

        <div className="palette-list" role="listbox" aria-label="Commands">
          {filteredCommands.length === 0 ? (
            <div className="palette-empty">No commands match "{query}"</div>
          ) : (
            filteredCommands.map((cmd, idx) => (
              <div
                key={cmd.id}
                ref={(el) => { itemRefs.current[idx] = el; }}
                className={`palette-item ${idx === selectedIndex ? "selected" : ""} ${cmd.disabled ? "disabled" : ""}`}
                role="option"
                aria-selected={idx === selectedIndex}
                aria-disabled={cmd.disabled}
                onClick={() => {
                  if (!cmd.disabled) {
                    cmd.action();
                    setIsOpen(false);
                    setQuery("");
                  }
                }}
              >
                <span className="palette-icon">{cmd.icon}</span>
                <div className="palette-content">
                  <span className="palette-label">{cmd.label}</span>
                  <span className="palette-desc">{cmd.description}</span>
                </div>
                {cmd.shortcut && <span className="palette-shortcut">{cmd.shortcut}</span>}
                {cmd.disabled && <span className="palette-badge" aria-label="Disabled">Unavailable</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}