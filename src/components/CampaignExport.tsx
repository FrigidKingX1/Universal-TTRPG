import { useMemo, useState } from "react";
import { useStore } from "../store";
import "../App.css";

type ExportFormat = "markdown" | "json" | "html";

interface ExportOptions {
  format: ExportFormat;
  includeCharacters: boolean;
  includeScenes: boolean;
  includeNpcs: boolean;
  includeMonsters: boolean;
  includeLogs: boolean;
}

export function CampaignExport() {
  const characters = useStore((s) => s.characters);
  const scenes = useStore((s) => s.scenes);
  const npcs = useStore((s) => s.npcCharacters);
  const statBlocks = useStore((s) => s.statBlocks);
  const logs = useStore((s) => s.logs);
  const showToast = useStore((s) => s.showToast);

  const [options, setOptions] = useState<ExportOptions>({
    format: "markdown",
    includeCharacters: true,
    includeScenes: true,
    includeNpcs: true,
    includeMonsters: false,
    includeLogs: true,
  });
  const [exporting, setExporting] = useState(false);

  const activeScene = scenes.find((sc) => sc.is_active);

  const generateMarkdown = useMemo(() => (): string => {
    let md = `# Auto-DM Campaign Export\n\n`;
    md += `_Generated: ${new Date().toLocaleString()}_\n\n`;

    if (activeScene) {
      md += `> **Active Scene #${activeScene.scene_number}:** ${activeScene.title} (CF ${activeScene.chaos_factor})\n\n`;
    }

    if (options.includeCharacters && characters.length > 0) {
      md += `## Characters\n\n`;
      for (const c of characters) {
        md += `### ${c.identity.name}\n`;
        md += `- **Archetype:** ${c.identity.archetype ?? "—"}\n`;
        md += `- **Ancestry:** ${c.identity.ancestry ?? "—"}\n`;
        md += `- **Level:** ${c.identity.level_or_rank}\n`;
        md += `- **HP:** ${c.resource_pools.hp?.current ?? 0}/${c.resource_pools.hp?.maximum ?? 0}\n`;
        const attrs = Object.entries(c.attributes)
          .map(([k, v]) => `${k.toUpperCase()} ${v.base_value}`)
          .join(", ");
        if (attrs) md += `- **Attributes:** ${attrs}\n`;
        md += `\n`;
      }
    }

    if (options.includeScenes && scenes.length > 0) {
      md += `## Scenes\n\n`;
      for (const s of scenes) {
        md += `### #${s.scene_number} ${s.title}${s.is_active ? " *(active)*" : ""}\n`;
        md += `- **Chaos Factor:** ${s.chaos_factor}\n`;
        if (s.summary_text) md += `- **Summary:** ${s.summary_text}\n`;
        md += `\n`;
      }
    }

    if (options.includeNpcs && npcs.length > 0) {
      md += `## NPCs\n\n`;
      for (const n of npcs) {
        md += `### ${n.name}${n.alive ? "" : " *(deceased)*"}\n`;
        md += `- **Disposition:** ${n.disposition}\n`;
        if (n.location) md += `- **Location:** ${n.location}\n`;
        if (n.notes) md += `- **Notes:** ${n.notes}\n`;
        md += `\n`;
      }
    }

    if (options.includeMonsters && statBlocks.length > 0) {
      md += `## Bestiary\n\n`;
      for (const b of statBlocks) {
        md += `### ${b.name} (CR ${b.challenge_rating})\n`;
        md += `- **AC:** ${b.armor_class}, **HP:** ${b.hit_points.current}/${b.hit_points.maximum}\n`;
        if (b.actions.length > 0) md += `- **Actions:** ${b.actions.join("; ")}\n`;
        md += `\n`;
      }
    }

    if (options.includeLogs && logs.length > 0) {
      md += `## Session Log\n\n`;
      for (const l of logs) {
        md += `- **[${l.timestamp}] ${l.speaker}:** ${l.content}\n`;
      }
      md += `\n`;
    }

    return md;
  }, [characters, scenes, npcs, statBlocks, logs, options, activeScene]);

  const generateJSON = useMemo(() => (): string => {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        activeSceneId: activeScene?.id ?? null,
        characters: options.includeCharacters ? characters : undefined,
        scenes: options.includeScenes ? scenes : undefined,
        npcs: options.includeNpcs ? npcs : undefined,
        monsters: options.includeMonsters ? statBlocks : undefined,
        logs: options.includeLogs ? logs : undefined,
      },
      null,
      2,
    );
  }, [characters, scenes, npcs, statBlocks, logs, options, activeScene]);

  const escapeHtml = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const generateHTML = useMemo(() => (): string => {
    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Auto-DM Campaign Export</title>
<style>
  body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #222; line-height: 1.5; }
  h1 { border-bottom: 3px double #8b1a1a; padding-bottom: 8px; }
  h2 { color: #8b1a1a; margin-top: 32px; border-bottom: 1px solid #ccc; }
  h3 { margin-bottom: 4px; }
  .meta { color: #666; font-style: italic; }
  .card { border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; margin: 10px 0; background: #fafafa; page-break-inside: avoid; }
  .dead { color: #999; text-decoration: line-through; }
  .log-entry { border-bottom: 1px dotted #ccc; padding: 4px 0; }
  .log-speaker { font-weight: bold; }
  @media print { body { padding: 0; } .card { border-color: #bbb; } }
</style>
</head>
<body>
<h1>Auto-DM Campaign Export</h1>
<p class="meta">Generated ${new Date().toLocaleString()}</p>`;

    if (activeScene) {
      html += `<p><strong>Active Scene:</strong> #${activeScene.scene_number} ${escapeHtml(activeScene.title)} (CF ${activeScene.chaos_factor})</p>`;
    }

    if (options.includeCharacters && characters.length > 0) {
      html += `<h2>Characters</h2>`;
      for (const c of characters) {
        html += `<div class="card"><h3>${escapeHtml(c.identity.name)}</h3>`;
        html += `<p>${escapeHtml(c.identity.archetype ?? "Adventurer")} &middot; Level ${c.identity.level_or_rank} &middot; HP ${c.resource_pools.hp?.current ?? 0}/${c.resource_pools.hp?.maximum ?? 0}</p></div>`;
      }
    }

    if (options.includeScenes && scenes.length > 0) {
      html += `<h2>Scenes</h2>`;
      for (const s of scenes) {
        html += `<div class="card"><h3>#${s.scene_number} ${escapeHtml(s.title)}${s.is_active ? " &#9733;" : ""}</h3>`;
        html += `<p class="meta">Chaos Factor ${s.chaos_factor}</p>`;
        if (s.summary_text) html += `<p>${escapeHtml(s.summary_text)}</p>`;
        html += `</div>`;
      }
    }

    if (options.includeNpcs && npcs.length > 0) {
      html += `<h2>NPCs</h2>`;
      for (const n of npcs) {
        html += `<div class="card"><h3 class="${n.alive ? "" : "dead"}">${escapeHtml(n.name)}</h3>`;
        html += `<p>${escapeHtml(n.disposition)}${n.location ? ` &middot; ${escapeHtml(n.location)}` : ""}</p>`;
        if (n.notes) html += `<p><em>${escapeHtml(n.notes)}</em></p>`;
        html += `</div>`;
      }
    }

    if (options.includeMonsters && statBlocks.length > 0) {
      html += `<h2>Bestiary</h2>`;
      for (const b of statBlocks) {
        html += `<div class="card"><h3>${escapeHtml(b.name)} (CR ${b.challenge_rating})</h3>`;
        html += `<p>AC ${b.armor_class} &middot; HP ${b.hit_points.current}/${b.hit_points.maximum}</p></div>`;
      }
    }

    if (options.includeLogs && logs.length > 0) {
      html += `<h2>Session Log</h2>`;
      for (const l of logs) {
        html += `<div class="log-entry"><span class="log-speaker">${escapeHtml(l.speaker)}:</span> ${escapeHtml(l.content)}</div>`;
      }
    }

    html += `\n</body>\n</html>`;
    return html;
  }, [characters, scenes, npcs, statBlocks, logs, options, activeScene]);

  const handleExport = async () => {
    setExporting(true);
    try {
      let content: string;
      let filename: string;
      let mimeType: string;

      switch (options.format) {
        case "markdown":
          content = generateMarkdown();
          filename = "campaign_export.md";
          mimeType = "text/markdown";
          break;
        case "json":
          content = generateJSON();
          filename = "campaign_export.json";
          mimeType = "application/json";
          break;
        default:
          content = generateHTML();
          filename = "campaign_export.html";
          mimeType = "text/html";
          break;
      }

      const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exported ${filename}`, "success");
    } catch (e) {
      showToast(`Export failed: ${String(e)}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const preview =
    options.format === "markdown"
      ? generateMarkdown().slice(0, 1200)
      : options.format === "json"
        ? generateJSON().slice(0, 1200)
        : "HTML export opens in your browser — print it (Ctrl+P) to save as PDF.";

  return (
    <section className="panel" aria-label="Campaign export">
      <h2>Export Campaign</h2>

      <div className="export-options">
        <div className="option-group">
          <label id="export-format-label">Format</label>
          <div className="radio-group" role="radiogroup" aria-labelledby="export-format-label">
            {(["markdown", "json", "html"] as const).map((f) => (
              <button
                key={f}
                className={options.format === f ? "active" : ""}
                onClick={() => setOptions((o) => ({ ...o, format: f }))}
                aria-pressed={options.format === f}
              >
                {f === "html" ? "Print / PDF" : f === "markdown" ? "Markdown" : "JSON"}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="option-group">
          <legend>Include</legend>
          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={options.includeCharacters}
                onChange={(e) => setOptions((o) => ({ ...o, includeCharacters: e.target.checked }))}
              />
              Characters ({characters.length})
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.includeScenes}
                onChange={(e) => setOptions((o) => ({ ...o, includeScenes: e.target.checked }))}
              />
              Scenes ({scenes.length})
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.includeNpcs}
                onChange={(e) => setOptions((o) => ({ ...o, includeNpcs: e.target.checked }))}
              />
              NPCs ({npcs.length})
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.includeMonsters}
                onChange={(e) => setOptions((o) => ({ ...o, includeMonsters: e.target.checked }))}
              />
              Bestiary ({statBlocks.length})
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.includeLogs}
                onChange={(e) => setOptions((o) => ({ ...o, includeLogs: e.target.checked }))}
              />
              Session Log ({logs.length})
            </label>
          </div>
        </fieldset>
      </div>

      <button className="btn btn-primary" onClick={() => void handleExport()} disabled={exporting}>
        {exporting ? "Exporting…" : "Export Campaign"}
      </button>

      <div className="export-preview">
        <h3>Preview</h3>
        <pre className="preview-content">{preview}</pre>
      </div>
    </section>
  );
}
