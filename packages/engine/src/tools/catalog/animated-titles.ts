/**
 * add_animated_title_tool: the desktop's Title > Animated Title templates,
 * rendered as 2D keyframed titles (titles/animated.ts) instead of Blender.
 *
 * Port of zenvi-core develop src/classes/editor_tools/titles_text_animated.py
 * up to the render: the same template names (by name or title), parameters,
 * validation and wording, defaults, length (the template's frames times the
 * length multiplier, remapped for the project frame rate like Blender does),
 * placement on the lowest free track above the video, one undo step. Where
 * the desktop runs Blender and imports a PNG sequence, this writes an SVG
 * title per clip and animates it with clip keyframes and effects, so the
 * result renders on every surface and stays editable. Four templates are 3D
 * scenes with no 2D version; they are refused as desktop-only.
 */

import { idFactory } from "../../model/ids.js";
import { pyRound } from "../../model/rounding.js";
import type { ProjectFile } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import { placeOverlayClip } from "../../ops/overlays.js";
import {
  ANIMATED_TITLES,
  DESKTOP_ONLY_TITLES,
  HIDDEN_PARAMS,
  TITLE_FPS,
  WEB_LOOKS,
  buildAnimatedTitle,
  colorValue,
  defaultParams,
  projectFpsDiff,
  rendersOnWeb,
  templateFrames,
  type AnimatedTitleData,
  type AnimatedTitleParamData,
  type ParamValues,
} from "../../titles/animated.js";
import { safeBaseName } from "../../titles/title-svg.js";
import { contractTool, unavailable, type ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pyFixed, pyG, pyReprString } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { ImportedMedia } from "../types.js";
import {
  carrierFile,
  colorHexAlpha,
  fpsOfProject,
  guarded,
  planOverlayTrack,
  prepareOverlayCarrier,
  projectSize,
  pyRoundTo,
  snapToFrame,
  summaryLine,
  toolError,
  trackInfo,
  warningNote,
  type OverlayCarrier,
} from "../titles-text.js";

/** `_param_row`: a parameter as list_title_templates_tool kind=animated shows it. */
function paramRow(p: AnimatedTitleParamData): Record<string, unknown> {
  const row: Record<string, unknown> = { name: p.name, type: p.type, title: p.title ?? "", default: p.default ?? "" };
  if (p.min !== undefined) row.min = p.min;
  if (p.max !== undefined) row.max = p.max;
  if (Object.keys(p.values).length > 0) {
    row.values = p.name.includes("project_files") ? "a Project Files id (image or video)" : Object.values(p.values).sort();
  }
  return row;
}

/** `animated_catalog`: the templates (with what renders here) and the renderer status, for list_title_templates_tool. */
export function animatedCatalog(query: string): { rows: Record<string, unknown>[]; renderer: Record<string, unknown> } {
  const words = String(query ?? "").toLowerCase().replaceAll("_", " ").split(/\s+/).filter(Boolean);
  const rows: Record<string, unknown>[] = [];
  for (const t of ANIMATED_TITLES) {
    const frames = templateFrames(t);
    const hay = `${t.name} ${t.title}`.toLowerCase().replaceAll("_", " ");
    if (!words.every((w) => hay.includes(w))) continue;
    const web = rendersOnWeb(t.name);
    rows.push({
      name: t.name,
      title: t.title,
      frames_at_25fps: frames,
      seconds: pyRoundTo(frames / TITLE_FPS, 2),
      params: t.params.filter((p) => !HIDDEN_PARAMS.has(p.name)).map(paramRow),
      renders_here: web,
      look: web ? WEB_LOOKS[t.name] : `needs Blender (Zenvi desktop): ${DESKTOP_ONLY_TITLES[t.name] ?? "a 3D scene"}`,
    });
  }
  const renderer = {
    blender: false,
    renders: "2D keyframed titles (SVG text, clip keyframes, Glow/Blur/LensFlare effects); Zenvi desktop renders these templates in 3D with Blender",
  };
  return { rows, renderer };
}

