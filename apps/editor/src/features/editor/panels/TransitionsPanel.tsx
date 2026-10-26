import {
  applyTransitionToClip,
  listMotionTransitions,
  listProjectMotionTransitions,
  searchTransitions,
  type MotionDirection,
  type MotionPresetInfo,
  type MotionTransitionStyle,
} from "@zenvi/engine";
import { Blend } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { SearchInput } from "@/ui/Input";
import { toast } from "@/ui/Toast";
import { defaultTransitionSeconds, transitions, type TransitionEntry } from "../catalog";
import { applyMotionStyle, applyMotionTransition, type DirectionChoice } from "../actions/motion";
import { beginDrag, endDrag } from "../dnd";
import { useProjectSelector, useSession, useUi } from "../session/context";
import { EMPTY_SELECTION } from "../session/uiStore";
import { peakFrame, previewFrames, type PreviewFrame } from "./motionPreview";
import { PanelHeader, Segmented } from "./PanelChrome";

/** Motion transitions (the clips themselves move across the cut) or the desktop's luma masks. */
type Kind = "motion" | "masks";

/** Previews play the 30 fps plan at half speed so a 3-frame flash is visible. */
const PLAN_FPS = 30;
const PREVIEW_FPS = 15;

/** Stand-in shots: a warm A and a cool B, striped so a whip or a shake reads. */
function shotArt(letter: string, from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><g fill="#fff" opacity=".14">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${i * 20 + 4}" y="0" width="6" height="90"/>`).join("")}</g><text x="80" y="62" font-family="Inter,Arial,sans-serif" font-size="46" font-weight="800" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const SHOTS = { a: shotArt("A", "#ff8a3d", "#c2275f"), b: shotArt("B", "#3275f8", "#14b8a6") };

function paint(frame: PreviewFrame, shot: HTMLDivElement, wash: HTMLDivElement, blur: SVGFEGaussianBlurElement, filterId: string): void {
  const w = shot.offsetWidth || 160;
  shot.style.backgroundImage = SHOTS[frame.shot];
  shot.style.transform = frame.transform;
  shot.style.backgroundPosition = `${frame.shiftX * w}px ${frame.shiftY * w}px`;
  blur.setAttribute("stdDeviation", `${(frame.blurX * w * 0.5).toFixed(2)} ${(frame.blurY * w * 0.5).toFixed(2)}`);
  const split = frame.redX || frame.blueX ? ` drop-shadow(${frame.redX * w}px 0 0 rgb(255 0 60 / 0.7)) drop-shadow(${frame.blueX * w}px 0 0 rgb(0 140 255 / 0.7))` : "";
  shot.style.filter = `url(#${filterId})${split}${frame.invert ? " invert(1)" : ""}`;
  wash.style.background = frame.wash > 0 ? `rgb(255 255 255 / ${frame.wash})` : frame.wash < 0 ? `rgb(0 0 0 / ${-frame.wash})` : "transparent";
}

function MotionTile({ info, direction, onApply }: { info: MotionPresetInfo; direction: MotionDirection | undefined; onApply: () => void }) {
  const filterId = `mt-${useId().replace(/:/g, "")}`;
  const shot = useRef<HTMLDivElement>(null);
  const wash = useRef<HTMLDivElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const [playing, setPlaying] = useState(false);
  const dir = direction && info.directions.includes(direction) ? direction : undefined;

  useEffect(() => {
    const els = shot.current && wash.current && blur.current ? ([shot.current, wash.current, blur.current] as const) : null;
    if (!els) return;
    if (!playing) {
      paint(peakFrame(info.id, dir, PLAN_FPS), ...els, filterId);
      return;
    }
    const frames = previewFrames(info.id, dir, PLAN_FPS);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      paint(frames[Math.floor(((now - start) / 1000) * PREVIEW_FPS) % frames.length]!, ...els, filterId);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, info.id, dir, filterId]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${info.title} motion transition`}
      onPointerEnter={() => setPlaying(true)}
      onPointerLeave={() => setPlaying(false)}
      onFocus={() => setPlaying(true)}
      onBlur={() => setPlaying(false)}
      onClick={onApply}
      onKeyDown={(e) => e.key === "Enter" && onApply()}
      title={`${info.description}\nClick to put it on the cut after the selected clip, or the cut nearest the playhead.`}
      className="group min-w-0 cursor-pointer rounded-lg p-1 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-black">
        <svg aria-hidden className="absolute h-0 w-0">
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur ref={blur} stdDeviation="0 0" />
          </filter>
        </svg>
        <div ref={shot} className="absolute inset-0 bg-repeat" style={{ backgroundSize: "100% 100%" }} />
        <div ref={wash} className="pointer-events-none absolute inset-0" />
      </div>
      <p className="mt-1 truncate px-0.5 text-xs text-fg-muted" title={info.title}>
        {info.title}
      </p>
    </div>
  );
}

function MotionTransitions() {
  const session = useSession();
  const selectedClips = useUi((s) => s.selection.clips);
  const onTimeline = useProjectSelector((p) => listProjectMotionTransitions(p).length);
  const [direction, setDirection] = useState<DirectionChoice>("auto");
  const [busy, setBusy] = useState<MotionTransitionStyle | null>(null);
  const presets = useMemo(() => listMotionTransitions(), []);
  const chosen = direction === "auto" ? undefined : direction;

  const applyAll = async (style: MotionTransitionStyle) => {
    setBusy(style);
    try {
      await applyMotionStyle(session, style, direction);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2">
        <Segmented<DirectionChoice>
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "auto", label: "Auto" },
            { value: "left", label: "←" },
            { value: "right", label: "→" },
            { value: "up", label: "↑" },
            { value: "down", label: "↓" },
          ]}
        />
        <p className="text-2xs text-fg-faint">Hover to preview. Click to put it on the cut after the selected clip, or the one nearest the playhead. Auto keeps the way the sequence already moves.</p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1 overflow-y-auto px-2 pb-2">
        {presets.map((info) => (
          <MotionTile key={info.id} info={info} direction={chosen} onApply={() => void applyMotionTransition(session, info, direction, selectedClips)} />
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-line px-3 py-2.5">
        <p className="text-xs text-fg-subtle">
          Every cut on the track{onTimeline > 0 ? ` · ${onTimeline} on the timeline` : ""}
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1" loading={busy === "hype"} onClick={() => void applyAll("hype")}>
            Hype mix
          </Button>
          <Button size="sm" className="flex-1" loading={busy === "cinematic"} onClick={() => void applyAll("cinematic")}>
            Cinematic mix
          </Button>
        </div>
      </div>
    </>
  );
}

/** The desktop dock's filter: Common, or Show all (common first, then the extra masks). */
type Category = "common" | "all";

function TransitionTile({ entry, onApply }: { entry: TransitionEntry; onApply: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => beginDrag(e, { kind: "transition", maskId: entry.id, name: entry.name })}
      onDragEnd={endDrag}
      onDoubleClick={onApply}
      onKeyDown={(e) => e.key === "Enter" && onApply()}
      title="Drag between two clips, or double-click to fade in the selected clip"
      className="group min-w-0 cursor-grab rounded-lg p-1 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-elevated">
        {entry.url ? (
          <img src={entry.url} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-fg-faint">
            <Blend size={18} />
          </div>
        )}
      </div>
      <p className="mt-1 truncate px-0.5 text-xs text-fg-muted" title={entry.name}>
        {entry.name}
      </p>
    </div>
  );
}

function MaskTransitions() {
  const session = useSession();
  const selectedClips = useUi((s) => s.selection.clips);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("common");
  const all = transitions();
  const list = useMemo(() => {
    const q = query.trim();
    if (!q) return category === "all" ? all : all.filter((t) => t.category === "common");
    // The desktop dock's search: display name or file name, common first.
    const hits = new Set(searchTransitions(q).map((t) => t.id));
    return all.filter((t) => hits.has(t.id));
  }, [all, query, category]);

  const apply = (entry: TransitionEntry) => {
    const clipId = selectedClips[0];
    if (!clipId) {
      toast.info("Select a clip first", { description: "Or drag the transition between two clips on the timeline." });
      return;
    }
    const t = session.edit(`Add ${entry.name}`, (tx) => applyTransitionToClip(tx, clipId, entry.id, "start", defaultTransitionSeconds()));
    if (t) session.ui.setState({ selection: { ...EMPTY_SELECTION, transitions: [t.id] } });
  };

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2">
        <SearchInput value={query} onValueChange={setQuery} placeholder={`Search ${all.length} transitions`} aria-label="Search transitions" />
        {!query ? (
          <Segmented<Category>
            label="Transition set"
            value={category}
            onChange={setCategory}
            options={[
              { value: "common", label: "Common" },
              { value: "all", label: "Show all" },
            ]}
          />
        ) : null}
      </div>
      <div className={cn("grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1 overflow-y-auto px-2 pb-4")}>
        {list.map((entry) => (
          <TransitionTile key={entry.id} entry={entry} onApply={() => apply(entry)} />
        ))}
        {list.length === 0 ? <p className="col-span-full py-8 text-center text-xs text-fg-subtle">No transitions match.</p> : null}
      </div>
    </>
  );
}

export function TransitionsPanel() {
  const [kind, setKind] = useState<Kind>("motion");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Transitions" />
      <div className="shrink-0 px-3 pb-2 pt-2.5">
        <Segmented<Kind>
          label="Transition kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "motion", label: "Motion" },
            { value: "masks", label: "Masks" },
          ]}
        />
      </div>
      {kind === "motion" ? <MotionTransitions /> : <MaskTransitions />}
    </div>
  );
}
