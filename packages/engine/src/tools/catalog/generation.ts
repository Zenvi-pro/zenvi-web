/**
 * AI generation tools: generate_video_and_add_to_timeline_tool,
 * generate_tts_and_add_to_timeline_tool, modify_clip_tool,
 * generate_transition_clip_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * generate_video_and_add_to_timeline (+ _snap_kling_o1_duration,
 * _project_kling_o1_t2v_dims), generate_tts_and_add_to_timeline /
 * add_tts_audio_to_timeline, modify_clip, generate_transition_clip.
 *
 * Credits are enforced by the backend on /generation/* (api/credit_gate.py),
 * so the desktop's client-side credit pre-check is not repeated here.
 * modify_clip_tool and generate_transition_clip_tool cut and upload source
 * segments and bake the result with the desktop's ffmpeg pipeline, so they
 * are refused as not available.
 */

import type { ProjectFile } from "../../model/types.js";
import { addClip, moveClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { generateTts, generateVideo } from "../backend.js";
import { contractTool, unavailable, type CatalogTool } from "../define.js";
import { parseSecondsArg, TimeArgError } from "../placement.js";
import { pyFloat } from "../pyfmt.js";
import { applied } from "../receipt.js";
import { defaultUnderlayLayerNumber, formatTrackLabelForLlm, normalizeTrackOrLayerArg } from "../tracks.js";
import type { ImportedMedia } from "../types.js";
import { applyPlacement, planPlacement, provisionalFile, placementText } from "./clips.js";
import { record, text } from "./common.js";

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

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
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
        const r = normalizeTrackOrLayerArg(text(input.track), project.layers);
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

  contractTool("generate_tts_and_add_to_timeline_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["backend", "media"],
    run: async (call, input) => {
      const narration = text(input.text);
      if (!narration) return "Error: No text provided for narration.";
      const writeGenerated = call.host.media!.writeGenerated;
      if (!writeGenerated) return unavailable("generate_tts_and_add_to_timeline_tool", "it cannot store generated audio.");
      let position: number;
      try {
        position = parseSecondsArg(input.position, 0, "position") ?? 0;
      } catch (error) {
        if (error instanceof TimeArgError) return `Error: ${error.message}`;
        throw error;
      }
      const project = call.doc.project;
      let layer = defaultUnderlayLayerNumber(project.layers);
      if (input.track !== undefined && String(input.track).trim() !== "") {
        const r = normalizeTrackOrLayerArg(String(input.track), project.layers);
        if (r.error) return r.error;
        if (r.layer !== undefined) layer = r.layer;
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
      const media: ImportedMedia = { path, info: { ...info, media_type: "audio" }, name: "Narration" };
      const clip = call.commit((tx) => {
        const file = addFile(tx, media, { dedupe: false, mediaType: "audio" });
        return addClip(tx, { fileId: String(file.id), position, layer });
      });
      return (
        `Added TTS audio to timeline at position ${pyFloat(position)}s on track ${formatTrackLabelForLlm(layer, project.layers)}` +
        ` timeline_clip_id=${clip.id}.`
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
