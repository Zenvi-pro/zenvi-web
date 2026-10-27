/**
 * Zenvi Motion blocks: parametric HTML motion graphics (prompt bars, glass
 * UI cards, kinetic type, counters, HUD callouts…) the host renders to
 * video with headless Chrome, placed as linked media.
 *
 * list_motion_blocks_tool lists the blocks and their params;
 * add_motion_block_tool renders one and places it over the video
 * (transparent ProRes 4444) or full frame (opaque H.264) in one undo step;
 * update_motion_block_tool re-renders a placed block with new params and
 * swaps the media of every clip that plays it, in one undo step. The spec
 * lives on the file record (`zenvi_link`, kind "zenvi-motion",
 * links/zenvi-link.ts). Rendering is the host's (`MotionHost`): only hosts
 * that can run Chrome (the CLI, `zenvi mcp`, Zenvi Cloud) list these tools.
 */

import { z } from "zod";
import { isAudioOnlyMedia, isSingleImageMedia } from "../../model/media.js";
import type { Project, ProjectFile } from "../../model/types.js";
import { clipsUsingFile } from "../../model/query.js";
import { addFile, updateFile, writeFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import { placeOverlayClip } from "../../ops/overlays.js";
import { LINK_KEY, motionLink, readMotionLink, type MotionLinkSpec } from "../../links/zenvi-link.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import type { MotionBlockInfo, MotionHost, MotionRender } from "../types.js";
import { clipsInWindow, errorText, planOverlayTrack, projectSize, snapToFrame, TextToolError, trackInfo } from "../titles-text.js";

const LIST = "list_motion_blocks_tool";
const ADD = "add_motion_block_tool";
const UPDATE = "update_motion_block_tool";
const SETUP = "setup_motion_runtime_tool";
const TRACK_LABEL = "Motion";

const round = (t: number): number => Math.round(t * 1000) / 1000;

/** Params arrive as an object, or as a JSON string from backend agents. */
const paramsArg = z
  .union([z.record(z.string(), z.unknown()), z.string().max(20000)])
  .optional()
  .describe("The block's parameters as an object (list_motion_blocks_tool gives each block's names, types and defaults); omitted ones take the block's defaults. Media params take a Project Files id.");

function parseParams(raw: Record<string, unknown> | string | undefined): Record<string, unknown> | string {
  if (raw === undefined || raw === "") return {};
  if (typeof raw !== "string") return raw;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  return "Error: params must be a JSON object, e.g. {\"text\": \"Hello\"}.";
}

function fpsOf(project: Project): { num: number; den: number } {
  const num = Number(project.fps?.num);
  const den = Number(project.fps?.den);
  return num > 0 && den > 0 ? { num, den } : { num: 30, den: 1 };
}

function blockLine(b: MotionBlockInfo): string {
  return `${b.id} (${b.duration.min}-${b.duration.max} s, default ${b.duration.default}; ${b.alpha ? "over video" : "full frame"}): ${b.description}`;
}

/** Media params: each must name a picture in Project Files; returns param → project path. */
function mediaPaths(project: Project, block: MotionBlockInfo, params: Record<string, unknown>): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const spec of block.params) {
    if (spec.type !== "media" || params[spec.name] === undefined) continue;
    const id = String(params[spec.name]);
    const file = project.files.find((f) => String(f.id) === id);
    if (!file) return `Error: ${spec.name}: unknown file id ${id} (use a Project Files id).`;
    if (isAudioOnlyMedia(file)) return `Error: ${spec.name}: ${id} has no picture; give a photo or a video.`;
    // The renderer refuses the wrong kind too, but only after the work of preparing it.
    const kind = isSingleImageMedia(file) ? "image" : "video";
    if (spec.accept && !spec.accept.includes(kind)) return `Error: ${spec.name} takes a ${spec.accept.includes("image") ? "photo" : "video"}, and ${id} is a ${kind === "image" ? "photo" : "video"}.`;
    out[spec.name] = String(file.path);
  }
  return out;
}

