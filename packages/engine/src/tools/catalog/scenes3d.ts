/**
 * Zenvi 3D tools: Blender scenes (@zenvi/scenes3d) rendered by the host and
 * placed on the timeline as linked media.
 *
 * - list_3d_scenes_tool: the scenes and their params (JSON Schema).
 * - add_3d_scene_tool: render one scene (draft or final), import the movie,
 *   place it on the lowest free track above the video (cube_cut: over the
 *   cut it replaces), one undo step. The spec rides on the file record as
 *   `zenvi_link` (kind blender) so a desktop provider can re-render it.
 * - rerender_3d_scene_tool: new params (merged over the stored ones) or a
 *   final pass → a new render swapped into the same bin file, one undo step.
 *
 * Rendering runs before the transaction: a failed or cancelled render
 * leaves history untouched.
 */

import { z } from "zod";
import { isSingleImageMedia } from "../../model/media.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { addFile, updateFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import { placeOverlayClip, repointFile } from "../../ops/overlays.js";
import { SCENE3D_IDS, SCENE3D_INFO, SCENE3D_PARAMS, parseScene3dParams, scene3dFiles, type Scene3dId, type Scene3dParams } from "../../scenes3d/catalog.js";
import { ZENVI_LINK_KEY, blenderLink, readBlenderLink, type Scene3dQuality, type Scene3dRender } from "../../scenes3d/link.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import type { ImportedMedia, Scene3dMediaInput } from "../types.js";
import { TextToolError, clipExtent, clipsInWindow, planOverlayTrack, projectSize, snapToFrame, trackInfo } from "../titles-text.js";

const LIST = "list_3d_scenes_tool";
const ADD = "add_3d_scene_tool";
const RERENDER = "rerender_3d_scene_tool";
const TRACK_LABEL = "3D";

const SCENE_LINES = SCENE3D_IDS.map((id) => `${id}: ${SCENE3D_INFO[id].summary}`).join(" ");

const quality = z
  .enum(["draft", "final"])
  .describe("draft: half size, few samples, a few seconds, to check the look; final: full size (default). Draft first, then rerender_3d_scene_tool quality=final.");

const addInput = z.strictObject({
  scene: z.enum(SCENE3D_IDS).describe(`Which scene. ${SCENE_LINES}`),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("The scene's params (list_3d_scenes_tool lists each scene's). title_3d needs text; cube_cut needs from_clip_id and to_clip_id; model_showcase takes model (a file path; without it a generic product); media are bin file ids (file_id, file_ids)."),
  position_seconds: z.number().min(0).optional().describe("Timeline start, seconds (default 0; cube_cut: centred on the cut)."),
  duration_seconds: z.number().min(0.2).max(15).optional().describe("Length (default per scene, list_3d_scenes_tool defaultSeconds: titles, logos, counters 3 s; cube_cut 0.8 s; burst 2 s; others 3-4 s)."),
  quality: quality.optional(),
  track: z.union([z.number(), z.string()]).optional().describe("Track number (default: the lowest free track above the video)."),
});

const rerenderInput = z.strictObject({
  file_id: z.string().min(1).optional().describe("Bin file of the 3D render (data.file_id of add_3d_scene_tool)."),
  timeline_clip_id: z.string().min(1).optional().describe("A timeline clip that plays it (instead of file_id)."),
  params: z.record(z.string(), z.unknown()).optional().describe("Params to change; the others stay as rendered."),
  quality: quality.optional(),
  duration_seconds: z.number().min(0.2).max(15).optional().describe("New length (default: as rendered). Clips that showed the whole render follow it."),
});

type AddInput = z.infer<typeof addInput>;
type RerenderInput = z.infer<typeof rerenderInput>;

function fpsOf(project: Project): { num: number; den: number } {
  const num = Math.trunc(Number(project.fps?.num)) || 30;
  const den = Math.trunc(Number(project.fps?.den)) || 1;
  return { num, den };
}

