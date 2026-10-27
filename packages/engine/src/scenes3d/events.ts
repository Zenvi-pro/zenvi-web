/**
 * Picture events of a Zenvi 3D scene (sfx/events.ts): the impacts, landings,
 * bursts, whooshes, reveals, glints and counter ticks inside a rendered
 * Blender scene, computed from the same timing the scene's bpy script keys
 * (packages/scenes3d/blender/scenes/<id>.py), so the cue sheet can sound them
 * without looking at the movie.
 *
 * Conventions shared by every scene:
 * - Frames are 1-based like the scripts' (frame 1 is t = 0) and rounded the
 *   way Python rounds (`round` is half-to-even, `int` truncates).
 * - An eased move has no contact frame: it reads as arrived once 95 % there
 *   (ARRIVED), which for the scripts' `out` ease is well before its last key.
 *   A whoosh goes where the move is half done (PASSING), the fastest stretch
 *   of an in-out move. Gravity falls (card_stack, model_showcase land) end on
 *   their key at full speed: that frame is the hit.
 * - Positions come from the layout: a lone subject sits on the optical centre
 *   (packages/scenes3d/blender/zenvi3d/camera.py:92-96: centred, 45 % down
 *   the safe area).
 */

import type { ProjectFile } from "../model/types.js";
import type { PictureEvent, PictureEventKind } from "../sfx/events.js";
import { parseScene3dParams, SCENE3D_INFO, type Scene3dId, type Scene3dParams } from "./catalog.js";
import { readBlenderLink } from "./link.js";

type Ease = "smooth" | "out" | "in" | "in-out";

/** CSS cubic-beziers of the scripts' eases (packages/scenes3d/blender/zenvi3d/motion.py:12-19). */
const EASES: Readonly<Record<Ease, readonly [number, number, number, number]>> = {
  smooth: [0.33, 0.0, 0.2, 1.0],
  out: [0.16, 1.0, 0.3, 1.0],
  in: [0.7, 0.0, 0.84, 0.0],
  "in-out": [0.65, 0.0, 0.35, 1.0],
};

const ARRIVED = 0.95;
const PASSING = 0.5;
const CX = 0.5;
const CY = 0.45;
/** Share of the frame's width the safe area spans (camera.py:82-89: 90 % wide, 88 % vertical). */
const SAFE_WIDTH = 0.9;
const DEFAULT_FPS = 30;

/** Python's round(): half to even. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's "%.*f" % (decimals, v): rounds exact ties to even (JS toFixed rounds them up). */
function pyFixed(v: number, decimals: number): string {
  const scale = 10 ** decimals;
  const scaled = v * scale;
  if (scaled / scale === v && Number.isInteger(scaled * 2) && !Number.isInteger(scaled)) return (pyRound(scaled) / scale).toFixed(decimals);
  return v.toFixed(decimals);
}

/** Share of the time `ease` takes to reach `share` of its change (inverse of motion.py:22-35 `bezier`). */
function easeTime(ease: Ease, share: number): number {
  const [x1, y1, x2, y2] = EASES[ease];
  const curve = (s: number, a: number, b: number): number => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    if (curve(s, y1, y2) < share) lo = s;
    else hi = s;
  }
  return curve((lo + hi) / 2, x1, x2);
}

class Clock {
  readonly frames: number;
  constructor(
    readonly fps: number,
    seconds: number,
  ) {
    this.frames = Math.max(2, Math.round(seconds * fps));
  }

  /** Seconds of a 1-based frame (motion.py:110-112). */
  t(frame: number): number {
    return (frame - 1) / this.fps;
  }

  /** Seconds at which an `ease` move keyed from f0 to f1 is `share` done. */
  reach(ease: Ease, f0: number, f1: number, share: number): number {
    return this.t(f0 + (f1 - f0) * easeTime(ease, share));
  }

  /** The middle of the studio's light sweep, keyed over the whole clip in-out (packages/scenes3d/blender/zenvi3d/core.py:133-135). */
  sweep(): number {
    return this.reach("in-out", 1, this.frames, PASSING);
  }
}

type Draft = PictureEvent;

