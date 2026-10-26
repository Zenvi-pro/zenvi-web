import type { BlockContext } from "../../runtime/index.js";
import { icon } from "../ui.js";
import { codeText, tokenizeLine, typeSeconds, typeTimes, type Language } from "./syntax.js";

const MAX_LINES = 16;

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const lang = String(p.language) as Language;
  const code = codeText(String(p.code)).split("\n").slice(0, MAX_LINES).join("\n");
  const lines = code.split("\n");
  const output = String(p.output ?? "");
  const S = ctx.seconds;

  const winW = W <= H * 1.3 ? W - safe.left - safe.right + 60 : Math.min(1380, W * 0.68);
  const win = ctx.el("div", "cc-win");
  win.style.width = `${winW}px`;
  const bar = ctx.el("div", "cc-bar", win);
  for (let i = 0; i < 3; i += 1) ctx.el("span", "cc-dot", bar);
  if (p.filename) ctx.el("span", "cc-tab", bar, String(p.filename));
  const body = ctx.el("div", "cc-body", win);
  const lit = ctx.el("div", "cc-lit", body);

  // Every character is its own span, so typing only flips visibility (the layout never reflows).
  const chars: HTMLElement[] = [];
  const codeEls: HTMLElement[] = [];
  lines.forEach((line, i) => {
    const row = ctx.el("div", "cc-line", body);
    ctx.el("span", "cc-num", row, String(i + 1));
    const host = ctx.el("span", "cc-code", row);
    codeEls.push(host);
    for (const token of tokenizeLine(line, lang)) {
      const span = ctx.el("span", `t-${token.kind}`, host);
      for (const c of Array.from(token.text)) chars.push(ctx.el("span", "", span, c));
    }
    // The newline as an empty marker, so typing pauses on it at the line's end.
    if (i < lines.length - 1) chars.push(ctx.el("span", "", host, ""));
  });
  const caret = ctx.el("span", "cc-caret", body);

  // Fit: the longest line spans the window at most 34 px (the mono face is ~0.6 em per column).
  const cols = Math.max(20, ...lines.map((l) => l.length));
  const size = Math.max(18, Math.min(ctx.portrait ? 32 : 36, (winW - 40 - 3.4 * 30) / (cols * 0.6 + 1)));
  body.style.fontSize = `${size}px`;

  let run: HTMLElement | null = null;
  let runH = 0;
  if (output) {
    run = ctx.el("div", "cc-run", win);
    const out = ctx.el("div", "cc-out", run);
    icon(ctx, "check", "", out);
    ctx.el("span", "", out, output);
    runH = run.getBoundingClientRect().height;
  }
  const winH = win.getBoundingClientRect().height;
  Object.assign(win.style, { left: `${(W - winW) / 2}px`, top: `${Math.max(safe.top, (H - winH) / 2 - (ctx.portrait ? 40 : 0))}px` });

  // Character positions (relative to the body) for the caret and the active line.
  const bodyRect = body.getBoundingClientRect();
  const lineH = size * 1.6;
  const pos = chars.map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.right - bodyRect.left, y: r.top - bodyRect.top };
  });
  const lineStarts = codeEls.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - bodyRect.left, y: r.top - bodyRect.top };
  });

  // Typing fits the time between the entrance and the run strip.
  const typeAt = 0.75;
  const tail = (run ? 0.45 + 0.5 + 0.9 : 0.9) + (p.exit === false ? 0 : 0.4);
  // Line-end pauses are fixed, so the characters get what is left (16-90 per second).
  const pauses = typeSeconds(code, 1e9);
  const typed = Array.from(code.replace(/\n\s*/g, "\n")).filter((c) => c !== "\n").length;
  const cps = Math.min(90, Math.max(16, typed / Math.max(0.6, S - typeAt - tail - pauses)));
  const times = typeTimes(code, cps, typeAt);
  const typedEnd = times[times.length - 1] ?? typeAt;
  const lineOf: number[] = [];
  lines.forEach((line, i) => {
    for (let k = 0; k < Array.from(line).length + (i < lines.length - 1 ? 1 : 0); k += 1) lineOf.push(i);
  });

  tl.track((t) => {
    let shown = 0;
    while (shown < times.length && times[shown]! <= t) shown += 1;
    chars.forEach((c, i) => {
      const v = i < shown ? "visible" : "hidden";
      if (c.style.visibility !== v) c.style.visibility = v;
    });
    // The caret sits after the last typed character (at a line's start after a newline).
    const last = shown - 1;
    const onNewline = last >= 0 && chars[last]!.textContent === "";
    const line = last < 0 ? 0 : onNewline ? lineOf[last]! + 1 : lineOf[last]!;
    const at = last < 0 || onNewline ? { x: lineStarts[line]?.x ?? 0, y: lineStarts[line]?.y ?? 0 } : pos[last]!;
    caret.style.left = `${at.x + 2}px`;
    caret.style.top = `${at.y}px`;
    lit.style.top = `${lineStarts[line]?.y ?? 0}px`;
    const blinkOn = t < typeAt || t > typedEnd + 0.05 ? Math.floor(t * 2) % 2 === 0 : true;
    caret.style.visibility = blinkOn ? "visible" : "hidden";
  });
  lit.style.height = `${lineH}px`;

  tl.fromTo(win, { y: H * 0.04, scale: 0.97, opacity: 0, blur: 12 }, { y: 0, scale: 1, opacity: 1, blur: 0 }, { at: 0, duration: 0.7, ease: "out" });

  // After a beat of stillness the run strip opens under the code: the payoff.
  if (run) {
    const runAt = typedEnd + 0.45;
    tl.fromTo(run, { height: 0 }, { height: runH }, { at: runAt, duration: 0.5, ease: "in-out" });
    const out = run.firstElementChild as HTMLElement;
    tl.fromTo(out, { y: -16, opacity: 0 }, { y: 0, opacity: 1 }, { at: runAt + 0.15, duration: 0.45, ease: "out" });
    tl.to(lit, { opacity: 0 }, { at: runAt, duration: 0.3, ease: "smooth" });
  }
}
