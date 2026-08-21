import { useState, useCallback, useEffect } from "react";
import { useStore } from "../store";
import { backend } from "../backend";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { ACCENT_PRESETS, applyTheme, loadTheme, saveTheme, type ThemeSettings } from "../theme";
import "../App.css";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const modalRef = useFocusTrap(true, onClose);
  const ollamaModel = useStore((s) => s.ollama.currentModel);
  const ollamaReachable = useStore((s) => s.ollama.reachable);
  const ollamaModels = useStore((s) => s.ollama.models);
  const pollOllamaModels = useStore((s) => s.pollOllamaModels);
  const setOllamaModel = useStore((s) => s.setOllamaModel);
  const loading = useStore((s) => s.loading);
  const showToast = useStore((s) => s.showToast);

  const [linesInput, setLinesInput] = useState("");
  const [veilsInput, setVeilsInput] = useState("");
  const [testModel, setTestModel] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [theme, setThemeState] = useState<ThemeSettings>(() => loadTheme());

  const updateTheme = useCallback((next: Partial<ThemeSettings>) => {
    setThemeState((prev) => {
      const merged = { ...prev, ...next };
      applyTheme(merged);
      saveTheme(merged);
      return merged;
    });
  }, []);

  const parseList = useCallback((input: string): string[] => {
    return input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, []);

  useEffect(() => {
    let cancelled = false;
    backend.getLinesVeils()
      .then((lv) => {
        if (cancelled) return;
        setLinesInput(lv.lines.join(", "));
        setVeilsInput(lv.veils.join(", "));
      })
      .catch((e) => {
        if (!cancelled) setTestResult(`Could not load safety tools: ${e}`);
      });
    return () => { cancelled = true; };
  }, []);

  const handleSaveLinesVeils = useCallback(async () => {
    const newLines = parseList(linesInput);
    const newVeils = parseList(veilsInput);
    try {
      await backend.setLinesVeils(newLines, newVeils);
      setTestResult(`Saved ${newLines.length} lines and ${newVeils.length} veils`);
      showToast("Safety tools saved");
    } catch (e) {
      setTestResult(`Error: ${e}`);
    }
  }, [linesInput, veilsInput, parseList, showToast]);

  const handleModelChange = useCallback(async (model: string) => {
    try {
      await setOllamaModel(model);
      setTestResult(`Model changed to ${model}`);
    } catch (e) {
      setTestResult(`Error: ${e}`);
    }
  }, [setOllamaModel]);

  const handleRefreshModels = useCallback(async () => {
    try {
      await pollOllamaModels();
      setTestResult("Refreshed model list");
    } catch (e) {
      setTestResult(`Error: ${e}`);
    }
  }, [pollOllamaModels]);

  const handleTestConnection = useCallback(async () => {
    if (!testModel.trim()) {
      setTestResult("Enter a model name to test");
      return;
    }
    try {
      await setOllamaModel(testModel);
      setTestResult(`Connected to ${testModel}`);
    } catch (e) {
      setTestResult(`Error: ${e}`);
    }
  }, [testModel, setOllamaModel]);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div ref={modalRef} className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </header>

        <div className="modal-body">
          <section className="settings-section">
            <h3>Ollama LLM Backend</h3>
            
            <div className="form-group">
              <label htmlFor="ollama-model">Active Model</label>
              <div className="model-selector">
                <select
                  id="ollama-model"
                  className="form-select"
                  value={ollamaModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={loading}
                >
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={handleRefreshModels}
                  disabled={loading}
                >
                  ↻ Refresh
                </button>
              </div>
              <p className="form-hint">
                Current: {ollamaModel} | Status:{" "}
                <span className={ollamaReachable ? "online" : "offline"}>
                  {ollamaReachable ? "Connected" : "Disconnected"}
                </span>
              </p>
            </div>

            <details className={showAdvanced ? "open" : ""}>
              <summary onClick={() => setShowAdvanced(!showAdvanced)}>
                Advanced Model Testing
              </summary>
              <div className="form-group">
                <label htmlFor="test-model">Test Model Name</label>
                <div className="input-with-btn">
                  <input
                    id="test-model"
                    type="text"
                    className="form-input"
                    placeholder="e.g. llama3.2:latest"
                    value={testModel}
                    onChange={(e) => setTestModel(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    className="btn btn-primary btn-small"
                    onClick={handleTestConnection}
                    disabled={loading || !testModel.trim()}
                  >
                    Test Connection
                  </button>
                </div>
              </div>
            </details>
          </section>

          <section className="settings-section">
            <h3>Safety Tools</h3>
            <p className="form-hint">Lines are hard boundaries. Veils are "fade to black" topics.</p>
            
            <div className="form-group">
              <label htmlFor="lines-input">Lines (one per line or comma-separated)</label>
              <textarea
                id="lines-input"
                className="form-textarea"
                value={linesInput}
                onChange={(e) => setLinesInput(e.target.value)}
                rows={3}
                placeholder="e.g. sexual violence, harm to children, torture"
              />
            </div>

            <div className="form-group">
              <label htmlFor="veils-input">Veils (one per line or comma-separated)</label>
              <textarea
                id="veils-input"
                className="form-textarea"
                value={veilsInput}
                onChange={(e) => setVeilsInput(e.target.value)}
                rows={3}
                placeholder="e.g. romance scenes, graphic violence, drug use"
              />
            </div>

            <button className="btn btn-primary" onClick={handleSaveLinesVeils} disabled={loading}>
              Save Safety Tools
            </button>
          </section>

          <section className="settings-section">
            <h3>Appearance</h3>

            <div className="form-group">
              <label>Accent Color</label>
              <div className="accent-swatches" role="radiogroup" aria-label="Accent color">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    className={`accent-swatch ${theme.accent === preset.value ? "active" : ""}`}
                    style={{ background: preset.value }}
                    onClick={() => updateTheme({ accent: preset.value })}
                    title={preset.name}
                    aria-label={`Accent color ${preset.name}`}
                    aria-pressed={theme.accent === preset.value}
                  />
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="font-size">Font Size: {theme.fontSize}px</label>
              <input
                id="font-size"
                type="range"
                min={12}
                max={18}
                step={1}
                value={theme.fontSize}
                onChange={(e) => updateTheme({ fontSize: Number(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label>Density</label>
              <div className="radio-group" role="radiogroup" aria-label="Layout density">
                <button
                  className={theme.density === "comfortable" ? "active" : ""}
                  onClick={() => updateTheme({ density: "comfortable" })}
                  aria-pressed={theme.density === "comfortable"}
                >
                  Comfortable
                </button>
                <button
                  className={theme.density === "compact" ? "active" : ""}
                  onClick={() => updateTheme({ density: "compact" })}
                  aria-pressed={theme.density === "compact"}
                >
                  Compact
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3>Application</h3>
            <p className="form-hint">
              Auto-save runs every 30 seconds while the app is open. Dice animations respect your
              system reduced-motion preference.
            </p>
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => {
                  try { localStorage.removeItem("autodm.theme"); } catch {}
                  try { localStorage.removeItem("autodm-onboarding-complete"); } catch {}
                  updateTheme({ accent: "#c9a86a", fontSize: 14, density: "comfortable" });
                  showToast("Appearance reset to defaults", "success");
                }}
              >
                Reset appearance
              </button>
              <span className="muted" style={{ fontSize: "0.75rem", alignSelf: "center" }}>v0.1.0</span>
            </div>
          </section>

          {testResult && (
            <div className={`test-result ${testResult.startsWith("Error") ? "error" : "success"}`}>
              {testResult}
            </div>
          )}
        </div>

        <footer className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}