/**
 * generate_broll_set_tool: N shots that look like one shoot, generated from
 * one style and (where the backend takes one) one reference image, then
 * each still animated into a clip. All new files go into the bin in one
 * undo step; nothing is placed.
 *
 * Why a set and not N generate calls: generated shots prompted one by one
 * come back in N palettes, lenses and lights, the same "unrelated shoots"
 * problem as mixed stock (bench SK2). The set shares three things:
 * - one style line on every prompt: the person's words plus the reference's
 *   measured colours, brightness and white balance;
 * - one reference image (the reference file's frame, else the set's first
 *   still) for image-to-image providers (zenvi-backend #69: OpenAI, Gemini);
 *   backends without it answer no provider and the receipt says so;
 * - image-to-video from each still (the morph route with the still at both
 *   ends), so the clip keeps the still's palette instead of re-rolling it.
 *
 * Cached: every file records a key of its prompt, size, reference and
 * length (ai_metadata.broll_key); a call that asks for a shot the bin
 * already has reuses it and pays nothing, and a clip whose animation failed
 * keeps its still, so the next call only animates.
 */

import { z } from "zod";
import { brightnessOf, dominantColors, meanLuma } from "../../brief/inventory.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import type { ProjectFile } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import { generateImage, generateMorph } from "../backend.js";
import { buildLookProfile } from "../color-agent.js";
import { mediaFileProject, renderPixels, secondsToFrame } from "../color-frames.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { singleFileProject } from "../media-frames.js";
import { applied, refused, unchanged } from "../receipt.js";
import type { ImportedMedia } from "../types.js";
import { scopesOf } from "./color-agent.js";
import { record, rememberFile } from "./common.js";
import { generatedImageType, generatedMediaStamp, snapKlingDuration, strictBase64, t2vDims } from "./generation.js";

const TOOL = "generate_broll_set_tool";
const MAX_SHOTS = 8;
/** Width the reference frame is sent at: enough for a palette and a composition, small enough for a JSON body. */
const REFERENCE_WIDTH = 768;
const MEASURE_WIDTH = 48;
/** warm_cool beyond this reads as warm or cool light. */
const WARM = 0.03;
/** A failed generation with these words means more calls would fail the same way: stop spending. */
const STOP = /credit|insufficient|402|quota|limit|not configured|unauthor/i;

const input = z.strictObject({
  shots: z
    .union([z.array(z.string().trim().min(1).max(300)).min(1).max(MAX_SHOTS), z.string().trim().min(1).max(2400)])
    .describe(`What each shot shows, one entry per shot (1-${MAX_SHOTS}), subject and action only, e.g. ['hands pour coffee into a ceramic cup', 'steam over the cup by the window']. A string is split on ';' or new lines.`),
  style: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .optional()
    .describe("The look every shot shares: palette, light, lens, film stock, e.g. 'warm tungsten interior, 35mm lens, shallow depth of field, soft film grain, cream and walnut palette'. Needed unless reference_file_id is given."),
  reference_file_id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .describe("A media-bin image or video (the person's footage, a brand photo) the set must look like: its measured colours and light join the style, and its frame is the reference image where the image model takes one."),
  animate: z.boolean().optional().describe("Turn each still into a clip that starts and ends on it (default true). false: stills only, cheaper."),
  duration_seconds: z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).optional().describe("Clip length when animating: 5 (default) or 10."),
  provider: z.enum(["auto", "gemini", "openai", "grok"]).optional().describe("Image model for the whole set (auto: Gemini when the set shares a reference image, else the backend's default)."),
  dry_run: z.boolean().optional().describe("List the prompts, the cache hits and what would be generated; spend nothing."),
});
type Args = z.output<typeof input>;

interface ShotPlan {
  shot: string;
  prompt: string;
  stillKey: string;
  videoKey: string;
  still?: ProjectFile;
  video?: ProjectFile;
}

interface NewMedia {
  plan: ShotPlan;
  kind: "still" | "video";
  media: ImportedMedia;
}

function shotList(raw: Args["shots"]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[;\n]+/);
  return [...new Set(list.map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, MAX_SHOTS);
}

