/**
 * Zenvi scenes: a film, or one shot of it, that the agent writes as code
 * (`@zenvi/motion` scene/contract.ts): one frame grid drives the picture,
 * the cues and the sound. The code runs only in the host's sandbox
 * (MotionHost.scenes: headless Chrome with the network blocked, limits, a
 * determinism check, the flash limit and a layout audit).
 *
 * create_scene_tool checks a scene and keeps it in the project (one undo
 * step), returning its contact sheet and problems; update_scene_tool
 * patches its code or params the same way; render_scene_tool renders it
 * into a linked file (`zenvi_link` kind "zenvi-scene") and places it, or
 * re-renders the placed one; scene_cues_tool lists scenes and their cues on
 * the timeline, which are also the picture events auto_sound_design_tool
 * and spot_sound_tool hit (links/zenvi-link.ts readMotionEvents).
 */

import { z } from "zod";
import { isAudioOnlyMedia } from "../../model/media.js";
import type { Project, ProjectFile } from "../../model/types.js";
import { clipsUsingFile } from "../../model/query.js";
import { generateId } from "../../model/ids.js";
import { addFile, updateFile, writeFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import { placeOverlayClip } from "../../ops/overlays.js";
import { LINK_KEY, readSceneLink, sceneLink, type SceneLinkSpec } from "../../links/zenvi-link.js";
import { readScene, readScenes, SCENES_KEY, withScene, type StoredScene } from "../../links/scene-store.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import type { SceneDraft, SceneHost, SceneProblem, SceneRenderResult, SceneRequest, ToolImage } from "../types.js";
import { clipsInWindow, errorText, planOverlayTrack, projectSize, snapToFrame, TextToolError, trackInfo } from "../titles-text.js";

const CREATE = "create_scene_tool";
const UPDATE = "update_scene_tool";
const RENDER = "render_scene_tool";
const CUES = "scene_cues_tool";
const TRACK_LABEL = "Scene";
const CODE_MAX = 120_000;
/** Names the desktop rewrites as paths when it saves (zenvi-link.ts): a media name may not be one. */
const PATH_LIKE = new Set(["path", "image", "resource", "protobuf_data_path", "lut_path"]);

const round = (t: number, places = 3): number => Math.round(t * 10 ** places) / 10 ** places;

const NO_SANDBOX = "this surface cannot run scene code: scenes run only inside a sandboxed headless Chrome (the zenvi CLI, zenvi mcp and Zenvi Cloud). Use motion blocks (add_motion_block_tool) here";

const objectArg = (what: string) =>
  z
    .union([z.record(z.string(), z.unknown()), z.string().max(20_000)])
    .optional()
    .describe(what);

/** Keys that would rewire an object's prototype when merged. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function parseObject(raw: Record<string, unknown> | string | undefined, name: string): Record<string, unknown> | string {
  if (raw === undefined || raw === "") return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return `Error: ${name} must be a JSON object.`;
  const unsafe = Object.keys(value).find((k) => UNSAFE_KEYS.has(k));
  if (unsafe) return `Error: ${name} cannot have a key named ${unsafe}.`;
  return value as Record<string, unknown>;
}

function fpsOf(project: Project): { num: number; den: number } {
  const num = Number(project.fps?.num);
  const den = Number(project.fps?.den);
  return num > 0 && den > 0 ? { num, den } : { num: 30, den: 1 };
}

/** Media names → Project Files ids, checked; returns the project paths the host reads. */
function mediaPaths(project: Project, media: Record<string, string>): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const [name, id] of Object.entries(media)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name) || PATH_LIKE.has(name)) return `Error: media name ${JSON.stringify(name)} must be lowercase letters, digits and _ (and not ${[...PATH_LIKE].join(", ")}): it is what the scene passes to api.image / api.video.`;
    const file = project.files.find((f) => String(f.id) === id);
    if (!file) return `Error: media ${name}: unknown file id ${id} (use a Project Files id).`;
    if (isAudioOnlyMedia(file)) return `Error: media ${name}: ${id} has no picture; give a photo or a video.`;
    out[name] = String(file.path);
  }
  return out;
}

