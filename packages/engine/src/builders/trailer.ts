/**
 * A trailer in three acts, the arc of the movie and game trailer references
 * (zenvi-styles movie-game-trailer): a cold open of slow shots faded from
 * black, a small card on black, the world built in 1.5-2.5 s shots, one held
 * hit of 4-6 s, black and dead silence, an escalation of shots from 0.8 s
 * down to 0.4 s, black, the title on a braam and the end card. The cut rate
 * rises 1.4-3x from the first act to the last, never one rate throughout.
 * The world build and the escalation cut on the music's beats when there is
 * a grid (the escalation on half beats), else on the frame grid.
 */

export interface TrailerShot {
  /** Index into the media given. */
  media: number;
  /** 1: cold open; 2: world build and the held hit; 3: escalation. */
  act: 1 | 2 | 3;
  start: number;
  end: number;
  /** The one long shot the music builds under. */
  held?: boolean;
}

export interface TrailerCard {
  kind: "act" | "title" | "end";
  text: string;
  start: number;
  end: number;
}

export interface TrailerPlan {
  shots: TrailerShot[];
  cards: TrailerCard[];
  /** Timeline [from, to] where everything falls silent (the music too): black before the escalation. */
  silence: [number, number];
  /** Where the braams hit: the held hit, the escalation and the title. */
  braams: number[];
  /** Where the riser into the silence starts and ends (over the held hit). */
  riser: [number, number];
  /** The cut in the escalation that gets the one white flash (timeline seconds), or null. */
  flash: number | null;
  acts: { act: 1 | 2 | 3; start: number; end: number }[];
  duration: number;
}

export interface TrailerInput {
  /** Visual files available (count). */
  media: number;
  seconds: number;
  fps: number;
  title: string;
  /** Up to two cards on black: after the cold open, and before the held hit. */
  actCards: readonly string[];
  endCard?: string;
  /** Beat times (timeline seconds) to cut the world build and the escalation on. */
  beats?: readonly number[];
  /**
   * Seconds of each file (in `media` order): a file that is already a cut
   * shot (shorter than the act's longest) keeps its own length inside the
   * act's range instead of the act's default, so pre-cut material is not
   * chopped finer than it was shot.
   */
  lengths?: readonly number[];
}

const CARD = 1.8;
const SILENCE = 0.8;
const TITLE = 2.6;
const END = 2.2;
const COLD_SHOT = 2.8;
const WORLD_SHOT = 2;
const ESCALATION_FIRST = 0.8;
const ESCALATION_LAST = 0.4;

