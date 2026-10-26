/**
 * Sound-effect media for add_sfx_tool and auto_sound_design_tool: render a
 * recipe (sfx/render.ts) to WAV, store it through the host once per sound
 * (the bin entry records its cache key, so a rerun reuses the file), and
 * place it on the SFX track with its hit point on the moment.
 *
 * Files are padded so the hit sits on a frame boundary: libopenshot places
 * a clip's audio by whole frames, so the frame-snapped clip then puts the
 * hit exactly on the cut.
 */

import type { Transaction } from "../history/document.js";
import { encodeWav } from "../io/wav.js";
import type { Clip, Layer, Project, ProjectFile } from "../model/types.js";
import { updateClipValues } from "../ops/clip-props.js";
import { addClip, setClipProperty } from "../ops/clips.js";
import { addFile, removeFile, updateFile } from "../ops/files.js";
import { addTrack } from "../ops/tracks.js";
import { SFX_ROLE, type SfxClipMark } from "../sfx/moments.js";
import { sfxRecipe } from "../sfx/recipes.js";
import { SFX_VERSION, framePad, padSfx, renderSfx, resolveSfxParams, sfxKey, type ResolvedSfxParams, type SfxParams } from "../sfx/render.js";
import { fpsFloatOf } from "./catalog/common.js";
import type { ToolCall } from "./define.js";
import type { ImportedMedia } from "./types.js";

/** Label of the first sound-effect track; more lanes are "SFX 2", "SFX 3"… */
export const SFX_TRACK_LABEL = "SFX";
const LANE = /^SFX(?: (\d+))?$/;

/** What a sound-effect file records about itself (`file.zenvi_sfx`). */
export interface SfxFileMark {
  key: string;
  recipe: string;
  params: ResolvedSfxParams;
  /** Seconds from the file's start to its hit point. */
  hit: number;
  /** Seconds of audio in the file. */
  duration: number;
  version: number;
}

/** One rendered (or cached) sound, ready to place. */
export interface PreparedSfx {
  key: string;
  recipe: string;
  params: ResolvedSfxParams;
  hit: number;
  duration: number;
  /** A bin entry that already holds this sound. */
  fileId?: string;
  /** Freshly written media, added to the bin when placed. */
  media?: ImportedMedia;
}

export interface SfxRequest {
  recipe: string;
  params: SfxParams;
}

function markOf(file: ProjectFile): Partial<SfxFileMark> | undefined {
  return file.zenvi_role === SFX_ROLE ? (file.zenvi_sfx as Partial<SfxFileMark> | undefined) : undefined;
}

/** Snap seconds to the project's frame grid. */
export function snapToFrame(project: Project, seconds: number): number {
  const fps = fpsFloatOf(project);
  return fps > 0 ? Math.round(seconds * fps) / fps : seconds;
}

/**
 * Render and store every requested sound not already in the bin (same
 * recipe, parameters, seed and frame rate). Returns one entry per request;
 * equal requests share an entry. Host writes happen here, before the edit.
 */
export async function prepareSfx(call: ToolCall, requests: readonly SfxRequest[]): Promise<PreparedSfx[]> {
  const project = call.doc.project;
  const fps = fpsFloatOf(project);
  const cached = new Map<string, ProjectFile>();
  for (const file of project.files) {
    const key = markOf(file)?.key;
    if (key) cached.set(key, file);
  }
  const byKey = new Map<string, PreparedSfx>();
  const out: PreparedSfx[] = [];
  for (const request of requests) {
    const recipe = sfxRecipe(request.recipe);
    if (!recipe) throw new Error(`unknown sound effect recipe: ${request.recipe}`);
    const params = resolveSfxParams(recipe, request.params);
    const key = sfxKey(recipe.id, params, fps);
    let prepared = byKey.get(key);
    if (!prepared) {
      const file = cached.get(key);
      const mark = file ? markOf(file) : undefined;
      if (file && mark && typeof mark.hit === "number") {
        prepared = { key, recipe: recipe.id, params, hit: mark.hit, duration: typeof mark.duration === "number" ? mark.duration : Number(file.duration) || 0, fileId: String(file.id) };
      } else {
        const rendered = renderSfx(recipe.id, params);
        const audio = padSfx(rendered, framePad(rendered.hit, fps));
        const name = `sfx-${recipe.id}-${key.slice(0, 8)}.wav`;
        const media = call.host.media!;
        const path = await media.writeGenerated!(name, encodeWav([audio.left, audio.right], audio.sampleRate), "audio/wav");
        const info = await media.probe(path);
        prepared = {
          key,
          recipe: recipe.id,
          params,
          hit: audio.hit,
          duration: audio.duration,
          media: { path, info: { ...info, media_type: "audio", has_video: false, has_audio: true }, name: `SFX ${recipe.title}` },
        };
      }
      byKey.set(key, prepared);
    }
    out.push(prepared);
  }
  return out;
}

