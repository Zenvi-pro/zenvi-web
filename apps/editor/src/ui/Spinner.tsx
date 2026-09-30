import { cn } from "./cn";

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cn("animate-spin", className)}
      role="status"
      aria-label="Loading"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ value, className }: { value: number | null; className?: string }) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10;
  return (
    <div
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
    >
      {pct === null ? (
        <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse-soft rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}
