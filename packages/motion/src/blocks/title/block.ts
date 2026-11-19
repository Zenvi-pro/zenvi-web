import type { BlockContext } from "../../runtime/index.js";

// add_title_tool's titles: a port of zenvi-core src/classes/hyperframes_titles.py
// (`compile_composition`), the HyperFrames composition the desktop renders, so a
// title looks the same from either app. Sizes are design px (short side 1080).

const ROLL_LINES = 6;

function css(colour: string): string {
  if (colour.length !== 9) return colour;
  const [r, g, b, a] = [1, 3, 5, 7].map((i) => parseInt(colour.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${(a! / 255).toFixed(3)})`;
}

/** *base* px while the longest line has at most *chars* characters, smaller after. */
function fit(text: string, base: number, chars: number, floor = 0.5): number {
  const longest = Math.max(0, ...text.split("\n").map((l) => l.length));
  return longest <= chars ? base : base * Math.max(floor, Math.sqrt(chars / longest));
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, root } = ctx;
  const style = String(p.style);
  const k = Number(p.font_scale) || 1;
  const title = String(p.title ?? "").trim();
  const sub = String(p.subtitle ?? "").trim();
  const lines = (Array.isArray(p.lines) ? p.lines : []).map(String).filter((l) => l.trim());
  const END = ctx.seconds;
  const OUT = Math.min(0.5, END * 0.2);
  const px = (n: number): string => `${n * k}px`;
  ctx.ownExit = true;

  const tall = H >= W * 1.6;
  const bg = String(p.background_color || (style === "end_card" ? "#0b0b0f" : ""));
  const ink = css(String(p.text_color || (style === "bold_box" ? "#111111" : "#ffffff")));
  const accent = css(String(p.accent_color || (style === "bold_box" ? "#ffffff" : "#ffd166")));
  const font = String(p.font ?? "").trim();
  Object.assign(root.style, {
    display: "flex",
    flexDirection: "column",
    justifyContent: { top: "flex-start", center: "center", bottom: "flex-end" }[String(p.zone)] ?? "center",
    padding: `${H * (tall ? 0.09 : 0.08)}px ${W * 0.07}px ${H * (tall ? 0.16 : 0.09)}px`,
    boxSizing: "border-box",
    background: bg ? css(bg) : "transparent",
    color: ink,
    fontFamily: font ? `"${font}", var(--font-sans)` : "var(--font-sans)",
  });
  root.style.setProperty("--title-ink", ink);
  root.style.setProperty("--title-accent", accent);
  if (!title && !sub && lines.length === 0) return; // a blank colour card

  const stack = ctx.el("div", "tt-stack");
  const fade = (el: HTMLElement): void => {
    tl.to(el, { opacity: 0, y: -30 }, { at: END - OUT, duration: OUT, ease: "in" });
  };

  if (style === "headline") {
    if (title) {
      const h = ctx.el("h1", "tt-t", stack);
      h.style.fontSize = px(fit(title, 124, 16));
      const words = title.split(/\s+/).map((w) => {
        const mask = ctx.el("span", "tt-m", h);
        h.append(" ");
        return ctx.el("span", "tt-w", mask, w);
      });
      const rule = ctx.el("div", "tt-rule", stack);
      Object.assign(rule.style, { height: px(7), width: px(150), margin: `${26 * k}px auto` });
      words.forEach((w, i) => tl.fromTo(w, { yPercent: 115 }, { yPercent: 0 }, { at: 0.05 + 0.07 * i, duration: 0.75, ease: "out" }));
      tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1 }, { at: 0.3, duration: 0.7, ease: "out" });
    }
    if (sub) {
      const s = ctx.el("p", "tt-s", stack, sub);
      s.style.fontSize = px(fit(sub, 46, 40));
      tl.fromTo(s, { opacity: 0, y: 24 * k }, { opacity: 0.9, y: 0 }, { at: 0.5, duration: 0.6, ease: "out" });
    }
    ctx.cue(0.05, "whoosh", { weight: 0.3, at: stack });
    fade(stack);
  } else if (style === "lower_third") {
    stack.classList.add("tt-lt");
    const bar = ctx.el("div", "tt-bar", stack);
    bar.style.width = px(10);
    const plate = ctx.el("div", "tt-plate", stack);
    plate.style.padding = `${22 * k}px ${44 * k}px ${24 * k}px ${34 * k}px`;
    const name = title ? ctx.el("div", "tt-n", ctx.el("div", "tt-m", plate), title) : null;
    if (name) name.style.fontSize = px(fit(title, 56, 26));
    const role = sub ? ctx.el("div", "tt-r", ctx.el("div", "tt-m", plate), sub) : null;
    if (role) Object.assign(role.style, { fontSize: px(fit(sub, 32, 44)), marginTop: px(6) });
    tl.fromTo(bar, { scaleY: 0 }, { scaleY: 1 }, { at: 0, duration: 0.45, ease: "out" });
    tl.fromTo(plate, { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)" }, { at: 0.15, duration: 0.7, ease: "in-out" });
    if (name) tl.fromTo(name, { yPercent: 110 }, { yPercent: 0 }, { at: 0.45, duration: 0.6, ease: "out" });
    if (role) tl.fromTo(role, { yPercent: 110 }, { yPercent: 0 }, { at: 0.58, duration: 0.6, ease: "out" });
    tl.to(plate, { clipPath: "inset(0% 100% 0% 0%)" }, { at: END - OUT, duration: OUT, ease: "in" });
    tl.to(bar, { scaleY: 0 }, { at: END - OUT * 0.6, duration: OUT * 0.6, ease: "in" });
    ctx.cue(0.15, "whoosh", { weight: 0.3, at: plate });
  } else if (style === "end_card") {
    const t = title ? ctx.el("h1", "tt-t", stack, title) : null;
    if (t) {
      t.style.fontSize = px(fit(title, 112, 18));
      tl.fromTo(t, { opacity: 0, scale: 0.92, blur: 18 * k }, { opacity: 1, scale: 1, blur: 0 }, { at: 0.1, duration: 1.1, ease: "out" });
    }
    if (sub) {
      const s = ctx.el("p", "tt-s tt-caps", stack, sub);
      Object.assign(s.style, { fontSize: px(fit(sub, 32, 42)), marginTop: px(30) });
      const size = fit(sub, 32, 42) * k;
      tl.fromTo(s, { opacity: 0, letterSpacing: size * 0.5 }, { opacity: 0.8, letterSpacing: size * 0.24 }, { at: 0.45, duration: 1.2, ease: "out" });
    }
    fade(stack);
  } else if (style === "bold_box") {
    const rows = [...title.split("\n").map((r) => r.trim()).filter(Boolean), ...(sub ? [sub] : [])];
    const size = fit(rows.join("\n"), 76, 20);
    rows.forEach((r, i) => {
      const box = ctx.el("span", "tt-box", ctx.el("div", "tt-row", stack), r);
      Object.assign(box.style, { fontSize: px(size * (sub && i === rows.length - 1 ? 0.72 : 1)), padding: `${10 * k}px ${26 * k}px` });
      tl.fromTo(box, { clipPath: "inset(0% 100% 0% 0%)", scale: 0.96 }, { clipPath: "inset(0% 0% 0% 0%)", scale: 1 }, { at: 0.05 + 0.12 * i, duration: 0.55, ease: "back-out" });
      tl.to(box, { clipPath: "inset(0% 0% 0% 100%)" }, { at: END - OUT + 0.05 * i, duration: OUT, ease: "in" });
    });
    ctx.cue(0.05, "pop", { weight: 0.35, at: stack });
  } else if (style === "kicker") {
    const row = ctx.el("div", "tt-kick", stack);
    const lineL = ctx.el("span", "tt-line", row);
    const label = title ? ctx.el("span", "tt-k", row, title) : null;
    const lineR = ctx.el("span", "tt-line", row);
    if (label) {
      const size = fit(title, 30, 34) * k;
      Object.assign(label.style, { fontSize: `${size}px`, margin: px(22) });
      tl.fromTo(label, { opacity: 0, letterSpacing: size * 0.7 }, { opacity: 1, letterSpacing: size * 0.32 }, { at: 0.05, duration: 1, ease: "out" });
    }
    for (const line of [lineL, lineR]) tl.fromTo(line, { scaleX: 0 }, { scaleX: 1 }, { at: 0.2, duration: 0.8, ease: "out" });
    if (sub) {
      const s = ctx.el("p", "tt-s", stack, sub);
      Object.assign(s.style, { fontSize: px(fit(sub, 30, 50)), marginTop: px(14) });
      tl.fromTo(s, { opacity: 0 }, { opacity: 0.75 }, { at: 0.5, duration: 0.6, ease: "smooth" });
    }
    fade(stack);
  } else {
    const size = fit(lines.join("\n"), 52, 34);
    const rows = lines.map((l) => {
      const c = ctx.el("p", "tt-c", stack, l);
      Object.assign(c.style, { fontSize: px(size), margin: `${size * 0.32 * k}px 0` });
      return c;
    });
    if (lines.length > ROLL_LINES) {
      tl.fromTo(stack, { yPercent: 0, y: H * 0.55 }, { yPercent: -100, y: -H * 0.55 }, { at: 0, duration: END, ease: "linear" });
    } else {
      rows.forEach((c, i) => tl.fromTo(c, { opacity: 0, y: 20 * k }, { opacity: 1, y: 0 }, { at: 0.1 + 0.18 * i, duration: 0.6, ease: "out" }));
      fade(stack);
    }
  }
}
