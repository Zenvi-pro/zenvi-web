import { videoTrack, type BlockContext } from "../../runtime/index.js";
import { artImage, artTheme, type ArtKind } from "../art.js";
import { ICONS, icon, pointer } from "../ui.js";

const HEX = /^#[0-9a-f]{6}$/i;
const GLYPHS = ["film", "wave", "pen", "play", "grid", "chat", "sun", "bolt", "layers"] as const satisfies readonly (keyof typeof ICONS)[];
const FILLS = ["#FF7A45", "#2FC0A8", "#FFB020", "#3D7BFF", "#FF5C8A", "#2E2A3D", "#45B649", "#FF4F3B", "#5A6FE0"];
/** How much the icon under the pointer grows, and how wide the swell is (in icon pitches). */
const MAGNIFY = 1.75;
const SPREAD = 1.25;

const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));
const smooth = (u: number): number => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
const out = (u: number): number => 1 - (1 - clamp01(u)) ** 3;

export async function build(ctx: BlockContext): Promise<void> {
  const { tl, params: p, width: W, height: H, palette, safe } = ctx;
  const S = ctx.seconds;
  const scale = Math.min(W, H) / 1080;
  const apps = p.apps as string[];
  const n = apps.length;
  const target = Math.min(n - 1, Number(p.target));
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const fill = (i: number): string => (i === target ? palette.accent : (given[i] ?? FILLS[i % FILLS.length]!));
  const face = (i: number): string => `linear-gradient(160deg, color-mix(in srgb, ${fill(i)} 78%, #fff), ${fill(i)} 45%, color-mix(in srgb, ${fill(i)} 80%, #000))`;
  const glyph = (i: number): keyof typeof ICONS => GLYPHS[i % GLYPHS.length]!;
  const open = p.open !== false;

  // Wallpaper.
  const stage = ctx.el("div", "dm-stage");
  const bg = ctx.el("img", "dm-bg", stage);
  bg.alt = "";
  const ref = ctx.media.background;
  if (ref?.kind === "image") bg.src = ref.url;
  else if (ref) tl.track(videoTrack(bg, ref, ctx.pending));
  else bg.src = await artImage(ctx.doc, String(p.scene) as ArtKind, artTheme(ctx.seed + 2), W, H, ctx.seed);

  // Rest layout: the dock at rest spans at most 72 % (vertical) / 56 % (wide) of the frame.
  const gapK = 0.18;
  const padK = 0.2;
  const B = Math.min(118 * scale, (W * (ctx.portrait ? 0.72 : 0.56)) / (n + (n - 1) * gapK + 2 * padK));
  const gap = B * gapK;
  const pad = B * padK;
  const bottom = ctx.portrait ? H - safe.bottom : H - 64 * scale;
  const cx = W / 2;
  const restLeft = cx - (n * B + (n - 1) * gap) / 2;
  const rest = apps.map((_, i) => restLeft + i * (B + gap) + B / 2);
  const sigma = SPREAD * (B + gap);

  const dock = ctx.el("div", "dm-dock");
  const els = apps.map((name, i) => {
    const el = ctx.el("div", "dm-app");
    Object.assign(el.style, { width: `${B}px`, height: `${B}px` });
    const f = ctx.el("div", "dm-face", el);
    f.style.background = face(i);
    icon(ctx, glyph(i), "", f);
    el.setAttribute("aria-label", name);
    return el;
  });
  const dot = ctx.el("div", "dm-dot");
  const tip = ctx.el("div", "dm-tip", ctx.root, apps[target]!);

  // Beats.
  const riseAt = 0.1;
  const glideAt = 0.75;
  const hoverAt = Math.min(2.1, Math.max(1.6, S * 0.45));
  const clickAt = hoverAt + 0.45;
  const launchAt = clickAt + 0.3;
  // The pointer rests low on the icon so its glyph stays in view.
  const iconY = bottom - pad - B * 0.32;
  const ptr = pointer(ctx, { x: rest[0]! - B * 1.6, y: iconY - B * 3.2 }, glideAt - 0.3);
  ptr.moveTo(rest[0]!, iconY, glideAt, 0.5);
  ptr.moveTo(rest[target]!, iconY, glideAt + 0.55, hoverAt - glideAt - 0.55);
  ptr.click(clickAt);
  const pointerX = (t: number): number => Number(tl.valuesAt(ptr.el, t).get("x") ?? 0) + 14;
  // The swell comes on as the pointer reaches the dock and stays while it is there.
  const inDock = (t: number): number => smooth((t - (glideAt + 0.25)) / 0.35);

  const sizesAt = (t: number): number[] => {
    const f = inDock(t);
    const x = pointerX(t);
    return rest.map((r) => B * (1 + (MAGNIFY - 1) * f * Math.exp(-((x - r) ** 2) / (2 * sigma * sigma))));
  };
  const press = (t: number): number => {
    const u = (t - clickAt) / 0.3;
    if (u < 0 || u > 1) return 1;
    return u < 0.3 ? 1 - 0.12 * (u / 0.3) : 1 - 0.12 * (1 - out((u - 0.3) / 0.7));
  };
  /** Without the zoom the opened app hops twice, the dock's own "launching" signal (6 % of its size, settling). */
  const hop = (t: number): number => {
    if (open) return 0;
    const u = (t - launchAt) / 0.9;
    return u < 0 || u > 1 ? 0 : Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u) * B * 0.45;
  };
  const layout = (t: number): { left: number; size: number }[] => {
    const sizes = sizesAt(t);
    const total = sizes.reduce((a, s) => a + s, 0) + (n - 1) * gap;
    let x = cx - total / 2;
    return sizes.map((size) => {
      const slot = { left: x, size };
      x += size + gap;
      return slot;
    });
  };

  const rise = (t: number): number => (1 - out((t - riseAt) / 0.7)) * B * 2.2;
  tl.fromTo(dock, { opacity: 0 }, { opacity: 1 }, { at: riseAt, duration: 0.4, ease: "smooth" });
  tl.track((t) => {
    const slots = layout(t);
    const dy = rise(t);
    const first = slots[0]!;
    const last = slots[n - 1]!;
    Object.assign(dock.style, { left: `${first.left - pad}px`, top: `${bottom - B - 2 * pad + dy}px`, width: `${last.left + last.size - first.left + 2 * pad}px`, height: `${B + 2 * pad}px` });
    slots.forEach((slot, i) => {
      const k = (slot.size / B) * (i === target ? press(t) : 1);
      const el = els[i]!;
      el.style.left = `${slot.left + (slot.size - B) / 2}px`;
      el.style.top = `${bottom - pad - B + dy - (i === target ? hop(t) : 0)}px`;
      el.style.transform = `scale(${k.toFixed(4)})`;
      // Icons fade in left to right with the rise; once the open starts the target is the launch copy and the rest go.
      const gone = !open || t < launchAt ? 1 : i === target ? 0 : 1 - smooth((t - launchAt - 0.2) / 0.3);
      el.style.opacity = String(clamp01((t - riseAt - i * 0.04) / 0.3) * gone);
    });
    const s = slots[target]!;
    Object.assign(dot.style, { left: `${s.left + s.size / 2 - 4 * scale}px`, top: `${bottom - pad * 0.45 + dy}px`, transform: `scale(${scale})` });
    tip.style.left = `${s.left + s.size / 2}px`;
    tip.style.top = `${bottom - pad - s.size - 26 * scale + dy}px`;
  });
  tl.set(dot, { opacity: 0 }, 0);
  tl.fromTo(dot, { opacity: 0 }, { opacity: 1 }, { at: clickAt + 0.15, duration: 0.2, ease: "smooth" });
  tl.fromTo(tip, { xPercent: -50, yPercent: -100, opacity: 0, y: 10 }, { xPercent: -50, yPercent: -100, opacity: 1, y: 0 }, { at: hoverAt - 0.1, duration: 0.3, ease: "out" });
  tl.to(tip, { opacity: 0 }, { at: clickAt + 0.1, duration: 0.2, ease: "smooth" });
  tl.fromTo(stage, { scale: 1.05 }, { scale: 1 }, { at: 0, duration: S, ease: "out" });

  if (!open) return;
  // The open: a copy of the icon flies at the camera from where it sits and fills the frame with its colour.
  ctx.ownExit = true;
  const slot = layout(launchAt)[target]!;
  const size = slot.size;
  const lcx = slot.left + size / 2;
  const lcy = bottom - pad - size / 2;
  const launch = ctx.el("div", "dm-launch");
  Object.assign(launch.style, { left: `${lcx - size / 2}px`, top: `${lcy - size / 2}px`, width: `${size}px`, height: `${size}px`, background: face(target) });
  const cover = (1.3 * Math.hypot(W, H)) / size;
  tl.set(launch, { opacity: 0 }, 0);
  tl.set(launch, { opacity: 1 }, launchAt);
  tl.fromTo(launch, { x: 0, y: 0, scale: 1 }, { x: W / 2 - lcx, y: H / 2 - lcy, scale: cover }, { at: launchAt, duration: 0.7, ease: "in" });
  tl.to([dock, dot, ptr.el], { opacity: 0 }, { at: launchAt + 0.2, duration: 0.3, ease: "smooth" });
  tl.to(stage, { blur: 14 }, { at: launchAt, duration: 0.6, ease: "in" });

  const end = ctx.el("div", "dm-end");
  const g = ctx.el("div", "dm-glyph", end);
  g.innerHTML = ICONS[glyph(target)];
  Object.assign(g.style, { width: `${260 * scale}px`, height: `${260 * scale}px` });
  const name = ctx.el("div", "dm-name", end, apps[target]!);
  name.style.fontSize = `${120 * scale}px`;
  tl.fromTo(g, { scale: 0.6, opacity: 0, blur: 10 }, { scale: 1, opacity: 1, blur: 0 }, { at: launchAt + 0.5, duration: 0.6, ease: "out" });
  tl.fromTo(name, { y: 30 * scale, opacity: 0 }, { y: 0, opacity: 1 }, { at: launchAt + 0.62, duration: 0.6, ease: "out" });
}
