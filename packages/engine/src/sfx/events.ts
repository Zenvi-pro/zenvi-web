/**
 * Picture events: what happens inside a motion block or a 3D scene that
 * the ear expects to hear (CRAFT.md §1, §9): a cursor click, a toggle, a
 * card landing, a counter ticking, a logo slamming in. Blocks report them
 * from their own timeline (`@zenvi/motion` `ctx.cue`), 3D scenes from their
 * scripts' timing (scenes3d/events.ts); the cue sheet (sfx/spot.ts) maps
 * them onto the timeline.
 */

export const PICTURE_EVENT_KINDS = [
  /** A cursor click, a button press, a chip select. */
  "click",
  /** A switch flipping (two clicks: on and off are different sounds). */
  "toggle",
  /** Typing: a run of key strikes from `t` to `until` at `rate` keys/s. */
  "type",
  /** A card, bubble or notification popping in. */
  "pop",
  /** Something settling into place: a card landing, a device setting down, a stack dropping. */
  "land",
  /** A heavy hit: a slam, a collision, a word stamping in. */
  "impact",
  /** Something travelling across the frame (fly-in, swipe, spin). */
  "whoosh",
  /** A hero reveal: a logo or product appearing, an end card resolving. */
  "reveal",
  /** A light sweep or specular pass, a sparkle. */
  "glint",
  /** A counter or odometer rolling: one tick per value change from `t` to `until` at `rate`/s. */
  "tick",
  /** Particles, shards or confetti bursting out. */
  "burst",
  /** A letter or word swapping (scramble, rotator, morph). */
  "swap",
] as const;
export type PictureEventKind = (typeof PICTURE_EVENT_KINDS)[number];

export interface PictureEvent {
  /** Seconds from the start of the block or scene. */
  t: number;
  kind: PictureEventKind;
  /** 0..1: how big it is on screen (a full-frame logo slam near 1, a cursor tap near 0.3). */
  weight: number;
  /** Where on screen, 0..1 of the frame's width and height (0.5 = the centre). */
  x: number;
  y: number;
  /** Runs (`type`, `tick`): seconds the run ends. */
  until?: number;
  /** Runs: events per second (keys, digit changes). */
  rate?: number;
}

export function isPictureEventKind(value: unknown): value is PictureEventKind {
  return typeof value === "string" && (PICTURE_EVENT_KINDS as readonly string[]).includes(value);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Events read back from a project record (the desktop keeps unknown keys,
 * but a hand-edited file may hold anything): bad rows are dropped, numbers
 * clamped, and the list sorted by time. At most `max` rows.
 */
export function readPictureEvents(raw: unknown, max = 500): PictureEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: PictureEvent[] = [];
  for (const row of raw.slice(0, max)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const t = Number(r.t);
    if (!isPictureEventKind(r.kind) || !Number.isFinite(t) || t < 0) continue;
    const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : fallback);
    const event: PictureEvent = { t, kind: r.kind, weight: clamp(num(r.weight, 0.5), 0, 1), x: clamp(num(r.x, 0.5), 0, 1), y: clamp(num(r.y, 0.5), 0, 1) };
    const until = num(r.until, NaN);
    if (Number.isFinite(until) && until > t) event.until = until;
    const rate = num(r.rate, NaN);
    if (Number.isFinite(rate) && rate > 0) event.rate = Math.min(rate, 30);
    out.push(event);
  }
  return out.sort((a, b) => a.t - b.t);
}
