import type { BlockContext, Props } from "../../runtime/index.js";
import { onColor } from "../ui.js";

/** Our drawn mark: three offset bars, a cut moving forward. Never a third-party logo. */
const MARK = `<svg viewBox="0 0 100 100"><rect x="8" y="16" width="62" height="18" rx="9" fill="var(--accent)"/><rect x="26" y="41" width="66" height="18" rx="9" fill="var(--ink)"/><rect x="8" y="66" width="46" height="18" rx="9" fill="var(--accent)"/></svg>`;

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  // An end card holds its last frame; the next thing is the end of the video.
  ctx.ownExit = true;
  const stacked = ctx.portrait;
  const markSize = stacked ? 240 : 200;
  const brand = String(p.brand ?? "");

  const wrap = ctx.el("div", "lr");
  wrap.style.gap = stacked ? "64px" : "56px";
  const lockup = ctx.el("div", "lr-lockup", wrap);
  Object.assign(lockup.style, { flexDirection: stacked ? "column" : "row", gap: stacked ? "40px" : "44px" });
  const markBox = ctx.el("div", "lr-markbox", lockup);
  Object.assign(markBox.style, { width: `${markSize}px`, height: `${markSize}px` });
  const glow = p.glow === true ? ctx.el("div", "lr-glow", markBox) : null;
  const iris = ctx.el("div", "lr-iris", markBox);
  const img = ctx.mediaImg("logo", "lr-mark", iris);
  let bars: Element[] = [];
  if (!img) {
    const mark = ctx.el("div", "lr-mark", iris);
    mark.innerHTML = MARK;
    bars = Array.from(mark.querySelectorAll("rect"));
  }
  const wordMask = brand ? ctx.el("div", "lr-wordmask", lockup) : null;
  const word = wordMask ? ctx.el("span", "lr-word", wordMask, brand) : null;
  if (word) word.style.fontSize = `${stacked ? 150 : 168}px`;
  const cta = p.cta ? ctx.el("div", "lr-cta", wrap, String(p.cta)) : null;
  if (cta) cta.style.color = onColor(palette.accent);
  // The pill does not wrap: past 32 characters the type shrinks to keep it the width 32 take at 36 px.
  if (cta && String(p.cta).length > 32) cta.style.fontSize = `${Math.round((36 * 32) / String(p.cta).length)}px`;
  const url = p.url ? ctx.el("div", "lr-url", wrap, String(p.url)) : null;

  // Fit the lockup to the safe width, then centre it a little above the middle.
  const maxW = W - safe.left - safe.right;
  const lockW = lockup.getBoundingClientRect().width;
  if (word && lockW > maxW) word.style.fontSize = `${(parseFloat(word.style.fontSize) * (maxW - (stacked ? 0 : markSize + 44))) / Math.max(1, lockW - (stacked ? 0 : markSize + 44))}px`;
  const h = wrap.getBoundingClientRect().height;
  wrap.style.top = `${Math.max(safe.top, (H - h) / 2 - H * 0.03)}px`;

  // The mask opens on the mark while the mark inside pulls back from 160 % and focuses (a lens).
  const open = 0.15;
  const clip = glow ? iris : markBox;
  tl.fromTo(clip, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(72% at 50% 50%)" }, { at: open, duration: 0.85, ease: "out" });
  tl.fromTo(iris, { scale: 1.6, blur: 8 }, { scale: 1, blur: 0 }, { at: open, duration: 1.0, ease: "out" });
  ctx.cue(open, "reveal", { weight: 0.9, at: markBox });
  if (bars.length > 0) tl.fromTo(bars, { x: -18 }, { x: 0 }, { at: open + 0.05, duration: 0.7, ease: "out", stagger: 0.06 });
  if (glow) {
    tl.fromTo(glow, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1.1 }, { at: open + 0.1, duration: 0.7, ease: "out" });
    ctx.cue(open + 0.1, "glint", { weight: 0.4, at: markBox });
    tl.to(glow, { opacity: 0.55, scale: 1 }, { at: open + 0.8, duration: 1.2, ease: "in-out" });
  }
  // The wordmark slides out from behind the mark (its mask edge is the mark's side).
  if (word) {
    const axis = stacked ? "yPercent" : "xPercent";
    const from: Props = { [axis]: stacked ? -100 : -104 };
    const to: Props = { [axis]: 0 };
    tl.fromTo(word, from, to, { at: open + 0.6, duration: 0.8, ease: "out" });
    ctx.cue(open + 0.6, "whoosh", { weight: 0.35, at: wordMask! });
  }
  // Then the call to action and the address, after the lockup has landed.
  const tail = open + 1.2;
  if (cta) {
    tl.fromTo(cta, { y: 30, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1 }, { at: tail, duration: 0.6, ease: "out" });
    ctx.cue(tail, "pop", { weight: 0.35, at: cta });
  }
  if (url) tl.fromTo(url, { y: 16, opacity: 0 }, { y: 0, opacity: 0.75 }, { at: tail + 0.12, duration: 0.55, ease: "out" });
}
