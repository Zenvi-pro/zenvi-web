import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

/** Header row shared by side panels: title on the left, actions on the right. */
export function PanelHeader({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-10 shrink-0 items-center gap-1 border-b border-line pl-3 pr-1.5", className)}>
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{title}</h2>
      {children}
    </div>
  );
}

export function PanelEmpty({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 text-fg-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-fg-muted">{title}</p>
      {body ? <p className="max-w-[240px] text-xs text-fg-subtle">{body}</p> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

/** Small segmented filter (All / Video / Audio …). */
export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5 rounded-md bg-white/[0.04] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 rounded-[5px] px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            value === o.value ? "bg-white/[0.1] text-fg" : "text-fg-subtle hover:text-fg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
