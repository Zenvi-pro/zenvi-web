/**
 * Copy and paste of timeline items.
 *
 * Desktop: zenvi-core src/windows/views/timeline.py `Copy_Triggered` (clips
 * and transitions serialized to the clipboard) and `_handle_paste_callback`
 * (items keep their offsets from the earliest copied item; pasted clips get
 * new ids and new effect ids; missing tracks are created).
 */

import type { Transaction } from "../history/document.js";
import type { Project } from "../model/types.js";
import { OpError } from "./errors.js";
import type { ClipboardData } from "./types.js";

/**
 * Deep-copy the clips and transitions with the given ids. Unknown ids are
 * refused with `not_found`. Pure: does not change the project.
 */
export function copyItems(project: Project, ids: readonly string[]): ClipboardData {
  void project;
  void ids;
  throw new OpError("unsupported", "not implemented: copyItems");
}

export interface PasteTarget {
  /** Timeline seconds where the copied selection's earliest item lands. */
  position: number;
  /** Track number where the copied selection's top track lands. Default: each item's own track. */
  layer?: number;
}

export interface PasteResult {
  clipIds: string[];
  transitionIds: string[];
  /** Tracks created because the pasted selection needed them. */
  createdLayers: number[];
}

/** Paste clipboard items at `target`, with fresh ids. Returns the new ids. */
export function pasteItems(tx: Transaction, data: ClipboardData, target: PasteTarget): PasteResult {
  void tx;
  void data;
  void target;
  throw new OpError("unsupported", "not implemented: pasteItems");
}
