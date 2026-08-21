import { useEffect } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "../App.css";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useFocusTrap(isOpen, onCancel);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <div ref={dialogRef} className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 id="confirm-title">{title}</h2>
        </header>

        <div className="modal-body">
          <p id="confirm-message">{message}</p>
        </div>

        <footer className="modal-footer">
          <button
            className={`btn btn-secondary ${variant === "primary" ? "btn-confirm-primary" : ""}`}
            onClick={onCancel}
            autoFocus
          >
            {cancelText}
          </button>
          <button
            className={`btn ${variant === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </footer>
      </div>
    </div>
  );
}