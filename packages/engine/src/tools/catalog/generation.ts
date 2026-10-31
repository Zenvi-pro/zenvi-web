/**
 * AI generation tools: generate_video_and_add_to_timeline_tool,
 * generate_image_and_add_to_timeline_tool,
 * generate_tts_and_add_to_timeline_tool, modify_clip_tool,
 * generate_transition_clip_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * generate_video_and_add_to_timeline (+ _snap_kling_o1_duration,
 * _project_kling_o1_t2v_dims), generate_tts_and_add_to_timeline /
 * add_tts_audio_to_timeline (with develop 1f80cb3d0's position_seconds,
 * playhead default and narration name), modify_clip, generate_transition_clip;
 * and of develop 1f80cb3d0's generate_image_and_add_to_timeline
 * (+ _stamp_generated_video_metadata).
 *
 * Credits are enforced by the backend on /generation/* (api/credit_gate.py),
 * so the desktop's client-side credit pre-check is not repeated here.
 * modify_clip_tool and generate_transition_clip_tool cut and upload source
 * segments and bake the result with the desktop's ffmpeg pipeline, so they
 * are refused as not available.
 */

import { generateId } from "../../model/ids.js";
import type { Project, ProjectFile } from "../../model/types.js";
import { addClip, moveClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { addTrack } from "../../ops/tracks.js";
import { ensureTrack } from "../../ops/overlays.js";
import { generateImage, generateTts, generateVideo } from "../backend.js";
import { contractTool, unavailable, type CatalogTool } from "../define.js";
import { parseSecondsArg, TimeArgError } from "../placement.js";
import { pyFloat, pyG, pySlice } from "../pyfmt.js";
import { applied } from "../receipt.js";
import { energyVadWindows } from "../speech.js";
import { ASR_KEY, type StoredTranscript } from "../transcripts.js";
import { scriptWordTimes, ttsTranscript } from "../tts-words.js";
import { formatTrackLabelForLlm, lockedTrackError, newTracksNote, resolvePlacementTrack } from "../tracks.js";
import type { ImportedMedia } from "../types.js";
import { applyPlacement, planPlacement, provisionalFile, placementText, type PlacementArgs } from "./clips.js";
import { playheadSeconds, record, text } from "./common.js";
import { alignedTranscript, lyricsPrompt } from "./align-lyrics.js";

/** Kling O1 Pro durations: 5 s unless 10 s is clearly asked for (>= 8). */
export function snapKlingDuration(duration: unknown): number {
  const v = Number(duration);
  if (!Number.isFinite(v)) return 5;
  return Math.max(1, Math.min(10, v)) >= 8 ? 10 : 5;
}

/** Text-to-video size from the project aspect (_project_kling_o1_t2v_dims). */
export function t2vDims(width: number, height: number): [number, number] {
  const aspect = (width || 1920) / Math.max(height || 1080, 1);
  if (aspect > 1.2) return [1920, 1080];
  if (aspect < 0.8) return [1080, 1920];
  return [1440, 1440];
}

/** Project Files name of a narration (zenvi-core develop ai_generation_tts.default_name). */
const NARRATION_TRACK_NAME = "Narration";

/** Narration audio already in the project: this tool's TTS files, or files the desktop tagged as narration. */
function isNarrationFile(file: ProjectFile): boolean {
  const tags = String((file as { tags?: unknown }).tags ?? "").toLowerCase().split(",").map((t) => t.trim());
  return /(^|[\\/])zenvi_tts_[^\\/]*$/.test(String(file.path)) || tags.includes("narration");
}

/**
 * The track narration at [start, end) goes on when the caller names none, or null for "create a Narration
 * track right above the lowest one". Port of zenvi-core editor_tools/ai_generation_tts.py
 * `pick_narration_track`: never the lowest track (the main picture track) and never a locked one; first a
 * track holding only narration and free over the range, then the lowest empty track above the lowest.
 */
export function pickNarrationTrack(project: Project, start: number, end: number): number | null {
  const rows = [...project.layers].sort((a, b) => a.number - b.number);
  if (rows.length < 2) return null;
  const narration = new Set(project.files.filter(isNarrationFile).map((f) => String(f.id)));
  const onTrack = (layer: number) => project.clips.filter((c) => c.layer === layer);
  const candidates = rows.slice(1).filter((t) => !t.lock);
  const EPS = 1e-6;
  for (const t of candidates) {
    const clips = onTrack(t.number);
    const overlaps = clips.some((c) => c.position < end - EPS && c.position + (c.end - c.start) > start + EPS);
    if (clips.length > 0 && clips.every((c) => narration.has(String(c.file_id ?? ""))) && !overlaps) return t.number;
  }
  return candidates.find((t) => onTrack(t.number).length === 0)?.number ?? null;
}

export function narrationName(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return `Narration - ${words.slice(0, 6).join(" ")}${words.length > 6 ? "..." : ""}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Bytes of strict base64 (Python `b64decode(validate=True)`), empty when it is not. */
export function strictBase64(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return new Uint8Array();
  try {
    return base64ToBytes(b64);
  } catch {
    return new Uint8Array();
  }
}

/** The generated image's file type, from the backend's MIME type (JPEG unless PNG or WebP). */
export function generatedImageType(mimeType: string): { ext: ".png" | ".webp" | ".jpg"; contentType: string } {
  const mime = mimeType.trim().toLowerCase();
  if (mime === "image/png") return { ext: ".png", contentType: mime };
  if (mime === "image/webp") return { ext: ".webp", contentType: mime };
  return { ext: ".jpg", contentType: "image/jpeg" };
}

function tagList(tags: unknown): string[] {
  const items = typeof tags === "string" ? tags.split(",") : Array.isArray(tags) ? tags.map(String) : [];
  return items.map((t) => t.trim()).filter(Boolean);
}

/**
 * What a generated clip's Project Files entry gets (tool_handlers
 * _stamp_generated_video_metadata): the `ai_generated` tag, the prompt as
 * its summary and description (analyzed, so scene search and the Scene
 * panel show it: generated media is never indexed), the source, and the
 * prompt as its name when it has none.
 */
export function generatedMediaStamp(prompt: string, source: string, existing: Partial<ProjectFile> = {}): Partial<ProjectFile> {
  const summary = prompt.trim();
  if (!summary) return {};
  const tags = tagList(existing.tags);
  if (!tags.includes("ai_generated")) tags.push("ai_generated");
  const stamp: Partial<ProjectFile> = {
    tags: tags.join(", "),
    ai_metadata: {
      ...record(existing.ai_metadata),
      short_summary: pySlice(summary, 0, 400),
      description: pySlice(summary, 0, 400),
      analyzed: true,
      source,
    },
  };
  if (!existing.name) stamp.name = pySlice(summary, 0, 120);
  return stamp;
}

/** A still as the planner sees it before it exists (libopenshot readers give images 3600 s). */
function plannedStill(width: number, height: number): ProjectFile {
  return { id: "", path: "generated.jpg", media_type: "image", has_video: true, has_audio: false, duration: 3600, width, height } as ProjectFile;
}

export const generationTools: CatalogTool[] = [
  contractTool("generate_video_and_add_to_timeline_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["backend", "media"],
    run: async (call, input) => {
      const prompt = text(input.prompt);
      if (Array.from(prompt).length < 2) return "Error: Prompt must be at least 2 characters.";
      const importUrl = call.host.media!.importUrl;
      if (!importUrl) return unavailable("generate_video_and_add_to_timeline_tool", "it cannot download the generated video.");
      const explicitDur = text(input.duration_seconds);
      const duration = explicitDur ? snapKlingDuration(Math.trunc(Number(explicitDur))) : 5;
      const project = call.doc.project;
      const [width, height] = t2vDims(project.width, project.height);
      const extra: Record<string, unknown> = { width, height, mode: "t2v" };
      const result = await generateVideo(call, prompt, duration, extra);
      if ("error" in result) return `Error: ${result.error}`;
      if (!result.videoUrl) return "Error: No video URL returned from generation.";
      let media: ImportedMedia;
      try {
        media = await importUrl.call(call.host.media, result.videoUrl, { filename: "generated.mp4", signal: call.signal });
      } catch (error) {
        return `Error: Download failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      const stamp: Partial<ProjectFile> = {
        ai_metadata: {
          ...record(media.info.ai_metadata),
          prompt: Array.from(prompt).slice(0, 500).join(""),
          short_summary: Array.from(prompt).slice(0, 200).join(""),
          source: "kling_t2v",
        },
      };
      const plan = await planPlacement(call, provisionalFile(media, stamp), {
        position_seconds: input.position_seconds ?? "",
        track: input.track ?? "",
        query: prompt,
        duration_seconds: explicitDur,
      });

      // Ripple later clips so the new shot does not land on top of them (one undo step with the placement).
      const posArg = Number(text(input.position_seconds));
      const hasPos = text(input.position_seconds) !== "" && Number.isFinite(posArg);
      let rippleLayer: number | null = null;
      if (hasPos && text(input.track)) {
        const r = resolvePlacementTrack(text(input.track), project.layers);
        if (!r.error && r.layer !== undefined) rippleLayer = r.layer;
      }
      if (hasPos && rippleLayer === null) {
        const after = (project.clips ?? []).filter((c) => (Number(c.position) || 0) >= posArg - 0.001 && c.id);
        if (after.length > 0) rippleLayer = after.reduce((a, b) => ((Number(a.position) || 0) <= (Number(b.position) || 0) ? a : b)).layer;
      }
      const genDur = Number(media.info.duration) || duration;
      const shifts = hasPos
        ? (project.clips ?? [])
            .filter((c) => c.id && (Number(c.position) || 0) >= posArg - 0.001 && (rippleLayer === null || c.layer === rippleLayer))
            .map((c) => [String(c.id), (Number(c.position) || 0) + genDur] as const)
        : [];

      const placed = call.commit((tx) => {
        const file = addFile(tx, media, { dedupe: true });
        tx.update(["files", { id: file.id }], stamp);
        if (typeof plan === "string") return { file, clip: undefined };
        for (const [id, position] of [...shifts].sort((a, b) => b[1] - a[1])) moveClip(tx, id, { position });
        return { file, clip: applyPlacement(tx, String(file.id), plan) };
      });
      if (typeof plan === "string" || !placed.clip) {
        // The paid-for video is kept in the media bin: never regenerate it.
        const why = typeof plan === "string" ? plan : "unknown";
        return applied("generate_video_and_add_to_timeline_tool",
          `Video imported (file_id=${placed.file.id}) but timeline placement failed: ${why}. ` +
            `Do NOT regenerate — call add_clip_to_timeline_tool(file_id='${placed.file.id}', ` +
            "track=<layer_number from list_layers_tool>, position_seconds=...).",
          { data: { file_id: placed.file.id } },
        );
      }
      return placementText(call.doc.project, plan, placed.clip);
    },
  }),

  contractTool("generate_image_and_add_to_timeline_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["backend", "media"],
    run: async (call, input) => {
      const tool = "generate_image_and_add_to_timeline_tool";
      const prompt = text(input.prompt);
      if (Array.from(prompt).length < 2) return "Error: Prompt must be at least 2 characters.";
      let seconds: number;
      try {
        seconds = parseSecondsArg(input.duration_seconds, 5, "duration_seconds") ?? 5;
      } catch (error) {
        if (error instanceof TimeArgError) return `Error: ${error.message}`;
        throw error;
      }
      if (!(seconds > 0)) return "Error: duration_seconds must be greater than 0.";
      const media = call.host.media!;
      const writeGenerated = media.writeGenerated;
      if (!writeGenerated) return unavailable(tool, "it cannot store generated images.");
      const project = call.doc.project;
      const args: PlacementArgs = {
        position_seconds: input.position_seconds ?? "",
        track: input.track ?? "",
        query: prompt,
        duration_seconds: pyG(seconds),
      };
      // Where it would go is checked before any credits are spent (the desktop checks after).
      const planned = await planPlacement(call, plannedStill(project.width, project.height), args);
      if (typeof planned === "string") return planned;
      const locked = lockedTrackError(planned.layer, project.layers);
      if (locked) return locked;

      const [width, height] = t2vDims(project.width, project.height);
      const result = await generateImage(call, prompt, { width, height });
      if ("error" in result) return `Error: ${result.error}`;
      const bytes = strictBase64(result.imageBase64);
      if (bytes.length === 0) return "Error: The backend returned no image data.";
      const { ext, contentType } = generatedImageType(result.mimeType);
      // tool_handlers names it like classes.assets.durable_media_path: generated_<12 random>.<ext>.
      const name = `generated_${generateId(undefined, 12).toLowerCase()}${ext}`;
      let path: string;
      try {
        path = await writeGenerated.call(media, name, bytes, contentType);
      } catch (error) {
        return `Error: Could not save the generated image: ${error instanceof Error ? error.message : String(error)}`;
      }
      let imported: ImportedMedia;
      try {
        imported = { path, info: await media.probe(path) };
      } catch {
        return "Error: Image generated but failed to import into project files.";
      }

      const stamp = generatedMediaStamp(prompt, "ai_image_generation");
      const plan = await planPlacement(call, provisionalFile(imported, { ...stamp, media_type: "image" }), args);
      const placementError = typeof plan === "string" ? plan : lockedTrackError(plan.layer, call.doc.project.layers);
      const placed = call.commit((tx) => {
        const file = addFile(tx, imported, { dedupe: true, mediaType: "image" });
        tx.update(["files", { id: file.id }], stamp);
        if (placementError || typeof plan === "string") return { file, clip: undefined };
        return { file, clip: applyPlacement(tx, String(file.id), plan) };
      });
      if (!placed.clip || typeof plan === "string") {
        // The paid-for image stays in Project Files: never generate it again.
        const fileId = String(placed.file.id);
        return applied(
          tool,
          `Image imported (file_id=${fileId}) but timeline placement failed: ${placementError || "unknown"}. ` +
            `Do NOT regenerate — call add_clip_to_timeline_tool(file_id='${fileId}', ` +
            `track=<layer_number from list_layers_tool>, position_seconds=..., duration_seconds=${pyG(seconds)}).`,
          { data: { file_id: fileId } },
        );
      }
      return placementText(call.doc.project, plan, placed.clip);
    },
  }),

  contractTool("generate_tts_and_add_to_timeline_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["backend", "media"],
    run: async (call, input) => {
      const narration = text(input.text);
      if (!narration) return "Error: No text provided for narration.";
      const writeGenerated = call.host.media!.writeGenerated;
      if (!writeGenerated) return unavailable("generate_tts_and_add_to_timeline_tool", "it cannot store generated audio.");
      // zenvi-core develop editor_tools/ai_generation_tts.py _start_seconds: position is the
      // older name of position_seconds; neither means the playhead.
      const asked = input.position_seconds ?? null;
      const older = input.position ?? null;
      if (asked !== null && older !== null && Math.abs(asked - older) > 1e-6) {
        return `Error: position (${pyFloat(older)}) and position_seconds (${pyFloat(asked)}) disagree; pass position_seconds only.`;
      }
      const position = Math.max(0, asked ?? older ?? playheadSeconds(call));
      const project = call.doc.project;
      let layer: number | undefined;
      let newTracks = 0;
      if (input.track !== undefined && String(input.track).trim() !== "") {
        const r = resolvePlacementTrack(String(input.track), project.layers);
        if (r.error) return r.error;
        if (r.layer !== undefined) layer = r.layer;
        newTracks = r.newTracks ?? 0;
      }
      const res = await generateTts(call, {
        text: narration,
        voice: text(input.voice) || "alloy",
        model: text(input.model) || "tts-1",
        speed: Number(input.speed ?? 1.0) || 1.0,
      });
      if ("error" in res) return `Error: ${res.error}`;
      const bytes = res.audioBase64 ? base64ToBytes(res.audioBase64) : new Uint8Array();
      if (bytes.length === 0) return "Error: TTS returned empty audio.";
      const path = await writeGenerated.call(call.host.media, `zenvi_tts_${Date.now().toString(36)}.mp3`, bytes, "audio/mpeg");
      const info = await call.host.media!.probe(path);
      const media: ImportedMedia = { path, info: { ...info, media_type: "audio" }, name: text(input.name) || narrationName(narration) };
      const seconds = Number(info.duration) || 0;
      const picked = layer ?? pickNarrationTrack(call.doc.project, position, position + seconds);
      // The script over the voice's own pauses: caption timings with no speech recognition (tts-words.ts).
      // Without an envelope (no audio host, or it failed) the words spread over the voice's length.
      let voiced: [number, number][] = [];
      try {
        const envelope = await call.host.audio?.analyzeAudio(path, { signal: call.signal });
        if (envelope) voiced = energyVadWindows(envelope, { minSpeechSec: 0.08, minSilenceSec: 0.15 });
      } catch (error) {
        call.host.log?.(`generate_tts_and_add_to_timeline_tool: no speech runs (${error instanceof Error ? error.message : String(error)}); words spread over the voice's length`);
      }
      let words = scriptWordTimes(narration, voiced, seconds);
      // Speech recognition on this machine costs nothing: the script then takes the times its words are heard at.
      let aligned: StoredTranscript | undefined;
      if (call.host.audio?.transcribesOnDevice && call.host.audio.transcribe) {
        try {
          const heard = await call.host.audio.transcribe(path, { language: "", prompt: lyricsPrompt(narration), onDeviceOnly: true, signal: call.signal });
          const got = alignedTranscript(narration, heard, "");
          if (got.alignment.heardRatio >= 0.5) {
            aligned = got.record;
            words = got.record.words;
          }
        } catch (error) {
          if (call.signal?.aborted) throw error;
          call.host.log?.(`generate_tts_and_add_to_timeline_tool: no word timings heard (${error instanceof Error ? error.message : String(error)}); words spread over the voice's pauses`);
        }
      }
      const clip = call.commit((tx) => {
        const file = addFile(tx, media, { dedupe: false, mediaType: "audio" });
        if (words.length > 0) tx.update(["files", { id: file.id }], { ai_metadata: { ...record(file.ai_metadata), [ASR_KEY]: aligned ?? ttsTranscript(words) } });
        let target = picked;
        if (target === null) {
          // Every track above the main one is busy (or there is only one): a Narration track right above it.
          const lowest = [...tx.project.layers].sort((a, b) => a.number - b.number)[0];
          target = addTrack(tx, { ...(lowest ? { above: lowest.number } : {}), label: NARRATION_TRACK_NAME }).number;
          newTracks = 1;
        } else if (newTracks > 0) ensureTrack(tx, target);
        return addClip(tx, { fileId: String(file.id), position, layer: target });
      });
      const placed = clip.layer;
      return (
        `Added TTS audio to timeline at position ${pyFloat(position)}s on track ${formatTrackLabelForLlm(placed, call.doc.project.layers)}${newTracksNote(newTracks)}` +
        ` timeline_clip_id=${clip.id}.` +
        (words.length === 0
          ? " No word timings could be read from the voice: caption it with kinetic_captions_tool cues and say the captions are hand-timed."
          : aligned
            ? ` Its ${words.length} words are timed to where they are heard in the voice: kinetic_captions_tool timeline_clip_ids=["${clip.id}"] captions it word by word.`
            : voiced.length > 0
            ? ` Its ${words.length} words are timed to the voice's pauses: kinetic_captions_tool timeline_clip_ids=["${clip.id}"] captions it word by word.`
            : ` Its ${words.length} words are spread over the voice's length (its pauses could not be measured): kinetic_captions_tool timeline_clip_ids=["${clip.id}"] captions it word by word; say the timing is approximate.`)
      );
    },
  }),

  contractTool("modify_clip_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    run: () =>
      unavailable(
        "modify_clip_tool",
        "AI clip edits cut and upload the source segment and splice the result with the desktop's ffmpeg pipeline. Use Zenvi desktop.",
      ),
  }),

  contractTool("generate_transition_clip_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    run: () =>
      unavailable(
        "generate_transition_clip_tool",
        "baking clip A + AI morph + clip B needs the desktop's ffmpeg pipeline. Use apply_transition_tool, or Zenvi desktop.",
      ),
  }),
];