const ev = (t: number, kind: PictureEventKind, weight: number, x = CX, y = CY, run?: { until: number; rate: number }): Draft => ({ t, kind, weight, x, y, ...run });

/** x of item i of n spread evenly across a subject `share` of the safe width wide, centred. */
const across = (i: number, n: number, share: number): number => CX + ((i + 0.5) / n - 0.5) * share * SAFE_WIDTH;

/** A shrink-away exit over the last 0.4 s, `in` eased (title_3d.py:75-77, logo_extrude.py:199-201). */
function exitWhoosh(c: Clock, landed: number): Draft {
  const end = c.frames;
  const holdFrom = Math.min(landed, end - 1);
  const out = Math.max(holdFrom + 1, end - Math.trunc(0.4 * c.fps));
  return ev(c.reach("in", out, end, PASSING), "whoosh", 0.4);
}

/** The light sweep across a reflective finish, once the subject has resolved (a glint on a subject still flying in is lost). */
function glint(c: Clock, after: number, weight = 0.3): Draft[] {
  const t = c.sweep();
  return t > after ? [ev(t, "glint", weight)] : [];
}

/** Styles the studio spins 150 degrees for (title_3d.py:34, logo_extrude.py:158). */
const SWEPT = new Set(["chrome", "iridescent", "glass"]);

/** Non-space characters: shapes.letters makes one glyph per visible character (packages/scenes3d/blender/zenvi3d/shapes.py:116-118). */
const glyphCount = (text: string): number => [...text.replace(/\s/g, "")].length;

function title3d(p: Scene3dParams<"title_3d">, c: Clock): Draft[] {
  const STAGGER = 0.06; // title_3d.py:8
  const fps = c.fps;
  const out: Draft[] = [];
  let landed: number;
  let resolved: number;
  if (p.animation === "tumble") {
    // Letters tumble in one by one, each over ENTRANCE (title_3d.py:50-58).
    const n = Math.max(1, glyphCount(p.text));
    const enter = pyRound(0.8 * fps); // title_3d.py:9, 48
    const f0 = (i: number): number => 1 + pyRound(i * STAGGER * fps);
    for (let i = 0; i < n; i++) out.push(ev(c.reach("out", f0(i), f0(i) + enter, ARRIVED), "land", 0.35, across(i, n, p.size)));
    const mid = Math.floor((n - 1) / 2);
    out.push(ev(c.reach("out", f0(mid), f0(mid) + enter, PASSING), "whoosh", 0.5));
    landed = 1 + pyRound((n - 1) * STAGGER * fps) + enter; // title_3d.py:58
    resolved = c.reach("out", f0(n - 1), landed, ARRIVED);
    out.push(ev(resolved, "reveal", 0.9));
  } else {
    // spin: 200 degrees in over 1.2 s (title_3d.py:59-62); rise: tips up from below over 1.0 s (title_3d.py:63-66).
    const spin = p.animation === "spin";
    landed = 1 + Math.trunc((spin ? 1.2 : 1.0) * fps);
    resolved = c.reach("out", 1, landed, ARRIVED);
    out.push(ev(c.reach("out", 1, landed, PASSING), "whoosh", spin ? 0.6 : 0.45));
    out.push(ev(resolved, "reveal", spin ? 0.9 : 0.85));
  }
  if (SWEPT.has(p.style)) out.push(...glint(c, resolved));
  if (p.exit) out.push(exitWhoosh(c, landed));
  return out;
}

