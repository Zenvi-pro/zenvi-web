/**
 * Transform handles on the preview (desktop video_widget.py): drag the
 * selected clip to move it, a corner to scale it, the top knob to rotate it.
 *
 * The box is the clip's real on-screen quad from the engine's frame planner,
 * so it matches what is drawn. Drags are inverted through the same planner
 * (a Newton step on the planned position), so no transform math lives here.
 */
import { clipFrameAtTime, evaluate, findClip, frameContaining, keyframeFrames, setClipProperty, type Clip, type KeyframeLike, type Project, type Transaction } from "@zenvi/engine";
import { planFrame, type LayerPlan } from "@zenvi/engine/render";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePlayback, useProject, useSession, useUi } from "../session/context";

type Point = { x: number; y: number };

function apply(m: readonly number[], p: Point): Point {
  return { x: m[0]! * p.x + m[2]! * p.y + m[4]!, y: m[1]! * p.x + m[3]! * p.y + m[5]! };
}

interface PlacedLayer {
  layer: LayerPlan;
  /** The planned canvas is centered in the preview box (letterbox offset). */
  offset: Point;
}

function quadOf({ layer, offset }: PlacedLayer): Point[] {
  const w = layer.drawWidth;
  const h = layer.drawHeight;
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map((p) => {
    const q = apply(layer.transform, p);
    return { x: q.x + offset.x, y: q.y + offset.y };
  });
}

function centerOf(q: Point[]): Point {
  return { x: (q[0]!.x + q[2]!.x) / 2, y: (q[0]!.y + q[2]!.y) / 2 };
}

function layerPlan(project: Project, clipId: string, frame: number, size: { width: number; height: number }): PlacedLayer | undefined {
  try {
    const plan = planFrame(project, frame, size, { preview: true });
    const layer = plan.layers.find((l) => l.clipId === clipId);
    if (!layer) return undefined;
    return { layer, offset: { x: (size.width - plan.width) / 2, y: (size.height - plan.height) / 2 } };
  } catch {
    return undefined;
  }
}

function withValues(project: Project, clipId: string, values: Record<string, number>): Project {
  return {
    ...project,
    clips: project.clips.map((c) =>
      c.id === clipId ? ({ ...c, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { Points: [{ co: { X: 1, Y: v }, interpolation: 1 }] }])) } as Clip) : c,
    ),
  };
}

type Drag =
  | { kind: "move"; start: Point; startCenter: Point; lx: number; ly: number }
  | { kind: "scale"; anchor: Point; startDist: Point; sx: number; sy: number; uniform: boolean }
  | { kind: "rotate"; center: Point; startAngle: number; r: number };

