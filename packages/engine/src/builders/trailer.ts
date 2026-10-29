/**
 * A trailer in three acts: the world (long, quiet shots, faded), the
 * trouble (shots at half that), the climax (each shot shorter than the one
 * before it, down to a few frames), then a beat of silence on black, the
 * title on a braam, and the end card. A title card on black sits between
 * the acts. Act two and the climax cut on the music's beats when there is a
 * grid (the climax on half beats), else on the frame grid.
 */

export interface TrailerShot {
  /** Index into the media given. */
  media: number;
  act: 1 | 2 | 3;
  start: number;
  end: number;
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
  /** Timeline [from, to] where everything falls silent (the music too). */
  silence: [number, number];
  /** Where the braams hit: the start of act two, of the climax and the title. */
  braams: number[];
  /** Where the riser into the silence starts and ends. */
  riser: [number, number];
  acts: { act: 1 | 2 | 3; start: number; end: number }[];
  duration: number;
}

export interface TrailerInput {
  /** Visual files available (count). */
  media: number;
  seconds: number;
  fps: number;
  title: string;
  /** Up to two cards between the acts. */
  actCards: readonly string[];
  endCard?: string;
  /** Beat times (timeline seconds) to cut acts two and three on. */
  beats?: readonly number[];
}

const ACT_CARD = 1.4;
const SILENCE = 0.8;
const TITLE = 2.6;
const END = 2.2;
/** Shot lengths: act one holds, act two halves it, the climax runs from CLIMAX_FIRST down to CLIMAX_LAST. */
const ACT1_SHOT = 2.8;
const ACT2_SHOT = 1.3;
const CLIMAX_FIRST = 0.9;
const CLIMAX_LAST = 0.2;

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

/** Cut a span into shots of the lengths `lengthAt(i)` gives, the last one taking what is left. */
function cutSpan(start: number, end: number, lengthAt: (i: number, at: number) => number, grid: readonly number[], fps: number, minShot: number): number[] {
  const cuts = [start];
  let at = start;
  for (let i = 0; i < 400; i += 1) {
    let next = snapTo(onGrid(at + lengthAt(i, at), grid, 0.12), fps);
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
  const cardsBetween = input.actCards.slice(0, 2).filter((t) => t.trim());
  const fixed = cardsBetween.length * ACT_CARD + SILENCE + TITLE + (input.endCard ? END : 0);
  const footage = Math.max(6, input.seconds - fixed);
  const lengths = [footage * 0.3, footage * 0.33, footage * 0.37];
  const grid = input.beats ?? [];
  const half = grid.flatMap((b, i) => (i + 1 < grid.length ? [b, (b + grid[i + 1]!) / 2] : [b]));

  const shots: TrailerShot[] = [];
  const cards: TrailerCard[] = [];
  const acts: TrailerPlan["acts"] = [];
  const braams: number[] = [];
  let at = 0;
  let media = 0;
  for (const act of [1, 2, 3] as const) {
    const start = snapTo(at, fps);
    const end = snapTo(start + lengths[act - 1]!, fps);
    const span = end - start;
    const cuts =
      act === 1
        ? cutSpan(start, end, () => ACT1_SHOT, [], fps, 1.2)
        : act === 2
          ? cutSpan(start, end, () => ACT2_SHOT, grid, fps, 0.6)
          : cutSpan(start, end, (_, t) => CLIMAX_FIRST + (CLIMAX_LAST - CLIMAX_FIRST) * Math.min(1, (t - start) / Math.max(1e-6, span * 0.85)), half, fps, 3 / fps);
    for (let i = 0; i + 1 < cuts.length; i += 1) {
      shots.push({ media: media % Math.max(1, input.media), act, start: cuts[i]!, end: cuts[i + 1]! });
      media += 1;
    }
    acts.push({ act, start, end });
    if (act > 1) braams.push(start);
    at = end;
    const card = cardsBetween[act - 1];
    if (act < 3 && card) {
      cards.push({ kind: "act", text: card, start: at, end: snapTo(at + ACT_CARD, fps) });
      at = snapTo(at + ACT_CARD, fps);
    }
  }
  // The climax's braam comes on its first shot; the riser runs over the climax into the silence.
  const climax = acts[2]!;
  const silence: [number, number] = [at, snapTo(at + SILENCE, fps)];
  const riser: [number, number] = [Math.max(climax.start, silence[0] - 4), silence[0]];
  at = silence[1];
  cards.push({ kind: "title", text: input.title, start: at, end: snapTo(at + TITLE, fps) });
  braams.push(at);
  at = snapTo(at + TITLE, fps);
  if (input.endCard) {
    cards.push({ kind: "end", text: input.endCard, start: at, end: snapTo(at + END, fps) });
    at = snapTo(at + END, fps);
  }
  return { shots, cards, silence, braams, riser, acts, duration: at };
}
