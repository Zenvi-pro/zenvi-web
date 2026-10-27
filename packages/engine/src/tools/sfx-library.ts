/**
 * Library sound effects through the host: search Openverse (the host's
 * `library`) and Freesound (the Zenvi backend), look one sound up again by
 * id (its licence is read from the library, never taken from the caller),
 * and make it a placeable effect: downloaded with `media.importUrl` (the
 * host's cache), decoded, conditioned (sfx/condition.ts), written back as
 * WAV and marked with its credit. Equal sounds are made once per project:
 * the bin entry records its cache key like a procedural one.
 */

import { encodeWav } from "../io/wav.js";
import { SFX_CONDITION_VERSION, conditionSfx, recipeLoudness } from "../sfx/condition.js";
import { SFX_SAMPLE_RATE } from "../sfx/dsp.js";
import type { KitVariation } from "../sfx/kit-search.js";
import {
  OPENVERSE_API,
  creditOf,
  filterResults,
  isOpenverseId,
  openverseDetailUrl,
  openverseSearchUrl,
  readFreesoundSound,
  readOpenverseAudio,
  readOpenverseSearch,
  type SfxCredit,
  type SfxLibraryProvider,
  type SfxLibraryResult,
  type SfxSearchFilters,
} from "../sfx/library.js";
import { sfxRecipe } from "../sfx/recipes.js";
import { framePad, padSfx } from "../sfx/render.js";
import type { FreesoundSound } from "../stock/stock.js";
import { fpsFloatOf } from "./catalog/common.js";
import type { Project } from "../model/types.js";
import type { ToolCall } from "./define.js";
import { markOf, type PreparedSfx } from "./sfx-media.js";
import type { LibraryHost } from "./types.js";

/** Origins a LibraryHost may reach. */
export const SOUND_LIBRARY_ORIGINS: readonly string[] = [/^https:\/\/[^/]+/.exec(OPENVERSE_API)![0]];

/** Largest library file downloaded, bytes (effects are small; this stops a whole album). */
export const MAX_LIBRARY_BYTES = 25 * 1024 * 1024;
/** Longest a library request may take, ms: Openverse checks every result's link before answering a search it has not cached, which can take most of a minute. */
const LIBRARY_TIMEOUT_MS = 60_000;
/** Most audio decoded from one library file, seconds. */
const MAX_DECODE_SECONDS = 30;

export type LibraryResult = SfxLibraryResult & { provider: SfxLibraryProvider };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The subset of `fetch` fetchLibraryHost uses (the engine has no DOM types). */
export type LibraryFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal; redirect: "error" },
) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

/**
 * A LibraryHost over `fetch`: GETs to SOUND_LIBRARY_ORIGINS only, no
 * redirects, an Openverse token when the host has one (more than the
 * anonymous 20 a minute / 200 a day), errors in words.
 */
export function fetchLibraryHost(options: { fetch: LibraryFetch; openverseToken?: string; userAgent?: string }): LibraryHost {
  return {
    async getJson(url, opts) {
      if (!SOUND_LIBRARY_ORIGINS.some((o) => url.startsWith(`${o}/`))) throw new Error(`${url} is not a sound library this surface reaches.`);
      const headers: Record<string, string> = { accept: "application/json" };
      if (options.userAgent) headers["user-agent"] = options.userAgent;
      if (options.openverseToken) headers.authorization = `Bearer ${options.openverseToken}`;
      const signals = (globalThis as { AbortSignal?: { timeout?(ms: number): AbortSignal; any?(signals: AbortSignal[]): AbortSignal } }).AbortSignal;
      const timeout = signals?.timeout?.(LIBRARY_TIMEOUT_MS);
      const signal = opts?.signal && timeout && signals?.any ? signals.any([opts.signal, timeout]) : (opts?.signal ?? timeout);
      let response: Awaited<ReturnType<LibraryFetch>>;
      try {
        response = await options.fetch(url, { headers, signal, redirect: "error" });
      } catch (error) {
        if (timeout?.aborted && !opts?.signal?.aborted) throw new Error(`the library did not answer within ${LIBRARY_TIMEOUT_MS / 1000} s.`);
        throw new Error(`could not reach the library: ${errorText(error)}`);
      }
      if (response.status === 429) {
        const wait = response.headers.get("retry-after");
        throw new Error(`Openverse's rate limit is reached (20 searches a minute, 200 a day without a key)${wait ? `; try again in ${wait} s` : ""}.`);
      }
      if (response.status === 404) throw new Error("no such sound in the library (404).");
      if (response.status >= 500) throw new Error(`the library is having trouble (${response.status}); try again in a minute.`);
      if (!response.ok) throw new Error(`the library answered ${response.status}.`);
      return response.json();
    },
  };
}

