import { useStore } from "../store";
import "../App.css";

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          role="alert"
          aria-live={toast.type === "error" ? "assertive" : "polite"}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.type === "error" ? "✕" : toast.type === "success" ? "✓" : toast.type === "warning" ? "⚠" : "ℹ"}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            className="toast-close"
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}