function snapTo(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

/** The nearest grid time within `reach`, else `t`. */
function onGrid(t: number, grid: readonly number[], reach: number): number {
  let best = t;
  let gap = reach;
  for (const g of grid) {
    const d = Math.abs(g - t);
    if (d < gap) {
      gap = d;
      best = g;
    }
  }
  return best;
}

/** Half the median gap of a grid: the reach that puts every cut on its nearest grid line. */
function halfGap(grid: readonly number[]): number {
  const gaps = grid.slice(1).map((t, i) => t - grid[i]!).sort((a, b) => a - b);
  return gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! / 2 + 1e-6 : 0;
}

/** Cut a span into shots of the lengths `lengthAt` gives (the i-th shot's; each cut on the nearest grid line), the last one taking what is left. */
function cutSpan(start: number, end: number, lengthAt: (at: number, i: number) => number, grid: readonly number[], fps: number, minShot: number): number[] {
  const cuts = [start];
  const reach = halfGap(grid);
  let at = start;
  for (let i = 0; i < 400; i += 1) {
    let next = snapTo(onGrid(at + lengthAt(at, i), grid, reach), fps);
    if (next - at < minShot) next = snapTo(at + minShot, fps);
    if (end - next < minShot * 0.8) break;
    cuts.push(next);
    at = next;
  }
  cuts.push(end);
  return cuts;
}

export function planTrailer(input: TrailerInput): TrailerPlan {
  const fps = input.fps;
  const count = Math.max(1, input.media);
  /** The length of the shot the next file gives: its own when it is a cut shot within [lo, hi], else `fallback`. */
  const own = (index: number, lo: number, hi: number, fallback: number) => {
    const len = input.lengths?.[index % count];
    return len !== undefined && len > 0 && len <= hi ? Math.max(lo, len) : fallback;
  };
  const [billing, second] = input.actCards.map((t) => t.trim());
  const fixed = (billing ? CARD : 0) + (second ? CARD : 0) + SILENCE + TITLE + (input.endCard ? END : 0);
  const footage = Math.max(8, input.seconds - fixed);
  const held = Math.min(6, Math.max(4, footage * 0.17));
  const cold = footage * 0.3;
  const world = footage * 0.28;
  const escalation = Math.max(2, footage - cold - world - held);
  const grid = input.beats ?? [];
  const half = grid.flatMap((b, i) => (i + 1 < grid.length ? [b, (b + grid[i + 1]!) / 2] : [b]));

  const shots: TrailerShot[] = [];
  const cards: TrailerCard[] = [];
  const braams: number[] = [];
  let media = 0;
  let at = 0;
  const take = (act: TrailerShot["act"], start: number, end: number, extra: Partial<TrailerShot> = {}) => {
    shots.push({ media: media % Math.max(1, input.media), act, start, end, ...extra });
    media += 1;
  };
  const card = (kind: TrailerCard["kind"], text: string, seconds: number) => {
    const start = snapTo(at, fps);
    at = snapTo(start + seconds, fps);
    cards.push({ kind, text, start, end: at });
  };

  // Act one: the cold open.
  const coldStart = 0;
  const coldEnd = snapTo(cold, fps);
  const coldCuts = cutSpan(coldStart, coldEnd, (_, i) => own(media + i, 1.6, 4, COLD_SHOT), [], fps, 1.6);
  for (let i = 0; i + 1 < coldCuts.length; i += 1) take(1, coldCuts[i]!, coldCuts[i + 1]!);
  at = coldEnd;
  if (billing) card("act", billing, CARD);

  // Act two: the world, then the held hit.
  const worldStart = at;
  const worldEnd = snapTo(worldStart + world, fps);
  const worldCuts = cutSpan(worldStart, worldEnd, (_, i) => own(media + i, 1.2, 3, WORLD_SHOT), grid, fps, 1.2);
  for (let i = 0; i + 1 < worldCuts.length; i += 1) take(2, worldCuts[i]!, worldCuts[i + 1]!);
  at = worldEnd;
  if (second) card("act", second, CARD);
  const heldStart = snapTo(at, fps);
  at = snapTo(heldStart + held, fps);
  take(2, heldStart, at, { held: true });
  braams.push(heldStart);
  const actTwo = { act: 2 as const, start: worldStart, end: at };

  // Black and dead silence, then the escalation.
  const silence: [number, number] = [at, snapTo(at + SILENCE, fps)];
  at = silence[1];
  const escStart = at;
  const escEnd = snapTo(escStart + escalation, fps);
  const span = escEnd - escStart;
  const escCuts = cutSpan(escStart, escEnd, (t) => ESCALATION_FIRST + (ESCALATION_LAST - ESCALATION_FIRST) * Math.min(1, (t - escStart) / Math.max(1e-6, span * 0.8)), half, fps, 0.3);
  for (let i = 0; i + 1 < escCuts.length; i += 1) take(3, escCuts[i]!, escCuts[i + 1]!);
  braams.push(escStart);
  // The one white flash: on the cut two thirds into the escalation.
  const inner = escCuts.slice(1, -1);
  const flash = inner.length > 0 ? inner.reduce((a, b) => (Math.abs(b - (escStart + span * 0.66)) < Math.abs(a - (escStart + span * 0.66)) ? b : a)) : null;
  at = escEnd;

  card("title", input.title, TITLE);
  braams.push(cards[cards.length - 1]!.start);
  if (input.endCard) card("end", input.endCard, END);
  return {
    shots,
    cards,
    silence,
    braams,
    riser: [heldStart, silence[0]],
    flash,
    acts: [{ act: 1, start: coldStart, end: coldEnd }, actTwo, { act: 3, start: escStart, end: escEnd }],
    duration: at,
  };
}
