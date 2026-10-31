/**
 * The kinetic_cut_scene storyboard: one line per shot,
 *
 *   <beats> <entrance> <text> [| <sub line>] [@layout] [#ground] [+layer …] [!]
 *
 * e.g. `2 slam LAUNCH DAY | 12.03 @bleed #accent +rings !`. Beats are on the
 * block's BPM grid (1 / 2 / 4 / 8, halves allowed); " / " breaks the text into
 * lines; `!` is the climax (the heaviest hit, a shake). Parsing and timing are
 * pure so the schedule, the hits and the sound cues are tested without a page.
 */

import type { PictureEventKind } from "@zenvi/engine";
import { fitsFlashLimit } from "@zenvi/engine/flashing";
import type { Hit } from "../../runtime/hit.js";

export const ENTRANCES = ["slam", "type", "assemble", "mask", "flip", "stretch", "drop", "count", "strobe", "none"] as const;
export type Entrance = (typeof ENTRANCES)[number];
export const LAYOUTS = ["center", "left", "right", "bleed", "top", "bottom", "diagonal", "space", "split"] as const;
export type Layout = (typeof LAYOUTS)[number];
export const GROUNDS = ["dark", "light", "accent", "secondary"] as const;
export type Ground = (typeof GROUNDS)[number];
export const LAYERS = ["scope", "routes", "rings", "rays", "grid", "orbit", "bars", "tunnel", "blobs", "marquee", "dial", "collapse"] as const;
export type Layer = (typeof LAYERS)[number];

export interface ShotSpec {
  beats: number;
  entrance: Entrance;
  /** Lines of the main text. */
  lines: string[];
  sub: string;
  layout: Layout;
  ground: Ground;
  layers: Layer[];
  climax: boolean;
}

export interface Shot extends ShotSpec {
  index: number;
  start: number;
  end: number;
}

const has = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

/** One storyboard line as a shot; an error message when it cannot be read. */
export function parseShot(line: string): ShotSpec | string {
  const [head = "", ...rest] = line.split("|");
  const sub = rest.join("|").trim();
  const words = head.trim().split(/\s+/).filter(Boolean);
  const spec: ShotSpec = { beats: 2, entrance: "slam", lines: [], sub: "", layout: "center", ground: "dark", layers: [], climax: false };
  const text: string[] = [];
  let i = 0;
  const beats = /^(\d+(?:\.\d+)?)b?$/i.exec(words[0] ?? "");
  if (beats) {
    spec.beats = Number(beats[1]);
    i = 1;
  }
  const entrance = (words[i] ?? "").toLowerCase();
  if (has(ENTRANCES, entrance)) {
    spec.entrance = entrance;
    i += 1;
  }
  // Modifiers may also trail the sub line.
  const subWords: string[] = [];
  const tokens = [...words.slice(i).map((w) => ({ w, sub: false })), ...sub.split(/\s+/).filter(Boolean).map((w) => ({ w, sub: true }))];
  for (const { w, sub: inSub } of tokens) {
    const low = w.toLowerCase();
    if (w === "!") spec.climax = true;
    else if (low.startsWith("@") && w.length > 1) {
      if (!has(LAYOUTS, low.slice(1))) return `unknown layout ${w} (${LAYOUTS.map((l) => `@${l}`).join(", ")})`;
      spec.layout = low.slice(1) as Layout;
    } else if (low.startsWith("#") && w.length > 1 && has(GROUNDS, low.slice(1))) spec.ground = low.slice(1) as Ground;
    else if (low.startsWith("+") && w.length > 1) {
      if (!has(LAYERS, low.slice(1))) return `unknown layer ${w} (${LAYERS.map((l) => `+${l}`).join(", ")})`;
      if (!spec.layers.includes(low.slice(1) as Layer)) spec.layers.push(low.slice(1) as Layer);
    } else (inSub ? subWords : text).push(w);
  }
  spec.lines = text.join(" ").split(/\s+\/\s+/).map((l) => l.trim()).filter(Boolean);
  spec.sub = subWords.join(" ");
  if (!(spec.beats > 0 && spec.beats <= 32)) return `beats must be 0-32, got ${spec.beats}`;
  if (spec.lines.length === 0 && spec.entrance !== "none") return `shot "${line}" has no text (use the entrance none for a picture-only shot)`;
  return spec;
}

