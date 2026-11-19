/**
 * add_title_tool (add_captions_tool is in captions.ts).
 *
 * Port of zenvi-core src/classes/editor_tools/titles_text.py `add_title` after
 * #407: a title is one of six animated styles (titles/styles.ts), never an
 * OpenShot SVG template. The desktop renders it as a HyperFrames composition;
 * here a host with headless Chrome renders it as the `title` Zenvi Motion
 * block (the same look, one transparent clip, or an opaque one for a
 * full-frame card) and any other surface (the browser editor) draws it with
 * the engine's keyframed layers (titles/native.ts). Either way it goes on the
 * lowest free track(s) above the picture, in one undo step, and the spec
 * rides on the file(s) so edit_title_tool can change it.
 */

import type { Transaction } from "../../history/document.js";
import type { Project } from "../../model/types.js";
import { addFile, updateFile } from "../../ops/files.js";
import { placeOverlayClip } from "../../ops/overlays.js";
import { LINK_KEY, motionLink, type MotionLinkSpec } from "../../links/zenvi-link.js";
import { MotionInputError } from "../../motion/template.js";
import type { MotionPlan } from "../../motion/types.js";
import { planInTypeface } from "../../motion/typeface.js";
import { buildNativeTitle } from "../../titles/native.js";
import {
  DEFAULT_TITLE_STYLE,
  TITLE_STYLES,
  TitleSpecError,
  isOpaqueTitle,
  titleFieldsOf,
  titleMetadata,
  titleShown,
  titleSpec,
  type TitleSpec,
  type TitleSpecInput,
} from "../../titles/styles.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { familyArg, loadFamilies, missingGlyphWarnings } from "../fonts.js";
import { pyFixed, pyReprString } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { ContractInput } from "../schemas.gen.js";
import type { MotionRender } from "../types.js";
import { colorHexAlpha, fpsOfProject, guarded, planOverlayTrack, projectSize, pyRoundTo, snapToFrame, summaryLine, toolError, trackInfo, warningNote } from "../titles-text.js";
import { commitDrawn, placeMotionPlan, planOverlayStack, writeDrawings } from "./motion-templates.js";

/** The motion block that draws titles (packages/motion/src/blocks/title). */
export const TITLE_BLOCK = "title";
/** File key of a title drawn with native layers: its group, spec and length (one per layer file). */
export const NATIVE_TITLE_KEY = "zenvi_title";

export interface NativeTitleTag {
  group: string;
  spec: TitleSpec;
  /** Seconds from the title's start to its first layer (layers enter a little after the start), and its length. */
  lead: number;
  seconds: number;
}

/** A colour argument in any form the desktop takes ('yellow', 'rgba(...)', '#RRGGBBAA') as '#rrggbb[aa]'. */
function colour(value: unknown, what: string): string {
  if (!String(value ?? "").trim()) return "";
  const [hex, alpha] = colorHexAlpha(value, what);
  return hex + (alpha >= 1 ? "" : Math.round(alpha * 255).toString(16).padStart(2, "0"));
}

/** `_spec`: the tool's arguments as a validated spec; a refusal for a bad one. */
export function specOf(input: Omit<TitleSpecInput, "zone"> & { screen_position?: string }): TitleSpec {
  try {
    return titleSpec({
      ...input,
      text_color: colour(input.text_color, "text_color"),
      accent_color: colour(input.accent_color, "accent_color"),
      background_color: colour(input.background_color, "background_color"),
      zone: input.screen_position && input.screen_position !== "auto" ? input.screen_position : "",
    });
  } catch (error) {
    if (error instanceof TitleSpecError) return toolError(error.message);
    throw error;
  }
}

/** Whether this host renders titles as the motion block (headless Chrome is there and ready). */
export async function rendersTitleBlock(call: ToolCall): Promise<boolean> {
  const motion = call.host.motion;
  if (!motion || !motion.blocks().some((b) => b.id === TITLE_BLOCK)) return false;
  const runtime = await motion.runtime?.();
  return runtime === undefined || runtime.ready;
}