function renderError(error: unknown): string {
  return errorText(`the motion block could not be rendered: ${error instanceof Error ? error.message : String(error)}`);
}

interface Rendered {
  render: MotionRender;
  spec: MotionLinkSpec;
}

async function renderSpec(call: ToolCall, motion: MotionHost, project: Project, spec: MotionLinkSpec): Promise<Rendered | string> {
  const block = motion.blocks().find((b) => b.id === spec.block)!;
  const media = mediaPaths(project, block, spec.params);
  if (typeof media === "string") return media;
  const [width, height] = projectSize(project);
  try {
    const render = await motion.render(
      { block: spec.block, params: spec.params, media, width, height, fps: fpsOf(project), seconds: spec.seconds, alpha: spec.alpha, motionBlurSamples: spec.motionBlurSamples, draft: spec.draft },
      call.signal,
    );
    return { render, spec };
  } catch (error) {
    return renderError(error);
  }
}

function linkOf({ render, spec }: Rendered): Record<string, unknown> {
  return motionLink(spec, { codec: render.codec, width: render.width, height: render.height, fps: render.fps, frames: render.frames, output: render.media.path, fingerprint: render.fingerprint, renderedAt: new Date().toISOString() });
}

function renderData({ render, spec }: Rendered): Record<string, unknown> {
  return {
    block: spec.block,
    params: spec.params,
    seconds: spec.seconds,
    alpha: spec.alpha,
    codec: render.codec,
    width: render.width,
    height: render.height,
    frames: render.frames,
    fingerprint: render.fingerprint,
    cached: render.cached,
    render_seconds: round(render.renderSeconds),
  };
}

const listInput = z.strictObject({
  block: z.string().max(64).optional().describe("One block's id: its full parameter list (default: every block, briefly)."),
  tag: z.string().max(32).optional().describe("Only blocks with this tag (ui, type, kinetic, background, hud…)."),
});

const addInput = z.strictObject({
  block: z.string().min(1).max(64).describe("Block id from list_motion_blocks_tool: prompt_bar, glass_cards, kinetic_headline, word_rotator, counter, text_scramble, hud_callouts, gradient_field…"),
  params: paramsArg,
  position_seconds: z.number().min(0).optional().describe("Timeline start, seconds (default 0)."),
  duration_seconds: z.number().positive().max(60).optional().describe("Length, seconds (default the block's; within its min-max)."),
  placement: z.enum(["over_video", "full_frame"]).optional().describe("over_video: transparent, on the lowest free track above the picture; full_frame: opaque with its own background. Default the block's (list_motion_blocks_tool says which)."),
  track: z.union([z.number(), z.string().max(40)]).optional().describe("A free track for it (number or name); default the lowest free track above the video."),
  motion_blur: z.number().int().min(0).max(16).optional().describe("Sub-frames averaged per frame for motion blur on fast moves (0 = off, 4-8 looks filmic; renders that many times slower)."),
  draft: z.boolean().optional().describe("Half-size, quicker render for a preview."),
});

const updateInput = z.strictObject({
  file_id: z.string().min(1).optional().describe("The motion block's Project Files id (add_motion_block_tool's data.file_id)."),
  clip_id: z.string().min(1).optional().describe("Or a timeline clip that plays it."),
  params: paramsArg.describe("Params to change, merged over the current ones (null resets one to the block's default)."),
  duration_seconds: z.number().positive().max(60).optional().describe("New length, seconds; clips that showed the whole block follow it."),
  motion_blur: z.number().int().min(0).max(16).optional().describe("Sub-frames per frame for motion blur (0 = off)."),
  draft: z.boolean().optional().describe("Half-size preview render (false for the final)."),
});

