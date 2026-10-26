import type { BlockContext } from "../../runtime/index.js";
import { fitWidth, icon, parseRich, pointer } from "../ui.js";

const ICON_FILLS = ["var(--accent)", "var(--secondary)", "#1E1E24", "#2BB673"];
/** Neutral glyphs we draw (no third-party logos), one per card in turn. */
const CARD_ICONS = ["film", "note", "captions", "layers"] as const;

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const titles = p.cards as string[];
  const details = p.details as string[];
  const S = ctx.seconds;

  // Background: the photo/video, else a drawn sky; a slow settle from 108 %.
  const back = ctx.el("div", "gc-stage");
  const bg = ctx.mediaImg("background", "gc-bg", back);
  if (!bg) {
    ctx.el("div", "gc-sky", back);
    for (const [x, y, w, h] of [[0.1, 0.62, 0.7, 0.2], [0.55, 0.7, 0.6, 0.22], [-0.1, 0.8, 0.8, 0.3], [0.6, 0.18, 0.35, 0.08]] as const) {
      const c = ctx.el("div", "gc-cloud", back);
      Object.assign(c.style, { left: `${x * W}px`, top: `${y * H}px`, width: `${w * W}px`, height: `${h * H}px` });
    }
  }
  ctx.el("div", "gc-shade", back);
  tl.fromTo(back, { scale: 1.08 }, { scale: 1 }, { at: 0, duration: S, ease: "out" });

  // Headline.
  let headlineBottom = safe.top;
  const headline = p.headline ? ctx.el("div", "gc-headline") : null;
  const headWords: HTMLElement[] = [];
  if (headline) {
    const lines = parseRich(String(p.headline));
    const inners = lines.map((runs) => {
      const line = ctx.el("div", "", headline);
      const inner = ctx.el("span", "", line);
      inner.style.whiteSpace = "nowrap";
      runs.forEach((run) =>
        run.text.split(/(\s+)/).forEach((tok) => {
          if (!tok) return;
          if (/^\s+$/.test(tok)) inner.append(ctx.doc.createTextNode(" "));
          else headWords.push(ctx.el("span", run.em ? "word em" : "word", inner, tok));
        }),
      );
      return inner;
    });
    fitWidth(headline, inners, W - safe.left - safe.right, ctx.portrait ? 104 : 96);
    headline.style.top = `${safe.top}px`;
    headlineBottom = safe.top + headline.getBoundingClientRect().height;
    tl.fromTo(headWords, { yPercent: 40, opacity: 0, blur: 12 }, { yPercent: 0, opacity: 1, blur: 0 }, { at: 0.1, duration: 0.7, ease: "out", stagger: 0.06 });
  }

  // Cards: a row on landscape, a column on vertical frames.
  const row = ctx.el("div", "gc-cards");
  row.style.flexDirection = ctx.portrait ? "column" : "row";
  const n = titles.length;
  const cardW = ctx.portrait ? Math.min(760, W - safe.left - safe.right) : Math.min(540, (W - safe.left - safe.right - 28 * (n - 1)) / n);
  const toggles: { knob: HTMLElement; track: HTMLElement; detail: HTMLElement; on: HTMLElement; ring: HTMLElement; card: HTMLElement }[] = [];
  const cards = titles.map((title, i) => {
    const card = ctx.el("div", "gc-card glass", row);
    card.style.width = `${cardW}px`;
    if (ctx.portrait) Object.assign(card.style, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" });
    const top = ctx.el("div", "gc-top", card);
    const ic = ctx.el("div", "gc-icon", top);
    icon(ctx, CARD_ICONS[i % CARD_ICONS.length]!, "", ic);
    ic.style.background = `linear-gradient(145deg, ${ICON_FILLS[i % ICON_FILLS.length]}, color-mix(in srgb, ${ICON_FILLS[i % ICON_FILLS.length]} 70%, #000))`;
    const text = ctx.el("div", "", ctx.portrait ? top : card);
    if (ctx.portrait) text.style.marginLeft = "26px";
    ctx.el("div", "gc-title", text, title);
    const detail = ctx.el("div", "gc-detail", text);
    const off = ctx.el("span", "", detail, details[i] ?? "");
    const on = ctx.el("span", "on", detail);
    icon(ctx, "check", "", on);
    ctx.el("span", "", on, String(p.status));
    on.style.position = "absolute";
    tl.set(on, { opacity: 0 }, 0);
    const toggleTrack = ctx.el("div", "gc-toggle", ctx.portrait ? card : top);
    const knob = ctx.el("div", "gc-knob", toggleTrack);
    const ring = ctx.el("div", "gc-ring", card);
    toggles.push({ knob, track: toggleTrack, detail: off, on, ring, card });
    return card;
  });
  const rowRect = row.getBoundingClientRect();
  const free = H - safe.bottom - headlineBottom;
  const top = headlineBottom + Math.max(40, (free - rowRect.height) / 2);
  Object.assign(row.style, { left: `${(W - rowRect.width) / 2}px`, top: `${top}px` });

  // Entrance in depth: tilted back, rising, focusing; 0.12 s apart.
  tl.fromTo(cards, { y: 120, rotateX: 28, scale: 0.92, opacity: 0, blur: 14 }, { y: 0, rotateX: 0, scale: 1, opacity: 1, blur: 0 }, { at: 0.45, duration: 0.9, ease: "out", stagger: 0.12 });

  const target = Number(p.click);
  if (target >= 0 && target < n) {
    const t = toggles[target]!;
    const rect = t.track.getBoundingClientRect();
    const x = rect.left + rect.width * 0.7;
    const y = rect.top + rect.height / 2;
    const clickAt = Math.min(S - 1.4, 0.45 + n * 0.12 + 1.5);
    const ptr = pointer(ctx, { x: x + 220, y: y + 260 }, clickAt - 1.1);
    ptr.moveTo(x, y, clickAt - 0.85, 0.75);
    ptr.click(clickAt);
    tl.to(ptr.el, { x: x + 120, y: y + 140, opacity: 0 }, { at: clickAt + 0.7, duration: 0.5, ease: "in-out" });
    tl.to(t.knob, { x: 40 }, { at: clickAt + 0.03, duration: 0.35, ease: "back-out" });
    tl.to(t.track, { backgroundColor: "#34C759" }, { at: clickAt + 0.03, duration: 0.25, ease: "smooth" });
    tl.to(t.detail, { opacity: 0, y: -10 }, { at: clickAt + 0.1, duration: 0.25, ease: "exit" });
    tl.fromTo(t.on, { opacity: 0, y: 12 }, { opacity: 1, y: 0 }, { at: clickAt + 0.25, duration: 0.4, ease: "out" });
    tl.fromTo(t.ring, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1 }, { at: clickAt + 0.1, duration: 0.4, ease: "out" });
    tl.to(t.card, { scale: 0.98 }, { at: clickAt, duration: 0.08, ease: "out" });
    tl.to(t.card, { scale: 1.02 }, { at: clickAt + 0.08, duration: 0.35, ease: "back-out" });
  }
}
