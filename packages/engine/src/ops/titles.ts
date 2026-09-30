/**
 * Title clips: an SVG image file plus a clip that shows it.
 *
 * The tool layer renders the SVG text with `buildTitleSvg` (titles/svg.ts),
 * writes it through the host (`MediaHost.writeGenerated`), probes it, and
 * calls `addTitleClip` with the result (desktop: title_editor.py `accept` adds
 * the saved SVG to the bin; the person then drags it to the timeline).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, ProjectFile } from "../model/types.js";
import type { ImportedMedia } from "../tools/types.js";
import { OpError } from "./errors.js";

export { buildTitleSvg, type TitleFields } from "../titles/svg.js";

export interface AddTitleClipInput {
  /** The written SVG, as imported media (`info.type` is usually "QtImageReader"). */
  file: ImportedMedia;
  /** Timeline start, seconds. */
  position: number;
  /** How long the title shows, seconds (> 0). */
  duration: number;
  /** Track number. */
  layer: number;
  /** Clip title. Default the file name. */
  title?: string;
}

export interface AddTitleClipResult {
  file: ProjectFile;
  clip: Clip;
}

/** Add a title SVG to the bin and place it on the timeline, in one step. */
export function addTitleClip(tx: Transaction, input: AddTitleClipInput): AddTitleClipResult {
  void tx;
  void input;
  throw new OpError("unsupported", "not implemented: addTitleClip");
}