export type SearchOutcome = { results: LibraryResult[]; total: number } | { error: string };

/** Search Openverse; results filtered by licence and length, at most `limit`. */
export async function searchOpenverse(call: ToolCall, query: string, filters: SfxSearchFilters, limit: number): Promise<SearchOutcome> {
  const library = call.host.library;
  if (!library) return { error: "this surface cannot reach Openverse." };
  try {
    // A few more than asked, for the length filter; small pages answer sooner (Openverse checks each result's link).
    const page = readOpenverseSearch(await library.getJson(openverseSearchUrl(query, filters, limit + 4), { signal: call.signal }));
    return { results: filterResults(page.results, filters).slice(0, limit) as LibraryResult[], total: page.total };
  } catch (error) {
    return { error: errorText(error) };
  }
}

function searchFreesound(call: ToolCall, query: string, pageSize: number, minSeconds: number): Promise<{ sounds: FreesoundSound[]; total: number } | { error: string }> {
  return call.host.stock!.searchFreesound(query, { pageSize, minSeconds, signal: call.signal }).catch((error: unknown) => ({ error: errorText(error) }));
}

/** Search Freesound through stock search (the Zenvi backend, or the server's own key); results filtered by licence and length, at most `limit`. */
export async function searchFreesoundSfx(call: ToolCall, query: string, filters: SfxSearchFilters, limit: number): Promise<SearchOutcome> {
  if (!call.host.stock) return { error: "Freesound is searched through the Zenvi backend: sign in to Zenvi." };
  const found = await searchFreesound(call, query, 40, filters.minSeconds);
  if ("error" in found) return { error: found.error };
  const results = found.sounds.map(readFreesoundSound).filter((r): r is SfxLibraryResult => r !== null);
  return { results: filterResults(results, filters).slice(0, limit) as LibraryResult[], total: found.total };
}

/**
 * One library sound by id, as the library describes it now. Freesound has
 * no lookup through the backend, so it is found again by its title.
 * Returns an error line when it cannot be found.
 */
export async function lookupLibrarySound(call: ToolCall, provider: SfxLibraryProvider, id: string, title?: string): Promise<LibraryResult | string> {
  if (provider === "openverse") {
    if (!isOpenverseId(id)) return `Error: ${id} is not an Openverse id (a UUID from search_sfx_tool).`;
    if (!call.host.library) return "Error: this surface cannot reach Openverse.";
    try {
      const result = readOpenverseAudio(await call.host.library.getJson(openverseDetailUrl(id), { signal: call.signal }));
      return result ? (result as LibraryResult) : `Error: Openverse sound ${id} has no downloadable file or no known licence.`;
    } catch (error) {
      return `Error: could not look up Openverse sound ${id}: ${errorText(error)}`;
    }
  }
  if (!/^\d+$/.test(id)) return `Error: ${id} is not a Freesound id (a number from search_sfx_tool).`;
  if (!title?.trim()) return "Error: a Freesound sound is found again by its title: pass title (from search_sfx_tool).";
  if (!call.host.stock) return "Error: Freesound is reached through the Zenvi backend: sign in to Zenvi.";
  const found = await searchFreesound(call, title.trim(), 40, 0);
  if ("error" in found) return `Error: Freesound search failed: ${found.error}`;
  const sound = found.sounds.map(readFreesoundSound).find((r) => r?.id === id);
  return sound ? (sound as LibraryResult) : `Error: Freesound sound ${id} was not found under the title '${title}' (search again and pass its exact title).`;
}

/** Cache key of a library sound made for `recipe` at `fps`. */
export function libraryKey(provider: string, id: string, recipe: string, maxSeconds: number, fps: number): string {
  return `lib-${SFX_CONDITION_VERSION}-${provider}-${id}-${recipe}-${Math.round(maxSeconds * 100)}-${Math.round(fps * 1000)}`;
}

/** What conditioning did to a library sound (for receipts). */
export interface LibraryPrep {
  trimmedHead: number;
  trimmedTail: number;
  gainDb: number;
}

/**
 * A library sound ready to place, standing in for `recipeId` (its hit
 * point, loudness and mix level), at most `maxSeconds` long. Reuses the
 * bin's file when the same sound was made before. Throws with words when
 * it cannot be downloaded or decoded.
 */