/** The storyboard laid on the beat grid, fitted to `seconds`: the last shot holds to the end, shots past it are dropped. */
export function scheduleShots(specs: readonly ShotSpec[], bpm: number, seconds: number): Shot[] {
  const beat = 60 / bpm;
  const out: Shot[] = [];
  let t = 0;
  for (const spec of specs) {
    if (t >= seconds - 0.05) break;
    const end = Math.min(seconds, t + spec.beats * beat);
    out.push({ ...spec, index: out.length, start: t, end });
    t = end;
  }
  const last = out[out.length - 1];
  if (last) last.end = seconds;
  return out;
}

/** Strobe words change every half beat, or every beat when that leaves each word under 0.3 s. */
export function strobeStep(shot: Shot, bpm: number): number {
  const words = shot.lines.join(" ").split(/\s+/).filter(Boolean).length;
  const half = 30 / bpm;
  return Math.max(half, Math.min(60 / bpm, (shot.end - shot.start) / Math.max(1, words)));
}

/** Flashes at least this far apart: 3 a second or fewer (WCAG 2.3.1). */
const FLASH_GAP = 1 / 3;

/**
 * The hits: every cut, every strobe word (half strength), the climax heavier
 * with a shake (design px at 1080). Stronger hits keep their flash first; a
 * hit closer than FLASH_GAP to a kept flash only punches.
 */
export function shotHits(shots: readonly Shot[], bpm: number, scale = 1): Hit[] {
  const hits: Hit[] = [];
  for (const shot of shots) {
    hits.push(shot.climax ? { t: shot.start, strength: 1.35, shake: 20 * scale } : { t: shot.start, strength: 1, ...(shot.entrance === "slam" ? { shake: 6 * scale } : {}) });
    if (shot.entrance === "strobe") {
      const step = strobeStep(shot, bpm);
      for (let t = shot.start + step; t < shot.end - 0.05; t += step) hits.push({ t, strength: 0.55 });
    }
  }
  const flashes: number[] = [];
  for (const h of [...hits].sort((a, b) => b.strength - a.strength || a.t - b.t)) {
    if (flashes.some((t) => Math.abs(t - h.t) < FLASH_GAP - 1e-6)) h.flash = 0;
    else flashes.push(h.t);
  }
  return hits;
}

/** The ground a shot shows at u s into it: strobe flips its ground with the words, at most 3 flips a second. */
export function groundAt(shot: Shot, bpm: number, u: number): Ground {
  if (shot.entrance !== "strobe") return shot.ground;
  const step = strobeStep(shot, bpm);
  if (step < 1 / 3) return shot.ground;
  const order: Ground[] = shot.ground === "light" ? ["light", "dark", "accent"] : shot.ground === "accent" ? ["accent", "dark", "light"] : ["dark", "light", "accent"];
  return order[Math.floor(u / step) % order.length]!;
}

/**
 * Seconds where the ground changes: cuts between shots on different grounds
 * and a strobe's flips. Every change counts toward a flash whatever the
 * palette, so the page and the receipt's warning agree.
 */
export function groundChanges(shots: readonly Shot[], bpm: number): number[] {
  const out: number[] = [];
  let previous: Ground | undefined;
  for (const shot of shots) {
    const step = shot.entrance === "strobe" ? strobeStep(shot, bpm) : Infinity;
    for (let u = 0; shot.start + u < shot.end - 1e-6; u += step) {
      const ground = groundAt(shot, bpm, u);
      if (previous !== undefined && ground !== previous) out.push(shot.start + u);
      previous = ground;
      if (!Number.isFinite(step)) break;
    }
  }
  return out;
}

