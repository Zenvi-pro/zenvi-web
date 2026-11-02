/**
 * A scene module's exports, checked: the frame grid, the cues and the
 * params, as the tools and the page's kit use them. The cues that name a
 * picture event kind become the scene's picture events (sfx/events.ts),
 * so the sound design hears exactly the beats the picture is timed to.
 */

import { isPictureEventKind, readPictureEvents, type PictureEvent, type SceneProblem } from "@zenvi/engine";
import { SCENE_LIMITS, type RawSceneExports, type SceneCue, type SceneInfo } from "../scene/contract.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

export type SceneInfoResult = { ok: true; info: SceneInfo; problems: SceneProblem[] } | { ok: false; problems: SceneProblem[] };

/** Check what the module exported. Errors make the scene unusable; warnings are values taken as near misses. */
export function sceneInfo(raw: RawSceneExports): SceneInfoResult {
  const problems: SceneProblem[] = [];
  const error = (message: string): void => void problems.push({ code: "exports", severity: "error", message });
  const warn = (code: string, message: string): void => void problems.push({ code, severity: "warning", message });
  if (!raw.draw) error("draw must be a function: export function draw(ctx, t, api) { … }");
  const fps = raw.fps;
  if (!finite(fps) || fps < 1 || fps > SCENE_LIMITS.maxFps) error(`fps must be a number from 1 to ${SCENE_LIMITS.maxFps} (got ${JSON.stringify(fps)})`);
  const duration = raw.duration;
  if (!finite(duration) || duration < 1 || !Number.isInteger(duration)) error(`duration must be a whole number of frames, at least 1 (got ${JSON.stringify(duration)})`);
  if (problems.length > 0) return { ok: false, problems };
  const f = fps as number;
  const d = duration as number;
  if (d / f > SCENE_LIMITS.seconds) return { ok: false, problems: [{ code: "exports", severity: "error", message: `the scene runs ${round(d / f, 2)} s; a scene is at most ${SCENE_LIMITS.seconds} s (split it in shots)` }] };
  if (raw.alpha !== undefined && typeof raw.alpha !== "boolean") warn("exports", "alpha should be true or false; it was taken as false");
  if (raw.params !== undefined && !isRecord(raw.params)) error("params must be an object of default values");
  const params = isRecord(raw.params) ? raw.params : {};
  if (raw.cues !== undefined && !isRecord(raw.cues)) error("cues must be an object: { name: frame } or { name: { at: frame, kind, … } }");
  if (problems.some((p) => p.severity === "error")) return { ok: false, problems };

  const cues: SceneCue[] = [];
  const entries = Object.entries(isRecord(raw.cues) ? raw.cues : {});
  if (entries.length > SCENE_LIMITS.cues) return { ok: false, problems: [{ code: "cues", severity: "error", message: `a scene has at most ${SCENE_LIMITS.cues} cues (got ${entries.length})` }] };
  for (const [name, spec] of entries) {
    const at = finite(spec) ? spec : isRecord(spec) ? spec.at : undefined;
    if (!finite(at)) {
      error(`cue ${name} needs a frame (a number, or { at: frame })`);
      continue;
    }
    if (at < 0 || at > d) {
      problems.push({ code: "cues", severity: "error", message: `cue ${name} is at frame ${at}, outside the scene (0-${d})` });
      continue;
    }
    if (!Number.isInteger(at)) warn("cues", `cue ${name} is at frame ${at}, between frames: cues sit on the grid (round it)`);
    const cue: SceneCue = { name, frame: at, weight: 0.5, x: 0.5, y: 0.5 };
    if (isRecord(spec)) {
      if (spec.kind !== undefined) {
        if (isPictureEventKind(spec.kind)) cue.kind = spec.kind;
        else warn("cues", `cue ${name}: kind ${JSON.stringify(spec.kind)} is not a picture event (click, toggle, type, pop, land, impact, whoosh, reveal, glint, tick, burst, swap); it makes no sound`);
      }
      if (finite(spec.weight)) cue.weight = round(clamp(spec.weight, 0, 1), 2);
      if (finite(spec.x)) cue.x = round(clamp(spec.x, 0, 1), 3);
      if (finite(spec.y)) cue.y = round(clamp(spec.y, 0, 1), 3);
      if (finite(spec.until)) {
        if (spec.until > at) cue.until = Math.min(spec.until, d);
        else warn("cues", `cue ${name}: until (${spec.until}) must come after at (${at}); dropped`);
      }
      if (finite(spec.rate) && spec.rate > 0) cue.rate = round(Math.min(30, spec.rate), 2);
      if (finite(spec.hit) && spec.hit > 0) cue.hit = round(Math.min(2, spec.hit), 2);
      if (finite(spec.shake) && spec.shake > 0) cue.shake = round(Math.min(80, spec.shake), 1);
      if (finite(spec.flash) && spec.flash >= 0) cue.flash = round(Math.min(2, spec.flash), 2);
      if (spec.cut === true) cue.cut = true;
    }
    cues.push(cue);
  }
  cues.sort((a, b) => a.frame - b.frame || (a.name < b.name ? -1 : 1));
  const title = typeof raw.title === "string" ? raw.title.slice(0, 80) : undefined;
  const info: SceneInfo = { fps: f, duration: d, alpha: raw.alpha === true, cues, params, ...(title ? { title } : {}) };
  return problems.some((p) => p.severity === "error") ? { ok: false, problems } : { ok: true, info, problems };
}

/** The cues that make a sound, as picture events (seconds from the scene's start). */
export function sceneEvents(info: SceneInfo): PictureEvent[] {
  const seconds = info.duration / info.fps;
  const raw = info.cues
    .filter((c) => c.kind !== undefined && c.frame / info.fps < seconds)
    .map((c) => ({
      t: round(c.frame / info.fps, 3),
      kind: c.kind,
      weight: c.weight,
      x: c.x,
      y: c.y,
      ...(c.until !== undefined ? { until: round(c.until / info.fps, 3) } : {}),
      ...(c.rate !== undefined ? { rate: c.rate } : {}),
    }));
  return readPictureEvents(raw);
}

/**
 * Output frames' sample positions (output frames, fractional) for motion
 * blur: `samples` sub-frames over a 180° shutter, each kept inside the shot
 * the frame belongs to, so a frame never mixes two sides of a cut.
 * `cuts` are output-frame positions.
 */
export function sceneSampleFrames(frames: number, samples: number, cuts: readonly number[]): number[] {
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: number[] = [];
  for (let f = 0; f < frames; f += 1) {
    let from = 0;
    let to = frames;
    for (const c of sorted) {
      if (c <= f + 1e-9) from = c;
      else {
        to = c;
        break;
      }
    }
    for (let k = 0; k < samples; k += 1) {
      const offset = samples > 1 ? (k / samples - 0.5) * 0.5 : 0;
      out.push(clamp(f + offset, from, Math.max(from, to - 1e-3)));
    }
  }
  return out;
}