export async function prepareLibrarySfx(call: ToolCall, result: LibraryResult, recipeId: string, maxSeconds: number): Promise<PreparedSfx & { prep?: LibraryPrep }> {
  const recipe = sfxRecipe(recipeId);
  if (!recipe) throw new Error(`unknown sound effect recipe: ${recipeId}`);
  const project = call.doc.project;
  const fps = fpsFloatOf(project);
  const key = libraryKey(result.provider, result.id, recipe.id, maxSeconds, fps);
  const credit = creditOf(result);
  const title = result.title.slice(0, 120);
  const cached = cachedSfx(project, key, title, credit);
  if (cached) return cached;
  const media = call.host.media;
  if (!media?.importUrl || !media.writeGenerated) throw new Error("this surface cannot download library sounds.");
  if (!call.host.audio?.decodePcm) throw new Error("this surface cannot decode audio, so library sounds cannot be trimmed and levelled here.");
  if (!result.preview_url) throw new Error(`${result.provider} sound ${result.id} has no file to download.`);
  if (result.filesize && result.filesize > MAX_LIBRARY_BYTES) throw new Error(`${result.provider} sound ${result.id} is ${Math.round(result.filesize / 1048576)} MB: too large for a sound effect.`);
  const ext = /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus)(?:$|\?)/i.exec(result.preview_url)?.[1]?.toLowerCase() ?? "mp3";
  const stem = `${result.provider}_${result.id.slice(0, 36)}`.replace(/[^\w-]/g, "_");
  const downloaded = await media.importUrl(result.preview_url, { filename: `${stem}.${ext}`, signal: call.signal });
  return conditionedSfxFile(call, downloaded.path, { key, recipeId: recipe.id, maxSeconds, stem, title, credit, what: `${result.provider} sound ${result.id}` });
}

/**
 * A downloaded sound file decoded, conditioned for `recipeId` (its hit
 * point and loudness), padded to the frame grid and written back as WAV,
 * ready to place. Throws with words when it cannot be decoded or is silent.
 */
export async function conditionedSfxFile(
  call: ToolCall,
  source: string,
  o: { key: string; recipeId: string; maxSeconds: number; stem: string; title: string; credit: SfxCredit; what: string; variation?: KitVariation },
): Promise<PreparedSfx & { prep: LibraryPrep }> {
  const media = call.host.media;
  if (!media?.writeGenerated) throw new Error("this surface cannot store generated audio.");
  if (!call.host.audio?.decodePcm) throw new Error("this surface cannot decode audio, so library sounds cannot be trimmed and levelled here.");
  const recipe = sfxRecipe(o.recipeId)!;
  const fps = fpsFloatOf(call.doc.project);
  const pcm = await call.host.audio.decodePcm(source, { sampleRate: SFX_SAMPLE_RATE, channels: 2, maxSeconds: MAX_DECODE_SECONDS, signal: call.signal });
  const conditioned = conditionSfx({ sampleRate: pcm.sampleRate, left: pcm.samples, right: pcm.right }, {
    hit: recipe.hit,
    maxSeconds: o.maxSeconds,
    targetRms: recipeLoudness(recipe.id) * 10 ** ((o.variation?.gainDb ?? 0) / 20),
    semitones: o.variation?.semitones,
  });
  if (!conditioned) throw new Error(`${o.what} is silent.`);
  const audio = padSfx(conditioned, framePad(conditioned.hit, fps));
  const path = await media.writeGenerated(`sfx-${o.stem}-${recipe.id}-${Math.round(o.maxSeconds * 100)}-${Math.round(fps * 100)}${variationTag(o.variation)}-v${SFX_CONDITION_VERSION}.wav`, encodeWav([audio.left, audio.right], audio.sampleRate), "audio/wav");
  const info = await media.probe(path);
  return {
    key: o.key,
    recipe: recipe.id,
    hit: audio.hit,
    duration: audio.duration,
    media: { path, info: { ...info, media_type: "audio", has_video: false, has_audio: true }, name: `SFX ${o.title}` },
    title: o.title,
    credit: o.credit,
    prep: { trimmedHead: conditioned.trimmedHead, trimmedTail: conditioned.trimmedTail, gainDb: conditioned.gainDb },
  };
}

/** File-name and cache-key part of a placement's variation ('' when it plays as recorded). */
export function variationTag(v: KitVariation | undefined): string {
  return v && (v.semitones !== 0 || v.gainDb !== 0) ? `-p${Math.round(v.semitones * 100)}g${Math.round(v.gainDb * 10)}` : "";
}

/** The bin's file made for `key` before, as a sound to place; undefined when there is none. */
export function cachedSfx(project: Project, key: string, title: string, credit: SfxCredit): PreparedSfx | undefined {
  for (const file of project.files) {
    const mark = markOf(file);
    if (mark?.key === key && typeof mark.hit === "number") {
      return { key, recipe: String(mark.recipe), hit: mark.hit, duration: typeof mark.duration === "number" ? mark.duration : Number(file.duration) || 0, fileId: String(file.id), title, credit };
    }
  }
  return undefined;
}
