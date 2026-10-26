import { resolveEase, type BlockContext } from "../../runtime/index.js";
import { ICONS, onColor } from "../ui.js";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * A drawn editor screen (media bin, preview, timeline, export button) in
 * fractions of `area`; returns the boxes the pointer can land on.
 */
function mockScreen(ctx: BlockContext, stage: HTMLElement, area: Box): Box[] {
  const { palette } = ctx;
  const mock = ctx.el("div", "cp-mock", stage);
  const targets: Box[] = [];
  const at = (x0: number, y0: number, x1: number, y1: number): Box => ({ x: area.x + x0 * area.w, y: area.y + y0 * area.h, w: (x1 - x0) * area.w, h: (y1 - y0) * area.h });
  const place = (el: HTMLElement, b: Box): HTMLElement => {
    Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    return el;
  };
  const unit = Math.min(ctx.width, ctx.height) / 1080;
  const head = ctx.el("div", "cp-head", mock, "Spring promo");
  Object.assign(head.style, { left: `${area.x + 0.05 * area.w}px`, top: `${area.y + 0.062 * area.h}px`, fontSize: `${40 * unit}px` });
  const btnBox = at(0.78, 0.06, 0.94, 0.11);
  const btn = place(ctx.el("div", "cp-btn", mock, "Export"), btnBox);
  Object.assign(btn.style, { color: onColor(palette.accent), fontSize: `${28 * unit}px` });
  targets.push(btnBox);

  place(ctx.el("div", "cp-box", mock), at(0.04, 0.14, 0.3, 0.62));
  const tints = [palette.accent, palette.secondary, palette.muted, palette.secondary, palette.accent, palette.muted];
  const rows: [number, number][] = [[0.165, 0.295], [0.31, 0.44], [0.455, 0.585]];
  rows.forEach(([y0, y1], r) =>
    [[0.055, 0.165], [0.175, 0.285]].forEach(([x0, x1], c) => {
      const b = at(x0!, y0, x1!, y1);
      const tile = place(ctx.el("div", "cp-tile", mock), b);
      tile.style.background = `color-mix(in srgb, ${tints[r * 2 + c]} ${30 + ((r + c) % 3) * 18}%, ${palette.surface})`;
      targets.push(b);
    }),
  );
  const preview = place(ctx.el("div", "cp-preview", mock), at(0.33, 0.14, 0.96, 0.62));
  // A still in the preview: a low sun over a ridge, our own drawing.
  ctx.el("div", "cp-sky", preview);
  ctx.el("div", "cp-sun", preview);
  ctx.el("div", "cp-ridge", preview);
  const code = ctx.el("div", "cp-timecode", preview, "00:00:12:08");
  code.style.fontSize = `${22 * unit}px`;
  const play = ctx.el("div", "cp-play", preview);
  const s = 34 * unit;
  Object.assign(play.style, { borderWidth: `${s}px 0 ${s}px ${s * 1.6}px`, marginLeft: `${-s * 0.6}px`, marginTop: `${-s}px` });

  place(ctx.el("div", "cp-box", mock), at(0.04, 0.66, 0.96, 0.95));
  const tracks: [number, number, [number, number][], string][] = [
    [0.7, 0.76, [[0.07, 0.3], [0.31, 0.52], [0.53, 0.8]], palette.secondary],
    [0.78, 0.84, [[0.07, 0.4], [0.42, 0.7], [0.71, 0.93]], palette.accent],
    [0.86, 0.92, [[0.07, 0.93]], palette.muted],
  ];
  tracks.forEach(([y0, y1, clips, fill], k) =>
    clips.forEach(([x0, x1], i) => {
      const b = at(x0, y0, x1, y1);
      const clip = place(ctx.el("div", "cp-clip", mock), b);
      clip.style.background = `color-mix(in srgb, ${fill} ${k === 2 ? 28 : 55 + (i % 2) * 20}%, ${palette.surface})`;
      targets.push(b);
    }),
  );
  place(ctx.el("div", "cp-playhead", mock), at(0.45, 0.68, 0.452, 0.94));
  return targets;
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H } = ctx;
  const given = p.points as Pt[];
  const labels = p.labels as string[];
  const zoom = Number(p.zoom);
  const S = ctx.seconds;

  const stage = ctx.el("div", "cp-stage");
  Object.assign(stage.style, { width: `${W}px`, height: `${H}px` });
  const bg = ctx.mediaImg("background", "cp-bg", stage);
  // The drawn screen keeps clear of a vertical frame's status bar and caption zone.
  const area: Box = ctx.portrait ? { x: 0, y: H * 0.1, w: W, h: H * 0.72 } : { x: 0, y: 0, w: W, h: H };
  const targets = bg ? [] : mockScreen(ctx, stage, area);
  const space = bg ? { x: 0, y: 0, w: W, h: H } : area;
  const stops = given.map((pt) => ({ x: space.x + pt.x * space.w, y: space.y + pt.y * space.h }));

  // The hover outline: the drawn target under the stop, else a box of `target` px.
  const tw = Number(p.target);
  const boxes = stops.map((s) => {
    const hit = targets.filter((b) => s.x >= b.x && s.x <= b.x + b.w && s.y >= b.y && s.y <= b.y + b.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    return hit ? { x: hit.x - 10, y: hit.y - 10, w: hit.w + 20, h: hit.h + 20 } : { x: s.x - tw / 2, y: s.y - tw * 0.32, w: tw, h: tw * 0.64 };
  });

  // Path timing: moves take longer the further they go; the dwell fills the rest.
  const start: Pt = { x: W * 0.92, y: H * 0.96 };
  const moves = stops.map((s, i) => {
    const from = i === 0 ? start : stops[i - 1]!;
    return Math.min(0.95, Math.max(0.5, 0.45 + Math.hypot(s.x - from.x, s.y - from.y) / 2600));
  });
  const enter = 0.3;
  const tail = 0.9 + (p.exit === false ? 0 : 0.4);
  const dwell = Math.min(1.6, Math.max(0.55, (S - enter - moves.reduce((a, b) => a + b, 0) - tail) / stops.length));
  const moveAt: number[] = [];
  let t0 = enter;
  stops.forEach((_, i) => {
    moveAt.push(t0);
    t0 += moves[i]! + dwell;
  });
  const arrive = moveAt.map((m, i) => m + moves[i]!);

  // Hover outlines, ripples and labels, inside the stage so they ride the camera.
  const tipSize = 32;
  stops.forEach((s, i) => {
    const b = boxes[i]!;
    const hover = ctx.el("div", "cp-hover", stage);
    Object.assign(hover.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    const leave = i + 1 < stops.length ? moveAt[i + 1]! + 0.12 : Infinity;
    tl.fromTo(hover, { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1 }, { at: arrive[i]! - 0.12, duration: 0.35, ease: "out" });
    if (Number.isFinite(leave)) tl.to(hover, { opacity: 0, scale: 0.98 }, { at: leave, duration: 0.25, ease: "exit" });
    if (p.clicks !== false) {
      const ring = ctx.el("div", "cp-ring", stage);
      const r = 60;
      Object.assign(ring.style, { left: `${s.x - r}px`, top: `${s.y - r}px`, width: `${r * 2}px`, height: `${r * 2}px` });
      tl.set(ring, { opacity: 0 }, 0);
      tl.fromTo(ring, { scale: 0.2, opacity: 0.95 }, { scale: 1.5, opacity: 0 }, { at: arrive[i]! + 0.18, duration: 0.55, ease: "out" });
    }
    const label = labels[i];
    if (label) {
      const tip = ctx.el("div", "cp-tip", stage, label);
      tip.style.fontSize = `${tipSize}px`;
      const r = tip.getBoundingClientRect();
      const right = b.x + b.w + 22;
      const left = b.x - 22 - r.width;
      const x = right + r.width <= W - 40 ? right : left >= 40 ? left : Math.max(40, Math.min(W - 40 - r.width, s.x - r.width / 2));
      const y = x === right || x === left ? b.y + b.h / 2 - r.height / 2 : b.y + b.h + 22 + r.height > H - 40 ? b.y - 22 - r.height : b.y + b.h + 22;
      Object.assign(tip.style, { left: `${x}px`, top: `${Math.max(40, y)}px` });
      tl.fromTo(tip, { opacity: 0, y: 14, scale: 0.96 }, { opacity: 1, y: 0, scale: 1 }, { at: arrive[i]! + 0.22, duration: 0.4, ease: "out" });
      if (Number.isFinite(leave)) tl.to(tip, { opacity: 0, y: -8 }, { at: leave, duration: 0.25, ease: "exit" });
    }
  });

  // The pointer: on curved paths (each bends the same way), pressing at each stop.
  const size = 88 * Number(p.cursor_size);
  const cursor = ctx.el("div", "cursor", stage);
  cursor.innerHTML = ICONS.pointer;
  Object.assign(cursor.style, { width: `${size}px`, height: `${size}px` });
  const tipX = (size * 6) / 28;
  const tipY = (size * 3.5) / 28;
  const ease = resolveEase("in-out");
  const curve = stops.map((s, i) => {
    const a = i === 0 ? start : stops[i - 1]!;
    const dx = s.x - a.x;
    const dy = s.y - a.y;
    return { a, b: s, c: { x: (a.x + s.x) / 2 - dy * 0.18, y: (a.y + s.y) / 2 + dx * 0.18 } };
  });
  tl.track((t) => {
    let pos = start;
    for (let i = 0; i < curve.length; i += 1) {
      if (t < moveAt[i]!) break;
      const u = ease(Math.min(1, (t - moveAt[i]!) / moves[i]!));
      const { a, b, c } = curve[i]!;
      pos = { x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y };
    }
    cursor.style.left = `${(pos.x - tipX).toFixed(2)}px`;
    cursor.style.top = `${(pos.y - tipY).toFixed(2)}px`;
  });
  tl.fromTo(cursor, { opacity: 0 }, { opacity: 1 }, { at: enter - 0.2, duration: 0.3, ease: "linear" });
  if (p.clicks !== false) {
    arrive.forEach((a) => {
      tl.to(cursor, { scale: 0.86 }, { at: a + 0.12, duration: 0.08, ease: "out" });
      tl.to(cursor, { scale: 1 }, { at: a + 0.2, duration: 0.25, ease: "out" });
    });
  }

  // The camera leans in toward each stop as the pointer heads there, never showing past the frame's edge.
  if (zoom > 1.001) {
    const lean = 0.45;
    stops.forEach((s, i) => {
      const sx = s.x + (W / 2 - s.x) * lean;
      const sy = s.y + (H / 2 - s.y) * lean;
      const x = Math.min(0, Math.max(W - W * zoom, sx - s.x * zoom));
      const y = Math.min(0, Math.max(H - H * zoom, sy - s.y * zoom));
      tl.to(stage, { x, y, scale: zoom }, { at: moveAt[i]!, duration: moves[i]! + 0.35, ease: "in-out" });
    });
  }
}