/** 64 bits of FNV-1a as hex: a cache key, not a security boundary. */
export function cacheKey(...parts: readonly (string | number)[]): string {
  const text = parts.join("␟");
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 0x100) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The words every prompt of the set ends with. */
export function styleLine(style: string | undefined, measured: { colors: string[]; brightness: string | null; light: string | null } | null): string {
  const parts: string[] = [];
  if (style) parts.push(`Style of the whole set: ${style.replace(/[.\s]+$/, "")}.`);
  if (measured && (measured.colors.length > 0 || measured.brightness || measured.light)) {
    const look = [measured.colors.length > 0 && `palette ${measured.colors.join(" ")}`, measured.brightness && `${measured.brightness} exposure`, measured.light && `${measured.light} light`].filter(Boolean);
    parts.push(`Match the reference: ${look.join(", ")}.`);
  }
  parts.push("Every shot of this set is from the same shoot: same camera and lens, same lighting, same colour grade. Photographic, no text, no logos, no watermark.");
  return parts.join(" ");
}

function cached(files: readonly ProjectFile[], key: string): ProjectFile | undefined {
  return files.find((f) => record(f.ai_metadata).broll_key === key);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The reference file's colours, exposure and white balance from one small frame; null where this host cannot render. */
async function measureReference(call: ToolCall, file: ProjectFile): Promise<{ colors: string[]; brightness: string | null; light: string | null } | null> {
  if (!call.host.frames) return null;
  const duration = Number(file.duration) || 0;
  try {
    const project = mediaFileProject(call.doc.project, file, duration);
    const { pixels } = await renderPixels(call, project, secondsToFrame(project, duration * 0.4), MEASURE_WIDTH);
    const warm = Number(buildLookProfile(scopesOf(pixels)).warm_cool);
    const light = !Number.isFinite(warm) ? null : warm > WARM ? "warm" : warm < -WARM ? "cool" : "neutral";
    return { colors: dominantColors(pixels), brightness: brightnessOf(meanLuma(pixels)), light };
  } catch (error) {
    call.host.log?.(`${TOOL}: measuring ${String(file.id)} failed: ${errorText(error)}`);
    return null;
  }
}

/** A bin file's picture as a JPEG data URI (the reference frame, a cached still), or null. */
async function frameDataUri(call: ToolCall, file: ProjectFile, width: number): Promise<string | null> {
  if (!call.host.frames) return null;
  const duration = Number(file.duration) || 0;
  const still = String(file.media_type ?? "") === "image" || Boolean(file.has_single_image);
  try {
    const image = await call.host.frames.renderFrame(singleFileProject(call.doc.project, file), still ? 0 : duration * 0.4, { width, format: "jpeg" });
    return `data:${image.mimeType};base64,${image.data}`;
  } catch (error) {
    call.host.log?.(`${TOOL}: frame of ${String(file.id)} failed: ${errorText(error)}`);
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(binary);
}

export const brollSetTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Generate a B-roll set",
    description:
      `Generate a consistent SET of 1-${MAX_SHOTS} B-roll shots that look like one shoot (same palette, light and lens): every prompt ends with one shared style line (your style words plus the reference file's measured colours and light), ` +
      "the reference file's frame (or the set's first still) goes with every image prompt where the image model takes a reference, and each still is animated into a clip that starts on it, so the clip keeps its look. " +
      "Use it for the shots the brief's footage plan lists as 'generate' (get_brief_tool) instead of one generate call per shot. Files only, in one undo step; nothing is placed. " +
      "Cached: shots already generated with the same prompt, style and reference are reused for free. Charges AI credits per still and per clip: dry_run=true shows the plan first. After cutting them in, run unify_grade_tool on the assembled set.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["backend", "media"],
    run: async (call, args: Args) => {
      const media = call.host.media!;
      if (!media.writeGenerated) return unavailable(TOOL, "it cannot store generated images.");
      const animate = args.animate ?? true;
      if (animate && !media.importUrl) return unavailable(TOOL, "it cannot download generated video (animate=false makes stills only).");
      const shots = shotList(args.shots);
      if (shots.length === 0) return refused(TOOL, "Error: give at least one shot.");
      if (!args.style && !args.reference_file_id) return refused(TOOL, "Error: give the set's style (palette, light, lens) or a reference_file_id to match.");
      const project = call.doc.project;
      const reference = args.reference_file_id ? project.files.find((f) => String(f.id) === args.reference_file_id) : undefined;
      if (args.reference_file_id && !reference) return refused(TOOL, `Error: media-bin file ${args.reference_file_id} not found.`);
      if (reference && isAudioOnlyMedia(reference)) return refused(TOOL, `Error: ${args.reference_file_id} has no picture to match.`);
      const duration = snapKlingDuration(args.duration_seconds ?? 5);
      const [width, height] = t2vDims(project.width, project.height);

      const measured = reference ? await measureReference(call, reference) : null;
      const line = styleLine(args.style, measured);
      const refKey = reference ? `${String(reference.id)}:${String(reference.path ?? "")}` : "";
      const setKey = cacheKey("set", line, refKey);
      const plans: ShotPlan[] = shots.map((shot) => {
        const prompt = `${shot.replace(/[.\s]+$/, "")}. ${line}`;
        const stillKey = cacheKey("still", prompt, width, height, refKey);
        const videoKey = cacheKey("video", stillKey, duration);
        return { shot, prompt, stillKey, videoKey, still: cached(project.files, stillKey), video: animate ? cached(project.files, videoKey) : undefined };
      });
      const stillsToMake = plans.filter((p) => !p.still && !(animate && p.video)).length;
      const videosToMake = animate ? plans.filter((p) => !p.video).length : 0;

      if (args.dry_run) {
        const lines = [
          `Dry run, nothing generated: ${plans.length} shot(s), ${stillsToMake} still(s) and ${videosToMake} clip(s) of ${duration}s to generate, the rest cached.`,
          `Style line: ${line}`,
          ...plans.map((p, i) => `  ${i + 1}. ${p.shot}${p.video ? ` (cached clip ${String(p.video.id)})` : p.still ? ` (cached still ${String(p.still.id)})` : ""}`),
        ];
        return applied(TOOL, lines.join("\n"), { data: { set: setKey, style_line: line, prompts: plans.map((p) => p.prompt), to_generate: { stills: stillsToMake, clips: videosToMake } } }, 0);
      }
      if (stillsToMake === 0 && videosToMake === 0) {
        const ids = plans.map((p) => String((animate ? p.video : p.still)!.id));
        return unchanged(TOOL, `All ${plans.length} shot(s) of this set are already in the bin: ${ids.join(", ")}. Nothing generated.`, { data: { set: setKey, files: ids } });
      }

      // One reference for the whole set: the person's file, else the first still made.
      let referenceUrl = reference ? await frameDataUri(call, reference, REFERENCE_WIDTH) : null;
      const wantsProvider = args.provider && args.provider !== "auto" ? args.provider : undefined;
      // One image model for the whole set: Gemini whenever a reference goes along (the person's frame, or the first still
      // for the stills after it), so the first still is not drawn by another model. Grok takes no reference (zenvi-backend #69 refuses it).
      const provider = wantsProvider ?? (referenceUrl || stillsToMake > 1 ? "gemini" : undefined);
      let referenceHonoured: boolean | null = null;
      const made: NewMedia[] = [];
      const warnings: string[] = [];
      let stopped = false;

      for (const plan of plans) {
        if (stopped || call.signal?.aborted) break;
        let stillUrl: string | null = null;
        let stillMedia: ImportedMedia | undefined;
        if (!plan.still && !(animate && plan.video)) {
          const sendReference = Boolean(referenceUrl) && wantsProvider !== "grok" && referenceHonoured !== false;
          const result = await generateImage(call, plan.prompt, { width, height }, { ...(provider ? { provider } : {}), ...(sendReference ? { referenceImageUrl: referenceUrl! } : {}) });
          if ("error" in result) {
            warnings.push(`"${plan.shot}": the still failed: ${result.error}`);
            stopped = STOP.test(result.error);
            continue;
          }
          if (sendReference) referenceHonoured = result.provider !== undefined;
          const bytes = strictBase64(result.imageBase64);
          if (bytes.length === 0) {
            warnings.push(`"${plan.shot}": the backend returned no image data.`);
            continue;
          }
          const { ext, contentType } = generatedImageType(result.mimeType);
          try {
            const path = await media.writeGenerated.call(media, `broll_${plan.stillKey}${ext}`, bytes, contentType);
            stillMedia = { path, info: await media.probe(path) };
          } catch (error) {
            warnings.push(`"${plan.shot}": could not save the still: ${errorText(error)}`);
            continue;
          }
          made.push({ plan, kind: "still", media: stillMedia });
          stillUrl = `data:${contentType};base64,${bytesToBase64(bytes)}`;
          referenceUrl ??= stillUrl;
        }
        if (!animate || plan.video) continue;
        stillUrl ??= plan.still ? await frameDataUri(call, plan.still, width) : null;
        if (!stillUrl) {
          warnings.push(`"${plan.shot}": no still to animate on this surface.`);
          continue;
        }
        const motion = `${plan.prompt} Slow, steady camera move; the light, palette and grade stay exactly as in the still.`;
        const video = await generateMorph(call, { prompt: motion, startImageUrl: stillUrl, endImageUrl: stillUrl, durationSeconds: duration, width, height });
        if ("error" in video) {
          warnings.push(`"${plan.shot}": the clip failed (its still is kept, a new call only animates it): ${video.error}`);
          stopped = STOP.test(video.error);
          continue;
        }
        try {
          made.push({ plan, kind: "video", media: await media.importUrl!.call(media, video.videoUrl, { filename: `broll_${plan.videoKey}.mp4`, signal: call.signal }) });
        } catch (error) {
          warnings.push(`"${plan.shot}": the clip did not download: ${errorText(error)}`);
        }
      }
      if (made.length === 0) return refused(TOOL, `Error: nothing was generated. ${warnings.join(" ")}`.trim());
      if (referenceHonoured === false) warnings.push("This backend ignored the reference image (no image-to-image model yet): the set shares the style line only; unify_grade_tool evens the rest.");

      const files = call.commit(
        (tx) =>
          made.map((m) => {
            const file = addFile(tx, m.media, { dedupe: true, ...(m.kind === "still" ? { mediaType: "image" as const } : {}) });
            const stamp = generatedMediaStamp(m.plan.prompt, "broll_set", file);
            const key = m.kind === "still" ? m.plan.stillKey : m.plan.videoKey;
            tx.update(["files", { id: file.id }], { ...stamp, ai_metadata: { ...record(stamp.ai_metadata), prompt: m.plan.prompt, broll_key: key, broll_set: setKey, broll_shot: m.plan.shot } });
            return file;
          }),
        `Generate B-roll set (${plans.length})`,
      );
      const idOf = new Map(made.map((m, i) => [`${m.kind}:${m.plan.stillKey}`, String(files[i]!.id)]));
      const rows = plans.map((p) => {
        const still = idOf.get(`still:${p.stillKey}`) ?? (p.still ? String(p.still.id) : undefined);
        const clip = idOf.get(`video:${p.stillKey}`) ?? (p.video ? String(p.video.id) : undefined);
        return { shot: p.shot, still_file_id: still, clip_file_id: clip, cached: !idOf.has(`still:${p.stillKey}`) && !idOf.has(`video:${p.stillKey}`) && Boolean(p.still || p.video) };
      });
      const usable = rows.map((r) => (animate ? r.clip_file_id : r.still_file_id)).filter((id): id is string => Boolean(id));
      if (usable.length > 0) rememberFile(call, usable[usable.length - 1]!);
      const stills = made.filter((m) => m.kind === "still").length;
      const clips = made.length - stills;
      const lookRef = args.reference_file_id ?? usable[0];
      const lines = [
        `Generated ${stills} still(s)${animate ? ` and ${clips} clip(s) of ${duration}s` : ""} for a set of ${plans.length} shot(s)${referenceHonoured ? ", every still from one reference image" : ""}:`,
        ...rows.map((r, i) => `  ${i + 1}. ${animate ? `clip ${r.clip_file_id ?? "-"} ` : ""}still ${r.still_file_id ?? "-"}${r.cached ? " (cached)" : ""}  '${r.shot}'`),
        `Next: place them, then unify_grade_tool${lookRef ? ` reference_file_id=${lookRef}` : ""} so the set and the rest of the cut share one grade.`,
      ];
      return applied(TOOL, lines.join("\n"), {
        warnings,
        data: { set: setKey, style_line: line, shots: rows, generated: { stills, clips }, reference: { file_id: args.reference_file_id ?? null, measured, honoured: referenceHonoured } },
      });
    },
  }),
];
