import { useFocusTrap } from "../hooks/useFocusTrap";
import "../App.css";

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ keys: string[]; description: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Open command palette" },
      { keys: ["Ctrl", "B"], description: "Toggle sidebar" },
      { keys: ["Ctrl", "M"], description: "Switch Setup / Tabletop mode" },
      { keys: ["Esc"], description: "Dismiss dialogs and errors" },
      { keys: ["?"], description: "Show this help" },
    ],
  },
  {
    title: "Navigation (Setup mode)",
    shortcuts: [
      { keys: ["1"], description: "Campaign wizard" },
      { keys: ["2"], description: "Scenes" },
      { keys: ["3"], description: "Characters" },
      { keys: ["4"], description: "Bestiary" },
      { keys: ["5"], description: "Combat" },
      { keys: ["6"], description: "Tools" },
    ],
  },
  {
    title: "Command Palette",
    shortcuts: [
      { keys: ["↑", "↓"], description: "Navigate results" },
      { keys: ["Enter"], description: "Run selected command" },
      { keys: ["Esc"], description: "Close palette" },
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const modalRef = useFocusTrap(true, onClose);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div ref={modalRef} className="modal modal-wide shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close shortcuts help">✕</button>
        </header>
        <div className="modal-body">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="settings-section">
              <h3>{group.title}</h3>
              <div className="shortcut-list">
                {group.shortcuts.map((s) => (
                  <div key={s.description} className="shortcut-row">
                    <span className="shortcut-keys">
                      {s.keys.map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="muted"> + </span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </span>
                    <span>{s.description}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <footer className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
