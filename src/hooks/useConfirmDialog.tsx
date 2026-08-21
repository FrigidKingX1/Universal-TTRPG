import { useState, useCallback, useRef } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "primary";
}

/**
 * Promise-based confirm dialog hook. Replaces window.confirm:
 *   const { confirm, dialog } = useConfirmDialog();
 *   if (await confirm({ title: "Delete?", message: "This cannot be undone." })) { ... }
 * Render `{dialog}` anywhere in the component's JSX.
 */
export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false); // resolve any stale request
      resolver.current = resolve;
      setOptions(opts);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setOptions(null);
    resolver.current?.(true);
    resolver.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setOptions(null);
    resolver.current?.(false);
    resolver.current = null;
  }, []);

  const dialog = options ? (
    <ConfirmDialog
      isOpen
      title={options.title}
      message={options.message}
      confirmText={options.confirmText}
      cancelText={options.cancelText}
      variant={options.variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, dialog };
}