function deviceMockup(p: Scene3dParams<"device_mockup">, c: Clock): Draft[] {
  const fps = c.fps;
  const end = c.frames;
  const out: Draft[] = [];
  const enter = pyRound(1.0 * fps); // device_mockup.py:117
  if (p.move === "hero") {
    // Spins in 142 degrees from below and lands (device_mockup.py:126-131).
    out.push(ev(c.reach("out", 1, enter + 6, PASSING), "whoosh", 0.6));
    out.push(ev(c.reach("out", 1, enter + 6, ARRIVED), "land", 0.7));
    // The camera holds: the studio's 50-degree turn is the light moving over the device (device_mockup.py:103).
    out.push(...glint(c, c.reach("out", 1, enter + 6, ARRIVED), 0.25));
  } else {
    // orbit, push, float: the device is there from the first frame (device_mockup.py:122-135).
    out.push(ev(0, "reveal", p.move === "float" ? 0.5 : 0.6));
    if (p.move === "orbit") out.push(ev(c.reach("in-out", 1, end, PASSING), "whoosh", 0.3)); // device_mockup.py:123
    if (p.move === "push") out.push(ev(c.reach("smooth", 1, end, PASSING), "whoosh", 0.3)); // device_mockup.py:125
    if (p.move === "float") out.push(...glint(c, 0, 0.25)); // device_mockup.py:103, 132-135
  }
  if (p.device === "laptop" && p.open_lid) {
    // The lid swings open over 1.2 s in-out and settles (device_mockup.py:136-139).
    out.push(ev(c.reach("in-out", 1, 1 + Math.trunc(1.2 * fps), ARRIVED), "land", 0.45));
  }
  return out;
}

/** Card slots (x, y in half-frames, depth in hero heights): floating_cards.py:11. */
const FLOATING_SLOTS: readonly (readonly [number, number, number])[] = [
  [0.0, 0.0, 0.0],
  [-0.85, 0.62, -0.55],
  [0.8, -0.45, 1.5],
  [-0.7, -0.75, 2.4],
  [0.72, 0.78, 2.8],
  [0.05, -1.05, 3.6],
  [-0.15, 1.05, 4.2],
  [1.0, 0.1, 4.6],
];

function floatingCards(p: Scene3dParams<"floating_cards">, c: Clock): Draft[] {
  const STAGGER = 0.12; // floating_cards.py:12
  const fps = c.fps;
  const count = Math.max(1, Math.min(FLOATING_SLOTS.length, Math.trunc(p.count ?? p.file_ids?.length ?? 5))); // floating_cards.py:19
  const out: Draft[] = [];
  for (let i = 0; i < count; i++) {
    const [sx, sy, depth] = FLOATING_SLOTS[i]!;
    // Each card rises in and scales up over 0.35 s, out (floating_cards.py:54-57); the slot spread
    // cancels the perspective, so on screen it sits at 0.78 / 0.72 of the half-frame (floating_cards.py:50-51).
    const f0 = 1 + pyRound(i * STAGGER * fps);
    const t = c.reach("out", f0, f0 + Math.trunc(0.35 * fps), PASSING);
    const weight = i === 0 ? 0.55 : Math.max(0.3, 0.45 - 0.03 * depth); // the hero is sharp and near; deep cards are small and soft
    out.push(ev(t, "pop", weight, CX + 0.5 * sx * 0.78, 0.5 - 0.5 * sy * 0.72));
  }
  // The camera glides forward and across, in-out (floating_cards.py:64).
  out.push(ev(c.reach("in-out", 1, c.frames, PASSING), "whoosh", 0.2));
  return out;
}

function iconCube(p: Scene3dParams<"icon_cube">, c: Clock): Draft[] {
  const fps = c.fps;
  const out: Draft[] = [];
  // The cube scales up from 60 % over 0.6 s (icon_cube.py:89).
  out.push(ev(c.reach("out", 1, 1 + Math.trunc(0.6 * fps), PASSING), "reveal", 0.6));
  // It spins 165 degrees, then bursts at spin_end (icon_cube.py:87-92).
  const spinEnd = Math.trunc(c.frames * (p.explode ? 0.45 : 1.0));
  out.push(ev(c.reach(p.explode ? "in-out" : "smooth", 1, spinEnd, PASSING), "whoosh", 0.5));
  if (p.explode) out.push(ev(c.t(spinEnd), "burst", p.grid === 3 ? 0.9 : 0.8));
  return out;
}

function cubeCut(_p: Scene3dParams<"cube_cut">, c: Clock): Draft[] {
  // The box turns 90 degrees in-out across the whole clip; the camera is furthest back at `mid` (cube_cut.py:62-65).
  const mid = 1 + Math.floor((c.frames - 1) / 2);
  return [ev(c.reach("in-out", 1, c.frames, PASSING), "whoosh", 0.7, 0.5, 0.5), ev(c.t(mid), "impact", 0.6, 0.5, 0.5)];
}

