import { splitText, type BlockContext } from "../../runtime/index.js";
import { onColor } from "../ui.js";
import { statusColor } from "./status.js";

interface Cell {
  text: string;
  chip: boolean;
}

function parseRow(text: string, columns: number): Cell[] {
  const cells = text.split("|").map((c) => c.trim());
  return Array.from({ length: columns }, (_, i) => {
    const raw = cells[i] ?? "";
    const m = /^\[(.*)\]$/.exec(raw);
    return m ? { text: m[1]!.trim(), chip: true } : { text: raw, chip: false };
  });
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const columns = (p.columns as string[]).slice(0, 4);
  const rows = (p.rows as string[]).map((r) => parseRow(r, columns.length));
  const n = rows.length;
  const S = ctx.seconds;
  const hi = Number(p.highlight);
  const template = columns.map((_, i) => (i === 0 ? "1.7fr" : "1fr")).join(" ");

  const cardW = W <= H * 1.3 ? W - safe.left - safe.right : Math.min(1240, W * 0.62);
  const plate = String(p.plate ?? "glass");
  const card = ctx.el("div", `dt-card${plate === "none" ? "" : ` is-${plate}`}`);
  card.style.width = `${cardW}px`;
  const title = p.title ? ctx.el("div", "dt-title", card, String(p.title)) : null;
  const head = ctx.el("div", "dt-row dt-head", card);
  head.style.gridTemplateColumns = template;
  for (const c of columns) ctx.el("div", "dt-cell", head, c);
  const lines = rows.map((cells) => {
    const el = ctx.el("div", "dt-row", card);
    el.style.gridTemplateColumns = template;
    const mark = ctx.el("span", "dt-mark", el);
    const chips: HTMLElement[] = [];
    const texts: HTMLElement[] = [];
    for (const cell of cells) {
      const box = ctx.el("div", "dt-cell", el);
      if (cell.chip && cell.text) {
        const chip = ctx.el("span", "dt-chip", box, cell.text);
        const bg = statusColor(cell.text, palette.accent);
        Object.assign(chip.style, { background: bg, color: onColor(bg) });
        chips.push(chip);
      } else {
        box.textContent = cell.text;
        texts.push(box);
      }
    }
    return { el, mark, chips, texts };
  });

  const rect = card.getBoundingClientRect();
  const left = (W - rect.width) / 2;
  const top = safe.top + Math.max(0, (H - safe.top - safe.bottom - rect.height) / 2);
  Object.assign(card.style, { left: `${left}px`, top: `${top}px` });

  // In: the card rises and focuses, the title lines up, then the header and the rows in turn.
  tl.fromTo(card, { y: H * 0.04, scale: 0.97, opacity: 0, blur: 12 }, { y: 0, scale: 1, opacity: 1, blur: 0 }, { at: 0, duration: 0.7, ease: "out" });
  ctx.cue(0, "pop", { weight: 0.4, at: { x: left + rect.width / 2, y: top + rect.height / 2 } });
  if (title) {
    const split = splitText(title, { lines: true });
    tl.fromTo(split.lineInners, { yPercent: 105 }, { yPercent: 0 }, { at: 0.1, duration: 0.6, ease: "out", stagger: 0.1 });
  }
  tl.fromTo(head, { opacity: 0 }, { opacity: 1 }, { at: 0.3, duration: 0.4, ease: "smooth" });
  // Rows land within the first ~45 % of the block, at least 0.1 s apart.
  const first = 0.45;
  const step = n > 1 ? Math.max(0.1, Math.min(0.32, (S * 0.45 - first) / (n - 1))) : 0;
  lines.forEach((line, i) => {
    const at = first + i * step;
    tl.fromTo(line.el, { y: 28, opacity: 0 }, { y: 0, opacity: 1 }, { at, duration: 0.5, ease: "out" });
    line.chips.forEach((chip) => {
      tl.fromTo(chip, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1 }, { at: at + 0.22, duration: 0.4, ease: "back-out" });
      ctx.cue(at + 0.22, "pop", { weight: 0.3, at: chip });
    });
  });

  // After a beat of stillness the picked row takes the accent; the others dim.
  const pick = hi >= 0 && hi < n ? lines[hi]! : null;
  if (pick) {
    const doneAt = Math.min(S - 1.1, first + (n - 1) * step + 0.9);
    const ink = onColor(palette.accent);
    // fromTo: a `to` rests at the identity (opacity 1) before it starts, which showed the mark from the first frame.
    tl.fromTo(pick.mark, { opacity: 0 }, { opacity: 1 }, { at: doneAt, duration: 0.3, ease: "smooth" });
    tl.fromTo(pick.texts, { color: palette.ink }, { color: ink }, { at: doneAt, duration: 0.3, ease: "smooth" });
    tl.to(pick.el, { scale: 1.03 }, { at: doneAt, duration: 0.18, ease: "out" });
    tl.to(pick.el, { scale: 1 }, { at: doneAt + 0.18, duration: 0.35, ease: "out" });
    tl.to(lines.filter((l) => l !== pick).map((l) => l.el), { opacity: 0.45 }, { at: doneAt, duration: 0.35, ease: "smooth" });
    ctx.cue(doneAt, "pop", { weight: 0.45, at: pick.el });
  }
}
