import { useState, useEffect, useRef } from "react";
import "../App.css";

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export function Tooltip({ children, content, position = "top", delay = 200 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = () => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    hideTimeout.current = window.setTimeout(() => setIsVisible(true), delay);
  };

  const hideTooltip = () => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    hideTimeout.current = window.setTimeout(() => setIsVisible(false), 100);
  };

  useEffect(() => {
    return () => { if (hideTimeout.current) clearTimeout(hideTimeout.current); };
  }, []);

  if (!triggerRef.current) return <>{children}</>;

  return (
    <div
      ref={triggerRef}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      style={{ display: "inline-flex" }}
    >
      {children}
      {isVisible && triggerRect && (
        <div
          className="tooltip-popover"
          style={{
            position: "fixed",
            left: triggerRect.left + triggerRect.width / 2,
            top: position === "top" ? triggerRect.top - 8 : triggerRect.bottom + 8,
            transform: position === "top" ? "translateX(-50%) translateY(-100%)" : "translateX(-50%) translateY(0)",
            zIndex: 9999,
            opacity: 1,
            transition: "opacity 0.15s ease, transform 0.15s ease",
          }}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </div>
  );
}