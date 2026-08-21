import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "../App.css";

const ONBOARDING_KEY = "autodm-onboarding-complete";

interface OnboardingStep {
  id: string;
  title: string;
  /** Main explanation shown on the card. */
  description: string;
  /** Concrete "try this" action the user can perform right now. */
  tryThis?: string;
  illustration?: React.ReactNode;
}

const STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to Auto-DM",
    description:
      "Your AI-powered solo RPG companion. Generate full campaigns from a single idea, play through them scene by scene, and let the Dungeon Master handle fate checks, dice, and narration.",
    tryThis: "Press Ctrl+K at any time to open the Command Palette — your hub for every action.",
    illustration: <span className="tut-die">◆</span>,
  },
  {
    id: "modes",
    title: "Two Modes of Play",
    description:
      "Setup Mode is your workshop: build characters, monsters, scenes, and campaigns. Tabletop Mode is the live table: three panels — your character (left), the unfolding story (center), and tactical intel (right).",
    tryThis: "Toggle modes with Ctrl+M or the brass button in the top bar.",
    illustration: <span className="tut-icon">🏰</span>,
  },
  {
    id: "campaign",
    title: "Zero-to-Campaign",
    description:
      "Type a concept — 'dark fantasy heist in a sky-city' — and Auto-DM generates opening scenes, NPCs with dispositions, doom clocks ticking toward catastrophe, and interwoven plot threads. Everything lands in SQLite, saved atomically.",
    tryThis: "Go to Campaign (press 1), type a concept, and press Generate. Ollama must be running.",
    illustration: <span className="tut-icon">✨</span>,
  },
  {
    id: "dm-loop",
    title: "Playing a Scene",
    description:
      "In Tabletop mode, type what you do — 'I search the alchemist's desk' — and press Enter. The DM runs a Mythic Fate check, consults Ollama, rolls any needed dice, applies world changes, and narrates the result live as tokens stream in.",
    tryThis: "Watch the mechanical events under each response — every roll is transparent.",
    illustration: <span className="tut-icon">📜</span>,
  },
  {
    id: "combat",
    title: "Combat & Conditions",
    description:
      "Roll initiative, attack with real dice math, and track HP, temp HP, conditions, and death saves. The engine enforces 5e rules: crits double damage, natural 1s auto-miss, Poisoned grants disadvantage, Invisible grants advantage.",
    tryThis: "Toggle conditions on a combatant and attack — watch the dice change.",
    illustration: <span className="tut-icon">⚔️</span>,
  },
  {
    id: "oracle",
    title: "The Oracle",
    description:
      "When you're not sure what happens next, ask the Mythic Oracle. Fate Checks answer yes/no questions with chaos-adjusted odds; Random Events inject surprises; Scene Tests tell you if the scene proceeds as expected, alters, or interrupts.",
    tryThis: "Open Tools (press 6) and ask the Oracle a question about your situation.",
    illustration: <span className="tut-icon">🔮</span>,
  },
  {
    id: "safety",
    title: "Safety Tools Built In",
    description:
      "Lines are hard boundaries that never appear. Veils happen off-screen. Set them once in Settings and every AI generation respects them automatically — no prompts to remember mid-session.",
    tryThis: "Settings (gear icon) → Safety Tools → add your lines and veils.",
    illustration: <span className="tut-icon">🛡️</span>,
  },
  {
    id: "settings",
    title: "Configure & Go",
    description:
      "Auto-DM needs Ollama running locally (it starts it for you when possible). Pick your model, adjust narrative length, choose an accent color, and set density for your screen. Without Ollama, a deterministic stub keeps the app fully playable offline.",
    tryThis: "Pick your accent color in Settings → Appearance — it themes the whole app.",
    illustration: <span className="tut-icon">⚙️</span>,
  },
];

export function OnboardingOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const modalRef = useFocusTrap(isOpen, () => completeOnboardingRef.current?.());

  useEffect(() => {
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY);
      if (!completed) {
        setIsOpen(true);
      }
    } catch {
      // localStorage unavailable; don't block the app on onboarding
    }
  }, []);

  const showToast = useStore((s) => s.showToast);

  const completeOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      // persistence is best-effort
    }
    setIsOpen(false);
    showToast("Welcome, Game Master! Press Ctrl+K whenever you need anything.", "success", 5000);
  }, [showToast]);

  // Ref so the focus trap's Escape handler can reach the latest closure.
  const completeOnboardingRef = useRef<() => void>(null);
  completeOnboardingRef.current = completeOnboarding;

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      completeOnboarding();
    }
  }, [currentStep, completeOnboarding]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  if (!isOpen) return null;

  const step = STEPS[currentStep];

  return (
    <div ref={modalRef} className="onboarding-overlay" onClick={(e) => e.target === e.currentTarget && handleSkip()} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        <header className="onboarding-header">
          <h1 id="onboarding-title">The Game Master's Handbook</h1>
          <button className="icon-btn" onClick={handleSkip} aria-label="Skip tutorial">✕</button>
        </header>

        <div className="onboarding-progress" role="progressbar" aria-valuenow={currentStep + 1} aria-valuemin={1} aria-valuemax={STEPS.length} aria-label={`Tutorial step ${currentStep + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              className={`step-dot ${i === currentStep ? "active" : ""} ${i < currentStep ? "completed" : ""}`}
              onClick={() => setCurrentStep(i)}
              aria-label={`Go to step ${i + 1}: ${s.title}`}
              title={s.title}
            />
          ))}
        </div>

        <div className="onboarding-content" key={step.id}>
          <div className="onboarding-illustration" aria-hidden="true">{step.illustration}</div>
          <h2>{step.title}</h2>
          <p>{step.description}</p>
          {step.tryThis && (
            <div className="tutorial-try">
              <span className="try-label">Try it now</span>
              <span>{step.tryThis}</span>
            </div>
          )}
        </div>

        <footer className="onboarding-footer">
          <button className="btn btn-secondary" onClick={handlePrev} disabled={currentStep === 0}>
            Previous
          </button>
          <span className="muted step-counter">{currentStep + 1} / {STEPS.length}</span>
          <button className="btn btn-primary" onClick={handleNext}>
            {currentStep === STEPS.length - 1 ? "Begin the Adventure" : "Next"}
          </button>
        </footer>
      </div>
    </div>
  );
}