function glassHero(_p: Scene3dParams<"glass_hero">, c: Clock): Draft[] {
  // Scales up from 82 % over 0.8 s (glass_hero.py:110-111), then turns in a 90-degree light sweep (glass_hero.py:87).
  const resolved = c.reach("out", 1, 1 + pyRound(0.8 * c.fps), ARRIVED);
  return [ev(resolved, "reveal", 0.8), ...glint(c, resolved, 0.35)];
}

function particleBurst(p: Scene3dParams<"particle_burst">, _c: Clock): Draft[] {
  // Every piece launches on the first frame and pops to size in 0.12 s (particle_burst.py:46, 69, 88-104).
  const count = p.count ?? (p.kind === "sparks" ? 180 : 140);
  return [ev(0, "burst", 0.7 + 0.2 * Math.min(1, count / 200), p.origin_x, p.origin_y)];
}

/** SVG paths are only counted once Blender imports them; assemble assumes a mark of a few pieces. */
const SVG_PIECES = 4;

function logoExtrude(p: Scene3dParams<"logo_extrude">, c: Clock): Draft[] {
  const STAGGER = 0.08; // logo_extrude.py:13
  const fps = c.fps;
  const out: Draft[] = [];
  const enter = pyRound(1.0 * fps); // logo_extrude.py:165
  const settle = pyRound(0.25 * fps); // logo_extrude.py:166
  // A word splits into letters only to assemble, and only when it has more than one (logo_extrude.py:80, 126).
  const pieces = p.svg !== undefined ? SVG_PIECES : p.animation === "assemble" ? glyphCount(p.text ?? "ZENVI") : 1;
  let landed: number;
  let resolved: number;
  if (p.animation === "assemble" && pieces > 1) {
    // Pieces fly together, the last within 0.8 s of the first (logo_extrude.py:167-181).
    const stagger = Math.min(STAGGER, 0.8 / (pieces - 1));
    const f0 = (i: number): number => 1 + pyRound(i * stagger * fps);
    for (let i = 0; i < pieces; i++) out.push(ev(c.reach("out", f0(i), f0(i) + enter, ARRIVED), "land", 0.4, across(i, pieces, p.size)));
    const mid = Math.floor((pieces - 1) / 2);
    out.push(ev(c.reach("out", f0(mid), f0(mid) + enter, PASSING), "whoosh", 0.55));
    landed = f0(pieces - 1) + enter;
    resolved = c.reach("out", f0(pieces - 1), landed, ARRIVED);
    out.push(ev(resolved, "reveal", 0.9));
  } else {
    // One body spins 340 degrees in from behind and below, overshoots 6 degrees and settles (logo_extrude.py:182-188).
    const land = 1 + enter;
    landed = land + settle;
    resolved = c.reach("out", 1, land, ARRIVED);
    out.push(ev(c.reach("out", 1, land, PASSING), "whoosh", 0.6));
    out.push(ev(resolved, "reveal", 0.95));
  }
  if (SWEPT.has(p.style)) out.push(...glint(c, resolved));
  if (p.exit) out.push(exitWhoosh(c, landed));
  return out;
}

function modelShowcase(p: Scene3dParams<"model_showcase">, c: Clock): Draft[] {
  const fps = c.fps;
  const out: Draft[] = [];
  if (p.land) {
    // Falls `in` to the floor, bounces 3 % and settles (model_showcase.py:265-269).
    const f1 = 1 + pyRound(0.55 * fps);
    const f2 = f1 + pyRound(0.3 * fps);
    out.push(ev(c.t(f1), "land", 0.7));
    out.push(ev(c.t(f2), "land", 0.25));
  } else {
    out.push(ev(0, "reveal", 0.7)); // on the floor from the first frame
  }
  if (p.move === "orbit") out.push(ev(c.reach("in-out", 1, c.frames, PASSING), "whoosh", 0.3)); // model_showcase.py:257-258
  if (p.move === "push") out.push(ev(c.reach("smooth", 1, c.frames, PASSING), "whoosh", 0.3)); // model_showcase.py:259-260
  // Chrome mirrors the studio's 40-degree turn (model_showcase.py:210-211, 227).
  if (p.material === "chrome" && p.look === "solid") out.push(...glint(c, p.land ? c.t(1 + pyRound(0.55 * fps)) : 0));
  return out;
}