function request(project: Project, scene: { code: string; params: Record<string, unknown>; media: Record<string, string>; allowStrobe: boolean }): SceneRequest | string {
  const media = mediaPaths(project, scene.media);
  if (typeof media === "string") return media;
  const [width, height] = projectSize(project);
  return { code: scene.code, params: scene.params, media, width, height, fps: fpsOf(project), allowStrobe: scene.allowStrobe };
}

function problemLine(p: SceneProblem): string {
  const where = p.line !== undefined ? ` (line ${p.line})` : p.frames ? ` (frames ${p.frames.from}${p.frames.to !== p.frames.from ? `-${p.frames.to}` : ""})` : "";
  return `${p.severity === "error" ? "ERROR" : "warning"} ${p.code}${where}: ${p.message}`;
}

function problemsText(problems: readonly SceneProblem[]): string {
  if (problems.length === 0) return "No problems: every frame drew, twice the same, no flashing, the text sits inside the safe zone.";
  const shown = problems.slice(0, 12).map(problemLine);
  return `${problems.length} problem(s):\n${shown.join("\n")}${problems.length > shown.length ? `\n… ${problems.length - shown.length} more in data.problems` : ""}`;
}

const errorsIn = (problems: readonly SceneProblem[]): number => problems.filter((p) => p.severity === "error").length;

function sceneSummary(scene: StoredScene): Record<string, unknown> {
  const { info } = scene;
  return {
    scene_id: scene.id,
    name: scene.name,
    fps: info.fps,
    duration_frames: info.duration,
    seconds: round(info.duration / info.fps),
    alpha: info.alpha,
    cues: info.cues.map((c) => ({ ...c, seconds: round(c.frame / info.fps) })),
    errors: errorsIn(scene.problems),
    warnings: scene.problems.length - errorsIn(scene.problems),
  };
}

function draftData(scene: StoredScene, draft: SceneDraft): Record<string, unknown> {
  return { ...sceneSummary(scene), problems: draft.problems, sheet_path: draft.sheetPath ?? null, sheet_cells: draft.cells, check_seconds: draft.checkSeconds };
}