export function TransformOverlay({ width, height }: { width: number; height: number }) {
  const session = useSession();
  const project = useProject();
  const selection = useUi((s) => s.selection.clips);
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState(false);

  const clipId = selection.length === 1 ? selection[0]! : null;
  const clip = clipId ? findClip(project, clipId) : undefined;
  const frame = frameContaining(time, project.fps);
  const size = useMemo(() => ({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }), [width, height]);
  const plan = clip && !playing && clip.reader?.has_video !== false ? layerPlan(project, clip.id, frame, size) : undefined;
  if (!clip || !plan || width < 40) return null;

  const quad = quadOf(plan);
  const center = centerOf(quad);
  const top = { x: (quad[0]!.x + quad[1]!.x) / 2, y: (quad[0]!.y + quad[1]!.y) / 2 };
  const up = { x: top.x - center.x, y: top.y - center.y };
  const len = Math.hypot(up.x, up.y) || 1;
  const knob = { x: top.x + (up.x / len) * 22, y: top.y + (up.y / len) * 22 };
  const clipFrame = clipFrameAtTime(clip, time, project.fps);

  const value = (prop: string, fallback: number) => evaluate(clip[prop] as KeyframeLike, clipFrame, fallback);
  /** Animated (or armed) properties get a point at this frame; constants stay constant. */
  const at = (prop: string) => {
    const armed = session.ui.getState().armedKeyframes.includes(`${clip.id}:${prop}`);
    return armed || keyframeFrames(clip[prop] as KeyframeLike).length > 1 ? { frame: clipFrame } : {};
  };

  const local = (e: ReactPointerEvent): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * size.width, y: ((e.clientY - rect.top) / rect.height) * size.height };
  };

  /** Location values that put the clip's planned centre at `target` (Newton steps through the planner). */
  const solveLocation = (lx0: number, ly0: number, target: Point): { lx: number; ly: number } => {
    let lx = lx0;
    let ly = ly0;
    for (let i = 0; i < 3; i += 1) {
      const base = layerPlan(withValues(session.project, clip.id, { location_x: lx, location_y: ly }), clip.id, frame, size);
      const px = layerPlan(withValues(session.project, clip.id, { location_x: lx + 0.01, location_y: ly }), clip.id, frame, size);
      const py = layerPlan(withValues(session.project, clip.id, { location_x: lx, location_y: ly + 0.01 }), clip.id, frame, size);
      if (!base || !px || !py) break;
      const c = centerOf(quadOf(base));
      const dx = (centerOf(quadOf(px)).x - c.x) / 0.01;
      const dy = (centerOf(quadOf(py)).y - c.y) / 0.01;
      if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) break;
      const ex = target.x - c.x;
      const ey = target.y - c.y;
      if (Math.abs(ex) < 0.25 && Math.abs(ey) < 0.25) break;
      lx += ex / dx;
      ly += ey / dy;
    }
    return { lx, ly };
  };

  const writes = (e: ReactPointerEvent): Record<string, number> | null => {
    const d = drag.current;
    if (!d) return null;
    const p = local(e);
    if (d.kind === "move") {
      const target = { x: d.startCenter.x + (p.x - d.start.x), y: d.startCenter.y + (p.y - d.start.y) };
      const { lx, ly } = solveLocation(d.lx, d.ly, target);
      return { location_x: Math.round(lx * 10000) / 10000, location_y: Math.round(ly * 10000) / 10000 };
    }
    if (d.kind === "scale") {
      const fx = Math.abs(p.x - d.anchor.x) / Math.max(1, Math.abs(d.startDist.x));
      const fy = Math.abs(p.y - d.anchor.y) / Math.max(1, Math.abs(d.startDist.y));
      const k = d.uniform ? Math.max(0.01, (fx + fy) / 2) : 0;
      const sx = Math.max(0.01, d.sx * (d.uniform ? k : fx));
      const sy = Math.max(0.01, d.sy * (d.uniform ? k : fy));
      return { scale_x: Math.round(sx * 1000) / 1000, scale_y: Math.round(sy * 1000) / 1000 };
    }
    const angle = (Math.atan2(p.y - d.center.y, p.x - d.center.x) * 180) / Math.PI;
    let r = d.r + (angle - d.startAngle);
    if (e.shiftKey) r = Math.round(r / 15) * 15;
    return { rotation: Math.round(r * 10) / 10 };
  };

  const record = (values: Record<string, number>, commit: boolean) => {
    const body = (tx: Transaction) => {
      for (const [prop, v] of Object.entries(values)) setClipProperty(tx, clip.id, prop, v, at(prop));
    };
    if (commit) {
      const label = "rotation" in values ? "Rotate clip" : "scale_x" in values ? "Scale clip" : "Move clip in frame";
      session.edit(label, body);
    } else {
      session.preview(body);
    }
  };

  const begin = (e: ReactPointerEvent, next: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = next;
    setActive(true);
  };

  const onMove = (e: ReactPointerEvent) => {
    const values = writes(e);
    if (values) record(values, false);
  };

  const onUp = (e: ReactPointerEvent) => {
    const values = writes(e);
    drag.current = null;
    setActive(false);
    if (values) record(values, true);
    else session.endPreview();
  };

  const startMove = (e: ReactPointerEvent) => begin(e, { kind: "move", start: local(e), startCenter: center, lx: value("location_x", 0), ly: value("location_y", 0) });
  const startScale = (index: number) => (e: ReactPointerEvent) => {
    const opposite = quad[(index + 2) % 4]!;
    const corner = quad[index]!;
    const gravity = Number(clip.gravity ?? 4);
    const anchor = gravity === 4 ? center : opposite;
    begin(e, { kind: "scale", anchor, startDist: { x: corner.x - anchor.x, y: corner.y - anchor.y }, sx: value("scale_x", 1), sy: value("scale_y", 1), uniform: !e.shiftKey });
  };
  const startRotate = (e: ReactPointerEvent) => {
    const p = local(e);
    begin(e, { kind: "rotate", center, startAngle: (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI, r: value("rotation", 0) });
  };

  const points = quad.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      ref={svg}
      className="absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${size.width} ${size.height}`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
        session.endPreview();
      }}
      aria-label="Transform handles"
      role="group"
    >
      <polygon points={points} fill="transparent" stroke="var(--color-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="cursor-move" style={{ pointerEvents: "all" }} onPointerDown={startMove} />
      <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} stroke="var(--color-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      <circle cx={knob.x} cy={knob.y} r={5} fill="white" stroke="var(--color-accent)" strokeWidth={1.5} className="cursor-grab" onPointerDown={startRotate} />
      {quad.map((p, i) => (
        <rect
          key={i}
          x={p.x - 4.5}
          y={p.y - 4.5}
          width={9}
          height={9}
          rx={1.5}
          fill="white"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          className={i % 2 === 0 ? "cursor-nwse-resize" : "cursor-nesw-resize"}
          onPointerDown={startScale(i)}
        />
      ))}
      {active ? null : <circle cx={center.x} cy={center.y} r={2} fill="var(--color-accent)" pointerEvents="none" />}
    </svg>
  );
}