/** Render `s` with the title block at the project's size: the render, or a refusal. */
export async function renderTitleBlock(call: ToolCall, project: Project, s: TitleSpec, seconds: number): Promise<{ render: MotionRender; spec: MotionLinkSpec }> {
  const motion = call.host.motion!;
  const checked = motion.check(TITLE_BLOCK, { ...s });
  if (!checked.ok) return toolError(checked.error);
  const [width, height] = projectSize(project);
  const spec: MotionLinkSpec = { block: TITLE_BLOCK, params: checked.params, seconds, alpha: !isOpaqueTitle(s), motionBlurSamples: 1, draft: false };
  try {
    const render = await motion.render({ block: TITLE_BLOCK, params: spec.params, media: {}, width, height, fps: { num: Number(project.fps?.num) || 30, den: Number(project.fps?.den) || 1 }, seconds, alpha: spec.alpha, motionBlurSamples: 1, draft: false }, call.signal);
    return { render, spec };
  } catch (error) {
    return toolError(`the title could not be rendered: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The file record of a title rendered with the block: its link, and the spec where the desktop reads it. */
export function blockFileFields(rendered: { render: MotionRender; spec: MotionLinkSpec }, s: TitleSpec, seconds: number): Record<string, unknown> {
  const { render, spec } = rendered;
  return {
    [LINK_KEY]: motionLink(spec, { codec: render.codec, width: render.width, height: render.height, fps: render.fps, frames: render.frames, output: render.media.path, fingerprint: render.fingerprint, renderedAt: new Date().toISOString(), events: render.events }),
    ai_metadata: titleMetadata(s, seconds),
  };
}

/** `s` drawn with native layers at the project's frame, set in its font where a bundled family matches. */
export async function nativePlan(call: ToolCall, project: Project, s: TitleSpec, seconds: number, warnings: string[]): Promise<MotionPlan> {
  const [width, height] = projectSize(project);
  let plan: MotionPlan;
  try {
    plan = buildNativeTitle(s, { width, height, fps: fpsOfProject(project) }, seconds);
  } catch (error) {
    if (error instanceof MotionInputError) return toolError(error.message);
    throw error;
  }
  if (!s.font) return plan;
  const family = familyArg(s.font);
  if (!family) {
    warnings.push(`font ${pyReprString(s.font)} is not one of the fonts drawn here, so the title is set in Inter`);
    return plan;
  }
  const lib = await loadFamilies(call, [family]);
  if (typeof lib === "string") {
    warnings.push(`${lib.replace(/^Error: /, "").replace(/\.$/, "")}, so the title is set in Inter`);
    return plan;
  }
  const typed = planInTypeface(plan, lib, family);
  warnings.push(...missingGlyphWarnings(typed.missing));
  return typed.plan;
}

/** Place a native plan on `layers` and tag every layer file with the group (inside a transaction). */
export function placeNativeTitle(tx: Transaction, plan: MotionPlan, written: Parameters<typeof placeMotionPlan>[2], position: number, fps: number, layers: readonly number[], s: TitleSpec, seconds: number): { clipIds: string[]; fileIds: string[] } {
  const placed = placeMotionPlan(tx, plan, written, position, fps, layers, `Title ${TITLE_STYLES[s.style].label}`, "Titles");
  const group = placed[0] ? String(placed[0].clip.id) : "";
  const lead = Math.min(...plan.layers.map((l) => l.start)) / fps;
  const tag: NativeTitleTag = { group, spec: s, lead, seconds };
  for (const p of placed) updateFile(tx, p.fileId, { [NATIVE_TITLE_KEY]: structuredClone(tag) } as Record<string, unknown>);
  return { clipIds: placed.map((p) => String(p.clip.id)), fileIds: placed.map((p) => p.fileId) };
}

async function addTitle(call: ToolCall, input: ContractInput<"add_title_tool">) {
  const tool = "add_title_tool";
  const s = specOf({
    style: input.style ?? DEFAULT_TITLE_STYLE,
    title: String(input.text ?? ""),
    subtitle: String(input.subtitle ?? ""),
    lines: (input.lines ?? []).map(String),
    text_color: input.text_color,
    accent_color: input.accent_color,
    background_color: input.background_color,
    font: input.font,
    font_scale: input.font_scale,
    screen_position: input.screen_position,
  });
  const project = call.doc.project;
  const fps = fpsOfProject(project);
  const position = snapToFrame(project, Number(input.position_seconds ?? 0));
  // `_frames`: whole frames, at least one.
  const seconds = Math.max(1, Math.round(Number(input.duration_seconds ?? 5) * fps)) / fps;
  const end = position + seconds;
  const track = String(input.track ?? "");
  // Where it goes, before anything is rendered: a refused call leaves no file and no undo step.
  planOverlayTrack(project, position, end, track);
  const warnings: string[] = [];
  const opaque = isOpaqueTitle(s);
  const label = TITLE_STYLES[s.style].label;
  const base = summaryLine(`Added title ${pyReprString(titleShown(s))} (${label})`);
  const extra: Record<string, unknown> = { style: s.style, fields: titleFieldsOf(s), position: pyRoundTo(position, 3), duration: pyRoundTo(seconds, 3), end: pyRoundTo(end, 3), screen_position: s.zone, opaque };

  if (await rendersTitleBlock(call)) {
    const rendered = await renderTitleBlock(call, project, s, seconds);
    const placed = call.commit((tx) => {
      const plan = planOverlayTrack(tx.project, position, end, track);
      const added = addFile(tx, rendered.render.media, { mediaType: "video", name: `${titleShown(s)} (${label})`, dedupe: false });
      const file = updateFile(tx, String(added.id), blockFileFields(rendered, s, seconds));
      const clip = placeOverlayClip(tx, { fileId: String(file.id), position, duration: seconds, layer: plan.layer, newTrackLabel: "Titles", title: titleShown(s) });
      return { fileId: String(file.id), clipId: clip.id, ...plan };
    }, `Add title ${s.style}`);
    if (placed.moved) warnings.push(placed.moved);
    const t = trackInfo(call.doc.project, placed.layer);
    const summary = `${base} on track ${t.track ?? "None"} at ${pyFixed(position, 2)}-${pyFixed(end, 2)}s${placed.created ? " on a new track" : ""}.`;
    return applied(tool, summary + warningNote(warnings), {
      warnings,
      data: { timeline_clip_id: placed.clipId, file_id: placed.fileId, path: rendered.render.media.path, renderer: "motion", ...extra, new_track: placed.created, ...t },
    });
  }

  if (!call.host.media!.writeGenerated) return unavailable(tool, "it can neither render titles nor store drawn ones.");
  const plan = await nativePlan(call, project, s, seconds, warnings);
  const first = planOverlayTrack(project, position, end, track);
  const stack = planOverlayStack(project, position, end, plan.tracks, track);
  const written = await writeDrawings(call, plan, `title-${s.style}`);
  if (typeof written === "string") return toolError(written.replace(/^Error: /, ""));
  const placed = await commitDrawn(call, written, (tx) => placeNativeTitle(tx, plan, written, position, fps, stack.layers, s, seconds), `Add title ${s.style}`);
  if (first.moved) warnings.push(first.moved);
  const t = trackInfo(call.doc.project, stack.layers[0]!);
  const created = stack.created.length > 0;
  const summary = `${base} on track ${t.track ?? "None"} at ${pyFixed(position, 2)}-${pyFixed(end, 2)}s${created ? " on a new track" : ""}.`;
  return applied(tool, summary + warningNote(warnings), {
    warnings,
    data: { timeline_clip_id: placed.clipIds[0], file_id: placed.fileIds[0], timeline_clip_ids: placed.clipIds, file_ids: placed.fileIds, renderer: "native", ...extra, new_track: created, ...t },
  });
}

export const titleTools: CatalogTool[] = [
  contractTool("add_title_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: (call, input) => guarded("add_title_tool", () => addTitle(call, input)),
  }),
];
