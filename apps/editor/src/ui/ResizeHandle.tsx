import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "./cn";

export interface ResizeHandleProps {
  /** "x" resizes a width (vertical bar), "y" a height (horizontal bar). */
  axis: "x" | "y";
  /** Called with the pointer delta in px since the drag started. */
  onResize: (delta: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  /** Keyboard nudges (px per arrow press). */
  onNudge?: (delta: number) => void;
  onReset?: () => void;
  label: string;
  className?: string;
}

/**
 * A 1px hairline with a wide invisible grab zone. Keyboard accessible
 * (arrows nudge, double-click / Enter resets).
 */
export function ResizeHandle({ axis, onResize, onResizeStart, onResizeEnd, onNudge, onReset, label, className }: ResizeHandleProps) {
  const start = useRef<number | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = axis === "x" ? e.clientX : e.clientY;
    onResizeStart?.();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    onResize((axis === "x" ? e.clientX : e.clientY) - start.current);
  };
  const end = () => {
    if (start.current === null) return;
    start.current = null;
    onResizeEnd?.();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    if (axis === "x" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      onNudge?.(e.key === "ArrowLeft" ? -step : step);
    } else if (axis === "y" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      onNudge?.(e.key === "ArrowUp" ? -step : step);
    } else if (e.key === "Enter") {
      onReset?.();
    }
  };
  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative z-20 shrink-0 outline-none",
        axis === "x" ? "w-px cursor-col-resize bg-line" : "h-px cursor-row-resize bg-line",
        className,
      )}
    >
      {/* Grab zone, wider than the hairline. */}
      <span aria-hidden className={cn("absolute", axis === "x" ? "-left-1 -right-1 inset-y-0" : "-top-1 -bottom-1 inset-x-0")} />
      {/* Highlight on hover, focus and drag. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-accent opacity-0 transition-opacity duration-100 group-hover:opacity-70 group-focus-visible:opacity-100 group-active:opacity-100",
          axis === "x" ? "inset-y-0 left-1/2 w-[2px] -translate-x-1/2" : "inset-x-0 top-1/2 h-[2px] -translate-y-1/2",
        )}
      />
    </div>
  );
}
