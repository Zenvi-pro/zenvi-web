import { formatNumber, resolveEase, splitText, type BlockContext } from "../../runtime/index.js";
import { mixHex } from "../ui.js";
import { overtakes, periodLabel, planRace, smoothRanks, valuesAt } from "./race.js";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const plan = planRace(p);
  // checkParams refuses malformed series before a block is built.
  if ("error" in plan) throw new Error(plan.error);
  const top = Math.min(Number(p.top), plan.series.length);
  const fmt = { prefix: String(p.prefix ?? ""), suffix: String(p.suffix ?? ""), decimals: Number(p.decimals) };
  const pinned = plan.series.findIndex((s) => s.name.toLowerCase() === String(p.highlight ?? "").trim().toLowerCase());

  const title = p.title ? ctx.el("div", "br-title", ctx.root, String(p.title)) : null;
  if (title) Object.assign(title.style, { left: `${safe.left}px`, top: `${safe.top}px`, width: `${W - safe.left - safe.right}px` });
  const headBottom = title ? safe.top + title.getBoundingClientRect().height + 50 : safe.top;

  // Names in a column at the left, bars from an axis, values after each bar's end.
  const contentW = W - safe.left - safe.right;
  const nameW = Math.min(360, contentW * (ctx.portrait ? 0.3 : 0.2));
  const valueW = ctx.portrait ? 150 : 190;
  const x0 = safe.left + nameW;
  const barMax = contentW - nameW - valueW;
  const plotTop = headBottom;
  const periodSize = Math.min(H * (ctx.portrait ? 0.11 : 0.24), contentW * 0.3);
  // On a vertical frame the bars run the full width, so the ghost period gets its own band under them.
  const plotH = H - safe.bottom - plotTop - (ctx.portrait ? periodSize * 1.1 : 0);
  const pitch = plotH / top;
  const barH = pitch * 0.72;
  const fontSize = Math.max(22, Math.min(40, barH * 0.42));

  const axis = ctx.el("div", "br-axis");
  Object.assign(axis.style, { left: `${x0 - 1.5}px`, top: `${plotTop}px`, height: `${plotH}px` });
  tl.fromTo(axis, { scaleY: 0 }, { scaleY: 1 }, { at: 0.2, duration: 0.6, ease: "in-out" });

  // The ghost period sits low on the right (behind the bars' short end on a wide frame).
  const period = ctx.el("div", "br-period", ctx.root, plan.periods[0]!);
  Object.assign(period.style, { right: `${safe.right}px`, bottom: `${safe.bottom + (ctx.portrait ? 0 : pitch * 0.15)}px`, fontSize: `${periodSize}px` });
  ctx.root.insertBefore(period, axis);
  tl.fromTo(period, { opacity: 0 }, { opacity: 0.16 }, { at: 0.3, duration: 0.6, ease: "smooth" });

  const tones = plan.series.map((_, i) => mixHex(palette.paper, palette.ink, 0.3 + 0.12 * (i % 3)));
  const rows = plan.series.map((s) => {
    const row = ctx.el("div", "br-row");
    Object.assign(row.style, { left: `${x0}px`, height: `${barH}px`, width: `${barMax}px` });
    const bar = ctx.el("div", "br-bar", row);
    const name = ctx.el("div", "br-name", row, s.name);
    name.style.fontSize = `${fontSize}px`;
    const value = ctx.el("div", "br-value", row);
    value.style.fontSize = `${fontSize * 0.9}px`;
    return { row, bar, value };
  });

  // The race: periods spread evenly from raceAt to raceEnd, then the last one holds.
  const raceAt = 0.8;
  const raceEnd = ctx.seconds - 1.4;
  const last = plan.periods.length - 1;
  const posAt = (t: number): number => (clamp01((t - raceAt) / (raceEnd - raceAt)) * last);
  const grow = resolveEase("out");
  // A swap slides over about a third of a second of race.
  const window = (last / (raceEnd - raceAt)) * 0.35;

  tl.track((t) => {
    const pos = posAt(t);
    const values = valuesAt(plan, pos);
    const ranks = smoothRanks(plan, pos, window);
    const scale = Math.max(1e-9, ...values);
    const intro = grow(clamp01((t - 0.3) / 0.8));
    rows.forEach(({ row, bar, value }, i) => {
      const rank = ranks[i]!;
      const y = plotTop + rank * pitch + (pitch - barH) / 2;
      row.style.transform = `translateY(${r1(y)}px)`;
      // Below the top bars the row fades out as it slides off the plot.
      row.style.opacity = r1(clamp01(top - rank) * intro);
      const w = Math.max(4, (values[i]! / scale) * barMax * intro);
      bar.style.width = `${r1(w)}px`;
      const lead = pinned >= 0 ? (i === pinned ? 1 : 0) : clamp01(1 - rank);
      bar.style.background = mixHex(tones[i]!, palette.accent, lead);
      value.style.left = `${r1(w + 18)}px`;
      value.textContent = formatNumber(values[i]! * intro, fmt);
      value.style.color = lead > 0.5 ? palette.accent : palette.muted;
    });
    period.textContent = periodLabel(plan, pos);
  });

  if (title) {
    const split = splitText(title, { lines: true });
    tl.fromTo(split.lineInners, { yPercent: 105 }, { yPercent: 0 }, { at: 0, duration: 0.7, ease: "out", stagger: 0.12 });
  }
  ctx.cue(0.3, "reveal", { weight: 0.4 });
  const perSecond = last / (raceEnd - raceAt);
  for (const pos of overtakes(plan, top, perSecond * 0.3)) ctx.cue(raceAt + pos / perSecond, "swap", { weight: 0.3 });
  ctx.cue(raceEnd, "land", { weight: 0.5 });
}