/** Drum slots: 0-9 and a blank (numerals_3d.py:11-12). */
const SLOTS = 11;
const BLANK = 10;

function numerals3d(p: Scene3dParams<"numerals_3d">, c: Clock): Draft[] {
  const ROLL = 0.6; // numerals_3d.py:14
  const STAGGER = 0.05; // numerals_3d.py:15
  const fps = c.fps;
  const frames = c.frames;
  const values = p.values;
  const texts = values.map((v) => pyFixed(Math.abs(v), p.decimals)); // numerals_3d.py:44-45
  const intLen = Math.max(...texts.map((t) => t.split(".")[0]!.length));
  const drums = intLen + p.decimals; // one drum per digit column (numerals_3d.py:73-109)
  const slots = (text: string): number[] => [...text.replace(".", "").padStart(drums, " ")].map((ch) => (ch === " " ? BLANK : Number(ch))); // numerals_3d.py:144-147

  // Equal steps per value, the last holding at least 30 % (numerals_3d.py:149-157).
  const enter = 2;
  const stagger = pyRound(STAGGER * fps);
  const lastHold = pyRound(0.3 * frames);
  const step = Math.max(3, (frames - enter - lastHold - stagger * (drums - 1)) / values.length);
  const roll = Math.max(2, Math.min(pyRound(ROLL * fps), Math.trunc(step * 0.8) - stagger * (drums - 1)));
  const current: number[] = Array.from({ length: drums }, () => BLANK);
  const out: Draft[] = [];
  let previous: number | null = null;
  let lastEnd = -1;
  // Which drums roll and how far (numerals_3d.py:164-181): one tick per numeral passing the front.
  texts.forEach((text, i) => {
    const target = slots(text);
    const value = values[i]!;
    const up = previous === null || value >= previous;
    const f0 = enter + pyRound(i * step);
    const fullTurn = previous !== null && Math.abs(value - previous) >= 10;
    let first = Infinity;
    let last = -Infinity;
    let most = 0;
    for (let k = 0; k < drums; k++) {
      const units = k === drums - 1;
      if (target[k] === current[k] && !(units && fullTurn)) continue;
      let n = up ? (((target[k]! - current[k]!) % SLOTS) + SLOTS) % SLOTS : -((((current[k]! - target[k]!) % SLOTS) + SLOTS) % SLOTS);
      if (units && fullTurn) n += up ? SLOTS : -SLOTS;
      const start = f0 + k * stagger;
      first = Math.min(first, start);
      last = Math.max(last, start + roll);
      most = Math.max(most, Math.abs(n));
      current[k] = target[k]!;
    }
    previous = value;
    if (most === 0) return;
    out.push(ev(c.t(first), "tick", 0.5, CX, CY, { until: c.t(last), rate: Math.min(30, most / (roll / fps)) }));
    lastEnd = last;
  });
  // The last figure is the one that reads (numerals_3d.py:149-150): it lands as its drums stop.
  if (lastEnd > 0) out.push(ev(c.t(lastEnd), "land", 0.7));
  if (SWEPT.has(p.style)) out.push(...glint(c, lastEnd > 0 ? c.t(lastEnd) : 0)); // numerals_3d.py:135
  return out;
}

function terrainGlide(_p: Scene3dParams<"terrain_glide">, _c: Clock): Draft[] {
  // A backdrop: a steady glide with slow sways, no moment to hit (terrain_glide.py:430-446). Its sound is a bed, not a cue.
  return [];
}

