import { useState, useCallback } from "react";
import { useStore, parseNum } from "../store";
import "../App.css";

export function CampaignWizard() {
  const appMode = useStore((s) => s.appMode);
  const generation = useStore((s) => s.generation);
  const characters = useStore((s) => s.characters);
  const ollamaReachable = useStore((s) => s.ollama.reachable);

  const [concept, setConcept] = useState("");
  const [levelRange, setLevelRange] = useState("1-3");
  const [sceneCount, setSceneCount] = useState(3);
  const [step, setStep] = useState<"input" | "review" | "generating">("input");

  const setError = useStore((s) => s.setError);
  const setAppMode = useStore((s) => s.setAppMode);
  const generateCampaign = useStore((s) => s.generateCampaign);

  const handleGenerate = useCallback(async () => {
    if (!concept.trim()) {
      setError("Please provide a campaign concept.");
      return;
    }
    if (!ollamaReachable) {
      setError("Ollama is not reachable. The stub backend will be used.");
    }
    setStep("generating");
    try {
      await generateCampaign(concept, levelRange, sceneCount);
      setAppMode("tabletop");
    } catch (e) {
      setError(String(e));
      setStep("input");
    }
  }, [
    concept,
    levelRange,
    sceneCount,
    ollamaReachable,
    generateCampaign,
    setAppMode,
    setError,
  ]);

  if (appMode === "tabletop") {
    return null;
  }

  if (generation.status === "success" && generation.result) {
    return (
      <div className="wizard-container">
        <div className="wizard-header">
          <h1>Campaign Generated: {generation.result.campaign_title}</h1>
          <p className="subtitle">{generation.result.campaign_theme}</p>
        </div>
        <div className="wizard-content">
          <p>{generation.result.campaign_summary}</p>
          <div className="generated-summary">
            <h3>Generated Content</h3>
            <ul>
              <li>{generation.result.scenes.length} scenes</li>
              <li>{generation.result.npcs.length} NPCs</li>
              <li>{generation.result.doom_clocks.length} doom clocks</li>
              <li>{generation.result.plot_threads.length} plot threads</li>
            </ul>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setAppMode("tabletop")}
          >
            Enter Tabletop Mode
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setAppMode("setup")}
          >
            Generate Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-container">
      <div className="wizard-header">
        <h1>Zero-to-Campaign Wizard</h1>
        <p className="subtitle">Generate a complete campaign from a single concept</p>
        {!ollamaReachable && (
          <div className="banner warning" role="alert">
            Ollama is not running. Campaign generation requires an Ollama backend
            for LLM-powered content. Using the stub backend for testing.
          </div>
        )}
      </div>

      <div className="wizard-content">
        {step === "input" && (
          <>
            <div className="form-group">
              <label htmlFor="concept">Campaign Concept</label>
              <textarea
                id="concept"
                className="form-textarea"
                placeholder="e.g. Dark fantasy heist in a sky-city, gothic horror mystery in a cursed village..."
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                rows={3}
                maxLength={500}
              />
              <p className="form-hint">{concept.length}/500 characters</p>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="levelRange">Player Level Range</label>
                <select
                  id="levelRange"
                  className="form-select"
                  value={levelRange}
                  onChange={(e) => setLevelRange(e.target.value)}
                >
                  <option value="1-3">Levels 1-3 (Low)</option>
                  <option value="3-5">Levels 3-5 (Mid)</option>
                  <option value="5-8">Levels 5-8 (High)</option>
                  <option value="8-12">Levels 8-12 (Epic)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="sceneCount">Opening Scenes</label>
                <input
                  id="sceneCount"
                  type="number"
                  className="form-input"
                  min={1}
                  max={6}
                  value={sceneCount}
                  onChange={(e) => setSceneCount(parseNum(e.target.value))}
                />
              </div>
            </div>

            {characters.length === 0 && (
              <div className="banner info" role="status">
                No player characters found. Create characters in Tabletop Mode
                after generating the campaign, or import a campaign with character
                data.
              </div>
            )}
          </>
        )}

        {step === "review" && generation.result && (
          <div className="review-content">
            <h3>Review Campaign: {generation.result.campaign_title}</h3>
            <p>{generation.result.campaign_summary}</p>
          </div>
        )}

        {generation.status === "generating" && (
          <div className="generating-overlay" role="status">
            <div className="spinner" aria-label="Generating campaign" />
            <p>{generation.progress || "Generating your campaign..."}</p>
          </div>
        )}
      </div>

      <div className="wizard-footer">
        <div className="wizard-progress">
          <span className={`dot ${step === "input" ? "active" : ""}`} />
          <span className={`dot ${step === "review" ? "active" : ""}`} />
          <span className={`dot ${generation.status === "success" ? "active" : ""}`} />
        </div>
        <div className="wizard-actions">
          {step === "input" && (
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generation.status === "generating" || !concept.trim()}
            >
              Generate Campaign
            </button>
          )}
        </div>
      </div>

      <p className="footer-note">
        Powered by Ollama LLM backend. Campaign data is saved locally via SQLite.
      </p>
    </div>
  );
}
