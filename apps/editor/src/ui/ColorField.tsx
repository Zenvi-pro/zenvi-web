import { useEffect, useState } from "react";
import { cn } from "./cn";
import { inputClass } from "./Input";

export function normalizeHex(text: string): string | null {
  const t = text.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(t)) return `#${[...t].map((c) => c + c).join("")}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t}`.toLowerCase();
  return null;
}

export interface ColorFieldProps {
  /** `#rrggbb`. */
  value: string;
  onCommit: (hex: string) => void;
  /** Live value while the system picker is open. */
  onScrub?: (hex: string) => void;
  ariaLabel: string;
  animated?: boolean;
  className?: string;
  disabled?: boolean;
}

/** Swatch (opens the system color picker) plus a hex field. */
export function ColorField({ value, onCommit, onScrub, ariaLabel, animated, className, disabled }: ColorFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commitDraft = () => {
    const hex = normalizeHex(draft);
    if (hex && hex !== value) onCommit(hex);
    else setDraft(value);
  };
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", disabled && "pointer-events-none opacity-40", className)}>
      <label
        className={cn(
          "relative h-7 w-7 shrink-0 overflow-hidden rounded-md border",
          animated ? "border-keyframe/70" : "border-line-bright",
        )}
        style={{ background: value }}
      >
        <input
          type="color"
          aria-label={ariaLabel}
          value={value}
          onInput={(e) => onScrub?.((e.target as HTMLInputElement).value)}
          onChange={(e) => onCommit(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <input
        aria-label={`${ariaLabel} hex`}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitDraft();
          if (e.key === "Escape") setDraft(value);
        }}
        className={cn(inputClass, "h-7 font-mono text-xs uppercase")}
      />
    </div>
  );
}
