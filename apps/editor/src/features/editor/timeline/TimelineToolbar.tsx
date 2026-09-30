import { timelineEnd } from "@zenvi/engine";
import { BookmarkPlus, ChevronsLeftRight, Magnet, MousePointer2, Plus, Scissors, SquareSplitHorizontal, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef } from "react";
import { secondsToTimecode } from "@/lib/timecode";
import { cn } from "@/ui/cn";
import { Divider, IconButton, Slider } from "@/ui/Controls";
import { shortcutFor } from "../commands";
import { useRunCommand } from "../layout/commandsContext";
import { useProjectSelector, useSession, useUi } from "../session/context";
import { selectionIsEmpty } from "../session/uiStore";
import { sliderToZoom, zoomToSlider } from "./geometry";

/** HH:MM:SS:FF, updated by direct DOM writes (60 fps during playback without re-rendering). */
export function LiveTimecode({ className }: { className?: string }) {
  const session = useSession();
  const el = useRef<HTMLSpanElement>(null);
  const fps = useProjectSelector((p) => p.fps);
  useEffect(() => {
    const write = (t: number) => {
      if (el.current) el.current.textContent = secondsToTimecode(t, fps);
    };
    write(session.playback.getState().time);
    return session.playback.subscribe((s, prev) => {
      if (s.time !== prev.time) write(s.time);
    });
  }, [session, fps]);
  return <span ref={el} aria-live="off" className={cn("font-mono tnum", className)} />;
}

export function TimelineToolbar() {
  const session = useSession();
  const run = useRunCommand();
  const tool = useUi((s) => s.tool);
  const snapping = useUi((s) => s.snapping);
  const pps = useUi((s) => s.pxPerSecond);
  const hasSelection = useUi((s) => !selectionIsEmpty(s.selection));
  const fps = useProjectSelector((p) => p.fps);
  const end = useProjectSelector((p) => timelineEnd(p));

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-base px-2">
      <div className="flex items-center rounded-md bg-white/[0.04] p-0.5" role="radiogroup" aria-label="Timeline tool">
        <IconButton size="xs" label="Select" active={tool === "select"} onClick={() => session.ui.setState({ tool: "select" })} className="h-6 w-7">
          <MousePointer2 size={13} />
        </IconButton>
        <IconButton size="xs" label="Razor" shortcut={shortcutFor("actionRazorTool")} active={tool === "razor"} onClick={() => run("actionRazorTool")} className="h-6 w-7">
          <Scissors size={13} />
        </IconButton>
      </div>
      <IconButton size="sm" label={snapping ? "Snapping on" : "Snapping off"} shortcut={shortcutFor("actionSnappingTool")} active={snapping} onClick={() => run("actionSnappingTool")}>
        <Magnet size={14} />
      </IconButton>
      <Divider vertical />
      <IconButton size="sm" label="Slice at playhead" shortcut={shortcutFor("sliceSelectedKeepBothSides")} onClick={() => run(hasSelection ? "sliceSelectedKeepBothSides" : "sliceAllKeepBothSides")}>
        <SquareSplitHorizontal size={14} />
      </IconButton>
      <IconButton size="sm" label="Delete" shortcut="Delete" disabled={!hasSelection} onClick={() => run("deleteItem")}>
        <Trash2 size={14} />
      </IconButton>
      <Divider vertical />
      <IconButton size="sm" label="Add track" shortcut={shortcutFor("actionAddTrack")} onClick={() => run("actionAddTrack")}>
        <Plus size={15} />
      </IconButton>
      <IconButton size="sm" label="Add marker" shortcut={shortcutFor("actionAddMarker")} onClick={() => run("actionAddMarker")}>
        <BookmarkPlus size={14} />
      </IconButton>

      <div className="flex flex-1 items-center justify-center gap-2 text-sm">
        <LiveTimecode className="text-fg" />
        <span className="font-mono text-xs tnum text-fg-faint">/ {secondsToTimecode(end, fps)}</span>
      </div>

      <IconButton size="sm" label="Zoom out" shortcut={shortcutFor("actionTimelineZoomOut")} onClick={() => run("actionTimelineZoomOut")}>
        <ZoomOut size={14} />
      </IconButton>
      <Slider
        label="Timeline zoom"
        className="w-28"
        min={0}
        max={1000}
        value={Math.round(zoomToSlider(pps) * 1000)}
        onValueChange={(v) => session.ui.setState({ pxPerSecond: sliderToZoom(v / 1000) })}
        onValueCommit={() => session.autosave.notify()}
      />
      <IconButton size="sm" label="Zoom in" shortcut={shortcutFor("actionTimelineZoomIn")} onClick={() => run("actionTimelineZoomIn")}>
        <ZoomIn size={14} />
      </IconButton>
      <IconButton size="sm" label="Zoom to fit" shortcut={shortcutFor("actionZoomToTimeline")} onClick={() => run("actionZoomToTimeline")}>
        <ChevronsLeftRight size={14} />
      </IconButton>
    </div>
  );
}
