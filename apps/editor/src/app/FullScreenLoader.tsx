import { ZenviMark } from "@/ui/Logo";

export function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center bg-canvas" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-fg-subtle">
        <ZenviMark size={28} className="animate-pulse-soft text-fg" />
        <span className="text-sm">{label}…</span>
      </div>
    </div>
  );
}