export const motionBlockTools: CatalogTool[] = [
  directTool({
    name: LIST,
    title: "List motion blocks",
    description:
      "List Zenvi Motion blocks: parametric motion graphics (AI prompt bars that type, glass UI cards with a clicking pointer, kinetic headlines, word rotators, counters, text scramble, HUD callouts, gradient backgrounds) " +
      "rendered at any size, with transparency. Gives each block's params, durations and whether it sits over video. Use add_motion_block_tool to place one.",
    input: listInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    requires: ["motion"],
    run: async (call, args: z.infer<typeof listInput>) => {
      const motion = call.host.motion!;
      const all = motion.blocks();
      // A block that cannot render yet is worse than none: say so before the agent plans around it.
      const runtime = await motion.runtime?.();
      const notReady = runtime && !runtime.ready ? runtime : undefined;
      const warnings = notReady ? [notReady.detail] : [];
      const note = notReady ? `\nWarning: ${notReady.detail}` : "";
      const status = runtime ? { runtime } : {};
      if (args.block) {
        const b = all.find((x) => x.id === args.block);
        if (!b) return refused(LIST, `Error: unknown motion block ${args.block}; blocks: ${all.map((x) => x.id).join(", ")}.`);
        const params = b.params.map((p) => `${p.name} (${p.type}${p.options ? `: ${p.options.join("|")}` : ""}${p.default !== undefined ? `, default ${JSON.stringify(p.default)}` : ""}): ${p.description}`);
        return applied(LIST, `${blockLine(b)}\nParams:\n${params.join("\n")}${note}`, { warnings, data: { blocks: [b], ...status } }, 0);
      }
      const blocks = args.tag ? all.filter((b) => b.tags.includes(args.tag!.toLowerCase())) : all;
      return applied(LIST, `${blocks.length} motion block(s):\n${blocks.map(blockLine).join("\n")}\nlist_motion_blocks_tool block=<id> gives a block's params.${note}`, {
        warnings,
        data: { blocks: blocks.map((b) => ({ id: b.id, title: b.title, tags: b.tags, duration: b.duration, aspects: b.aspects, alpha: b.alpha, params: b.params.map((p) => p.name) })), ...status },
      }, 0);
    },
  }),
  directTool({
    name: SETUP,
    title: "Set up the motion runtime",
    description:
      "Install what Zenvi Motion blocks render with on this computer: headless Chrome (chrome-headless-shell, a one-time download of about 90 MB, the same as `zenvi motion setup`). " +
      "Call it when list_motion_blocks_tool or mcp_health_tool says the runtime is missing, or an add_motion_block_tool call asks for it; it does nothing when Chrome is already installed. " +
      "Only this computer's hosts have it: Zenvi Cloud renders blocks itself and refuses.",
    input: z.strictObject({}),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    requires: ["motion"],
    run: async (call) => {
      const motion = call.host.motion!;
      if (!motion.setup) return unavailable(SETUP, "this host renders motion blocks itself (or somewhere else), so there is nothing to install here.");
      const before = await motion.runtime?.();
      if (before?.ready) return unchanged(SETUP, `${before.detail} Nothing to download.`, { data: { runtime: before } });
      let status;
      try {
        status = await motion.setup(call.signal);
      } catch (error) {
        return failed(SETUP, errorText(`the motion runtime could not be installed: ${error instanceof Error ? error.message : String(error)}. Check the internet connection and call setup_motion_runtime_tool again, or run \`zenvi motion setup\`.`));
      }
      if (!status.ready) return refused(SETUP, errorText(status.detail));
      return applied(SETUP, `Installed headless Chrome. ${status.detail} Motion blocks can render now.`, { data: { runtime: status } }, 0);
    },
  }),
  directTool({
    name: ADD,
    title: "Add a motion block",
    description:
      "Render a Zenvi Motion block (list_motion_blocks_tool) with your params at the project's size and frame rate and place it on the timeline in one undo step: " +
      "over the video with transparency (lowest free track above the picture), or full frame with its own background. The render is cached by its params; " +
      "the spec stays on the file so update_motion_block_tool can change the text or colours later.",
    input: addInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["motion", "media"],
    run: async (call, args: z.infer<typeof addInput>) => {
      const motion = call.host.motion!;
      const project = call.doc.project;
      const block = motion.blocks().find((b) => b.id === args.block);
      if (!block) return refused(ADD, `Error: unknown motion block ${args.block}; blocks: ${motion.blocks().map((b) => b.id).join(", ")}.`);
      const raw = parseParams(args.params);
      if (typeof raw === "string") return refused(ADD, raw);
      const checked = motion.check(block.id, raw);
      if (!checked.ok) return refused(ADD, errorText(checked.error));
      const asked = args.duration_seconds ?? block.duration.default;
      if (asked < block.duration.min || asked > block.duration.max) {
        return refused(ADD, `Error: ${block.id} runs ${block.duration.min}-${block.duration.max} s (got ${asked}).`);
      }
      // Whole frames: the render has round(seconds × fps) frames, and the clip must not outrun them.
      const seconds = snapToFrame(project, asked);
      const media = mediaPaths(project, block, checked.params);
      if (typeof media === "string") return refused(ADD, media);
      const start = snapToFrame(project, args.position_seconds ?? 0);
      let plan: { layer: number; created: boolean };
      try {
        plan = planOverlayTrack(project, start, start + seconds, args.track);
      } catch (error) {
        if (error instanceof TextToolError) return refused(ADD, errorText(error.message));
        throw error;
      }
      const alpha = args.placement ? args.placement === "over_video" : block.alpha;
      const spec: MotionLinkSpec = { block: block.id, params: checked.params, seconds, alpha, motionBlurSamples: Math.max(1, args.motion_blur ?? 1), draft: args.draft === true };
      const rendered = await renderSpec(call, motion, project, spec);
      if (typeof rendered === "string") return failed(ADD, rendered);

      const placed = call.commit((tx) => {
        const added = addFile(tx, rendered.render.media, { mediaType: "video", name: `${block.title} (Zenvi Motion)`, dedupe: false });
        const file = updateFile(tx, String(added.id), { [LINK_KEY]: linkOf(rendered) });
        const clip = placeOverlayClip(tx, { fileId: String(file.id), position: start, duration: seconds, layer: plan.layer, newTrackLabel: TRACK_LABEL, title: block.title });
        return { file, clip };
      }, `Add motion block ${block.id}`);
      const doc = call.doc.project;
      const track = trackInfo(doc, plan.layer);
      return applied(ADD, `Added ${block.title} at ${start.toFixed(2)}-${(start + seconds).toFixed(2)}s on track ${track.track ?? plan.layer}${alpha ? " over the video" : " full frame"}${rendered.render.cached ? " (cached render)" : ""}.`, {
        warnings: checked.warnings,
        data: { file_id: placed.file.id, timeline_clip_id: placed.clip.id, position: round(start), duration: round(seconds), ...track, new_track: plan.created, ...renderData(rendered) },
      });
    },
  }),
  directTool({
    name: UPDATE,
    title: "Update a motion block",
    description:
      "Change a placed Zenvi Motion block: new params (merged over the current ones), length, motion blur or draft/final. It is rendered again and every clip that plays it switches to the new render, in one undo step. " +
      "Give the block's file_id (add_motion_block_tool's data.file_id) or a clip_id.",
    input: updateInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["motion", "media"],
    run: async (call, args: z.infer<typeof updateInput>) => {
      const motion = call.host.motion!;
      const project = call.doc.project;
      let file: ProjectFile | undefined;
      if (args.file_id) file = project.files.find((f) => String(f.id) === args.file_id);
      else if (args.clip_id) {
        const clip = project.clips.find((c) => c.id === args.clip_id);
        if (!clip) return refused(UPDATE, `Error: unknown clip id ${args.clip_id}.`);
        file = project.files.find((f) => String(f.id) === String(clip.file_id));
        if (!file) return refused(UPDATE, `Error: clip ${args.clip_id} plays no file in Project Files.`);
      } else return refused(UPDATE, "Error: give file_id or clip_id of the motion block.");
      if (!file) return refused(UPDATE, `Error: unknown file id ${args.file_id}.`);
      const current = readMotionLink(file);
      if (!current) return refused(UPDATE, `Error: ${file.id} is not a Zenvi Motion block (add one with add_motion_block_tool).`);
      const block = motion.blocks().find((b) => b.id === current.block);
      if (!block) return refused(UPDATE, `Error: this Zenvi has no motion block ${current.block}.`);
      const raw = parseParams(args.params);
      if (typeof raw === "string") return refused(UPDATE, raw);
      const merged: Record<string, unknown> = { ...current.params };
      for (const [k, v] of Object.entries(raw)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      const checked = motion.check(block.id, merged);
      if (!checked.ok) return refused(UPDATE, errorText(checked.error));
      const asked = args.duration_seconds ?? (current.seconds || block.duration.default);
      if (asked < block.duration.min || asked > block.duration.max) {
        return refused(UPDATE, `Error: ${block.id} runs ${block.duration.min}-${block.duration.max} s (got ${asked}).`);
      }
      const seconds = snapToFrame(project, asked);
      // A shorter block cuts every clip's end to it (writeFile); a clip trimmed to start past that would be empty.
      const emptied = clipsUsingFile(project, String(file.id)).find((c) => Number(c.start) >= seconds);
      if (emptied) return refused(UPDATE, `Error: clip ${emptied.id} starts ${round(Number(emptied.start))}s into the block; it cannot be shorter than that.`);
      const spec: MotionLinkSpec = {
        block: block.id,
        params: checked.params,
        seconds,
        alpha: current.alpha,
        motionBlurSamples: args.motion_blur !== undefined ? Math.max(1, args.motion_blur) : current.motionBlurSamples,
        draft: args.draft ?? current.draft,
      };
      const rendered = await renderSpec(call, motion, project, spec);
      if (typeof rendered === "string") return failed(UPDATE, rendered);
      if (rendered.render.fingerprint === current.fingerprint) {
        return unchanged(UPDATE, `${block.title} already shows these params; nothing changed.`, { warnings: checked.warnings, data: { file_id: file.id, ...renderData(rendered) } });
      }
      const fileId = String(file.id);
      const oldSeconds = Number(file.duration) || current.seconds;
      const result = call.commit((tx) => {
        const old = tx.project.files.find((f) => String(f.id) === fileId)!;
        // The new render's reader info, with every other key of the record kept (unknown keys survive).
        const next: Record<string, unknown> = { ...structuredClone(old), ...structuredClone(rendered.render.media.info), path: rendered.render.media.path, id: old.id, media_type: "video", [LINK_KEY]: linkOf(rendered) };
        if (rendered.render.media.fingerprint) next.fingerprint = structuredClone(rendered.render.media.fingerprint);
        // The old content address names the old render's bytes: a cloud render job would fetch those.
        if (rendered.render.media.cloud) next.cloud = structuredClone(rendered.render.media.cloud);
        else delete next.cloud;
        const written = writeFile(tx, fileId, next);
        // Clips that showed the whole block follow a longer one, where their track is free.
        const longer = seconds > oldSeconds + 1e-6;
        for (const clip of clipsUsingFile(tx.project, fileId)) {
          if (!longer || Math.abs(Number(clip.end) - oldSeconds) > 0.02) continue;
          const pos = Number(clip.position);
          const from = pos + (Number(clip.end) - Number(clip.start));
          const to = pos + (seconds - Number(clip.start));
          if (clipsInWindow(tx.project, Number(clip.layer), from, to, new Set([clip.id])).length === 0) patchClip(tx, clip.id, { end: seconds });
        }
        return written;
      }, `Update motion block ${block.id}`);
      return applied(UPDATE, `Re-rendered ${block.title}; ${result.updatedClipIds.length} clip(s) now play the new render.`, {
        warnings: checked.warnings,
        data: { file_id: fileId, timeline_clip_ids: result.updatedClipIds, ...renderData(rendered) },
      });
    },
  }),
];
