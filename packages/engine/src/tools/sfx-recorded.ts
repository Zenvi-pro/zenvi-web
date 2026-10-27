/**
 * Sounds of the recorded SFX kit (sfx/recorded.ts) made placeable: fetched
 * through the host's shared cache (MediaHost.kitSample), conditioned like a
 * library sound for the recipe the cue asked for, credited on the file. A
 * sound already made for this recipe and length is reused from the bin.
 */

import { SFX_CONDITION_VERSION } from "../sfx/condition.js";
import { kitVariation, type KitUse, type KitVariation } from "../sfx/kit-search.js";
import type { Project } from "../model/types.js";
import { isSfxClip } from "../sfx/moments.js";
import { pickRecorded, recordedCredit, recordedGroupOf, recordedMaxSeconds, type RecordedSample, type SfxKit } from "../sfx/recorded.js";
import { fileById, fpsFloatOf } from "./catalog/common.js";
import type { ToolCall } from "./define.js";
import { cachedSfx, conditionedSfxFile, variationTag } from "./sfx-library.js";
import { markOf, prepareSfx, type PreparedSfx, type SfxRequest } from "./sfx-media.js";
import type { ToolHost } from "./types.js";

/** Whether this surface can play the recorded kit: fetch to a cache, decode, write WAV. */
export function recordedKitAvailable(host: ToolHost): boolean {
  return Boolean(host.media?.kitSample && host.media.writeGenerated && host.audio?.decodePcm);
}

/** The kit a call plays: the one asked for, else recorded where the surface can fetch it. */
export function resolveSfxKit(host: ToolHost, asked: SfxKit | undefined): SfxKit {
  return asked ?? (recordedKitAvailable(host) ? "recorded" : "synth");
}

/** Cache key of a kit sound made for `recipe` at `fps`, played with `variation`. */
export function recordedKey(id: number, recipe: string, maxSeconds: number, fps: number, variation?: KitVariation): string {
  return `rec-${SFX_CONDITION_VERSION}-${id}-${recipe}-${Math.round(maxSeconds * 100)}-${Math.round(fps * 1000)}${variationTag(variation)}`;
}

/** The kit sound id a bin file was made from, if it is one. */
export function recordedIdOfKey(key: unknown): number | undefined {
  const m = typeof key === "string" ? /^rec-\d+-(\d+)-/.exec(key) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * The kit sounds on the timeline, each at its hit point (a whoosh's peak, a
 * hit's transient), for the variety rules: the moment a new cue is asked
 * for is a hit point too, while a peaking sound's clip starts its pre-roll
 * earlier.
 */
export function kitUsesOf(project: Project): KitUse[] {
  return project.clips.flatMap((clip) => {
    const file = isSfxClip(clip) ? fileById(project, String(clip.file_id)) : undefined;
    const mark = file ? markOf(file) : undefined;
    const id = recordedIdOfKey(mark?.key);
    return id !== undefined ? [{ id, at: clip.position + (mark?.hit ?? 0) - clip.start }] : [];
  });
}

/** One kit sound ready to place for `recipeId`, varied by `variation`. Throws with words when it cannot be fetched or decoded. */
export async function prepareRecordedSfx(call: ToolCall, sample: RecordedSample, recipeId: string, maxSeconds: number, variation?: KitVariation): Promise<PreparedSfx> {
  const key = recordedKey(sample.id, recipeId, maxSeconds, fpsFloatOf(call.doc.project), variation);
  const credit = recordedCredit(sample);
  const title = sample.name.slice(0, 120);
  const cached = cachedSfx(call.doc.project, key, title, credit);
  if (cached) return cached;
  if (!call.host.media?.kitSample) throw new Error("this surface cannot fetch the recorded kit.");
  const path = await call.host.media.kitSample(sample, { signal: call.signal });
  return conditionedSfxFile(call, path, { key, recipeId, maxSeconds, stem: `kit_${sample.id}`, title, credit, what: `recorded kit sound ${sample.id}`, variation });
}

/** A request for the recorded kit: the synth's request, plus the kit sound to play instead when there is one and how this use of it varies. */
export interface KitRequest extends SfxRequest {
  sample?: RecordedSample;
  variation?: KitVariation;
}

/** The kit sound each request (at `times`, timeline seconds) plays with `kit` (none with synth, for recipes the kit has no group for, or with an empty kit). */
export function kitRequests(requests: readonly SfxRequest[], kit: SfxKit, seed: number, times?: readonly number[]): KitRequest[] {
  if (kit === "synth") return [...requests];
  const picks = pickRecorded(requests.map((r, i) => ({ recipe: r.recipe, seconds: r.params.duration, ...(times?.[i] !== undefined ? { at: times[i] } : {}) })), seed);
  const uses = new Map<number, number>();
  return requests.map((r, i) => {
    const sample = picks[i];
    if (!sample) return r;
    const use = uses.get(sample.id) ?? 0;
    uses.set(sample.id, use + 1);
    return { ...r, sample, variation: kitVariation(sample.id, use, seed) };
  });
}

/**
 * Sounds for `requests`: kit sounds where a request has one (fetched at
 * once), synthesised otherwise and wherever a kit sound cannot be had (the
 * first failure is noted in `warnings`, e.g. offline).
 */
export async function prepareKitSfx(call: ToolCall, requests: readonly KitRequest[], warnings: string[]): Promise<{ sounds: PreparedSfx[]; recorded: number }> {
  const out: (PreparedSfx | undefined)[] = new Array(requests.length);
  const failures: string[] = [];
  // One fetch and one file per sound and recipe, however many cues play it.
  const made = new Map<string, Promise<PreparedSfx | undefined>>();
  await Promise.all(
    requests.map(async (r, i) => {
      if (!r.sample) return;
      const sample = r.sample;
      const max = recordedMaxSeconds(recordedGroupOf(r.recipe)!, r.params.duration);
      const key = recordedKey(sample.id, r.recipe, max, fpsFloatOf(call.doc.project), r.variation);
      if (!made.has(key)) {
        made.set(
          key,
          prepareRecordedSfx(call, sample, r.recipe, max, r.variation).catch((error: unknown) => {
            failures.push(`${sample.id}: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }),
        );
      }
      out[i] = await made.get(key);
    }),
  );
  if (failures.length > 0) warnings.push(`${failures.length} recorded kit ${failures.length === 1 ? "sound" : "sounds"} could not be fetched, so ${failures.length === 1 ? "it is" : "they are"} synthesised (${failures[0]}).`);
  const todo = requests.flatMap((r, i) => (out[i] ? [] : [{ r, i }]));
  const rendered = await prepareSfx(call, todo.map(({ r }) => ({ recipe: r.recipe, params: r.params })));
  todo.forEach((t, k) => (out[t.i] = rendered[k]));
  return { sounds: out as PreparedSfx[], recorded: requests.length - todo.length };
}