/** `_find_template`: a template by name, title or .blend name (case and spaces forgiven). */
function findTemplate(name: string): AnimatedTitleData {
  const raw = String(name ?? "").trim();
  if (!raw) toolError("template is required (list_title_templates_tool kind=animated lists them)");
  const key = raw.toLowerCase().replaceAll(" ", "_").replace(".xml", "").replace(".blend", "");
  for (const t of ANIMATED_TITLES) {
    if ([t.name.toLowerCase(), t.title.toLowerCase().replaceAll(" ", "_"), t.service.toLowerCase().replace(".blend", "")].includes(key)) return t;
  }
  return toolError(`unknown animated title ${pyReprString(raw)}; available: ${ANIMATED_TITLES.map((t) => `${t.name} (${t.title})`).join(", ")}`);
}

/** Python `float(value)` for a spinner override. */
function spinnerNumber(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  return Number(text);
}

/** `_apply_params`: the text and `params` overrides, validated against the template. */
function applyParams(t: AnimatedTitleData, values: ParamValues, text: string, overrides: Readonly<Record<string, unknown>>, fileChoices: ReadonlyMap<string, string>): ParamValues {
  const byName = new Map(t.params.map((p) => [p.name, p]));
  const editable = t.params.filter((p) => !HIDDEN_PARAMS.has(p.name));
  if (text) {
    const main = editable.find((p) => p.type === "text" || p.type === "multiline");
    if (!main) toolError("this animated title has no text; drop text");
    values[main.name] = text;
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    const p = byName.get(name);
    if (!p || HIDDEN_PARAMS.has(name)) toolError(`unknown parameter ${pyReprString(name)}; this template takes: ${editable.map((q) => q.name).join(", ")}`);
    if (p.type === "spinner") {
      const v = spinnerNumber(value);
      if (v === null) toolError(`${name} must be a number`);
      const lo = p.min !== undefined ? Number(p.min) : v;
      const hi = p.max !== undefined ? Number(p.max) : v;
      if (!(lo <= v && v <= hi)) toolError(`${name} must be between ${pyG(lo)} and ${pyG(hi)}`);
      values[name] = v;
    } else if (p.type === "text" || p.type === "multiline") {
      values[name] = typeof value === "string" ? value : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
    } else if (p.type === "color") {
      const [hex, alpha] = colorHexAlpha(value, name);
      values[name] = colorValue(hex + pyRound(alpha * 255).toString(16).padStart(2, "0"), name);
    } else if (p.type === "dropdown") {
      if (name.includes("project_files")) {
        const choice = fileChoices.get(String(value));
        if (choice === undefined) toolError(`${name} takes the id of an image or video in Project Files`);
        values[name] = choice;
        continue;
      }
      const options = Object.entries(p.values);
      const v = String(value);
      const byLabel = new Map(options.map(([label, num]) => [label.toLowerCase(), num]));
      if (options.some(([, num]) => num === v)) values[name] = v;
      else if (byLabel.has(v.toLowerCase())) values[name] = byLabel.get(v.toLowerCase())!;
      else toolError(`${name} must be one of [${options.map(([, num]) => num).sort().map((n) => `'${n}'`).join(", ")}]`);
    }
  }
  return values;
}

/** `_project_file_choices`: images and videos in the bin (not SVG titles), for project_files parameters. */
function projectFileChoices(files: readonly ProjectFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    if ((f.media_type === "image" || f.media_type === "video") && !String(f.path ?? "").toLowerCase().endsWith(".svg")) {
      const fps = (f.fps ?? { num: 25, den: 1 }) as { num: number; den: number };
      out.set(String(f.id), [f.path, f.height, f.width, f.media_type, String(fps.num / (fps.den || 1))].map(String).join("|"));
    }
  }
  return out;
}

interface PreparedSegment {
  position: number;
  duration: number;
  /** The written SVG, or the overlay carrier for effect-only clips. */
  source: { media: ImportedMedia } | { carrier: OverlayCarrier };
  props: Record<string, unknown>;
  effects: Record<string, unknown>[];
}

