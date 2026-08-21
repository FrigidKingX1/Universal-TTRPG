import { useState, useCallback, useRef, useEffect } from "react";

interface PanelSizes {
  left: number;
  center: number;
  right: number;
}

const DEFAULT_SIZES: PanelSizes = { left: 240, center: 1, right: 260 };
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 400;

export function usePanelResize() {
  const [sizes, setSizes] = useState<PanelSizes>(() => {
    const saved = localStorage.getItem("autodm-panel-sizes");
    if (saved) {
      try {
        return { ...DEFAULT_SIZES, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_SIZES;
      }
    }
    return DEFAULT_SIZES;
  });

  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const startX = useRef(0);
  const startSizes = useRef<PanelSizes>(DEFAULT_SIZES);

  useEffect(() => {
    localStorage.setItem("autodm-panel-sizes", JSON.stringify(sizes));
  }, [sizes]);

  const handleMouseDown = useCallback((edge: "left" | "right", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(edge);
    startX.current = e.clientX;
    startSizes.current = { ...sizes };
    document.body.style.cursor = edge === "left" ? "ew-resize" : "ew-resize";
    document.body.style.userSelect = "none";
  }, [sizes]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging) return;

      const deltaX = e.clientX - startX.current;
      const newSizes = { ...startSizes.current };

      if (dragging === "left") {
        const newLeft = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, startSizes.current.left + deltaX));
        const diff = newLeft - startSizes.current.left;
        newSizes.left = newLeft;
        newSizes.center = Math.max(1, startSizes.current.center - diff);
      } else if (dragging === "right") {
        const newRight = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, startSizes.current.right - deltaX));
        const diff = startSizes.current.right - newRight;
        newSizes.right = newRight;
        newSizes.center = Math.max(1, startSizes.current.center - diff);
      }

      setSizes(newSizes);
    };

    const handleMouseUp = () => {
      setDragging(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, sizes]);

  const resetSizes = useCallback(() => {
    setSizes(DEFAULT_SIZES);
  }, []);

  return { sizes, dragging, handleMouseDown, resetSizes };
}