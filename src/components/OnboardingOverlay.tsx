import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "../App.css";

const ONBOARDING_KEY = "autodm-onboarding-complete";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  illustration?: string;
}

const STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to Auto-DM",
    description: "Your AI-powered solo RPG companion. Generate campaigns, play through adventures, and let the Dungeon Master handle the rules.",
    illustration: "🎲",
  },
  {
    id: "modes",
    title: "Two Modes of Play",
    description: "Setup Mode (🧙) for campaign creation and character building. Tabletop Mode (🏰) for live play with the three-panel layout: Command Deck, Narrative Stream, and Tactical Matrix.",
    illustration: "🏰",
  },
  {
    id: "campaign",
    title: "Zero-to-Campaign",
    description: "Enter a concept like 'dark fantasy heist in a sky-city' and Auto-DM generates scenes, NPCs, doom clocks, and plot threads — all saved atomically to SQLite.",
    illustration: "✨",
  },
  {
    id: "dm",
    title: "Active DM Loop",
    description: "Type your action in the Narrative Stream. The DM pipeline runs Fate checks, queries Ollama, parses structured intent, applies world changes, and narrates the result.",
    illustration: "🤖",
  },
  {
    id: "shortcuts",
    title: "Keyboard Shortcuts",
    description: "Ctrl+K: Command Palette • Ctrl+M: Toggle Mode • 1-5: Navigate (Setup) • Enter: Send to DM • Esc: Dismiss • Ctrl+B: Toggle Sidebar",
    illustration: "⌨️",
  },
  {
    id: "settings",
    title: "Configure Ollama",
    description: "Open Settings (⚙️) to select your Ollama model, set Lines & Veils safety tools, and test connections. Requires Ollama running locally on port 11434.",
    illustration: "⚙️",
  },
];

export function OnboardingOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const modalRef = useFocusTrap(isOpen);

  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!completed) {
      setIsOpen(true);
    }
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      completeOnboarding();
    }
  }, [currentStep]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const showToast = useStore((s) => s.showToast);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setIsOpen(false);
    showToast("Welcome to Auto-DM! Press Ctrl+K for the Command Palette.", "success", 5000);
  }, [showToast]);

  const handleSkip = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  if (!isOpen) return null;

  const step = STEPS[currentStep];

  return (
    <div ref={modalRef} className="onboarding-overlay" onClick={(e) => e.target === e.currentTarget && handleSkip()} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        <header className="onboarding-header">
          <h1 id="onboarding-title">Auto-DM Onboarding</h1>
          <button className="icon-btn" onClick={handleSkip} aria-label="Skip onboarding">✕</button>
        </header>

        <div className="onboarding-progress">
          {STEPS.map((s, i) => (
            <span key={s.id} className={`step-dot ${i === currentStep ? "active" : ""} ${i < currentStep ? "completed" : ""}`} />
          ))}
        </div>

        <div className="onboarding-content">
          <div className="onboarding-illustration" aria-hidden="true">{step.illustration}</div>
          <h2>{step.title}</h2>
          <p>{step.description}</p>
        </div>

        <footer className="onboarding-footer">
          <button className="btn btn-secondary" onClick={handlePrev} disabled={currentStep === 0}>
            Previous
          </button>
          <button className="btn btn-primary" onClick={handleNext}>
            {currentStep === STEPS.length - 1 ? "Get Started" : "Next"}
          </button>
          <button className="btn btn-ghost" onClick={handleSkip}>
            Skip
          </button>
        </footer>
      </div>
    </div>
  );
}