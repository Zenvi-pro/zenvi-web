import { renameTrack, setTrackLocked, trackDisplayName, type Layer } from "@zenvi/engine";
import { Lock, LockOpen } from "lucide-react";
import { forwardRef, memo, useEffect, useRef, useState } from "react";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/Controls";
import { ContextMenu } from "@/ui/Menu";
import { useProject, useSession } from "../session/context";
import { trackMenu } from "./menus";

const TrackHeader = memo(function TrackHeader({ layer, name, height, index }: { layer: Layer; name: string; height: number; index: number }) {
  const session = useSession();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);
  const commit = () => {
    setRenaming(false);
    const label = draft.trim();
    if (label !== (layer.label ?? "")) session.edit("Rename track", (tx) => renameTrack(tx, layer.number, label));
  };
  const startRename = () => {
    setDraft(layer.label || name);
    setRenaming(true);
  };
  return (
    <ContextMenu items={() => trackMenu(session, layer.number, startRename)}>
      <div
        className={cn("group flex items-center gap-1 border-b border-line pl-3 pr-1.5", index % 2 ? "bg-track-alt" : "bg-track")}
        style={{ height }}
        data-track={layer.number}
        data-track-header=""
      >
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={input}
              value={draft}
              aria-label="Track name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="h-6 w-full rounded-sm bg-white/[0.06] px-1 text-sm text-fg outline-none ring-1 ring-accent"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={startRename}
              title="Double-click to rename"
              className="max-w-full truncate rounded-sm text-left text-sm font-medium text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
            >
              {name}
            </button>
          )}
        </div>
        <IconButton
          size="xs"
          label={layer.lock ? "Unlock track" : "Lock track"}
          active={layer.lock}
          tooltipSide="right"
          onClick={() => session.edit(layer.lock ? "Unlock track" : "Lock track", (tx) => setTrackLocked(tx, layer.number, !layer.lock))}
          className={cn(!layer.lock && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        >
          {layer.lock ? <Lock size={12} /> : <LockOpen size={12} />}
        </IconButton>
      </div>
    </ContextMenu>
  );
});

export const TrackHeaders = forwardRef<HTMLDivElement, { tracks: readonly Layer[]; trackHeight: number }>(function TrackHeaders({ tracks, trackHeight }, ref) {
  const project = useProject();
  return (
    <div ref={ref} className="will-change-transform">
      {tracks.map((layer, index) => (
        <TrackHeader key={layer.id} layer={layer} index={index} height={trackHeight} name={trackDisplayName(project, layer.number)} />
      ))}
    </div>
  );
});
