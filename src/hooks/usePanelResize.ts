import { useState, useCallback, useRef, useEffect } from "react";

interface PanelSizes {
  left: number;
  right: number;
}

const DEFAULT_SIZES: PanelSizes = { left: 240, right: 260 };
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 400;
const KEYBOARD_STEP = 16;

function clampWidth(value: number): number {
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, value));
}

function loadSizes(): PanelSizes {
  try {
    const saved = localStorage.getItem("autodm-panel-sizes");
    if (saved) return { ...DEFAULT_SIZES, ...JSON.parse(saved) };
  } catch {
    // localStorage unavailable or corrupt; use defaults
  }
  return DEFAULT_SIZES;
}

export function usePanelResize() {
  const [sizes, setSizes] = useState<PanelSizes>(loadSizes);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const dragState = useRef<{ edge: "left" | "right"; startX: number; startSize: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("autodm-panel-sizes", JSON.stringify(sizes));
    } catch {
      // persistence is best-effort
    }
  }, [sizes]);

  const beginDrag = useCallback(
    (edge: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragState.current = {
        edge,
        startX: e.clientX,
        startSize: edge === "left" ? sizes.left : sizes.right,
      };
      setDragging(edge);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [sizes],
  );

  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (e: PointerEvent) => {
      const st = dragState.current;
      if (!st) return;
      const delta = e.clientX - st.startX;
      const newSize = clampWidth(st.edge === "left" ? st.startSize + delta : st.startSize - delta);
      setSizes((prev) => ({ ...prev, [st.edge]: newSize }));
    };

    const endDrag = () => {
      dragState.current = null;
      setDragging(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      // Reset body styles even if unmounted mid-drag.
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  const resizeByKeyboard = useCallback((edge: "left" | "right", direction: 1 | -1) => {
    setSizes((prev) => ({ ...prev, [edge]: clampWidth(prev[edge] + direction * KEYBOARD_STEP) }));
  }, []);

  const resetSizes = useCallback(() => setSizes(DEFAULT_SIZES), []);

  return { sizes, dragging, beginDrag, resizeByKeyboard, resetSizes };
}
