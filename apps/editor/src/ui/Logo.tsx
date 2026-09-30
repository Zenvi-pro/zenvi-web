import { cn } from "./cn";

/**
 * The Zenvi mark: three equal squares stepped diagonally (same geometry as
 * zenvi.pro's ZenviLogo: 18×18 squares, step 6, stroke 2 in a 32×32 box).
 */
export function ZenviMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden className={cn("shrink-0", className)}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1 + i * 6} y={1 + i * 6} width={18} height={18} stroke="currentColor" strokeWidth={2} />
      ))}
    </svg>
  );
}

export function ZenviWordmark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <ZenviMark size={size} />
      <span className="text-md font-semibold tracking-tight">Zenvi</span>
    </span>
  );
}
