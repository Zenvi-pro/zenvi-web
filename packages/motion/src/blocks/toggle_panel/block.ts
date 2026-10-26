import type { BlockContext } from "../../runtime/index.js";
import { icon, onColor, pointer } from "../ui.js";

/** Knob travel: switch width − knob − 2 × inset (block.css). */
const TRAVEL = 108 - 50 - 12;

interface Row {
  label: string;
  detail: string;
  on: boolean;
}

function parseRow(text: string): Row {
  const on = text.startsWith("+");
  const body = on ? text.slice(1).trim() : text.trim();
  const i = body.indexOf(":");
  return i > 0 ? { label: body.slice(0, i).trim(), detail: body.slice(i + 1).trim(), on } : { label: body, detail: "", on };
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const rows = (p.rows as string[]).map(parseRow);
  const n = rows.length;
  const S = ctx.seconds;
  const onAccent = onColor(palette.accent);

  const panelW = ctx.portrait ? W - safe.left - safe.right : Math.min(980, W * 0.52);
  const panel = ctx.el("div", "tp-panel");
  panel.style.width = `${panelW}px`;
  const head = ctx.el("div", "tp-head", panel);
  const tile = ctx.el("div", "tp-tile", head);
  const shield = icon(ctx, "shield", "", tile);
  const check = icon(ctx, "check", "", tile);
  ctx.el("div", "tp-title", head, String(p.title));
  const pill = ctx.el("div", "tp-pill", head);
  const pillFill = ctx.el("span", "tp-pill-fill", pill);
  const count = ctx.el("span", "tp-count", pill);

  const switches = rows.map((row) => {
    const el = ctx.el("div", "tp-row", panel);
    const text = ctx.el("div", "tp-text", el);
    const label = ctx.el("div", "tp-label", text, row.label);
    if (row.detail) ctx.el("div", "tp-detail", text, row.detail);
    const sw = ctx.el("div", "tp-switch", el);
    const fill = ctx.el("span", "tp-fill", sw);
    const knob = ctx.el("span", "tp-knob", sw);
    return { row, el, label, sw, fill, knob };
  });

  const rect = panel.getBoundingClientRect();
  const left = (W - rect.width) / 2;
  const top = safe.top + Math.max(0, (H - safe.top - safe.bottom - rect.height) / 2);
  Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });

  // In: the panel rises and focuses, its rows following (≤ 0.5 s of stagger in all).
  tl.fromTo(panel, { y: H * 0.04, scale: 0.97, opacity: 0, blur: 12 }, { y: 0, scale: 1, opacity: 1, blur: 0 }, { at: 0, duration: 0.7, ease: "out" });
  tl.fromTo(switches.map((s) => s.el), { y: 24, opacity: 0 }, { y: 0, opacity: 1 }, { at: 0.15, duration: 0.6, ease: "out", stagger: Math.min(0.08, 0.45 / Math.max(1, n - 1)) });

  // Switches start in their stated state.
  for (const s of switches) {
    tl.set(s.knob, { x: s.row.on ? TRAVEL : 0 }, 0);
    tl.set(s.fill, { opacity: s.row.on ? 1 : 0 }, 0);
    if (!s.row.on) tl.set(s.label, { opacity: 0.62 }, 0);
  }
  const offs = switches.filter((s) => !s.row.on);
  const start = 1.0;
  const doneBeat = 0.45;
  const room = S - start - doneBeat - 0.8 - (p.exit === false ? 0.6 : 1.0);
  const interval = offs.length > 0 ? Math.min(1.0, Math.max(0.45, room / offs.length)) : 0;
  const clicks = offs.map((_, i) => start + 0.55 + i * interval);

  // The count in the header follows the clicks.
  const already = n - offs.length;
  const done = String(p.done);
  const doneAt = (clicks[clicks.length - 1] ?? start) + doneBeat;
  tl.track((t) => {
    const on = already + clicks.filter((c) => t >= c).length;
    const text = t >= doneAt + 0.1 ? done : `${on} of ${n} on`;
    if (count.textContent !== text) count.textContent = text;
  });

  // Click positions, measured with the panel untransformed.
  const at = (s: (typeof switches)[number]): { x: number; y: number } => {
    const r = s.sw.getBoundingClientRect();
    return { x: r.left + r.width * 0.68, y: r.top + r.height * 0.55 };
  };
  if (p.cursor !== false && offs.length > 0) {
    const first = at(offs[0]!);
    const size = ctx.portrait ? 84 : 72;
    const ptr = pointer(ctx, { x: first.x + 140, y: first.y + 220 }, start - 0.2, size);
    offs.forEach((s, i) => {
      const pt = at(s);
      ptr.moveTo(pt.x, pt.y, clicks[i]! - Math.min(0.55, interval * 0.8), Math.min(0.5, interval * 0.75));
      ptr.click(clicks[i]!);
    });
    // Out along the way it was already heading: down the panel.
    const last = at(offs[offs.length - 1]!);
    tl.to(ptr.el, { x: last.x + 40, y: last.y + 200, opacity: 0 }, { at: clicks[clicks.length - 1]! + 0.4, duration: 0.45, ease: "in" });
  }
  offs.forEach((s, i) => {
    const c = clicks[i]! + 0.02;
    tl.to(s.knob, { x: TRAVEL }, { at: c, duration: 0.32, ease: "back-out" });
    tl.to(s.fill, { opacity: 1 }, { at: c, duration: 0.22, ease: "smooth" });
    tl.to(s.label, { opacity: 1 }, { at: c, duration: 0.3, ease: "smooth" });
    tl.to(s.knob, { scaleX: 1.14 }, { at: c, duration: 0.12, ease: "out" });
    tl.to(s.knob, { scaleX: 1 }, { at: c + 0.12, duration: 0.2, ease: "out" });
  });

  // The done state, after a beat of stillness: the tile becomes a check and the count pill fills.
  tl.set(check, { opacity: 0, scale: 0.4 }, 0);
  tl.set(pillFill, { scaleX: 0 }, 0);
  pillFill.style.transformOrigin = "0 50%";
  tl.fromTo(tile, { backgroundColor: hexA(palette.ink, 0.1), color: palette.ink }, { backgroundColor: palette.accent, color: onAccent }, { at: doneAt, duration: 0.35, ease: "smooth" });
  tl.to(shield, { opacity: 0, scale: 0.6 }, { at: doneAt, duration: 0.2, ease: "exit" });
  tl.to(check, { opacity: 1, scale: 1 }, { at: doneAt + 0.08, duration: 0.4, ease: "back-out" });
  tl.to(pillFill, { scaleX: 1 }, { at: doneAt, duration: 0.45, ease: "in-out" });
  tl.fromTo(pill, { color: palette.muted }, { color: onAccent }, { at: doneAt + 0.1, duration: 0.25, ease: "smooth" });
  tl.to(tile, { scale: 1.08 }, { at: doneAt, duration: 0.18, ease: "out" });
  tl.to(tile, { scale: 1 }, { at: doneAt + 0.18, duration: 0.35, ease: "out" });
}

/** `#rrggbb` at alpha `a`, as rgba() (so it interpolates against the accent). */
function hexA(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  const v = (i: number): number => parseInt(m[1]!.slice(i, i + 2), 16);
  return `rgba(${v(0)}, ${v(2)}, ${v(4)}, ${a})`;
}
