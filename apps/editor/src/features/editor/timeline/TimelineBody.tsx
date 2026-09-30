import {
  addClip,
  addEffect,
  addTransition,
  applyTransitionBetween,
  applyTransitionToClip,
  findClip,
  findTransition,
  frameDuration,
  itemEnd,
  moveClip,
  moveMarker,
  moveTransition,
  snapTargets,
  snapToFrame,
  snapToleranceSeconds,
  sortedLayers,
  splitClip,
  timelineEnd,
  trimClipEdge,
  trimTransition,
  type Clip,
  type Layer,
  type Marker,
  type ProjectFile,
  type Transition,
} from "@zenvi/engine";
import { Upload } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "zustand";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ContextMenu, type MenuSpec } from "@/ui/Menu";
import { importMedia } from "../actions/importMedia";
import { activeDrag, endDrag, isEditorDrag, isFileDrag, readDrop, type DragPayload } from "../dnd";
import { useCommands } from "../layout/commandsContext";
import { useProject, useSession, useUi } from "../session/context";
import { fileDisplayName } from "../session/media";
import { clickSelect, EMPTY_SELECTION, type Selection } from "../session/uiStore";
import { ClipView, TransitionView, type ClipGeometry } from "./ClipView";
import { computeMove, computeTrim, edgeAt, marqueeHits, normalizeRect, type Box, type DragItem, type MoveResult, type Rect, type SnapSettings, type TrimResult, type TrimSubject } from "./dragMath";
import { anchoredScroll, contentWidth, HEADER_WIDTH, RULER_HEIGHT, trackIndexAt, zoomStep, zoomToFit } from "./geometry";
import { clipMenu, emptyAreaMenu, markerMenu, transitionMenu } from "./menus";
import { Ruler, type RulerHandle } from "./Ruler";
import { TrackHeaders } from "./TrackHeaders";

type Preview =
  | { kind: "move"; ids: ReadonlySet<string>; dx: number; dTracks: number }
  | { kind: "trim"; id: string; position: number; start: number; end: number };

type Gesture =
  | { kind: "pending-move"; x0: number; y0: number; items: DragItem[]; invertSnap: boolean }
  | { kind: "move"; x0: number; y0: number; items: DragItem[]; snap: SnapSettings | null; last: MoveResult }
  | { kind: "trim"; x0: number; itemKind: "clip" | "transition"; id: string; edge: "left" | "right"; subject: TrimSubject; edgeTime0: number; snap: SnapSettings | null; last: TrimResult | null }
  | { kind: "marquee"; x0: number; y0: number; base: Selection; moved: boolean }
  | { kind: "marker"; id: string; x0: number; position0: number; moved: boolean; last: number };

type DropPreview = { left: number; width: number; trackIndex: number; label: string; kind: "clip" | "transition" } | { kind: "effect"; clipId: string };

type MenuTarget = { kind: "clip" | "transition" | "marker"; id: string } | { kind: "empty" };

const TRANSITION_SECONDS = 1;
const CUT_SNAP_PX = 14;
const PAD = 3;

function mediaTypeOf(file: ProjectFile | undefined): "video" | "audio" | "image" {
  if (!file) return "video";
  if (file.media_type === "audio" || file.media_type === "image" || file.media_type === "video") return file.media_type;
  if (file.has_single_image) return "image";
  return file.has_video ? "video" : "audio";
}