function cardStack(p: Scene3dParams<"card_stack">, c: Clock): Draft[] {
  const STAGGER = 0.12; // card_stack.py:12
  const FALL = 0.7; // card_stack.py:13
  const fps = c.fps;
  const count = Math.max(2, Math.min(12, Math.trunc(p.count ?? p.file_ids?.length ?? 6))); // card_stack.py:59
  const fan = p.animation === "fan";
  const paper = p.kind === "paper";
  const out: Draft[] = [];
  // Each card falls under gravity (1 - u^2) and hits the stack at f1 (card_stack.py:107-124); a fan drops them twice as fast.
  for (let i = 0; i < count; i++) {
    const f0 = 1 + pyRound(i * (STAGGER * (fan ? 0.5 : 1.0)) * fps);
    const f1 = f0 + pyRound(FALL * fps);
    const weight = (paper ? 0.4 : 0.45) + (i === 0 ? 0.1 : 0); // the first lands on the table, the rest on cards
    out.push(ev(c.t(f1), "land", weight));
  }
  if (fan) {
    // The hand opens card after card over 0.6 s, out (card_stack.py:136-148).
    const g0 = (i: number): number => 1 + pyRound((FALL + 0.2 + count * 0.06) * fps) + pyRound(i * 0.05 * fps);
    const mid = Math.floor(count / 2);
    out.push(ev(c.reach("out", g0(mid), g0(mid) + pyRound(0.6 * fps), PASSING), "whoosh", 0.45));
  }
  return out;
}

const SCENES: { readonly [S in Scene3dId]: (params: Scene3dParams<S>, clock: Clock) => Draft[] } = {
  title_3d: title3d,
  device_mockup: deviceMockup,
  floating_cards: floatingCards,
  icon_cube: iconCube,
  cube_cut: cubeCut,
  glass_hero: glassHero,
  particle_burst: particleBurst,
  logo_extrude: logoExtrude,
  model_showcase: modelShowcase,
  numerals_3d: numerals3d,
  terrain_glide: terrainGlide,
  card_stack: cardStack,
};

/** Params that parse for scenes with required keys; the values do not change any timing (title_3d.py:20 defaults the word to ZENVI). */
const FALLBACK: Partial<Record<Scene3dId, Record<string, unknown>>> = {
  title_3d: { text: "ZENVI" },
  cube_cut: { from_clip_id: "from", to_clip_id: "to" },
};

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * The picture events of `scene` rendered `seconds` long at `fps`: sorted,
 * inside [0, seconds). Invalid params fall back to the scene's defaults.
 */
export function scene3dEvents(scene: Scene3dId, params: Record<string, unknown>, seconds: number, fps: number = DEFAULT_FPS): PictureEvent[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  const rate = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
  let parsed = parseScene3dParams(scene, params);
  if (!parsed.ok) parsed = parseScene3dParams(scene, FALLBACK[scene] ?? {});
  if (!parsed.ok) throw new Error(`scene3dEvents: ${scene} has no default params: ${parsed.error}`);
  const build = SCENES[scene] as (params: Scene3dParams, clock: Clock) => Draft[];
  const out: PictureEvent[] = [];
  for (const draft of build(parsed.params, new Clock(rate, seconds))) {
    const t = Math.max(0, r3(draft.t));
    if (t >= seconds) continue;
    const event: PictureEvent = { t, kind: draft.kind, weight: r2(clamp01(draft.weight)), x: r3(clamp01(draft.x)), y: r3(clamp01(draft.y)) };
    if (draft.until !== undefined) {
      const until = Math.min(seconds, r3(draft.until));
      if (until > t) event.until = until;
    }
    if (draft.rate !== undefined && draft.rate > 0) event.rate = Math.min(30, r2(draft.rate));
    out.push(event);
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The picture events of a file rendered by Zenvi 3D, from its Blender link:
 * the stored params, the render's fps, and its length (`seconds`, else
 * duration_frames / fps). Null when the file is not a 3D scene.
 */
export function readScene3dEvents(file: ProjectFile, seconds?: number): PictureEvent[] | null {
  const link = readBlenderLink(file);
  if (!link) return null;
  const render = (link.link.render && typeof link.link.render === "object" ? link.link.render : {}) as { fps?: { num?: unknown; den?: unknown }; duration_frames?: unknown };
  const fps = Number(render.fps?.num) / (Number(render.fps?.den) || 1);
  const rate = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
  const frames = Number(render.duration_frames);
  const length =
    seconds !== undefined && Number.isFinite(seconds) && seconds > 0
      ? seconds
      : Number.isFinite(frames) && frames > 0
        ? frames / rate
        : Number(file.duration) > 0
          ? Number(file.duration)
          : SCENE3D_INFO[link.scene].defaultSeconds;
  return scene3dEvents(link.scene, link.props, length, rate);
}