const round = (t: number): number => Math.round(t * 1000) / 1000;

/** A bin file as a scene's picture, or why it cannot be one. */
function mediaInput(project: Project, fileId: string, start: number): Scene3dMediaInput | string {
  const file = project.files.find((f) => String(f.id) === fileId);
  if (!file) return `unknown file id ${fileId}`;
  const width = Number(file.width);
  const height = Number(file.height);
  if (!(width > 0 && height > 0) || file.has_video === false) return `${fileId} has no picture; give a video or an image`;
  if (isSingleImageMedia(file)) return { fileId, path: String(file.path), kind: "image", width, height, fps: 0, frames: 0, start: 0 };
  const fps = Number(file.fps?.num) / (Number(file.fps?.den) || 1) || 30;
  const frames = Math.max(1, Math.trunc(Number(file.video_length)) || Math.round((Number(file.duration) || 0) * fps));
  return { fileId, path: String(file.path), kind: "video", width, height, fps, frames, start };
}

interface Plan {
  media: Record<string, Scene3dMediaInput>;
  /** cube_cut: where it must go. */
  cut?: { start: number; duration: number; trackOver: number };
  warnings: string[];
}

/** The project media a scene shows, by slot, from its params. */
function planMedia(project: Project, scene: Scene3dId, params: Scene3dParams, duration: number): Plan | string {
  const media: Record<string, Scene3dMediaInput> = {};
  const warnings: string[] = [];
  const add = (slot: string, fileId: string, start = 0): string | null => {
    const m = mediaInput(project, fileId, start);
    if (typeof m === "string") return m;
    media[slot] = m;
    return null;
  };
  const p = params as Record<string, unknown>;
  if (scene === "numerals_3d") {
    const fps = fpsOf(project);
    const need = counterMinFrames(p, fps);
    if (Math.round((duration * fps.num) / fps.den) < need) {
      return `numerals_3d needs at least ${((need * fps.den) / fps.num).toFixed(2)}s to show all ${((p.values as unknown[] | undefined) ?? [0, 100]).length} values: give a longer duration_seconds or fewer values`;
    }
  }
  if (scene === "device_mockup" && typeof p.file_id === "string") {
    const error = add("screen", p.file_id, Number(p.media_start_seconds) || 0);
    if (error) return error;
  }
  if ((scene === "floating_cards" || scene === "icon_cube" || scene === "card_stack") && Array.isArray(p.file_ids)) {
    const slot = scene === "icon_cube" ? "face" : "card";
    for (const [i, id] of (p.file_ids as string[]).entries()) {
      const error = add(`${slot}${i}`, id);
      if (error) return error;
    }
  }
  if (scene !== "cube_cut") return { media, warnings };
  if (p.background === "transparent") return "cube_cut replaces the picture across the cut: background must be dark, light or a #rrggbb colour";
  const clips = new Map(project.clips.map((c) => [String(c.id), c]));
  const a = clips.get(String(p.from_clip_id));
  const b = clips.get(String(p.to_clip_id));
  if (!a) return `unknown timeline clip ${String(p.from_clip_id)}`;
  if (!b) return `unknown timeline clip ${String(p.to_clip_id)}`;
  const [, aEnd, aLen] = clipExtent(a);
  const [bStart, , bLen] = clipExtent(b);
  const frame = 1 / (fpsOf(project).num / fpsOf(project).den);
  if (Math.abs(aEnd - bStart) > frame * 1.5) {
    return `${a.id} ends at ${aEnd.toFixed(2)}s but ${b.id} starts at ${bStart.toFixed(2)}s: cube_cut goes on a cut where one clip ends and the next starts`;
  }
  const d = Math.min(duration, aLen, bLen);
  if (d < duration - 1e-6) warnings.push(`Shortened to ${d.toFixed(2)}s to fit the shorter clip.`);
  const cut = bStart;
  const start = Math.max(0, cut - d / 2);
  for (const clip of [a, b]) {
    if (Number(clip.time?.Points?.length ?? 0) > 1) warnings.push(`${clip.id} has a time remap; the cube plays its media at normal speed.`);
  }
  // A plays on from where it is at the start; B is where it will be at the end.
  const aSource = Number(a.start) + (start - Number(a.position));
  const bSourceRaw = Number(b.start) + (start - Number(b.position));
  if (bSourceRaw < -1e-6) warnings.push(`${b.id} starts at the beginning of its media, so its face holds the first frame for ${(-bSourceRaw).toFixed(2)}s.`);
  let error = add("from", String(a.file_id), aSource);
  if (error) return error;
  // Negative: the face holds B's first frame that long, so the last frame is B where the timeline has it.
  error = add("to", String(b.file_id), bSourceRaw);
  if (error) return error;
  return { media, cut: { start, duration: d, trackOver: Math.max(Number(a.layer), Number(b.layer)) }, warnings };
}