/** Sound-effect tracks, bottom to top. */
export function sfxLanes(project: Project): Layer[] {
  return project.layers.filter((l) => LANE.test(String(l.label ?? "").trim())).sort((a, b) => a.number - b.number);
}

function overlaps(project: Project, layer: number, from: number, to: number): boolean {
  return project.clips.some((c) => c.layer === layer && c.position < to - 1e-6 && c.position + (c.end - c.start) > from + 1e-6);
}

/** The first SFX track free over [from, to); a new lane above the others when none is (the first is named "SFX"). */
function laneFor(tx: Transaction, from: number, to: number): number {
  const lanes = sfxLanes(tx.project);
  const free = lanes.find((l) => !l.lock && !overlaps(tx.project, l.number, from, to));
  if (free) return free.number;
  const top = lanes[lanes.length - 1];
  // Next number after the highest lane ("SFX" counts as 1), so a gap never repeats a label.
  const highest = Math.max(0, ...lanes.map((l) => Number(LANE.exec(String(l.label ?? "").trim())?.[1] ?? 1)));
  const label = lanes.length === 0 ? SFX_TRACK_LABEL : `${SFX_TRACK_LABEL} ${highest + 1}`;
  return addTrack(tx, top ? { above: top.number, label } : { label }).number;
}

export interface SfxPlacement {
  /** Timeline seconds of the moment (frame-snapped by the caller). */
  at: number;
  /** `peak`: the hit point lands on `at`; `start`: the file starts there. */
  align: "peak" | "start";
  gainDb: number;
  auto: boolean;
  reason?: string;
}

/**
 * Place a prepared sound: its bin entry (added once), a clip on a free SFX
 * lane, the gain as clip volume, and the marks that let tools find it. A
 * hit before the timeline's start trims the head instead. Returns null when
 * nothing of the sound is left on the timeline.
 */
export function placeSfx(tx: Transaction, sound: PreparedSfx, where: SfxPlacement): Clip | null {
  const recipe = sfxRecipe(sound.recipe)!;
  let position = where.at - (where.align === "peak" ? sound.hit : 0);
  let start = 0;
  if (position < 0) {
    start = -position;
    position = 0;
  }
  if (start >= sound.duration - 0.01) return null;
  if (!sound.fileId) {
    const file = addFile(tx, sound.media!, { dedupe: true, mediaType: "audio" });
    const mark: SfxFileMark = { key: sound.key, recipe: sound.recipe, params: sound.params, hit: sound.hit, duration: sound.duration, version: SFX_VERSION };
    updateFile(tx, String(file.id), { zenvi_role: SFX_ROLE, zenvi_sfx: mark, name: sound.media!.name });
    sound.fileId = String(file.id);
  }
  const layer = laneFor(tx, position, position + sound.duration - start);
  const clip = addClip(tx, { fileId: sound.fileId, position, layer, start, end: sound.duration, title: recipe.title });
  setClipProperty(tx, clip.id, "volume", Math.round(10 ** (where.gainDb / 20) * 1000) / 1000);
  const mark: SfxClipMark = { recipe: sound.recipe, auto: where.auto, ...(where.reason ? { reason: where.reason } : {}) };
  return updateClipValues(tx, clip.id, { zenvi_role: SFX_ROLE, zenvi_sfx: mark });
}

/** Remove sound-effect files no clip plays any more (a rerun's leftovers). Returns their ids. */
export function removeUnusedSfxFiles(tx: Transaction): string[] {
  const used = new Set(tx.project.clips.map((c) => String(c.file_id)));
  const unused = tx.project.files.filter((f) => f.zenvi_role === SFX_ROLE && !used.has(String(f.id))).map((f) => String(f.id));
  for (const id of unused) removeFile(tx, id);
  return unused;
}
