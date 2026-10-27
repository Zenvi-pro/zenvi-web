/**
 * Sounds of the recorded SFX kit (sfx/recorded.ts) made placeable: fetched
 * through the host's shared cache (MediaHost.kitSample), conditioned like a
 * library sound for the recipe the cue asked for, credited on the file. A
 * sound already made for this recipe and length is reused from the bin.
 */

import { SFX_CONDITION_VERSION } from "../sfx/condition.js";
import { pickRecorded, recordedCredit, recordedGroupOf, recordedMaxSeconds, type RecordedSample, type SfxKit } from "../sfx/recorded.js";
import { fpsFloatOf } from "./catalog/common.js";
import type { ToolCall } from "./define.js";
import { cachedSfx, conditionedSfxFile } from "./sfx-library.js";
import { prepareSfx, type PreparedSfx, type SfxRequest } from "./sfx-media.js";
import type { ToolHost } from "./types.js";

/** Whether this surface can play the recorded kit: fetch to a cache, decode, write WAV. */
export function recordedKitAvailable(host: ToolHost): boolean {
  return Boolean(host.media?.kitSample && host.media.writeGenerated && host.audio?.decodePcm);
}

/** The kit a call plays: the one asked for, else recorded where the surface can fetch it. */
export function resolveSfxKit(host: ToolHost, asked: SfxKit | undefined): SfxKit {
  return asked ?? (recordedKitAvailable(host) ? "recorded" : "synth");
}

/** Cache key of a kit sound made for `recipe` at `fps`. */
export function recordedKey(id: number, recipe: string, maxSeconds: number, fps: number): string {
  return `rec-${SFX_CONDITION_VERSION}-${id}-${recipe}-${Math.round(maxSeconds * 100)}-${Math.round(fps * 1000)}`;
}

/** The kit sound id a bin file was made from, if it is one. */
export function recordedIdOfKey(key: unknown): number | undefined {
  const m = typeof key === "string" ? /^rec-\d+-(\d+)-/.exec(key) : null;
  return m ? Number(m[1]) : undefined;
}

/** One kit sound ready to place for `recipeId`. Throws with words when it cannot be fetched or decoded. */
export async function prepareRecordedSfx(call: ToolCall, sample: RecordedSample, recipeId: string, maxSeconds: number): Promise<PreparedSfx> {
  const key = recordedKey(sample.id, recipeId, maxSeconds, fpsFloatOf(call.doc.project));
  const credit = recordedCredit(sample);
  const title = sample.name.slice(0, 120);
  const cached = cachedSfx(call.doc.project, key, title, credit);
  if (cached) return cached;
  if (!call.host.media?.kitSample) throw new Error("this surface cannot fetch the recorded kit.");
  const path = await call.host.media.kitSample(sample, { signal: call.signal });
  return conditionedSfxFile(call, path, { key, recipeId, maxSeconds, stem: `kit_${sample.id}`, title, credit, what: `recorded kit sound ${sample.id}` });
}

/** A request for the recorded kit: the synth's request, plus the kit sound to play instead when there is one. */
export interface KitRequest extends SfxRequest {
  sample?: RecordedSample;
}

/** The kit sound each request plays with `kit` (none with synth, for recipes the kit has no group for, or with an empty kit). */
export function kitRequests(requests: readonly SfxRequest[], kit: SfxKit, seed: number): KitRequest[] {
  if (kit === "synth") return [...requests];
  const picks = pickRecorded(requests.map((r) => ({ recipe: r.recipe, seconds: r.params.duration })), seed);
  return requests.map((r, i) => (picks[i] ? { ...r, sample: picks[i] } : r));
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
      const key = recordedKey(sample.id, r.recipe, max, fpsFloatOf(call.doc.project));
      if (!made.has(key)) {
        made.set(
          key,
          prepareRecordedSfx(call, sample, r.recipe, max).catch((error: unknown) => {
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