async function render(call: ToolCall, tool: string, scene: Scene3dId, params: Scene3dParams, plan: Plan, frames: number, q: Scene3dQuality): Promise<{ render: Scene3dRender; imported: ImportedMedia } | string> {
  const project = call.doc.project;
  const [width, height] = projectSize(project);
  let result: Scene3dRender;
  try {
    result = await call.host.scenes3d!.render({ scene, params, width, height, fps: fpsOf(project), frames, quality: q, media: plan.media, files: scene3dFiles(scene, params), signal: call.signal });
  } catch (error) {
    return `Error: the ${scene} render failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  try {
    return { render: result, imported: await call.host.media!.importPath!(result.path) };
  } catch (error) {
    return `Error: ${tool} could not import the render ${result.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderData(r: Scene3dRender, q: Scene3dQuality): Record<string, unknown> {
  return { quality: q, codec: r.codec, alpha: r.codec === "prores4444", width: r.width, height: r.height, frames: r.frames, fingerprint: r.fingerprint, cached: r.cached, render_seconds: round(r.seconds), blender: r.blender };
}

function paramsSchema(id: Scene3dId): Record<string, unknown> {
  const { $schema: _schema, ...json } = z.toJSONSchema(SCENE3D_PARAMS[id], { io: "input" }) as Record<string, unknown>;
  return json;
}

function needsHost(call: ToolCall, tool: string): ReturnType<typeof unavailable> | null {
  if (!call.host.media?.importPath) return unavailable(tool, "it cannot import rendered movies from this computer.");
  return null;
}

/** `"%.*f" % (decimals, value)` as numerals_3d.py prints it: an exact tie rounds to even there, up in `toFixed` (1.25 → "1.2", not "1.3"). */
function printfFixed(value: number, decimals: number): string {
  const exact = Math.abs(value).toFixed(100);
  const cut = exact.indexOf(".") + 1 + decimals;
  if (!/^50*$/.test(exact.slice(cut))) return Math.abs(value).toFixed(decimals);
  const kept = exact.slice(0, cut).replace(/\.$/, "");
  return Number(kept[kept.length - 1]) % 2 === 0 ? kept : Math.abs(value).toFixed(decimals);
}

/**
 * Frames numerals_3d needs to land its last value: a 2-frame entry, at least 3 frames per change, one stagger per drum
 * and a 2-frame roll (numerals_3d.py `build`, STAGGER 0.05 s). Shorter renders would end before the last value shows.
 */
function counterMinFrames(params: Record<string, unknown>, fps: { num: number; den: number }): number {
  const values = (params.values as number[] | undefined) ?? [0, 100];
  const decimals = Number(params.decimals) || 0;
  const drums = Math.max(...values.map((v) => printfFixed(v, decimals).split(".")[0]!.length)) + decimals;
  return 2 + 3 * (values.length - 1) + Math.round((0.05 * fps.num) / fps.den) * (drums - 1) + 2 + 1;
}

function clipTitle(scene: Scene3dId, params: Scene3dParams): string {
  const p = params as Record<string, unknown>;
  if (typeof p.text === "string") return `3D ${p.text}`;
  const file = typeof p.svg === "string" ? p.svg : typeof p.model === "string" ? p.model : undefined;
  if (file) return `3D ${file.split(/[\\/]/).pop()}`;
  if (Array.isArray(p.values) && p.values.length > 0) {
    // As the counter shows it (numerals_3d.py formats every value with the same decimals).
    const last = printfFixed(Number(p.values[p.values.length - 1]), Number(p.decimals) || 0);
    return `3D ${typeof p.prefix === "string" ? p.prefix : ""}${last}${typeof p.suffix === "string" ? p.suffix : ""}`;
  }
  return SCENE3D_INFO[scene].title;
}

export const scenes3dTools: CatalogTool[] = [
  directTool({
    name: LIST,
    title: "List 3D scenes",
    description:
      "The Zenvi 3D scenes add_3d_scene_tool renders with Blender (3D titles and logos, device mockups, the user's 3D models, rolling 3D counters, floating cards, card stacks, icon cube, cube cut transition, glass hero objects, particle bursts, grass/sand/snow terrain glides): " +
      "what each shows, its default length and its params as JSON Schema, and whether this Zenvi surface can render them.",
    input: z.strictObject({ scene: z.enum(SCENE3D_IDS).optional().describe("Only this scene.") }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (call, args: { scene?: Scene3dId }) => {
      const ids = args.scene ? [args.scene] : [...SCENE3D_IDS];
      const scenes = ids.map((id) => ({ ...SCENE3D_INFO[id], params: paramsSchema(id) }));
      const here = call.host.scenes3d !== undefined;
      return applied(LIST, `${ids.length} 3D scene(s)${here ? "" : "; this surface cannot render them (Blender runs with the zenvi CLI / local MCP server)"}.`, { data: { available: here, scenes } }, 0);
    },
  }),
  directTool({
    name: ADD,
    title: "Add a 3D scene",
    description:
      "Render a Zenvi 3D scene with Blender and place it on the timeline in one undo step: an extruded chrome/glass title tumbling in, a phone/tablet/laptop playing a bin video while the camera glides, " +
      "cards floating in depth with depth of field, an icon cube that spins and explodes, a 3D cube turn between two clips (cube_cut, placed over their cut), a glass/chrome hero object, a confetti/sparks/shards burst, " +
      "the user's SVG logo extruded (logo_extrude), the user's .glb/.obj/.fbx model or a generic music player / speaker, on a turntable, in x-ray, or spinning in and landing for a product reveal (model_showcase move=hero, the default without a model file), a huge rolling 3D counter (numerals_3d), a low glide over grass/sand/snow (terrain_glide, a full-frame backdrop), cards tumbling onto a stack (card_stack). " +
      "Transparent scenes render with alpha (ProRes 4444) and go on the lowest free track above the video; with background dark/light/#rrggbb they are opaque full-frame. " +
      "Use quality=draft (seconds) to check the look with preview_frame, then rerender_3d_scene_tool quality=final. list_3d_scenes_tool lists every param.",
    input: addInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["scenes3d", "media"],
    run: async (call, args: AddInput) => {
      const missing = needsHost(call, ADD);
      if (missing) return missing;
      const project = call.doc.project;
      const parsed = parseScene3dParams(args.scene, args.params ?? {});
      if (!parsed.ok) return refused(ADD, `Error: ${parsed.error}.`);
      const info = SCENE3D_INFO[args.scene];
      const duration = Math.min(info.maxSeconds, args.duration_seconds ?? info.defaultSeconds);
      const plan = planMedia(project, args.scene, parsed.params, duration);
      if (typeof plan === "string") return refused(ADD, `Error: ${plan}.`);
      const fps = fpsOf(project);
      const start = snapToFrame(project, plan.cut?.start ?? args.position_seconds ?? 0);
      const seconds = plan.cut?.duration ?? duration;
      const frames = Math.max(2, Math.round((seconds * fps.num) / fps.den));
      const end = start + (frames * fps.den) / fps.num;
      let track: { layer: number; created: boolean };
      try {
        track = planOverlayTrack(project, start, end, args.track);
      } catch (error) {
        if (error instanceof TextToolError) return refused(ADD, `Error: ${error.message}.`);
        throw error;
      }
      if (plan.cut && track.layer <= plan.cut.trackOver) return refused(ADD, `Error: track ${track.layer} is not above the clips of the cut; leave track empty.`);
      const q: Scene3dQuality = args.quality ?? "final";
      const done = await render(call, ADD, args.scene, parsed.params, plan, frames, q);
      if (typeof done === "string") return failed(ADD, done);
      const { render: r, imported } = done;
      const title = clipTitle(args.scene, parsed.params);
      const placed = call.commit((tx) => {
        const file = addFile(tx, imported, { mediaType: "video", dedupe: false, name: `${args.scene}-${r.fingerprint.slice(0, 8)}.${r.codec === "h264" ? "mp4" : "mov"}` });
        updateFile(tx, String(file.id), { [ZENVI_LINK_KEY]: blenderLink(args.scene, parsed.params, r, q) });
        const clip = placeOverlayClip(tx, { fileId: String(file.id), position: start, duration: (frames * fps.den) / fps.num, layer: track.layer, newTrackLabel: TRACK_LABEL, title });
        return { file, clip };
      }, `Add 3D ${args.scene}`);
      const doc = call.doc.project;
      return applied(ADD, `Added ${args.scene} (${q}, ${r.cached ? "from the render cache" : `rendered in ${r.seconds.toFixed(1)}s`}) at ${start.toFixed(2)}-${end.toFixed(2)}s.`, {
        warnings: plan.warnings,
        notes: q === "draft" ? ["Draft render (half size): check it with preview_frame, then rerender_3d_scene_tool quality=final."] : [],
        data: {
          scene: args.scene,
          file_id: placed.file.id,
          timeline_clip_id: placed.clip.id,
          position: round(start),
          duration: round(end - start),
          ...trackInfo(doc, track.layer),
          new_track: track.created,
          params: parsed.params,
          render: renderData(r, q),
        },
      });
    },
  }),
  directTool({
    name: RERENDER,
    title: "Re-render a 3D scene",
    description:
      "Re-render a 3D scene added by add_3d_scene_tool with changed params (merged over the ones it was rendered with), a final pass after a draft, or a new length, " +
      "and swap the new movie into the same bin file so every clip that plays it updates. One undo step.",
    input: rerenderInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["scenes3d", "media"],
    run: async (call, args: RerenderInput) => {
      const missing = needsHost(call, RERENDER);
      if (missing) return missing;
      const project = call.doc.project;
      let fileId = args.file_id;
      if (!fileId && args.timeline_clip_id) {
        const clip = project.clips.find((c) => c.id === args.timeline_clip_id);
        if (!clip) return refused(RERENDER, `Error: unknown timeline clip ${args.timeline_clip_id}.`);
        fileId = String(clip.file_id);
      }
      if (!fileId) return refused(RERENDER, "Error: give file_id or timeline_clip_id.");
      const file = project.files.find((f) => String(f.id) === fileId);
      if (!file) return refused(RERENDER, `Error: unknown file id ${fileId}.`);
      const link = readBlenderLink(file);
      if (!link) return refused(RERENDER, `Error: ${fileId} is not a Zenvi 3D render (no zenvi_link of kind blender).`);
      const parsed = parseScene3dParams(link.scene, { ...link.props, ...(args.params ?? {}) });
      if (!parsed.ok) return refused(RERENDER, `Error: ${parsed.error}.`);
      // A new length moves the cube's centre off the cut while its clip stays put; add a new one instead.
      if (args.duration_seconds !== undefined && SCENE3D_INFO[link.scene].placement === "cut") {
        return refused(RERENDER, `Error: ${link.scene} sits centred on its cut: delete the clip and add_3d_scene_tool again with the new duration_seconds.`);
      }
      const fps = fpsOf(project);
      const stored = link.link.render as { duration_frames?: unknown; fingerprint?: unknown } | undefined;
      const oldFrames = Math.trunc(Number(stored?.duration_frames)) || Math.round((Number(file.duration) || 1) * (fps.num / fps.den));
      const frames = args.duration_seconds !== undefined ? Math.max(2, Math.round((Math.min(SCENE3D_INFO[link.scene].maxSeconds, args.duration_seconds) * fps.num) / fps.den)) : oldFrames;
      const plan = planMedia(project, link.scene, parsed.params, (frames * fps.den) / fps.num);
      if (typeof plan === "string") return refused(RERENDER, `Error: ${plan}.`);
      const storedQuality = (link.link.scenes3d as { quality?: unknown } | undefined)?.quality;
      const q: Scene3dQuality = args.quality ?? (storedQuality === "draft" ? "draft" : "final");
      const done = await render(call, RERENDER, link.scene, parsed.params, plan, frames, q);
      if (typeof done === "string") return failed(RERENDER, done);
      const { render: r, imported } = done;
      // Same fingerprint: the movie on the file already is this render; no undo step.
      if (r.fingerprint === stored?.fingerprint) {
        return unchanged(RERENDER, `${link.scene} is already rendered with these params (${q}).`, { data: { scene: link.scene, file_id: file.id, params: parsed.params, render: renderData(r, q) } });
      }
      const oldSeconds = (oldFrames * fps.den) / fps.num;
      const newSeconds = (frames * fps.den) / fps.num;
      const frameSeconds = fps.den / fps.num;
      const warnings = [...plan.warnings];
      const patches: { id: string; patch: Partial<Clip> }[] = [];
      for (const clip of project.clips.filter((c) => String(c.file_id) === String(file.id))) {
        const showedAll = Math.abs(Number(clip.end) - oldSeconds) < 1e-3 && Number(clip.start) < 1e-3;
        let patch: Partial<Clip> = {};
        if (showedAll && Math.abs(newSeconds - oldSeconds) > 1e-6) {
          // A longer render must not run into the next clip on its track: keep the old length there.
          const [position] = clipExtent(clip);
          const blocked = newSeconds > oldSeconds ? clipsInWindow(project, clip.layer, position + oldSeconds, position + newSeconds, new Set([clip.id])) : [];
          if (blocked.length) warnings.push(`clip ${clip.id} keeps its ${oldSeconds.toFixed(2)}s length: ${blocked[0]!.id} follows it on the same track`);
          else patch = { end: newSeconds, duration: newSeconds };
        } else if (Number(clip.end) > newSeconds) {
          // A trim past the new end keeps at least one frame of the new movie.
          patch = { start: Math.min(Number(clip.start), Math.max(0, newSeconds - frameSeconds)), end: newSeconds };
        }
        patches.push({ id: clip.id, patch });
      }
      call.commit((tx) => {
        const { path: _path, ...info } = imported.info;
        repointFile(tx, String(file.id), { ...(info as Partial<ProjectFile>), path: imported.path, [ZENVI_LINK_KEY]: blenderLink(link.scene, parsed.params, r, q) });
        for (const { id, patch } of patches) if (Object.keys(patch).length) patchClip(tx, id, patch);
      }, `Re-render 3D ${link.scene}`);
      const changed = patches.map((p) => p.id);
      return applied(RERENDER, `Re-rendered ${link.scene} (${q}, ${r.cached ? "from the render cache" : `${r.seconds.toFixed(1)}s`}); ${changed.length} clip(s) updated.`, {
        warnings,
        data: { scene: link.scene, file_id: file.id, timeline_clip_ids: changed, params: parsed.params, render: renderData(r, q) },
      });
    },
  }),
];
