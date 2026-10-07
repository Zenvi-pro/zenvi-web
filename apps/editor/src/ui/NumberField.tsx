import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface NumberFieldProps {
  value: number;
  /** Final value of an edit: one undo step. */
  onCommit: (value: number) => void;
  /** Live value while dragging (preview only, nothing recorded). */
  onScrub?: (value: number) => void;
  /** A drag ended without a commit (value unchanged): clear any preview. */
  onScrubCancel?: () => void;
  /** Change per pixel dragged and per arrow key press, in display units. */
  step?: number;
  min?: number;
  max?: number;
  /** Decimals shown. */
  precision?: number;
  /** Display = value × scale (e.g. 100 to show 0..1 as percent). */
  scale?: number;
  unit?: string;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  /** Visual state: value is animated (keyframed). */
  animated?: boolean;
  className?: string;
}

const DRAG_THRESHOLD = 3;

export function clampValue(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

export function roundTo(value: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

/** Parse typed text: "12", "12.5", "-3", "50%" (unit ignored), simple "a+b"/"a-b"/"a*b"/"a/b". */
export function parseNumberInput(text: string): number | null {
  const cleaned = text.replace(/[%°sx×]/gi, "").replace(/,/g, ".").trim();
  if (!cleaned) return null;
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;
  const m = /^(-?\d*\.?\d+)\s*([+\-*/])\s*(-?\d*\.?\d+)$/.exec(cleaned);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const r = m[2] === "+" ? a + b : m[2] === "-" ? a - b : m[2] === "*" ? a * b : b === 0 ? NaN : a / b;
  return Number.isFinite(r) ? r : null;
}

/**
 * A compact numeric field with drag-to-scrub (Shift = fine, Alt = coarse),
 * click-to-type, arrow keys, and Enter/Escape. Values are in model units;
 * `scale` converts to display units.
 */
export function NumberField({
  value,
  onCommit,
  onScrub,
  onScrubCancel,
  step = 1,
  min,
  max,
  precision = 2,
  scale = 1,
  unit,
  label,
  ariaLabel,
  disabled,
  animated,
  className,
}: NumberFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);

  const shown = scrubValue ?? value;
  const display = roundTo(shown * scale, precision);
  const text = Number.isFinite(display) ? String(display === 0 ? 0 : display) : "—";

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const toModel = (displayValue: number) => clampValue(displayValue / scale, min, max);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || editing || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, moved: false, last: value };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    d.moved = true;
    const factor = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    const next = toModel(roundTo(d.start * scale + dx * step * factor, precision));
    if (next !== d.last) {
      d.last = next;
      setScrubValue(next);
      onScrub?.(next);
    }
  };

  const finishDrag = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      if (commit) {
        setDraft(text);
        setEditing(true);
      }
      return;
    }
    setScrubValue(null);
    if (commit && d.last !== d.start) onCommit(d.last);
    else onScrubCancel?.();
  };

  const commitDraft = () => {
    setEditing(false);
    const parsed = parseNumberInput(draft);
    if (parsed === null) return;
    const next = toModel(parsed);
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setEditing(false);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const base = parseNumberInput(draft) ?? display;
      const nextDisplay = roundTo(base + (e.key === "ArrowUp" ? 1 : -1) * step * factor, precision);
      const next = toModel(nextDisplay);
      setDraft(String(roundTo(next * scale, precision)));
      onCommit(next);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex h-7 min-w-0 items-center rounded-md border bg-white/[0.03] text-sm",
        editing ? "border-accent" : "border-line-strong hover:border-line-bright",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
    >
      {label ? (
        <span className="pointer-events-none select-none pl-2 pr-1 text-2xs font-medium uppercase tracking-wide text-fg-faint">
          {label}
        </span>
      ) : null}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label={ariaLabel}
          inputMode="decimal"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
          className="h-full w-full min-w-0 bg-transparent px-2 text-right tnum text-fg outline-none"
        />
      ) : (
        <div
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-label={ariaLabel}
          aria-valuenow={display}
          aria-valuemin={min !== undefined ? min * scale : undefined}
          aria-valuemax={max !== undefined ? max * scale : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => finishDrag(true)}
          onPointerCancel={() => finishDrag(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "F2") {
              e.preventDefault();
              setDraft(text);
              setEditing(true);
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
              const next = toModel(roundTo(display + (e.key === "ArrowUp" ? 1 : -1) * step * factor, precision));
              if (next !== value) onCommit(next);
            }
          }}
          className={cn(
            "flex h-full min-w-0 flex-1 cursor-ew-resize select-none items-center justify-end gap-0.5 px-2 tnum outline-none",
            animated ? "text-keyframe" : "text-fg",
          )}
        >
          <span className="truncate">{text}</span>
          {unit ? <span className="text-fg-faint">{unit}</span> : null}
        </div>
      )}
    </div>
  );
}
