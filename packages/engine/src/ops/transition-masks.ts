/**
 * Transition mask lookup used by the transition ops, on top of the
 * transitions catalog (`src/transitions/`): catalog ids, stored paths and
 * names (the desktop's fuzzy rule), plus reader JSON for user masks.
 */

import type { ReaderInfo } from "../model/types.js";
import {
  matchTransition,
  resolveTransitionAsset,
  transitionReader,
  type TransitionEntry,
} from "../transitions/catalog.js";
import { MASK_READER_TEMPLATE } from "../transitions/catalog.data.js";

export interface TransitionMask {
  /** Path as the desktop stores it, e.g. `@transitions/common/fade.svg`, or a user file path. */
  path: string;
  /** Title the desktop's tools give the transition: the file name without extension. */
  title: string;
  /** Natural size of the mask image. */
  width: number;
  height: number;
  /** The catalog entry, for built-in masks. */
  entry?: TransitionEntry;
}

function stem(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function fromEntry(entry: TransitionEntry): TransitionMask {
  return { path: entry.storedPath, title: stem(entry.file), width: entry.width, height: entry.height, entry };
}

/**
 * Resolve a transition by catalog id (`common/fade`), stored path
 * (`@transitions/…`) or name (exact, else zenvi-core's fuzzy rule from
 * tool_handlers.py `add_transition_between_clips`). Undefined when nothing
 * matches or the query is empty.
 */
export function resolveTransitionMask(query: string): TransitionMask | undefined {
  const q = String(query ?? "").trim();
  if (!q) return undefined;
  const asset = resolveTransitionAsset(q);
  if (asset) return fromEntry(asset);
  const entry = matchTransition(q);
  return entry ? fromEntry(entry) : undefined;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/**
 * The reader JSON the desktop stores for a mask
 * (`QtImageReader(path).Json()`): exact for built-in masks; for user masks
 * the same fields with the given size (libopenshot re-reads the image when it
 * opens it, so size and file_size are informational).
 */
export function maskReader(path: string, width = 720, height = 576): ReaderInfo {
  const entry = resolveTransitionAsset(path);
  if (entry) return transitionReader(entry);
  const divisor = gcd(width, height);
  const fields: Record<string, unknown> = {
    ...structuredClone(MASK_READER_TEMPLATE),
    display_ratio: { den: height / divisor, num: width / divisor },
    file_size: width * height * 4,
    height,
    path,
    width,
  };
  return Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]])) as ReaderInfo;
}
