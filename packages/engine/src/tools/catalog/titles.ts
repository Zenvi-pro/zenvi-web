/**
 * Title tools: add_title_tool (add_captions_tool is in captions.ts).
 *
 * Port of zenvi-core (ref b63c39be7) src/classes/agent_tools/titles.py
 * `add_title`. A title is a bundled SVG
 * template with its first text line replaced (W1's `setSvgText`, the port of
 * `_set_svg_text`), written through the host, probed, and placed with
 * add_clip_to_timeline's track/position rules (W1's `addTitleClip` records
 * the file and the clip).
 *
 * Templates are the bundled catalog (`src/titles/templates.ts`, read through
 * `ToolHost.assets` by their `assetPath`); the desktop reads them from its
 * install folder. An absolute `.svg` path is a user's own file, read through
 * `StorageHost.readText`.
 */

import type { Clip } from "../../model/types.js";
import { generateId } from "../../model/ids.js";
import { ensureTrack } from "../../ops/overlays.js";
import { addTitleClip, setSvgText } from "../../ops/titles.js";
import { getTitleTemplate } from "../../titles/templates.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { parseSecondsArg, TimeArgError } from "../placement.js";
import { pyFixed, pyReprString, pySlice } from "../pyfmt.js";
import { applied, failed, refused } from "../receipt.js";
import { planOverlayTrack } from "../titles-text.js";
import type { ImportedMedia } from "../types.js";
import { planPlacement, placementText, provisionalFile, type PlacementPlan } from "./clips.js";
import { text } from "./common.js";

function basename(path: string): string {
  return String(path).split(/[\\/]/).pop() ?? "";
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

export interface LoadedTitleTemplate {
  /** Template file name, e.g. `Bar_1.svg`. */
  file: string;
  svg: string;
}

/**
 * Resolve `template` like add_title: blank is the default template (Bar_1),
 * a name is a bundled template (`getTitleTemplate`), an absolute `.svg` path
 * is a file the host can read. Null when nothing readable matches (the
 * desktop's `os.path.isfile` miss).
 */
export async function loadTitleTemplate(call: ToolCall, template: string): Promise<LoadedTitleTemplate | null> {
  const tmpl = template.trim();
  const log = (what: string, error: unknown): void => call.host.log?.(`title template ${what}: ${error instanceof Error ? error.message : String(error)}`);
  if (tmpl && isAbsolutePath(tmpl)) {
    const storage = call.host.storage;
    if (!tmpl.toLowerCase().endsWith(".svg") || !storage?.readText) return null;
    try {
      return { file: basename(tmpl), svg: await storage.readText(tmpl) };
    } catch (error) {
      log(tmpl, error);
      return null;
    }
  }
  const bundled = getTitleTemplate(tmpl);
  if (!bundled) return null;
  try {
    return { file: bundled.file, svg: await call.host.assets!.readText(bundled.assetPath) };
  } catch (error) {
    log(bundled.assetPath, error);
    return null;
  }
}

/** add_title's file name: the given one (+ .svg), else a slug of the text plus 8 random characters. */
export function titleFileName(body: string, fileName: string): string {
  let safe = basename(fileName.trim());
  if (!safe) {
    const slug = pySlice(body.replace(/[^A-Za-z0-9_-]+/g, "_"), 0, 40).replace(/^_+|_+$/g, "") || "title";
    safe = `${slug}_${generateId().slice(0, 8).toLowerCase()}.svg`;
  }
  if (!safe.toLowerCase().endsWith(".svg")) safe += ".svg";
  return safe;
}

interface PreparedTitle {
  media: ImportedMedia;
  plan: PlacementPlan;
  duration: number;
}

/**
 * Write one title SVG and plan its placement (add_title up to the import).
 * Returns an "Error: …" string, already in the desktop's wording, on failure.
 */
async function prepareTitle(
  call: ToolCall,
  template: LoadedTitleTemplate,
  body: string,
  options: { position: number; duration: number; track: string; fileName: string },
): Promise<PreparedTitle | string> {
  const media = call.host.media!;
  const name = titleFileName(body, options.fileName);
  let path: string;
  try {
    const svg = setSvgText(template.svg, body);
    path = await media.writeGenerated!(name, new TextEncoder().encode(svg), "image/svg+xml");
  } catch (error) {
    return `Error: failed to write title SVG: ${error instanceof Error ? error.message : String(error)}`;
  }
  let imported: ImportedMedia;
  try {
    const info = await media.probe(path);
    imported = { path, info, name };
  } catch {
    return `Error: could not import title into media bin: ${path}`;
  }
  const placed = await planPlacement(call, provisionalFile(imported), {
    position_seconds: options.position,
    track: options.track,
    duration_seconds: options.duration,
    full_file: "true",
  });
  if (typeof placed === "string") return placed;
  const duration = placed.start !== undefined && placed.end !== undefined ? placed.end - placed.start : options.duration;
  // Without a track, a title goes over the picture: the lowest free track above every clip with video at
  // that time, or a new top track (develop's add_title_tool), not the bottom track under the video.
  const plan = options.track ? placed : { ...placed, layer: planOverlayTrack(call.doc.project, placed.position, placed.position + duration, "").layer };
  return { media: imported, plan, duration };
}

function placeTitle(tx: Parameters<typeof addTitleClip>[0], title: PreparedTitle): { fileId: string; clip: Clip } {
  ensureTrack(tx, title.plan.layer, "Titles");
  const { file, clip } = addTitleClip(tx, { file: title.media, position: title.plan.position, duration: title.duration, layer: title.plan.layer });
  return { fileId: String(file.id), clip };
}

export const titleTools: CatalogTool[] = [
  contractTool("add_title_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media", "assets"],
    run: async (call, input) => {
      const tool = "add_title_tool";
      const body = text(input.text);
      if (!body) return refused(tool, "Error: add_title_tool needs text.");
      if (!call.host.media!.writeGenerated) return unavailable(tool, "it cannot store generated title images.");
      const tmplArg = text(input.template);
      const template = await loadTitleTemplate(call, tmplArg);
      if (!template) return failed(tool, `Error: title template not found (${tmplArg || "default"}).`);
      let pos: number;
      let dur: number;
      try {
        pos = parseSecondsArg(input.position_seconds, 0, "position_seconds") ?? 0;
        dur = parseSecondsArg(input.duration_seconds, 5, "duration_seconds") ?? 5;
      } catch (error) {
        if (error instanceof TimeArgError) return refused(tool, `Error: ${error.message}`);
        throw error;
      }
      if (!(dur > 0)) dur = 5;
      const prepared = await prepareTitle(call, template, body, { position: pos, duration: dur, track: text(input.track), fileName: text(input.file_name) });
      if (typeof prepared === "string") return failed(tool, prepared);
      const placed = call.commit((tx) => placeTitle(tx, prepared));
      const place = placementText(call.doc.project, prepared.plan, placed.clip);
      return applied(
        tool,
        `Added title ${pyReprString(body)} from template ${template.file} at ${pyFixed(pos, 3)}s for ${pyFixed(dur, 3)}s. ${place}`,
        {
          data: {
            text: body,
            path: prepared.media.path,
            file_id: placed.fileId,
            position_seconds: pos,
            duration_seconds: dur,
            template: template.file,
          },
          notes: [place],
        },
      );
    },
  }),
];
