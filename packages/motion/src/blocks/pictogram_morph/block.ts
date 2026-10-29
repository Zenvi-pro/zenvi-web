import { counter, formatNumber, resolveEase, splitText, type BlockContext } from "../../runtime/index.js";
import { mixHex } from "../ui.js";
import { ICONS } from "./icons.js";
import { layoutIcons, planPictogram, type Layout, type Slot } from "./layout.js";

const SVG = "http://www.w3.org/2000/svg";
/** The non-focus groups step down in tone so the accent reads first (chart_build's donut does the same). */
const TONES = [0.62, 0.44, 0.32, 0.24, 0.18];

const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const plan = planPictogram(p);
  // checkParams refuses bad groups and layouts before a block is built.
  if ("error" in plan) throw new Error(plan.error);
  const { groups, layouts } = plan;
  const focus = Math.min(Number(p.focus), groups.length - 1);
  const keep = Number(p.keep);
  const captions = (p.captions as string[]).slice(0, layouts.length);
  const fmt = { prefix: String(p.prefix ?? ""), suffix: String(p.suffix ?? "") };
  const total = groups.reduce((n, g) => n + g.icons, 0);

  const backdrop = p.backdrop ? ctx.el("div", "pm-backdrop") : null;
  if (backdrop) backdrop.style.background = palette.paper;

  const captionH = captions.some(Boolean) ? 170 : 0;
  const region = { x: safe.left, y: safe.top + captionH, w: W - safe.left - safe.right, h: H - safe.bottom - safe.top - captionH };
  const steps: Layout[] = [];
  layouts.forEach((kind, j) => steps.push(kind === "hold" ? { slots: steps[j - 1]!.slots, labels: [] } : layoutIcons(kind, groups, region, ctx.portrait)));

  // Time: the icons pop in, then each layout holds an equal share of the rest.
  const enterAt = 0.3;
  const enterFor = Math.min(1.2, 0.5 + total * 0.004);
  const span = (ctx.seconds - 0.6 - enterAt) / layouts.length;
  const T = layouts.map((_, j) => enterAt + j * span);
  const morphFor = Math.min(0.9, span * 0.55);
  const stagger = Math.min(0.5, span * 0.3);
  const out = resolveEase("out");
  const pop = resolveEase("back-out");

  // One SVG; each icon a <use> of one path, moved every frame.
  const svg = ctx.doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "pm-svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  ctx.root.append(svg);
  const defs = ctx.doc.createElementNS(SVG, "defs");
  const glyph = ctx.doc.createElementNS(SVG, "path");
  const glyphId = `pm-icon-${ctx.seed}`;
  glyph.setAttribute("id", glyphId);
  glyph.setAttribute("d", ICONS[String(p.icon)] ?? ICONS.person!);
  glyph.setAttribute("fill-rule", "evenodd");
  defs.append(glyph);
  svg.append(defs);

  const colours = groups.map((_, j) => (j === focus ? palette.accent : mixHex(palette.paper, palette.ink, TONES[Math.min(TONES.length - 1, j < focus ? j : j - 1)]!)));
  const icons: { use: SVGUseElement; kept: boolean }[] = [];
  groups.forEach((g, j) => {
    for (let m = 0; m < g.icons; m += 1) {
      const use = ctx.doc.createElementNS(SVG, "use");
      use.setAttribute("href", `#${glyphId}`);
      use.style.fill = colours[j]!;
      svg.append(use);
      icons.push({ use, kept: j === focus && m < keep });
    }
  });

  // Sequenced: icon i starts its move (or entrance) i/total of the stagger late.
  const delay = (i: number, length: number): number => (total > 1 ? (length * i) / (total - 1) : 0);
  const holds = layouts.map((kind) => kind === "hold");
  const at = (slot: Slot, sc: number): string => `translate(${r1(slot.x)} ${r1(slot.y)}) scale(${(Math.round(((slot.s * sc) / 24) * 1000) / 1000).toString()}) translate(-12 -12)`;
  const mix = (a: Slot, b: Slot, f: number): Slot => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s: a.s + (b.s - a.s) * f });

  tl.track((t) => {
    icons.forEach(({ use, kept }, i) => {
      let j = 0;
      while (j + 1 < layouts.length && t >= T[j + 1]! + delay(i, stagger)) j += 1;
      const f = j === 0 ? 1 : out(clamp01((t - T[j]! - delay(i, stagger)) / morphFor));
      const slot = j === 0 ? steps[0]!.slots[i]! : mix(steps[j - 1]!.slots[i]!, steps[j]!.slots[i]!, f);
      const enter = pop(clamp01((t - enterAt - delay(i, enterFor)) / 0.4));
      // A hold dissolves all but the kept icons; the next layout brings them back.
      let alpha = 1;
      let grow = 1;
      if (holds[j]) {
        if (kept) grow = 1 + 0.25 * f;
        else alpha = 1 - f;
      } else if (j > 0 && holds[j - 1]) {
        if (kept) grow = 1.25 - 0.25 * f;
        else alpha = f;
      }
      use.setAttribute("transform", at(slot, enter * grow));
      use.style.opacity = r1(alpha * Math.min(1, enter * 1.5));
    });
    if (backdrop) {
      let alpha = 1;
      layouts.forEach((kind, j) => {
        if (kind !== "hold") return;
        const q = resolveEase("smooth")(clamp01((t - T[j]!) / (morphFor + stagger)));
        const back = j + 1 < layouts.length ? resolveEase("smooth")(clamp01((t - T[j + 1]!) / (morphFor + stagger))) : 0;
        alpha = Math.min(alpha, 1 - q + back);
      });
      backdrop.style.opacity = r1(alpha);
    }
  });
  ctx.cue(enterAt, "tick", { weight: 0.2, until: enterAt + enterFor + 0.4, rate: Math.min(20, total / (enterFor + 0.4)) });
  layouts.forEach((kind, j) => {
    if (j === 0) return;
    ctx.cue(T[j]!, kind === "hold" ? "whoosh" : "swap", { weight: kind === "hold" ? 0.5 : 0.45 });
  });

  // Labels and captions belong to one layout: in after its morph lands, out when the next starts.
  steps.forEach((step, j) => {
    const inAt = j === 0 ? enterAt + enterFor * 0.7 : T[j]! + morphFor * 0.6;
    const outAt = j + 1 < layouts.length ? T[j + 1]! : undefined;
    for (const label of step.labels) {
      const g = groups[label.group];
      const el = ctx.el("div", `pm-${label.kind}`);
      Object.assign(el.style, { left: `${label.x - 300}px`, top: `${label.y}px` });
      if (label.kind === "name") el.textContent = g?.label ?? "";
      else if (g) tl.track(counter(el, { from: 0, to: g.value, at: inAt, duration: 0.7, ease: "out", decimals: Number.isInteger(g.value) ? 0 : 1, ...fmt }));
      else el.textContent = `${formatNumber(groups.reduce((n, x) => n + x.value, 0), fmt)} in all`;
      if (label.group === focus) el.style.color = palette.accent;
      tl.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, { at: inAt, duration: 0.45, ease: "out" });
      if (outAt !== undefined) tl.to(el, { opacity: 0 }, { at: outAt, duration: 0.25, ease: "smooth" });
    }
    const text = captions[j];
    if (!text) return;
    const cap = ctx.el("div", "pm-caption", ctx.root, text);
    Object.assign(cap.style, { left: `${safe.left}px`, top: `${safe.top}px`, width: `${W - safe.left - safe.right}px` });
    const split = splitText(cap, { lines: true });
    tl.fromTo(split.lineInners, { yPercent: 105 }, { yPercent: 0 }, { at: j === 0 ? 0.1 : T[j]! + 0.1, duration: 0.6, ease: "out", stagger: 0.08 });
    if (outAt !== undefined) tl.to(split.lineInners, { yPercent: -105 }, { at: outAt - 0.05, duration: 0.35, ease: "in" });
  });
}
