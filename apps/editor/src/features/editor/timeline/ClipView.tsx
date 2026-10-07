import type { Clip, MediaType, Transition } from "@zenvi/engine";
import { AlertTriangle, Blend, Sparkles } from "lucide-react";
import { memo } from "react";
import { cn } from "@/ui/cn";
import { Filmstrip } from "./Filmstrip";
import { Waveform } from "./Waveform";

export interface ClipGeometry {
  left: number;
  width: number;
  top: number;
  height: number;
}

const tones: Record<MediaType, { body: string; head: string; edge: string }> = {
  video: { body: "bg-clip-video", head: "bg-clip-video-head", edge: "border-clip-video-edge/50" },
  audio: { body: "bg-clip-audio", head: "bg-clip-audio-head", edge: "border-clip-audio-edge/50" },
  image: { body: "bg-clip-image", head: "bg-clip-image-head", edge: "border-clip-image-edge/50" },
};

export interface ClipViewProps {
  clip: Clip;
  left: number;
  width: number;
  top: number;
  height: number;
  mediaType: MediaType;
  title: string;
  selected: boolean;
  locked: boolean;
  missing: boolean;
  dragging: boolean;
  /** Visible slice of the clip in clip-local px (for filmstrip/waveform drawing). */
  visibleFrom: number;
  visibleTo: number;
  pxPerSecond: number;
  fileId: string;
  hasAudio: boolean;
}

export const ClipView = memo(function ClipView({
  clip,
  left,
  width,
  top,
  height,
  mediaType,
  title,
  selected,
  locked,
  missing,
  dragging,
  visibleFrom,
  visibleTo,
  pxPerSecond,
  fileId,
  hasAudio,
}: ClipViewProps) {
  const geometry = { left, width, top, height };
  const tone = tones[mediaType];
  const effects = clip.effects?.length ?? 0;
  const narrow = geometry.width < 28;
  const showWave = hasAudio && geometry.height >= 34;
  const waveOnly = mediaType === "audio";
  return (
    <div
      data-kind="clip"
      data-id={clip.id}
      data-clip-id={clip.id}
      data-track={clip.layer}
      data-selected={selected || undefined}
      role="button"
      aria-label={`Clip ${title}`}
      aria-pressed={selected}
      className={cn(
        "group absolute left-0 top-0 flex select-none flex-col overflow-hidden rounded-[4px] border shadow-clip",
        tone.body,
        tone.edge,
        selected && "z-[2] border-transparent ring-[1.5px] ring-accent ring-offset-0",
        dragging && "z-[3] opacity-90 shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
        locked && "opacity-60",
      )}
      style={{
        transform: `translate3d(${geometry.left}px, ${geometry.top}px, 0)`,
        width: Math.max(2, geometry.width),
        height: geometry.height,
      }}
    >
      <div className={cn("flex h-[18px] shrink-0 items-center gap-1 px-1.5 text-[11px] font-medium leading-none text-white/95", missing ? "bg-danger/70" : tone.head)}>
        {!narrow ? (
          <>
            {missing ? <AlertTriangle size={11} className="shrink-0" aria-label="Media missing" /> : null}
            <span className="truncate">{title}</span>
            {effects > 0 ? (
              <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-[3px] bg-black/25 px-1 py-px text-[10px] text-white/85" title={`${effects} effect${effects > 1 ? "s" : ""}`}>
                <Sparkles size={9} />
                {effects}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        {!waveOnly ? <Filmstrip fileId={fileId} clip={clip} pxPerSecond={pxPerSecond} height={geometry.height - 18} visibleFrom={visibleFrom} visibleTo={visibleTo} /> : null}
        {showWave ? (
          <div className={cn("absolute inset-x-0 bottom-0", waveOnly ? "top-0" : "h-[42%] bg-black/25")}>
            <Waveform fileId={fileId} clip={clip} pxPerSecond={pxPerSecond} visibleFrom={visibleFrom} visibleTo={visibleTo} />
          </div>
        ) : null}
      </div>
      {/* Trim handles: hit-testing is by pointer position; these only show where they are. */}
      {!locked && geometry.width > 18 ? (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-white/0 transition-colors group-hover:bg-white/45" />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[3px] bg-white/0 transition-colors group-hover:bg-white/45" />
        </>
      ) : null}
    </div>
  );
});

export interface TransitionViewProps {
  transition: Transition;
  left: number;
  width: number;
  top: number;
  height: number;
  selected: boolean;
  dragging: boolean;
}

export const TransitionView = memo(function TransitionView({ transition, left, width, top, height, selected, dragging }: TransitionViewProps) {
  const geometry = { left, width, top, height };
  const title = typeof transition.title === "string" && transition.title ? transition.title : "Transition";
  return (
    <div
      data-kind="transition"
      data-id={transition.id}
      data-transition-id={transition.id}
      data-track={transition.layer}
      data-selected={selected || undefined}
      role="button"
      aria-label={`Transition ${title}`}
      aria-pressed={selected}
      className={cn(
        "absolute left-0 top-0 z-[4] flex select-none items-center justify-center overflow-hidden rounded-[4px] border border-transition-edge/50 backdrop-blur-[1px]",
        "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.14)_0_6px,rgba(255,255,255,0.05)_6px_12px)]",
        selected && "border-transparent ring-[1.5px] ring-accent",
        dragging && "opacity-90",
      )}
      style={{
        transform: `translate3d(${geometry.left}px, ${geometry.top}px, 0)`,
        width: Math.max(4, geometry.width),
        height: geometry.height,
      }}
    >
      {geometry.width > 44 ? (
        <span className="flex min-w-0 items-center gap-1 rounded-[3px] bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
          <Blend size={10} className="shrink-0" />
          <span className="truncate">{title}</span>
        </span>
      ) : (
        <Blend size={11} className="text-white/80" />
      )}
    </div>
  );
});
