import { PROFILES, type Profile } from "@zenvi/engine";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { formatFps } from "@/lib/format";
import { COMMON_PRESETS, presetProfile, type ProfilePreset } from "@/lib/projectFactory";
import { cn } from "@/ui/cn";
import { Dialog } from "@/ui/Dialog";
import { SearchInput } from "@/ui/Input";

/** A rectangle in the format's aspect ratio. */
function FrameGlyph({ width, height, className }: { width: number; height: number; className?: string }) {
  const box = 30;
  const ratio = width / height;
  const w = ratio >= 1 ? box : Math.round(box * ratio);
  const h = ratio >= 1 ? Math.round(box / ratio) : box;
  return (
    <span className={cn("inline-flex h-[34px] w-[34px] items-center justify-center", className)} aria-hidden>
      <span className="rounded-[3px] border-[1.5px] border-current" style={{ width: w, height: h }} />
    </span>
  );
}

export function FormatCard({
  preset,
  onPick,
  busy,
}: {
  preset: ProfilePreset;
  onPick: (profile: Profile) => void;
  busy?: boolean;
}) {
  const profile = presetProfile(preset);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onPick(profile)}
      className={cn(
        "group flex min-w-0 flex-col items-start gap-3 rounded-xl border border-line bg-base p-4 text-left outline-none",
        "transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-line-bright hover:bg-raised",
        "focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
      )}
    >
      <FrameGlyph width={profile.width} height={profile.height} className="text-fg-subtle transition-colors group-hover:text-accent-hover" />
      <span className="min-w-0">
        <span className="block truncate text-md font-medium text-fg">{preset.label}</span>
        <span className="block truncate text-xs text-fg-subtle">{preset.hint}</span>
      </span>
    </button>
  );
}

export function MoreFormatsCard({ onPick, busy }: { onPick: (profile: Profile) => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className={cn(
          "group flex min-w-0 flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong p-4 text-left outline-none",
          "transition-[border-color,background-color] duration-150 hover:border-line-bright hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        <span className="inline-flex h-[34px] w-[34px] items-center justify-center text-fg-subtle group-hover:text-fg">
          <Plus size={20} />
        </span>
        <span>
          <span className="block text-md font-medium text-fg">More formats</span>
          <span className="block text-xs text-fg-subtle">{PROFILES.filter((p) => !p.legacy).length} profiles</span>
        </span>
      </button>
      <ProfileDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(p) => {
          setOpen(false);
          onPick(p);
        }}
      />
    </>
  );
}

export function ProfileDialog({
  open,
  onOpenChange,
  onPick,
  title = "Choose a format",
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (profile: Profile) => void;
  title?: string;
  current?: string;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    return PROFILES.filter((p) => !p.legacy)
      .filter((p) => {
        if (terms.length === 0) return true;
        const hay = `${p.description} ${p.width}x${p.height} ${p.width}×${p.height} ${formatFps(p.fps)}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .sort((a, b) => b.height * b.width - a.height * a.width || a.description.localeCompare(b.description));
  }, [query]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description="Frame size and frame rate of the timeline." width={560} bodyClassName="pb-3">
      <SearchInput value={query} onValueChange={setQuery} placeholder="Search: 1080, vertical, 60 fps, 4K…" autoFocus className="mb-3" />
      <ul className="-mx-2 max-h-[52vh] overflow-y-auto" role="listbox" aria-label="Profiles">
        {results.slice(0, 300).map((p) => (
          <li key={p.key}>
            <button
              type="button"
              role="option"
              aria-selected={current === p.description}
              onClick={() => onPick(p)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-white/[0.06] focus-visible:bg-white/[0.08]",
                current === p.description && "bg-accent/15",
              )}
            >
              <FrameGlyph width={p.width} height={p.height} className="scale-75 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{p.description}</span>
              <span className="shrink-0 text-xs tnum text-fg-subtle">
                {p.width}×{p.height} · {formatFps(p.fps)}
              </span>
            </button>
          </li>
        ))}
        {results.length === 0 ? <li className="px-2 py-6 text-center text-sm text-fg-subtle">No format matches “{query}”.</li> : null}
      </ul>
    </Dialog>
  );
}

export { COMMON_PRESETS };
