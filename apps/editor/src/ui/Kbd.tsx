import { cn } from "./cn";
import { formatShortcut } from "@/lib/keyboard/format";

/** A keyboard shortcut rendered as key caps, platform-aware (⌘ on macOS). */
export function Kbd({ shortcut, className }: { shortcut: string; className?: string }) {
  const parts = formatShortcut(shortcut);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-white/10 bg-white/[0.05] px-1 font-sans text-2xs font-medium text-fg-muted"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}
