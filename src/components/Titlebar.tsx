import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import "../App.css";

export function Titlebar() {
  const win = getCurrentWindow();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <img src="/icon.svg" alt="" aria-hidden="true" className="titlebar-logo" />
        <span className="titlebar-title">Auto-DM</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          onClick={() => void win.minimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          className="titlebar-btn"
          onClick={() => void win.toggleMaximize()}
          aria-label="Maximize"
          title="Maximize"
        >
          <Square size={13} strokeWidth={1.8} />
        </button>
        <button
          className="titlebar-btn close"
          onClick={() => void win.close()}
          aria-label="Close"
          title="Close"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
