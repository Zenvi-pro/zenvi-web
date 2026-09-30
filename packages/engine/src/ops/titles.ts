/**
 * Title clips: an SVG image file plus a clip that shows it.
 *
 * The tool layer renders the SVG text with `buildTitleSvg` / `setSvgText`
 * (titles/svg.ts), writes it through the host (`MediaHost.writeGenerated`),
 * probes it, and calls `addTitleClip` with the result (desktop:
 * agent_tools/titles.py `add_title` saves the SVG, imports it and places it
 * with `add_clip_to_timeline`; the title editor imports it into the bin).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, ProjectFile } from "../model/types.js";
import type { ImportedMedia } from "../tools/types.js";
import { invalid, requireNonNegative, requirePositive, requireUnlocked } from "./errors.js";
import { addFile } from "./files.js";
import { addClip } from "./clips.js";

export { buildTitleSvg, setSvgText, inspectTitleSvg, titleLines, type TitleFields } from "../titles/svg.js";

export interface AddTitleClipInput {
  /** The written SVG, as imported media (`info.type` is usually "QtImageReader"). */
  file: ImportedMedia;
  /** Timeline start, seconds. */
  position: number;
  /** How long the title shows, seconds (> 0; the desktop tool defaults to 5). */
  duration: number;
  /** Track number (created when missing). */
  layer: number;
  /** Clip title. Default the file's display name. */
  title?: string;
}

export interface AddTitleClipResult {
  file: ProjectFile;
  clip: Clip;
}

/** Add a title SVG to the bin (or reuse it) and place it on the timeline, in one step. */
export function addTitleClip(tx: Transaction, input: AddTitleClipInput): AddTitleClipResult {
  if (typeof input !== "object" || input === null) throw invalid("addTitleClip needs an input object.");
  requireNonNegative(input.position, "position");
  const duration = requirePositive(input.duration, "duration");
  if (!input.file || typeof input.file.path !== "string") throw invalid("file is required.");
  if (!/\.svgz?$/i.test(input.file.path) && !/\.svgz?$/i.test(input.file.name ?? "")) {
    throw invalid("A title file must be an SVG.");
  }
  // Validate the placement before recording the file, so a refusal records nothing.
  if (!Number.isInteger(input.layer) || input.layer <= 0) throw invalid("layer must be a positive track number.");
  requireUnlocked(tx.project, input.layer);
  const file = addFile(tx, input.file, { mediaType: "image" });
  const clipInput: Parameters<typeof addClip>[1] = {
    fileId: file.id,
    position: input.position,
    layer: input.layer,
    start: 0,
    end: duration,
  };
  if (input.title !== undefined) clipInput.title = input.title;
  const clip = addClip(tx, clipInput);
  return { file, clip };
}
