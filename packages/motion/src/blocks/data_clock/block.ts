import type { BlockContext } from "../../runtime/index.js";
import { fitWidth } from "../ui.js";
import { RAMPS, addSteps, formatDate, planClock, type DateFormat } from "./dates.js";

const START = 0.3;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const plan = planClock(p, ctx.seconds);
  // checkParams refuses bad dates and legends before a block is built.
  if ("error" in plan) throw new Error(plan.error);
  const style = String(p.style) as "band" | "ghost" | "badge";
  const format = String(p.format) as DateFormat;
  const reverse = p.reverse === true;
  const stampOf = (i: number): string => formatDate(addSteps(plan.start, plan.step, i), format, plan.step);
  /** Steps done at t, and the clock's progress 0..1 (the slider glides, the stamp steps). */
  const at = (t: number): { i: number; f: number } => {
    const f = clamp01(((t - START) * plan.rate) / plan.count);
    const done = Math.min(plan.count, Math.floor(Math.max(0, t - START) * plan.rate + 1e-9));
    return reverse ? { i: plan.count - done, f: 1 - f } : { i: done, f };
  };
  const widest = [stampOf(0), stampOf(plan.count)].sort((a, b) => b.length - a.length)[0]!;
  const contentW = W - safe.left - safe.right;

  const stamp = ctx.el("div", style === "band" ? "dc-stamp" : `dc-stamp dc-${style}`, ctx.root, widest);
  const label = p.label ? ctx.el("div", "dc-label", ctx.root, String(p.label)) : null;
  let slider: { fill: HTMLElement; knob: HTMLElement; w: number } | null = null;

  if (style === "ghost") {
    // A ghost stamp about a third of the frame tall, never wider than the safe area.
    fitWidth(stamp, [stamp], contentW, H * 0.35 * (ctx.portrait ? 0.5 : 1), 60);
    Object.assign(stamp.style, { left: `${safe.left}px`, bottom: `${safe.bottom}px` });
    tl.fromTo(stamp, { opacity: 0, y: 30 }, { opacity: 0.24, y: 0 }, { at: 0, duration: 0.6, ease: "out" });
    if (label) {
      Object.assign(label.style, { left: `${safe.left + 6}px`, bottom: `${safe.bottom + stamp.getBoundingClientRect().height + 16}px` });
      tl.fromTo(label, { opacity: 0 }, { opacity: 1 }, { at: 0.2, duration: 0.5, ease: "smooth" });
    }
  } else if (style === "badge") {
    Object.assign(stamp.style, { right: `${safe.right}px`, top: `${safe.top}px` });
    tl.fromTo(stamp, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1 }, { at: 0, duration: 0.45, ease: "back-out" });
    ctx.cue(0, "pop", { weight: 0.3, at: stamp });
    if (label) {
      Object.assign(label.style, { right: `${safe.right + 8}px`, top: `${safe.top + stamp.getBoundingClientRect().height + 12}px` });
      tl.fromTo(label, { opacity: 0 }, { opacity: 1 }, { at: 0.2, duration: 0.5, ease: "smooth" });
    }
  } else {
    // The band: about a tenth of the frame, legends at the left, the stamp at the right, the slider along its top.
    const bandH = Math.max(120, Math.round(Math.min(W, H) * 0.12));
    // Portrait: the whole band above the bottom safe margin, clear of the platform's controls.
    const lift = ctx.portrait ? safe.bottom : 0;
    const band = ctx.el("div", "dc-band");
    Object.assign(band.style, { height: `${bandH}px`, bottom: `${lift}px` });
    ctx.root.insertBefore(band, stamp);
    const mid = H - lift - bandH / 2;
    const size = Math.round(bandH * 0.34);
    Object.assign(stamp.style, { fontSize: `${size}px`, fontWeight: "600", lineHeight: "1", right: `${safe.right}px`, top: `${mid - size / 2 + 8}px` });
    if (label) Object.assign(label.style, { right: `${safe.right}px`, top: `${mid - bandH * 0.38}px`, fontSize: "20px" });
    const legendW = Math.min(300, (contentW * 0.6) / Math.max(1, plan.legends.length));
    plan.legends.forEach((lg, j) => {
      const box = ctx.el("div", "dc-legend");
      Object.assign(box.style, { left: `${safe.left + j * (legendW + 40)}px`, top: `${mid - 40}px`, width: `${legendW}px` });
      ctx.el("div", "dc-legend-label", box, lg.label);
      ctx.el("div", "dc-ramp", box).style.background = `linear-gradient(90deg, ${RAMPS[lg.ramp]!.join(", ")})`;
      const ends = ctx.el("div", "dc-ends", box);
      ctx.el("span", "", ends, lg.min);
      ctx.el("span", "", ends, lg.max);
      tl.fromTo(box, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, { at: 0.25 + j * 0.08, duration: 0.5, ease: "out" });
    });
    const track = ctx.el("div", "dc-track", band);
    const w = W - safe.left - safe.right;
    Object.assign(track.style, { left: `${safe.left}px`, width: `${w}px`, top: "-2px" });
    slider = { fill: ctx.el("div", "dc-fill", track), knob: ctx.el("div", "dc-knob", track), w };
    tl.fromTo(band, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1 }, { at: 0, duration: 0.55, ease: "out" });
    tl.fromTo(stamp, { opacity: 0 }, { opacity: 1 }, { at: 0.15, duration: 0.4, ease: "smooth" });
    if (label) tl.fromTo(label, { opacity: 0 }, { opacity: 1 }, { at: 0.2, duration: 0.4, ease: "smooth" });
    ctx.cue(0, "whoosh", { weight: 0.25 });
  }

  tl.track((t) => {
    const { i, f } = at(t);
    stamp.textContent = stampOf(i);
    if (slider) {
      slider.fill.style.width = `${(f * slider.w).toFixed(1)}px`;
      slider.knob.style.left = `${(f * slider.w).toFixed(1)}px`;
    }
  });
  // A tick per step, as long as the clock runs.
  const until = START + plan.count / plan.rate;
  ctx.cue(START, "tick", { weight: 0.15, at: stamp, until, rate: Math.min(20, plan.rate) });
}