/** Run the check; a scene that did not run at all is refused with its problems. */
async function check(call: ToolCall, scenes: SceneHost, req: SceneRequest): Promise<SceneDraft | string> {
  let draft: SceneDraft;
  try {
    draft = await scenes.draft(req, call.signal);
  } catch (error) {
    return errorText(`the scene could not be checked: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!draft.info) return `Error: the scene did not run, so nothing was saved. Fix it and call again.\n${problemsText(draft.problems)}`;
  return draft;
}

function outcome(tool: string, summary: string, scene: StoredScene, draft: SceneDraft, undo: number): ReturnType<typeof applied> | { receipt: ReturnType<typeof applied>; images: ToolImage[] } {
  const receipt = applied(tool, summary, { warnings: draft.problems.filter((p) => p.severity === "warning").slice(0, 6).map((p) => p.message), data: draftData(scene, draft) }, undo);
  return draft.sheet ? { receipt, images: [draft.sheet] } : receipt;
}

const sceneNote = (scene: StoredScene, draft: SceneDraft): string => {
  const { info } = scene;
  const sounding = info.cues.filter((c) => c.kind).length;
  const errors = errorsIn(draft.problems);
  return (
    `${round(info.duration / info.fps, 2)} s at ${info.fps} fps (${info.duration} frames), ${info.cues.length} cue(s), ${sounding} with a sound. ` +
    `Checked in ${draft.checkSeconds} s. ${problemsText(draft.problems)}` +
    (errors > 0 ? `\nFix the error(s) with update_scene_tool before render_scene_tool.` : `\nThe contact sheet shows the cue frames: look at it, then update_scene_tool or render_scene_tool scene_id=${scene.id}.`)
  );
};

const createInput = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(CODE_MAX)
    .describe(
      "The scene module (TypeScript or JavaScript): export const fps (the grid, e.g. 60), duration (frames), cues ({ name: frame } or { name: { at, kind: click|land|impact|whoosh|reveal|pop|type|tick…, weight, x, y, until, rate, hit, shake, flash, cut } }), " +
        "params (defaults), alpha (true = over video), and export function draw(ctx, t, api): t is the frame; draw only with ctx (Canvas 2D) and api " +
        "(api.text with reveal, api.ui.window/card/cursor/toggle/field/list/chart/counter/button, api.rect/circle/path with draw-on, api.image/video, api.prog/tween/stagger/ease/spring, api.camera + api.layer(depth) parallax, api.hitFx on cues with hit, api.gradient (dithered), api.grain, api.rng, api.cue/since, api.typed, api.W/H/safe/p/palette). " +
        "No imports, Math.random, Date, timers or the DOM: the same t must draw the same frame.",
    ),
  name: z.string().min(1).max(60).optional().describe("A short name (default the module's title)."),
  params: objectArg("Params over the module's defaults (api.p), as an object or JSON."),
  media: objectArg("Media the scene draws: { name: Project Files id } (api.image(name, …), api.video(name, …))."),
  allow_strobe: z.boolean().optional().describe("Keep flashes faster than 3 a second (only when the user asked for a strobe; WCAG 2.3.1 otherwise refuses the render)."),
});

const updateInput = z.strictObject({
  scene_id: z.string().min(1).max(40).describe("The scene's id (create_scene_tool's data.scene_id)."),
  code: z.string().min(1).max(CODE_MAX).optional().describe("The whole new source (or give edits)."),
  edits: z
    .array(z.strictObject({ find: z.string().min(1).max(20_000).describe("Exact text that occurs once in the current code."), replace: z.string().max(20_000).describe("What replaces it.") }))
    .max(50)
    .optional()
    .describe("Patches to the current code, applied in order; each find must occur exactly once."),
  params: objectArg("Params to change, merged over the current ones (null removes one)."),
  media: objectArg("Media to change, merged ({ name: file id }, null removes one)."),
  name: z.string().min(1).max(60).optional(),
  allow_strobe: z.boolean().optional(),
});

const renderInput = z.strictObject({
  scene_id: z.string().min(1).max(40).describe("The scene to render (create_scene_tool's data.scene_id)."),
  position_seconds: z.number().min(0).optional().describe("Timeline start the first time it is placed, seconds (default 0). A placed scene is re-rendered in place."),
  track: z.union([z.number(), z.string().max(40)]).optional().describe("A free track for it the first time (number or name); default the lowest free track above the video."),
  placement: z.enum(["over_video", "full_frame"]).optional().describe("over_video: transparent ProRes 4444 over the picture; full_frame: opaque H.264. Default the scene's alpha."),
  motion_blur: z.number().int().min(0).max(16).optional().describe("Sub-frames averaged per frame (0/1 = off, 4-8 filmic); they never cross a cue marked cut."),
  draft: z.boolean().optional().describe("Half-size, quicker render for a preview."),
});

const cuesInput = z.strictObject({
  scene_id: z.string().min(1).max(40).optional().describe("One scene (default every scene of the project)."),
  clip_id: z.string().min(1).optional().describe("Or the timeline clip that plays a rendered scene."),
});

/** The file a scene was rendered into, if it was. */
function renderedFile(project: Project, sceneId: string): ProjectFile | undefined {
  return project.files.find((f) => readSceneLink(f)?.sceneId === sceneId);
}

function applyEdits(code: string, edits: readonly { find: string; replace: string }[]): string {
  let out = code;
  for (const [i, e] of edits.entries()) {
    const at = out.indexOf(e.find);
    if (at < 0) throw new TextToolError(`edit ${i + 1}: its find text is not in the code (it must match exactly, whitespace included)`);
    if (out.indexOf(e.find, at + 1) >= 0) throw new TextToolError(`edit ${i + 1}: its find text occurs more than once; include more of the surrounding code`);
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return out;
}

function merged(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function sceneHost(call: ToolCall): SceneHost | undefined {
  return call.host.motion?.scenes;
}

export const sceneTools: CatalogTool[] = [
  directTool({
    name: CREATE,
    title: "Create a scene",
    description:
      "Write a film (or one shot of it) as code: a deterministic scene whose one frame grid drives the picture, its cues and the sound, drawn with Zenvi's motion kit (kinetic type, app UI with a clicking cursor and typing, charts and counters, shapes that draw on, the project's photos and videos, eases and springs, camera push and parallax, hit FX, grain). " +
      "The code runs in a sandbox; every frame is drawn and measured: errors (code that cannot run, frames that differ when drawn twice, flashing past WCAG 2.3.1) and layout warnings (text outside the safe zone, overlapping, too small, too much to read) come back with a contact sheet of the cue frames. " +
      "The scene is kept in the project (one undo step); render_scene_tool puts it on the timeline. Use it when blocks cannot do what the brief needs: a bespoke sequence timed to its own beats.",
    input: createInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["motion"],
    run: async (call, args: z.infer<typeof createInput>) => {
      const scenes = sceneHost(call);
      if (!scenes) return unavailable(CREATE, NO_SANDBOX);
      const project = call.doc.project;
      const params = parseObject(args.params, "params");
      if (typeof params === "string") return refused(CREATE, params);
      const media = parseObject(args.media, "media");
      if (typeof media === "string") return refused(CREATE, media);
      const mediaIds = Object.fromEntries(Object.entries(media).map(([k, v]) => [k, String(v)]));
      const req = request(project, { code: args.code, params, media: mediaIds, allowStrobe: args.allow_strobe === true });
      if (typeof req === "string") return refused(CREATE, req);
      const draft = await check(call, scenes, req);
      if (typeof draft === "string") return refused(CREATE, draft);
      const taken = new Set(readScenes(project).map((s) => s.id));
      const id = generateId((c) => taken.has(c));
      const scene: StoredScene = { id, name: args.name ?? draft.info!.title ?? "Scene", code: args.code, params, media: mediaIds, allowStrobe: args.allow_strobe === true, info: draft.info!, problems: draft.problems, checkedAt: new Date().toISOString() };
      call.commit((tx) => tx.update(["settings"], { [SCENES_KEY]: withScene(tx.project, scene) }), `Create scene ${scene.name}`);
      return outcome(CREATE, `Created scene ${scene.name} (${id}): ${sceneNote(scene, draft)}`, scene, draft, 1);
    },
  }),
  directTool({
    name: UPDATE,
    title: "Update a scene",
    description:
      "Change a scene: the whole code, exact find/replace edits to it, params (merged) or media, then check it again (one undo step) and get the new contact sheet and problems. " +
      "A rendered scene keeps its render until render_scene_tool renders it again.",
    input: updateInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["motion"],
    run: async (call, args: z.infer<typeof updateInput>) => {
      const scenes = sceneHost(call);
      if (!scenes) return unavailable(UPDATE, NO_SANDBOX);
      const project = call.doc.project;
      const current = readScene(project, args.scene_id);
      if (!current) return refused(UPDATE, `Error: unknown scene ${args.scene_id}; scenes: ${readScenes(project).map((s) => `${s.id} (${s.name})`).join(", ") || "none (create_scene_tool makes one)"}.`);
      if (args.code !== undefined && args.edits !== undefined) return refused(UPDATE, "Error: give code or edits, not both.");
      let code = args.code ?? current.code;
      if (args.edits) {
        try {
          code = applyEdits(current.code, args.edits);
        } catch (error) {
          if (error instanceof TextToolError) return refused(UPDATE, errorText(error.message));
          throw error;
        }
      }
      const params = parseObject(args.params, "params");
      if (typeof params === "string") return refused(UPDATE, params);
      const media = parseObject(args.media, "media");
      if (typeof media === "string") return refused(UPDATE, media);
      const next = {
        code,
        params: merged(current.params, params),
        media: Object.fromEntries(Object.entries(merged(current.media, media)).map(([k, v]) => [k, String(v)])),
        allowStrobe: args.allow_strobe ?? current.allowStrobe,
      };
      const name = args.name ?? current.name;
      const same = next.code === current.code && JSON.stringify(next.params) === JSON.stringify(current.params) && JSON.stringify(next.media) === JSON.stringify(current.media) && next.allowStrobe === current.allowStrobe && name === current.name;
      if (same) return unchanged(UPDATE, `Scene ${current.name} already has this code and these params; nothing changed.`, { data: { ...sceneSummary(current), problems: current.problems } });
      const req = request(project, next);
      if (typeof req === "string") return refused(UPDATE, req);
      const draft = await check(call, scenes, req);
      if (typeof draft === "string") return refused(UPDATE, draft.replace("nothing was saved", "the scene was not changed"));
      const scene: StoredScene = { ...current, ...next, name, info: draft.info!, problems: draft.problems, checkedAt: new Date().toISOString() };
      call.commit((tx) => tx.update(["settings"], { [SCENES_KEY]: withScene(tx.project, scene) }), `Update scene ${scene.name}`);
      const placed = renderedFile(call.doc.project, scene.id);
      return outcome(UPDATE, `Updated scene ${scene.name}: ${sceneNote(scene, draft)}${placed ? `\nIts clip still plays the earlier render: render_scene_tool scene_id=${scene.id} renders this one.` : ""}`, scene, draft, 1);
    },
  }),
  directTool({
    name: RENDER,
    title: "Render a scene",
    description:
      "Render a scene (create_scene_tool) at the project's size and frame rate in the sandbox, after its checks pass, and place it on the timeline as linked media in one undo step: over the video with transparency or full frame. " +
      "Rendering a scene that is already placed re-renders it in place (every clip that plays it switches). Its cues become the file's picture events, so auto_sound_design_tool and spot_sound_tool put each hit on its visible event.",
    input: renderInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["motion", "media"],
    run: async (call, args: z.infer<typeof renderInput>) => {
      const scenes = sceneHost(call);
      if (!scenes) return unavailable(RENDER, NO_SANDBOX);
      const project = call.doc.project;
      const scene = readScene(project, args.scene_id);
      if (!scene) return refused(RENDER, `Error: unknown scene ${args.scene_id}; scenes: ${readScenes(project).map((s) => `${s.id} (${s.name})`).join(", ") || "none (create_scene_tool makes one)"}.`);
      const existing = renderedFile(project, scene.id);
      const prior = existing ? readSceneLink(existing) : null;
      const seconds = snapToFrame(project, scene.info.duration / scene.info.fps);
      const alpha = args.placement ? args.placement === "over_video" : (prior?.alpha ?? scene.info.alpha);
      const start = snapToFrame(project, args.position_seconds ?? 0);
      let plan: { layer: number; created: boolean } | undefined;
      if (!existing) {
        try {
          plan = planOverlayTrack(project, start, start + seconds, args.track);
        } catch (error) {
          if (error instanceof TextToolError) return refused(RENDER, errorText(error.message));
          throw error;
        }
      } else {
        // A shorter scene cuts every clip's end to it; a clip trimmed to start past that would be empty.
        const emptied = clipsUsingFile(project, String(existing.id)).find((c) => Number(c.start) >= seconds);
        if (emptied) return refused(RENDER, `Error: clip ${emptied.id} starts ${round(Number(emptied.start))}s into the scene, past its new end (${round(seconds)}s).`);
      }
      const req = request(project, scene);
      if (typeof req === "string") return refused(RENDER, req);
      const motionBlurSamples = Math.max(1, args.motion_blur ?? prior?.motionBlurSamples ?? 1);
      const draft = args.draft ?? false;
      let result: SceneRenderResult;
      try {
        result = await scenes.render({ ...req, alpha, motionBlurSamples, draft }, call.signal);
      } catch (error) {
        return failed(RENDER, errorText(`the scene could not be rendered: ${error instanceof Error ? error.message : String(error)}`));
      }
      if (!result.ok) return failed(RENDER, `Error: the scene was not rendered.\n${problemsText(result.problems)}\nFix it with update_scene_tool scene_id=${scene.id}.`);
      const spec: SceneLinkSpec = { sceneId: scene.id, name: scene.name, code: scene.code, params: scene.params, media: scene.media, seconds, alpha, motionBlurSamples, draft, allowStrobe: scene.allowStrobe };
      const link = sceneLink(spec, { codec: result.codec, width: result.width, height: result.height, fps: result.fps, frames: result.frames, output: result.media.path, fingerprint: result.fingerprint, renderedAt: new Date().toISOString(), events: result.events });
      const data = { scene_id: scene.id, codec: result.codec, width: result.width, height: result.height, frames: result.frames, seconds: round(seconds), alpha, fingerprint: result.fingerprint, cached: result.cached, render_seconds: round(result.renderSeconds, 1), events: result.events.length, problems: result.problems };
      const warnings = result.problems.slice(0, 6).map((p) => p.message);
      if (existing) {
        if (prior?.fingerprint === result.fingerprint) return unchanged(RENDER, `${scene.name} is already rendered this way; nothing changed.`, { warnings, data: { file_id: existing.id, ...data } });
        const fileId = String(existing.id);
        const oldSeconds = Number(existing.duration) || prior?.seconds || seconds;
        const written = call.commit((tx) => {
          const old = tx.project.files.find((f) => String(f.id) === fileId)!;
          // The new render's reader info, with every other key of the record kept (unknown keys survive).
          const next: Record<string, unknown> = { ...structuredClone(old), ...structuredClone(result.media.info), path: result.media.path, id: old.id, media_type: "video", [LINK_KEY]: link };
          if (result.media.fingerprint) next.fingerprint = structuredClone(result.media.fingerprint);
          if (result.media.cloud) next.cloud = structuredClone(result.media.cloud);
          else delete next.cloud;
          const out = writeFile(tx, fileId, next);
          // Clips that showed the whole scene follow a longer one, where their track is free.
          if (seconds > oldSeconds + 1e-6) {
            for (const clip of clipsUsingFile(tx.project, fileId)) {
              if (Math.abs(Number(clip.end) - oldSeconds) > 0.02) continue;
              const pos = Number(clip.position);
              if (clipsInWindow(tx.project, Number(clip.layer), pos + (Number(clip.end) - Number(clip.start)), pos + (seconds - Number(clip.start)), new Set([clip.id])).length === 0) patchClip(tx, clip.id, { end: seconds });
            }
          }
          return out;
        }, `Render scene ${scene.name}`);
        return applied(RENDER, `Re-rendered ${scene.name}; ${written.updatedClipIds.length} clip(s) now play the new render, with ${result.events.length} picture event(s) for the sound design.`, { warnings, data: { file_id: fileId, timeline_clip_ids: written.updatedClipIds, ...data } });
      }
      const placed = call.commit((tx) => {
        const added = addFile(tx, result.media, { mediaType: "video", name: `${scene.name} (Zenvi scene)`, dedupe: false });
        const file = updateFile(tx, String(added.id), { [LINK_KEY]: link });
        const clip = placeOverlayClip(tx, { fileId: String(file.id), position: start, duration: seconds, layer: plan!.layer, newTrackLabel: TRACK_LABEL, title: scene.name });
        return { file, clip };
      }, `Render scene ${scene.name}`);
      const track = trackInfo(call.doc.project, plan!.layer);
      return applied(RENDER, `Rendered ${scene.name} at ${start.toFixed(2)}-${(start + seconds).toFixed(2)}s on track ${track.track ?? plan!.layer}${alpha ? " over the video" : " full frame"}${result.cached ? " (cached render)" : ""}, with ${result.events.length} picture event(s) for the sound design.`, {
        warnings,
        data: { file_id: placed.file.id, timeline_clip_id: placed.clip.id, position: round(start), duration: round(seconds), ...track, new_track: plan!.created, ...data },
      });
    },
  }),
  directTool({
    name: CUES,
    title: "Scene cues",
    description:
      "List the project's scenes, or one scene's cues: each named beat with its frame, seconds into the scene, what the ear should hear (kind, weight, place) and, for a rendered scene, the timeline seconds where every clip that plays it shows the cue. " +
      "Put sounds, cuts or other motion on these exact times; auto_sound_design_tool and spot_sound_tool read them on their own.",
    input: cuesInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call, args: z.infer<typeof cuesInput>) => {
      const project = call.doc.project;
      let id = args.scene_id;
      if (args.clip_id) {
        const clip = project.clips.find((c) => c.id === args.clip_id);
        if (!clip) return refused(CUES, `Error: unknown clip id ${args.clip_id}.`);
        const file = project.files.find((f) => String(f.id) === String(clip.file_id));
        const link = file ? readSceneLink(file) : null;
        if (!link) return refused(CUES, `Error: clip ${args.clip_id} does not play a rendered scene.`);
        id = link.sceneId;
      }
      const all = readScenes(project);
      if (!id) {
        if (all.length === 0) return applied(CUES, "The project has no scenes (create_scene_tool writes one).", { data: { scenes: [] } }, 0);
        const lines = all.map((s) => `${s.id} ${s.name}: ${round(s.info.duration / s.info.fps, 2)} s, ${s.info.cues.length} cue(s)${renderedFile(project, s.id) ? ", rendered" : ""}${errorsIn(s.problems) > 0 ? `, ${errorsIn(s.problems)} error(s)` : ""}`);
        return applied(CUES, `${all.length} scene(s):\n${lines.join("\n")}`, { data: { scenes: all.map(sceneSummary) } }, 0);
      }
      const scene = all.find((s) => s.id === id);
      if (!scene) return refused(CUES, `Error: unknown scene ${id}; scenes: ${all.map((s) => `${s.id} (${s.name})`).join(", ") || "none"}.`);
      const file = renderedFile(project, scene.id);
      const clips = file ? clipsUsingFile(project, String(file.id)) : [];
      const fps = scene.info.fps;
      const cues = scene.info.cues.map((c) => {
        const seconds = c.frame / fps;
        const timeline = clips.filter((clip) => seconds >= Number(clip.start) - 1e-6 && seconds < Number(clip.end) - 1e-6).map((clip) => ({ clip_id: clip.id, seconds: round(Number(clip.position) + seconds - Number(clip.start)) }));
        return { ...c, seconds: round(seconds), timeline };
      });
      const lines = cues.map((c) => `${c.name}: frame ${c.frame} (${c.seconds.toFixed(3)} s)${c.kind ? ` ${c.kind} w${c.weight}` : " (silent beat)"}${c.timeline.length > 0 ? ` → timeline ${c.timeline.map((t) => `${t.seconds.toFixed(3)}s`).join(", ")}` : ""}`);
      return applied(CUES, `${scene.name} (${scene.id}), ${fps} fps, ${scene.info.duration} frames:\n${lines.join("\n") || "no cues"}${file ? "" : "\nNot rendered yet: render_scene_tool places it, then the timeline times are listed."}`, { data: { ...sceneSummary(scene), cues, file_id: file?.id ?? null } }, 0);
    },
  }),
];