export function TimelineBody() {
  const session = useSession();
  const commands = useCommands();
  const project = useProject();
  const pps = useUi((s) => s.pxPerSecond);
  const trackHeight = useUi((s) => s.trackHeight);
  const selection = useUi((s) => s.selection);
  const tool = useUi((s) => s.tool);
  const mediaStatus = useStore(session.media.status);

  const viewport = useRef<HTMLDivElement>(null);
  const headers = useRef<HTMLDivElement>(null);
  const ruler = useRef<RulerHandle>(null);
  const rulerLayer = useRef<HTMLDivElement>(null);
  const rulerHead = useRef<HTMLDivElement>(null);
  const playheadLine = useRef<HTMLDivElement>(null);
  const snapLine = useRef<HTMLDivElement>(null);
  const razorLine = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const menuTarget = useRef<MenuTarget>({ kind: "empty" });
  const pendingScroll = useRef<number | null>(null);
  const pointer = useRef<{ clientX: number; clientY: number; shift: boolean } | null>(null);
  const autoScrollRaf = useRef(0);

  const [view, setView] = useState({ left: 0, width: 800, height: 240 });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [drop, setDrop] = useState<DropPreview | null>(null);

  const tracks = useMemo<Layer[]>(() => sortedLayers(project).reverse(), [project]);
  const trackIndex = useMemo(() => new Map(tracks.map((l, i) => [l.number, i])), [tracks]);
  const files = useMemo(() => new Map(project.files.map((f) => [f.id, f])), [project.files]);
  const locked = useMemo(() => new Set(tracks.filter((l) => l.lock).map((l) => l.number)), [tracks]);
  const end = Math.max(timelineEnd(project), 10);
  const width = contentWidth(Math.max(end, project.duration || 0), pps, view.width);
  const height = Math.max(tracks.length * trackHeight, view.height);
  const fps = project.fps;

  // ---------------------------------------------------------------------------
  // Scrolling, virtualization window, ruler and header sync
  // ---------------------------------------------------------------------------

  const syncScroll = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    if (headers.current) headers.current.style.transform = `translateY(${-el.scrollTop}px)`;
    if (rulerLayer.current) rulerLayer.current.style.transform = `translateX(${-el.scrollLeft}px)`;
    ruler.current?.draw(el.scrollLeft);
    setView((v) => {
      const half = Math.max(200, el.clientWidth / 2);
      if (Math.floor(v.left / half) === Math.floor(el.scrollLeft / half) && v.width === el.clientWidth && v.height === el.clientHeight) return v;
      return { left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight };
    });
  }, []);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => syncScroll());
    observer.observe(el);
    syncScroll();
    return () => observer.disconnect();
  }, [syncScroll]);

  // Apply a scroll offset requested by a zoom after the new width rendered.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (el && pendingScroll.current !== null) {
      el.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
    syncScroll();
  }, [pps, syncScroll]);

  const setZoom = useCallback(
    (next: number, anchorTime?: number, anchorX?: number) => {
      const el = viewport.current;
      if (!el) return;
      const t = session.playback.getState().time;
      const playheadX = t * pps - el.scrollLeft;
      const useHead = anchorTime === undefined && playheadX >= 0 && playheadX <= el.clientWidth;
      const at = anchorTime ?? (useHead ? t : (el.scrollLeft + el.clientWidth / 2) / pps);
      const x = anchorX ?? (useHead ? playheadX : el.clientWidth / 2);
      pendingScroll.current = anchoredScroll(at, x, next);
      session.ui.setState({ pxPerSecond: next });
      session.autosave.notify();
    },
    [pps, session],
  );

  // Timeline controller for commands (=, -, \, Shift+C).
  useEffect(() => {
    session.views.timeline = {
      zoomIn: () => setZoom(zoomStep(session.ui.getState().pxPerSecond, 1)),
      zoomOut: () => setZoom(zoomStep(session.ui.getState().pxPerSecond, -1)),
      zoomToFit: () => {
        const el = viewport.current;
        if (!el) return;
        const next = zoomToFit(Math.max(1, timelineEnd(session.project)), el.clientWidth);
        pendingScroll.current = 0;
        session.ui.setState({ pxPerSecond: next });
      },
      centerOnPlayhead: () => {
        const el = viewport.current;
        if (el) el.scrollLeft = Math.max(0, session.playback.getState().time * session.ui.getState().pxPerSecond - el.clientWidth / 2);
      },
      reveal: (seconds) => {
        const el = viewport.current;
        if (!el) return;
        const x = seconds * session.ui.getState().pxPerSecond;
        if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2);
      },
    };
    session.views.focusTimeline = () => viewport.current?.focus();
    return () => {
      session.views.timeline = null;
      session.views.focusTimeline = null;
    };
  }, [session, setZoom]);

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const current = session.ui.getState().pxPerSecond;
      const next = Math.min(1200, Math.max(0.5, current * Math.exp(-e.deltaY * 0.0025)));
      setZoom(next, (el.scrollLeft + x) / current, x);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [session, setZoom]);

  // Playhead: direct DOM updates, never a React render per frame.
  useEffect(() => {
    const apply = (t: number) => {
      const x = t * pps;
      if (playheadLine.current) playheadLine.current.style.transform = `translateX(${x}px)`;
      if (rulerHead.current) rulerHead.current.style.transform = `translateX(${x}px)`;
      const el = viewport.current;
      if (el && session.playback.getState().playing && !gesture.current) {
        if (x > el.scrollLeft + el.clientWidth - 24 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.15);
      }
    };
    apply(session.playback.getState().time);
    return session.playback.subscribe((s, prev) => {
      if (s.time !== prev.time) apply(s.time);
    });
  }, [session, pps]);

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------

  const clipGeometry = (clip: Clip): ClipGeometry => {
    let position = clip.position;
    let start = clip.start;
    let finish = clip.end;
    let index = trackIndex.get(clip.layer) ?? 0;
    if (preview?.kind === "move" && preview.ids.has(clip.id)) {
      position += preview.dx;
      index += preview.dTracks;
    } else if (preview?.kind === "trim" && preview.id === clip.id) {
      position = preview.position;
      start = preview.start;
      finish = preview.end;
    }
    return { left: position * pps, width: (finish - start) * pps, top: index * trackHeight + PAD, height: trackHeight - PAD * 2 };
  };

  const transitionGeometry = (t: Transition): ClipGeometry => {
    let position = t.position;
    let start = t.start;
    let finish = t.end;
    let index = trackIndex.get(t.layer) ?? 0;
    if (preview?.kind === "move" && preview.ids.has(t.id)) {
      position += preview.dx;
      index += preview.dTracks;
    } else if (preview?.kind === "trim" && preview.id === t.id) {
      position = preview.position;
      start = preview.start;
      finish = preview.end;
    }
    const top = index * trackHeight + PAD + Math.round((trackHeight - PAD * 2) * 0.28);
    return { left: position * pps, width: (finish - start) * pps, top, height: Math.round((trackHeight - PAD * 2) * 0.72) };
  };

  const renderFrom = Math.max(0, view.left - view.width);
  const renderTo = view.left + view.width * 2;
  const visibleClips = project.clips.filter((c) => {
    const g = clipGeometry(c);
    return g.left + g.width >= renderFrom && g.left <= renderTo;
  });
  const visibleTransitions = project.effects.filter((t) => {
    const g = transitionGeometry(t);
    return g.left + g.width >= renderFrom && g.left <= renderTo;
  });

  // ---------------------------------------------------------------------------
  // Pointer helpers
  // ---------------------------------------------------------------------------

  const toContent = (clientX: number, clientY: number) => {
    const el = viewport.current!;
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left + el.scrollLeft, y: clientY - rect.top + el.scrollTop };
  };

  const snapSettings = (ignore: Iterable<string>, invert: boolean): SnapSettings | null => {
    if (session.ui.getState().snapping === invert) return null;
    return {
      targets: snapTargets(session.project, { ignoreIds: ignore, playhead: session.playback.getState().time }),
      tolerance: snapToleranceSeconds(session.ui.getState().pxPerSecond),
    };
  };

  const showSnap = (seconds: number | null, rowTop = 0, rowHeight = height) => {
    const line = snapLine.current;
    if (!line) return;
    if (seconds === null) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.transform = `translateX(${seconds * session.ui.getState().pxPerSecond}px)`;
    line.style.top = `${rowTop}px`;
    line.style.height = `${rowHeight}px`;
  };

  const showRazor = (seconds: number | null, row = 0) => {
    const line = razorLine.current;
    if (!line) return;
    if (seconds === null) {
      line.style.display = "none";
      return;
    }
    line.style.display = "block";
    line.style.transform = `translate(${seconds * session.ui.getState().pxPerSecond}px, ${row * trackHeight}px)`;
    line.style.height = `${trackHeight}px`;
  };

  const setSelection = (next: Selection) => session.ui.setState({ selection: next });

  const dragItemsFor = (sel: Selection): DragItem[] => {
    const p = session.project;
    const items: DragItem[] = [];
    for (const id of sel.clips) {
      const c = findClip(p, id);
      if (c && !locked.has(c.layer)) items.push({ id, kind: "clip", position: c.position, duration: c.end - c.start, trackIndex: trackIndex.get(c.layer) ?? 0 });
    }
    for (const id of sel.transitions) {
      const t = findTransition(p, id);
      if (t && !locked.has(t.layer)) items.push({ id, kind: "transition", position: t.position, duration: t.end - t.start, trackIndex: trackIndex.get(t.layer) ?? 0 });
    }
    return items;
  };

  const razorAt = (clientX: number, invert: boolean): number => {
    const { x } = toContent(clientX, 0);
    let t = Math.max(0, x / pps);
    const snap = snapSettings([], invert);
    if (snap) {
      for (const target of snap.targets) if (Math.abs(target.seconds - t) <= snap.tolerance) t = target.seconds;
    }
    return snapToFrame(t, fps);
  };

  // ---------------------------------------------------------------------------
  // Gestures
  // ---------------------------------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = viewport.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const { x, y } = toContent(e.clientX, e.clientY);
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-kind]");
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const current = session.ui.getState().selection;

    if (hit && (hit.dataset.kind === "clip" || hit.dataset.kind === "transition")) {
      const kind = hit.dataset.kind;
      const id = hit.dataset.id!;
      if (session.ui.getState().tool === "razor" && kind === "clip") {
        const t = razorAt(e.clientX, e.altKey);
        const allClips = e.shiftKey;
        session.edit(allClips ? "Slice all" : "Slice", (tx) => {
          const ids = allClips ? tx.project.clips.filter((c) => c.position < t && itemEnd(c) > t).map((c) => c.id) : [id];
          return ids.map((cid) => splitClip(tx, cid, t, "both"));
        });
        return;
      }
      const listKey = kind === "clip" ? "clips" : "transitions";
      let sel = current;
      if (additive) {
        sel = clickSelect(current, kind, id, true);
        setSelection(sel);
        if (!sel[listKey].includes(id)) return;
      } else if (!current[listKey].includes(id)) {
        sel = clickSelect(current, kind, id, false);
        setSelection(sel);
      }
      const item = kind === "clip" ? findClip(session.project, id) : findTransition(session.project, id);
      if (!item || locked.has(item.layer)) return;
      const left = item.position * pps;
      const right = left + (item.end - item.start) * pps;
      const edge = edgeAt(x, left, right);
      el.setPointerCapture(e.pointerId);
      if (edge) {
        const file = kind === "clip" ? files.get((item as Clip).file_id) : undefined;
        const still = !file || file.has_single_image || mediaTypeOf(file) === "image";
        const mediaDuration = kind === "clip" && !still ? Number(file?.duration ?? (item as Clip).duration ?? NaN) : NaN;
        gesture.current = {
          kind: "trim",
          x0: x,
          itemKind: kind,
          id,
          edge,
          subject: { position: item.position, start: item.start, end: item.end, mediaDuration: Number.isFinite(mediaDuration) ? mediaDuration : null },
          edgeTime0: edge === "left" ? item.position : itemEnd(item),
          snap: snapSettings([id], e.altKey),
          last: null,
        };
      } else {
        gesture.current = { kind: "pending-move", x0: x, y0: y, items: dragItemsFor(sel), invertSnap: e.altKey };
      }
      return;
    }

    if (session.ui.getState().tool === "razor") return;
    el.setPointerCapture(e.pointerId);
    gesture.current = { kind: "marquee", x0: x, y0: y, base: additive ? current : EMPTY_SELECTION, moved: false };
  };

  const runMove = (clientX: number, clientY: number, shift: boolean) => {
    const g = gesture.current;
    if (!g) return;
    const { x, y } = toContent(clientX, clientY);
    if (g.kind === "pending-move") {
      if (Math.hypot(x - g.x0, y - g.y0) < 4 || g.items.length === 0) return;
      gesture.current = { kind: "move", x0: g.x0, y0: g.y0, items: g.items, snap: snapSettings(g.items.map((i) => i.id), g.invertSnap), last: { dx: 0, dTracks: 0, snapAt: null } };
      runMove(clientX, clientY, shift);
      return;
    }
    if (g.kind === "move") {
      const result = computeMove(g.items, (x - g.x0) / pps, (y - g.y0) / trackHeight, tracks.length, g.snap);
      g.last = result;
      setPreview({ kind: "move", ids: new Set(g.items.map((i) => i.id)), dx: result.dx, dTracks: result.dTracks });
      showSnap(result.snapAt);
      return;
    }
    if (g.kind === "trim") {
      const result = computeTrim(g.subject, g.edge, g.edgeTime0 + (x - g.x0) / pps, frameDuration(fps), g.snap);
      g.last = result;
      setPreview({ kind: "trim", id: g.id, position: result.position, start: result.start, end: result.end });
      showSnap(result.snapAt);
      return;
    }
    if (g.kind === "marquee") {
      if (!g.moved && Math.hypot(x - g.x0, y - g.y0) < 4) return;
      g.moved = true;
      const rect = { x0: g.x0, y0: g.y0, x1: x, y1: y };
      setMarquee(rect);
      const boxes: Box[] = [
        ...session.project.clips.map((c) => {
          const top = (trackIndex.get(c.layer) ?? 0) * trackHeight;
          return { id: c.id, kind: "clip" as const, left: c.position * pps, right: itemEnd(c) * pps, top, bottom: top + trackHeight };
        }),
        ...session.project.effects.map((t) => {
          const top = (trackIndex.get(t.layer) ?? 0) * trackHeight;
          return { id: t.id, kind: "transition" as const, left: t.position * pps, right: itemEnd(t) * pps, top, bottom: top + trackHeight };
        }),
      ];
      const hits = marqueeHits(rect, boxes);
      const base = g.base;
      setSelection({
        ...EMPTY_SELECTION,
        clips: [...new Set([...base.clips, ...hits.clips])],
        transitions: [...new Set([...base.transitions, ...hits.transitions])],
      });
      return;
    }
    if (g.kind === "marker") {
      const t = Math.max(0, g.position0 + (x - g.x0) / pps);
      g.moved = g.moved || Math.abs(x - g.x0) > 3;
      g.last = snapToFrame(t, fps);
      const pin = rulerLayer.current?.querySelector<HTMLElement>(`[data-id="${g.id}"]`);
      if (pin) pin.style.left = `${g.last * pps}px`;
    }
  };

  const autoScroll = () => {
    cancelAnimationFrame(autoScrollRaf.current);
    const step = () => {
      const el = viewport.current;
      const p = pointer.current;
      const g = gesture.current;
      if (!el || !p || !g || g.kind === "pending-move") return;
      const rect = el.getBoundingClientRect();
      const edge = 36;
      let dx = 0;
      if (p.clientX < rect.left + edge) dx = -Math.ceil((rect.left + edge - p.clientX) / 3);
      else if (p.clientX > rect.right - edge) dx = Math.ceil((p.clientX - (rect.right - edge)) / 3);
      if (dx !== 0) {
        el.scrollLeft = Math.max(0, el.scrollLeft + dx);
        runMove(p.clientX, p.clientY, p.shift);
        autoScrollRaf.current = requestAnimationFrame(step);
      }
    };
    autoScrollRaf.current = requestAnimationFrame(step);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointer.current = { clientX: e.clientX, clientY: e.clientY, shift: e.shiftKey };
    const el = viewport.current;
    if (!el) return;
    if (!gesture.current) {
      // Hover feedback: trim cursor on edges, razor line.
      const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-kind]");
      const razor = session.ui.getState().tool === "razor";
      if (razor) {
        const { y } = toContent(e.clientX, e.clientY);
        const row = trackIndexAt(y, trackHeight, tracks.length);
        showRazor(hit?.dataset.kind === "clip" && row >= 0 ? razorAt(e.clientX, e.altKey) : null, row);
        el.style.cursor = hit?.dataset.kind === "clip" ? "crosshair" : "default";
        return;
      }
      if (hit && (hit.dataset.kind === "clip" || hit.dataset.kind === "transition")) {
        const item = hit.dataset.kind === "clip" ? findClip(session.project, hit.dataset.id!) : findTransition(session.project, hit.dataset.id!);
        const { x } = toContent(e.clientX, e.clientY);
        const edge = item && !locked.has(item.layer) ? edgeAt(x, item.position * pps, itemEnd(item) * pps) : null;
        el.style.cursor = edge ? "ew-resize" : "default";
      } else {
        el.style.cursor = "default";
      }
      return;
    }
    runMove(e.clientX, e.clientY, e.shiftKey);
    autoScroll();
  };

  const finish = (commit: boolean) => {
    cancelAnimationFrame(autoScrollRaf.current);
    const g = gesture.current;
    gesture.current = null;
    setPreview(null);
    setMarquee(null);
    showSnap(null);
    if (!g || !commit) return;
    if (g.kind === "move" && (g.last.dx !== 0 || g.last.dTracks !== 0)) {
      const { dx, dTracks } = g.last;
      const count = g.items.length;
      session.edit(count === 1 ? (g.items[0]!.kind === "clip" ? "Move clip" : "Move transition") : `Move ${count} items`, (tx) => {
        for (const item of g.items) {
          const layer = tracks[item.trackIndex + dTracks]?.number;
          const to = { position: Math.max(0, item.position + dx), ...(dTracks !== 0 && layer !== undefined ? { layer } : {}) };
          if (item.kind === "clip") moveClip(tx, item.id, to);
          else moveTransition(tx, item.id, to);
        }
      });
    } else if (g.kind === "trim" && g.last) {
      const { time } = g.last;
      if (Math.abs(time - g.edgeTime0) > 1e-9) {
        session.edit(g.itemKind === "clip" ? "Trim clip" : "Trim transition", (tx) =>
          g.itemKind === "clip" ? trimClipEdge(tx, g.id, g.edge, time) : trimTransition(tx, g.id, g.edge, time),
        );
      }
    } else if (g.kind === "marquee" && !g.moved) {
      setSelection(g.base);
    } else if (g.kind === "marker") {
      if (g.moved) session.edit("Move marker", (tx) => moveMarker(tx, g.id, g.last));
      else session.seek(g.position0);
    }
  };

  // Escape cancels a drag in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gesture.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    if (tool !== "razor") showRazor(null);
  }, [tool]);

  // ---------------------------------------------------------------------------
  // Drag and drop
  // ---------------------------------------------------------------------------

  const dropTarget = (e: DragEvent) => {
    const { x, y } = toContent(e.clientX, e.clientY);
    const row = trackIndexAt(y, trackHeight, tracks.length);
    const time = Math.max(0, x / pps);
    return { x, y, row: row < 0 ? tracks.length - 1 : row, time };
  };

  const clipUnder = (e: DragEvent): Clip | undefined => {
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-kind="clip"]');
    return hit ? findClip(session.project, hit.dataset.id!) : undefined;
  };

  const snapDropTime = (time: number, duration: number): number => {
    const snap = snapSettings([], false);
    if (!snap) return snapToFrame(time, fps);
    const r = computeMove([{ id: "_drop", kind: "clip", position: time, duration, trackIndex: 0 }], 0, 0, 1, snap);
    return snapToFrame(time + r.dx, fps);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const payload = activeDrag();
    if (!isEditorDrag(e) && !isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const target = dropTarget(e);
    if (payload?.kind === "effect") {
      const clip = clipUnder(e);
      setDrop(clip ? { kind: "effect", clipId: clip.id } : null);
      return;
    }
    if (payload?.kind === "transition") {
      const left = snapDropTime(target.time, TRANSITION_SECONDS);
      setDrop({ kind: "transition", left: left * pps, width: TRANSITION_SECONDS * pps, trackIndex: target.row, label: payload.name });
      return;
    }
    const duration = payload?.kind === "files" ? payload.durations.reduce((a, b) => a + b, 0) : 5;
    const at = snapDropTime(target.time, duration);
    const label = payload?.kind === "files" ? (payload.fileIds.length > 1 ? `${payload.fileIds.length} clips` : fileDisplayName(files.get(payload.fileIds[0]!) ?? { path: "Clip" })) : "Import and add";
    setDrop({ kind: "clip", left: at * pps, width: Math.max(24, duration * pps), trackIndex: target.row, label });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const payload = readDrop(e);
    const target = dropTarget(e);
    setDrop(null);
    endDrag();
    const layer = tracks[target.row]?.number;
    if (layer === undefined) return;
    if (!payload && e.dataTransfer.files.length) {
      const at = snapDropTime(target.time, 5);
      void importMedia(session, [...e.dataTransfer.files], { position: at, layer });
      return;
    }
    if (!payload) return;
    if (payload.kind === "files") {
      const at = snapDropTime(target.time, payload.durations.reduce((a, b) => a + b, 0));
      const added = session.edit(payload.fileIds.length > 1 ? `Add ${payload.fileIds.length} clips` : "Add to timeline", (tx) => {
        let cursor = at;
        return payload.fileIds.map((fileId) => {
          const clip = addClip(tx, { fileId, position: cursor, layer });
          cursor = itemEnd(clip);
          return clip.id;
        });
      });
      if (added) setSelection({ ...EMPTY_SELECTION, clips: added });
      return;
    }
    if (payload.kind === "effect") {
      const clip = clipUnder(e);
      if (!clip) return;
      const effect = session.edit(`Add ${payload.name}`, (tx) => addEffect(tx, clip.id, payload.className));
      if (effect) session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: [clip.id], effect: effect.id }, rightTab: "properties" });
      return;
    }
    dropTransition(payload, target.time, layer, e);
  };

  const dropTransition = (payload: Extract<DragPayload, { kind: "transition" }>, time: number, layer: number, e: DragEvent) => {
    const p = session.project;
    const onTrack = p.clips.filter((c) => c.layer === layer).sort((a, b) => a.position - b.position);
    const tolerance = CUT_SNAP_PX / pps;
    // Near a cut between two clips on this track: overlap them with the transition.
    for (let i = 0; i < onTrack.length - 1; i += 1) {
      const a = onTrack[i]!;
      const b = onTrack[i + 1]!;
      if (Math.abs(itemEnd(a) - time) <= tolerance || (b.position <= time + tolerance && itemEnd(a) >= time - tolerance && b.position < itemEnd(a))) {
        const result = session.edit(`Add ${payload.name}`, (tx) => applyTransitionBetween(tx, a.id, b.id, payload.maskId, TRANSITION_SECONDS));
        if (result) setSelection({ ...EMPTY_SELECTION, transitions: [result.transition.id] });
        return;
      }
    }
    const clip = clipUnder(e);
    if (clip && clip.layer === layer) {
      const placement = time - clip.position < (clip.end - clip.start) / 2 ? "start" : "end";
      const duration = Math.min(TRANSITION_SECONDS, (clip.end - clip.start) / 2);
      const t = session.edit(`Add ${payload.name}`, (tx) => applyTransitionToClip(tx, clip.id, payload.maskId, placement, duration));
      if (t) setSelection({ ...EMPTY_SELECTION, transitions: [t.id] });
      return;
    }
    const t = session.edit(`Add ${payload.name}`, (tx) =>
      addTransition(tx, { layer, position: snapDropTime(time, TRANSITION_SECONDS), duration: TRANSITION_SECONDS, maskId: payload.maskId }),
    );
    if (t) setSelection({ ...EMPTY_SELECTION, transitions: [t.id] });
  };

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------

  const onContextMenuCapture = (e: ReactMouseEvent) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-kind]");
    const current = session.ui.getState().selection;
    if (hit && (hit.dataset.kind === "clip" || hit.dataset.kind === "transition" || hit.dataset.kind === "marker")) {
      const kind = hit.dataset.kind;
      const id = hit.dataset.id!;
      menuTarget.current = { kind, id };
      const key = kind === "clip" ? "clips" : kind === "transition" ? "transitions" : "markers";
      if (!current[key].includes(id)) setSelection(clickSelect(current, kind, id, false));
    } else {
      menuTarget.current = { kind: "empty" };
    }
  };

  const menuItems = (): MenuSpec[] => {
    const target = menuTarget.current;
    const sel = session.ui.getState().selection;
    if (target.kind === "clip") return clipMenu(session, commands, sel.clips.includes(target.id) ? sel.clips : [target.id]);
    if (target.kind === "transition") return transitionMenu(session, commands, sel.transitions.includes(target.id) ? sel.transitions : [target.id]);
    if (target.kind === "marker") return markerMenu(session, commands, target.id);
    return emptyAreaMenu(commands);
  };

  // ---------------------------------------------------------------------------

  const onMarkerPointerDown = (marker: Marker, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    setSelection({ ...EMPTY_SELECTION, markers: [marker.id] });
    const { x } = toContent(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "marker", id: marker.id, x0: x, position0: marker.position, moved: false, last: marker.position };
    const onMove = (ev: PointerEvent) => runMove(ev.clientX, ev.clientY, ev.shiftKey);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      finish(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const empty = project.clips.length === 0 && project.effects.length === 0;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Track headers */}
      <div className="flex shrink-0 flex-col border-r border-line bg-raised" style={{ width: HEADER_WIDTH }}>
        <div className="flex shrink-0 items-center border-b border-line px-3 text-2xs font-medium uppercase tracking-wider text-fg-faint" style={{ height: RULER_HEIGHT }}>
          Tracks
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <TrackHeaders ref={headers} tracks={tracks} trackHeight={trackHeight} />
        </div>
      </div>

      {/* Ruler + tracks */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Ruler
          ref={ruler}
          pxPerSecond={pps}
          fps={fps}
          markers={project.markers}
          selectedMarkers={selection.markers}
          width={view.width}
          contentWidth={width}
          headRef={rulerHead}
          layerRef={rulerLayer}
          onScrubStart={(t) => {
            session.pause();
            session.seek(snapToFrame(t, fps));
          }}
          onScrub={(t) => session.seek(snapToFrame(t, fps))}
          onScrubEnd={() => undefined}
          onMarkerPointerDown={onMarkerPointerDown}
          onMarkerContextMenu={(m) => setSelection({ ...EMPTY_SELECTION, markers: [m.id] })}
        />
        <ContextMenu items={menuItems}>
          <div
            ref={viewport}
            tabIndex={0}
            aria-label="Timeline tracks"
            className="relative min-h-0 flex-1 overflow-auto outline-none"
            onScroll={syncScroll}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => finish(true)}
            onPointerCancel={() => finish(false)}
            onPointerLeave={() => showRazor(null)}
            onDoubleClick={(e) => {
              const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-kind="clip"]');
              if (hit) session.ui.setState({ rightTab: "properties", panels: { ...session.ui.getState().panels, rightCollapsed: false } });
            }}
            onContextMenuCapture={onContextMenuCapture}
            onDragOver={onDragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
            }}
            onDrop={onDrop}
          >
            <div className="relative" style={{ width, height }}>
              {/* Track rows */}
              {tracks.map((layer, index) => (
                <div
                  key={layer.id}
                  aria-hidden
                  className={cn("absolute inset-x-0 border-b border-line", index % 2 ? "bg-track-alt" : "bg-track", layer.lock && "bg-[repeating-linear-gradient(135deg,transparent_0_8px,rgba(255,255,255,0.025)_8px_16px)]")}
                  style={{ top: index * trackHeight, height: trackHeight }}
                />
              ))}
              {/* Marker lines */}
              {project.markers.map((m) => (
                <div key={m.id} aria-hidden className="pointer-events-none absolute top-0 w-px bg-white/10" style={{ left: m.position * pps, height }} />
              ))}
              {/* Clips */}
              {visibleClips.map((clip) => {
                const geometry = clipGeometry(clip);
                const file = files.get(clip.file_id);
                const mediaType = mediaTypeOf(file);
                const status = mediaStatus[clip.file_id]?.status;
                const visibleFrom = Math.max(0, view.left - view.width / 2 - geometry.left);
                const visibleTo = Math.min(geometry.width, view.left + view.width * 1.5 - geometry.left);
                return (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    geometry={geometry}
                    mediaType={mediaType}
                    title={(typeof clip.title === "string" && clip.title) || (file ? fileDisplayName(file) : "Missing file")}
                    selected={selection.clips.includes(clip.id) || (drop?.kind === "effect" && drop.clipId === clip.id)}
                    locked={locked.has(clip.layer)}
                    missing={!file || status === "missing" || status === "error"}
                    dragging={preview?.kind === "move" && preview.ids.has(clip.id)}
                    visibleFrom={Math.floor(visibleFrom / 64) * 64}
                    visibleTo={Math.ceil(visibleTo / 64) * 64}
                    pxPerSecond={pps}
                    fileId={clip.file_id}
                    hasAudio={Boolean(file?.has_audio) && mediaType !== "image"}
                  />
                );
              })}
              {/* Transitions */}
              {visibleTransitions.map((t) => (
                <TransitionView
                  key={t.id}
                  transition={t}
                  geometry={transitionGeometry(t)}
                  selected={selection.transitions.includes(t.id)}
                  dragging={preview?.kind === "move" && preview.ids.has(t.id)}
                />
              ))}
              {/* Drop preview */}
              {drop && drop.kind !== "effect" ? (
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute z-[5] flex items-center overflow-hidden rounded-[4px] border-[1.5px] border-dashed px-2 text-[11px] font-medium text-white/90",
                    drop.kind === "transition" ? "border-white/70 bg-white/15" : "border-accent bg-accent/20",
                  )}
                  style={{ left: drop.left, width: drop.width, top: drop.trackIndex * trackHeight + PAD, height: trackHeight - PAD * 2 }}
                >
                  <span className="truncate">{drop.label}</span>
                </div>
              ) : null}
              {/* Marquee */}
              {marquee ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute z-[7] rounded-[2px] border border-accent/80 bg-accent/10"
                  style={(() => {
                    const r = normalizeRect(marquee);
                    return { left: r.x0, top: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 };
                  })()}
                />
              ) : null}
              {/* Snap and razor lines, playhead */}
              <div ref={snapLine} aria-hidden className="pointer-events-none absolute left-0 top-0 z-[8] hidden w-px bg-snap shadow-[0_0_6px_rgba(255,212,59,0.7)]" />
              <div ref={razorLine} aria-hidden className="pointer-events-none absolute left-0 top-0 z-[8] hidden w-px bg-razor" />
              <div ref={playheadLine} aria-hidden className="pointer-events-none absolute left-0 top-0 z-[9] w-px bg-playhead will-change-transform" style={{ height }} />
            </div>
            {empty ? <EmptyTimeline onImport={() => session.views.pickMedia?.()} /> : null}
          </div>
        </ContextMenu>
      </div>
    </div>
  );
}

function EmptyTimeline({ onImport }: { onImport: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-base/80 px-8 py-6 text-center backdrop-blur-sm">
        <Upload size={20} className="text-fg-subtle" />
        <div>
          <p className="text-md text-fg-muted">Drag media here to start editing</p>
          <p className="mt-0.5 text-xs text-fg-subtle">From Project Files, or straight from your computer.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onImport}>
          Import media
        </Button>
      </div>
    </div>
  );
}
