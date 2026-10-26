import { scrambledText, type BlockContext } from "../../runtime/index.js";

const GLYPHS: Readonly<Record<string, string>> = {
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  binary: "01",
  symbols: "#%&*+=<>/\\[]{}!?$@^~",
  blocks: "░▒▓█▚▞▙▟",
};

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const lines = String(p.text).split(/\s*(?:\/|\n)\s*/).filter(Boolean);
  const box = ctx.el("div", "ts");
  const align = p.align === "left" ? "flex-start" : "center";
  box.style.alignItems = align;
  const label = p.label ? ctx.el("div", "ts-label", box, String(p.label)) : null;
  const rows = lines.map((text) => {
    const line = ctx.el("div", "ts-line", box);
    ctx.el("span", "ts-ghost", line, text);
    const live = ctx.el("span", "ts-live", line);
    const front = p.highlight !== false ? ctx.el("span", "ts-front", line) : null;
    return { text, line, live, front };
  });

  box.style.fontSize = "100px";
  const widest = Math.max(...rows.map((r) => r.line.getBoundingClientRect().width));
  const size = Number(p.size) > 0 ? Number(p.size) : Math.min(120, (100 * (W - safe.left - safe.right)) / widest);
  box.style.fontSize = `${size}px`;
  if (label) label.style.fontSize = "24px";
  const rect = box.getBoundingClientRect();
  const left = p.align === "left" ? safe.left : (W - rect.width) / 2;
  Object.assign(box.style, { left: `${left}px`, top: `${safe.top + (H - safe.top - safe.bottom - rect.height) / 2}px` });

  const exit = p.exit === false ? 0 : 0.4;
  const decode = Math.max(0.6, Math.min(1.6, (ctx.seconds - exit - 0.6) / Math.max(1, lines.length * 0.7)));
  if (label) tl.fromTo(label, { opacity: 0, x: -12 }, { opacity: 1, x: 0 }, { at: 0, duration: 0.4, ease: "out" });
  rows.forEach((row, i) => {
    const at = 0.15 + i * decode * 0.55;
    const options = { at, duration: decode, seed: ctx.seed + i * 101, glyphs: GLYPHS[String(p.glyphs)] ?? GLYPHS.letters, rate: 22 };
    tl.track((t) => {
      const shown = scrambledText(row.text, t, options);
      if (row.live.textContent !== shown) row.live.textContent = shown;
      if (!row.front) return;
      // The front sits just after the characters shown (measured: any face), until the line has resolved.
      const done = t >= at + decode;
      row.front.style.opacity = t < at || done ? "0" : "1";
      row.front.style.transform = `translateX(${row.live.offsetWidth}px)`;
    });
  });
}
