import type { BlockContext } from "../../runtime/index.js";

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const words = p.words as string[];
  const stack = ctx.portrait;
  const flip = p.style === "flip" || (p.style === "auto" && stack);
  const row = ctx.el("div", `wr${flip ? " wr-flip" : ""}${stack ? " wr-stack" : ""}`);
  const prefix = p.prefix ? ctx.el("span", "wr-fixed", row, String(p.prefix)) : null;
  const slot = ctx.el("span", "wr-slot", row);
  const column = ctx.el("span", "wr-column", slot);
  const items = words.map((w) => ctx.el("span", "wr-word", column, w));
  const suffix = p.suffix ? ctx.el("span", "wr-fixed", row, String(p.suffix)) : null;

  // Size: the widest state of the line fits the safe width.
  row.style.fontSize = "100px";
  const fixed = (prefix?.getBoundingClientRect().width ?? 0) + (suffix?.getBoundingClientRect().width ?? 0);
  const widths = items.map((i) => i.getBoundingClientRect().width);
  const gap = 0.26 * 100 * ((prefix ? 1 : 0) + (suffix ? 1 : 0));
  const widest = stack ? Math.max(...widths, prefix?.getBoundingClientRect().width ?? 0, suffix?.getBoundingClientRect().width ?? 0) : fixed + gap + Math.max(...widths);
  const size = Number(p.size) > 0 ? Number(p.size) : Math.min(stack ? 150 : 120, (100 * (W - safe.left - safe.right)) / widest);
  row.style.fontSize = `${size}px`;
  const k = size / 100;
  const lineH = size * 1.15;
  const rowH = row.getBoundingClientRect().height;
  row.style.top = `${safe.top + (H - safe.top - safe.bottom - rowH) / 2}px`;

  const n = words.length;
  const enter = 0.7;
  const exit = p.exit === false ? 0 : 0.4;
  const step = Math.max(0.45, (ctx.seconds - enter - exit - 0.9) / Math.max(1, n - 1));
  const change = (i: number): number => enter + 0.15 + (i - 1) * step;
  const move = 0.5;

  // The line's left edge follows the current word's width so the line stays centred.
  const lineLeft = (i: number): number => (stack ? 0 : (W - (fixed + gap) * k - widths[i]! * k) / 2);
  tl.fromTo(row, { x: lineLeft(0), y: 30, opacity: 0, blur: 10 }, { x: lineLeft(0), y: 0, opacity: 1, blur: 0 }, { at: 0, duration: enter, ease: "out" });
  tl.set(slot, { width: widths[0]! * k }, 0);
  for (let i = 1; i < n; i += 1) {
    tl.to(row, { x: lineLeft(i) }, { at: change(i), duration: move, ease: "in-out" });
    tl.to(slot, { width: widths[i]! * k }, { at: change(i), duration: move, ease: "in-out" });
  }

  if (flip) {
    items.forEach((item, i) => {
      if (i === 0) tl.set(item, { yPercent: 0, opacity: 1 }, 0);
      else tl.fromTo(item, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1 }, { at: change(i), duration: move, ease: "out" });
      if (i < n - 1) tl.to(item, { yPercent: -100, opacity: 0 }, { at: change(i + 1), duration: move * 0.8, ease: "in-out" });
    });
    return;
  }
  // Slot: the column scrolls one line per word; distance from the current word fades and blurs neighbours.
  const pos = { v: 0 };
  for (let i = 1; i < n; i += 1) tl.to(pos, { v: i }, { at: change(i), duration: move, ease: "in-out" });
  tl.track(() => {
    column.style.transform = `translateY(${-pos.v * lineH}px)`;
    items.forEach((item, i) => {
      const d = Math.abs(i - pos.v);
      item.style.opacity = String(Math.max(0, 1 - d * 0.72));
      item.style.color = d < 0.5 ? "var(--accent)" : "var(--muted)";
      item.style.filter = d > 0.05 ? `blur(${Math.min(6, d * 3).toFixed(2)}px)` : "";
    });
  });
}