async function writeSvg(call: ToolCall, name: string, svg: string): Promise<ImportedMedia> {
  const media = call.host.media!;
  let path: string;
  try {
    path = await media.writeGenerated!(name, new TextEncoder().encode(svg), "image/svg+xml");
  } catch (error) {
    return toolError(`could not write the animated title: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { path, info: await media.probe(path), name };
  } catch (error) {
    return toolError(`the animated title could not be imported: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const animatedTitleTools = [
  contractTool("add_animated_title_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: (call, input) =>
      guarded("add_animated_title_tool", async () => {
        const tool = "add_animated_title_tool";
        const project = call.doc.project;
        const template = findTemplate(input.template ?? "");
        const diff = projectFpsDiff(projectFps(project));
        let values = defaultParams(template, diff);
        const needsFiles = template.params.some((p) => p.name.includes("project_files"));
        const choices = needsFiles ? projectFileChoices(project.files) : new Map<string, string>();
        const text = String(input.text ?? "");
        values = applyParams(template, values, text, input.params ?? {}, choices);
        const multiplier = input.length_multiplier ?? 1;
        values.length_multiplier = multiplier * Math.max(1, diff);
        const base = safeBaseName(String(input.file_name ?? "") || text || template.name, "AnimatedTitle", 40);
        values.file_name = base.replaceAll(" ", "_");

        if (!rendersOnWeb(template.name)) {
          return unavailable(
            tool,
            `${template.title} is a 3D scene (${DESKTOP_ONLY_TITLES[template.name] ?? "Blender"}) that only Zenvi desktop renders, with Blender. ` +
              "The other animated titles render here (list_title_templates_tool kind=animated); add_title_tool makes static titles with fades.",
          );
        }
        if (!call.host.media!.writeGenerated) return unavailable(tool, "it cannot store generated title images.");

        const frames = Math.trunc(Number(values.end_frame) || 1) * Math.max(1, pyRound(Number(values.length_multiplier)));
        const fps = fpsOfProject(project);
        const position = snapToFrame(project, input.position_seconds ?? 0);
        const duration = Math.max(1 / fps, frames / fps);
        planOverlayTrack(project, position, position + duration, input.track);

        const [width, height] = projectSize(project);
        const segments = buildAnimatedTitle(template.name, values, { width, height }, frames);
        const prepared: PreparedSegment[] = [];
        for (const [i, seg] of segments.entries()) {
          const startFrame = Math.round(seg.from * frames);
          const endFrame = Math.max(startFrame + 1, Math.round(seg.to * frames));
          const source = seg.svg === null ? { carrier: await prepareOverlayCarrier(call) } : { media: await writeSvg(call, `${values.file_name}${segments.length > 1 ? `_${i + 1}` : ""}.svg`, seg.svg) };
          prepared.push({ position: position + startFrame / fps, duration: (endFrame - startFrame) / fps, source, props: seg.props, effects: seg.effects as Record<string, unknown>[] });
        }

        const placed = call.commit((tx) => {
          const { layer, created, moved } = planOverlayTrack(tx.project, position, position + duration, input.track);
          const nextId = idFactory(tx.project);
          const clips = prepared.map((seg) => {
            const file = "media" in seg.source ? addFile(tx, seg.source.media, { mediaType: "image" }) : carrierFile(tx, seg.source.carrier);
            const props: Record<string, unknown> = { ...seg.props };
            if (seg.effects.length > 0) props.effects = seg.effects.map((e) => ({ ...e, id: nextId() }));
            const clip = placeOverlayClip(tx, { fileId: file.id, position: seg.position, duration: seg.duration, layer, newTrackLabel: "Titles", title: template.title, props });
            return { clip, fileId: file.id };
          });
          return { clips, layer, created, moved };
        });

        const t = trackInfo(call.doc.project, placed.layer);
        const first = placed.clips[0]!;
        const data: Record<string, unknown> = {
          timeline_clip_id: first.clip.id,
          file_id: first.fileId,
          template: template.name,
          frames,
          position: pyRoundTo(position, 3),
          duration: pyRoundTo(duration, 3),
          new_track: placed.created,
          renderer: "keyframes",
          look: WEB_LOOKS[template.name],
          params: values,
          ...t,
        };
        if (placed.clips.length > 1) {
          data.timeline_clip_ids = placed.clips.map((c) => c.clip.id);
          data.file_ids = placed.clips.map((c) => c.fileId);
        }
        const warnings = placed.moved ? [placed.moved] : [];
        if (warnings.length > 0) data.warnings = warnings;
        return applied(
          tool,
          summaryLine(
            `Added animated title ${pyReprString(template.title)} (a 2D keyframed title, ${frames} frames) on track ${t.track} at ` +
              `${pyFixed(position, 2)}-${pyFixed(position + duration, 2)}s.${warningNote(warnings)}`,
          ),
          {
            data,
            warnings,
            notes: ["Zenvi desktop renders this template in 3D with Blender; this surface draws a 2D version of it with keyframes, which stays editable."],
          },
        );
      }),
  }),
];