/** A hit's flash fades over about this long (hitEnvelope's decay): its two luminance changes. */
const HIT_FLASH_SECONDS = 0.12;

/**
 * Take the flash off the hits (they still punch) that would make more than
 * 3 flashes in a second (WCAG 2.3.1) with the ground changes and the stronger
 * hits' flashes. Returns how many lost it.
 */
export function limitHitFlashes(shots: readonly Shot[], hits: Hit[], bpm: number): number {
  const kept = groundChanges(shots, bpm);
  let dropped = 0;
  for (const h of [...hits].sort((a, b) => b.strength - a.strength || a.t - b.t)) {
    if (h.flash === 0) continue;
    const changes = [h.t, h.t + HIT_FLASH_SECONDS];
    if (fitsFlashLimit(kept, changes)) kept.push(...changes);
    else {
      h.flash = 0;
      dropped += 1;
    }
  }
  return dropped;
}

/** The receipt's warning when hits lose their flash: counted on the whole storyboard (the block may cut it shorter). */
export function flashNote(params: Readonly<Record<string, unknown>>): string | undefined {
  if (params.allow_strobe === true) return undefined;
  const bpm = Number(params.bpm) || 120;
  const specs = ((params.shots as string[] | undefined) ?? []).filter((l) => l.trim()).map(parseShot).filter((s): s is ShotSpec => typeof s !== "string");
  const shots = scheduleShots(specs, bpm, specs.reduce((t, s) => t + (s.beats * 60) / bpm, 0));
  const dropped = limitHitFlashes(shots, shotHits(shots, bpm), bpm);
  if (dropped === 0) return undefined;
  return `${dropped} hit(s) punch without their flash: with the ground changes they made more than 3 flashes in a second, which can trigger seizures (WCAG 2.3.1); fewer ground changes on fast cuts keep them, allow_strobe=true only when the user asks for a strobe`;
}

export interface ShotCue {
  t: number;
  kind: PictureEventKind;
  weight: number;
  until?: number;
  rate?: number;
}

/** Seconds a typed line takes: 22 characters a second, at most 60 % of the shot. */
export function typingSeconds(shot: Shot): number {
  return Math.min((shot.end - shot.start) * 0.6, Math.max(0.25, shot.lines.join(" ").length / 22));
}

/** What the ear should hear: a sound on every cut, typing and counting runs, the assembly's landing. */
export function shotCues(shots: readonly Shot[], bpm: number): ShotCue[] {
  const cues: ShotCue[] = [];
  for (const shot of shots) {
    const u = shot.start;
    const len = shot.end - shot.start;
    const cut: PictureEventKind = shot.entrance === "stretch" || shot.entrance === "flip" || shot.layers.includes("rays") ? "whoosh" : "impact";
    cues.push({ t: u, kind: cut, weight: shot.climax ? 1 : shot.entrance === "slam" ? 0.8 : 0.6 });
    if (shot.entrance === "type") cues.push({ t: u + 0.05, kind: "type", weight: 0.25, until: u + 0.05 + typingSeconds(shot), rate: 18 });
    if (shot.entrance === "count") cues.push({ t: u + 0.06, kind: "tick", weight: 0.3, until: u + 0.06 + len * 0.7, rate: 14 });
    if (shot.entrance === "assemble" && len > 1.1) cues.push({ t: u + 1.0, kind: "reveal", weight: 0.7 });
    if (shot.entrance === "strobe") {
      const step = strobeStep(shot, bpm);
      for (let t = u + step; t < shot.end - 0.05; t += step) cues.push({ t, kind: "swap", weight: 0.45 });
    }
    if (shot.layers.includes("rings")) cues.push({ t: u + 0.02, kind: "burst", weight: 0.5 });
  }
  return cues.sort((a, b) => a.t - b.t);
}
