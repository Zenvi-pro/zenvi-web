/**
 * The built-in transition masks (zenvi-core src/transitions/{common,extra}).
 *
 * A transition is a libopenshot `Mask` whose reader is one of these images;
 * projects store its path as `@transitions/<category>/<file>` (json_data.py).
 * Copies ship in `@zenvi/engine/assets/transitions/` under the same names
 * (JPG masks re-encoded at most `BUNDLED_MASK_MAX_SIZE` px; libopenshot
 * scales a mask to the frame anyway). Hosts map `assetPath` to a URL or file.
 *
 * Names, listing and search follow the desktop transitions dock
 * (src/windows/models/transition_model.py) and agent tools
 * (tool_handlers.py `list_transitions`, `search_transitions`,
 * `add_transition_between_clips`).
 */

import type { ReaderInfo } from "../model/types.js";
import { MASK_READER_TEMPLATE, TRANSITION_FILES } from "./catalog.data.js";

export { BUNDLED_MASK_MAX_SIZE } from "./catalog.data.js";

export type TransitionCategory = "common" | "extra";

export interface TransitionEntry {
  /** `<category>/<file name without extension>`, e.g. `"common/fade"`. */
  id: string;
  /** Desktop display name, e.g. `"Wipe left to right"`. */
  name: string;
  category: TransitionCategory;
  /** File name, e.g. `"fade.svg"`. */
  file: string;
  /** The mask reader path projects store: `"@transitions/common/fade.svg"`. */
  storedPath: string;
  /** The bundled copy, relative to `@zenvi/engine/assets/`: `"transitions/common/fade.svg"`. */
  assetPath: string;
  /** Size of the original mask, as the desktop's QtImageReader reports it. */
  width: number;
  height: number;
  /** QtImageReader `file_size` of the original mask. */
  fileSize: number;
}

function stem(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Python `str.capitalize()`: first character upper case, the rest lower case. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** transition_model.py: `basename.replace("_", " ").capitalize()`. */
export function transitionDisplayName(file: string): string {
  return capitalize(stem(file).replaceAll("_", " "));
}

/** Every built-in transition: common first, then extra, each sorted by file name. */
export const TRANSITIONS: readonly TransitionEntry[] = TRANSITION_FILES.map(([category, file, width, height, fileSize]) =>
  Object.freeze({
    id: `${category}/${stem(file)}`,
    name: transitionDisplayName(file),
    category,
    file,
    storedPath: `@transitions/${category}/${file}`,
    assetPath: `transitions/${category}/${file}`,
    width,
    height,
    fileSize,
  }),
);

const BY_ID = new Map(TRANSITIONS.map((t) => [t.id, t]));
const BY_LOCATION = new Map(TRANSITIONS.map((t) => [`${t.category}/${t.file}`, t]));

/** A transition by id (`"common/fade"`). */
export function getTransition(id: string): TransitionEntry | undefined {
  return BY_ID.get(id);
}

/** `list_transitions(category)`: every transition of one category, or all. */
export function listTransitions(category: TransitionCategory | "all" = "all"): TransitionEntry[] {
  return TRANSITIONS.filter((t) => category === "all" || t.category === category);
}

/**
 * `search_transitions(query)`: case-insensitive substring match on the
 * display name or the file name without extension. An empty query matches
 * everything. Common transitions come first.
 */
export function searchTransitions(query: string): TransitionEntry[] {
  const q = (query ?? "").toLowerCase();
  return TRANSITIONS.filter((t) => t.name.toLowerCase().includes(q) || stem(t.file).toLowerCase().includes(q));
}

/**
 * The transition an agent means by `name` (apply_transition_tool).
 *
 * An exact id (`"extra/board_10"`), file name, file stem or display name wins.
 * Otherwise the desktop rule applies: lower-case the name, turn spaces into
 * underscores, and take the first mask whose stem contains it or is
 * contained in it (`"fade in"` → fade, `"circle"` → circle_in_to_out),
 * common before extra. The desktop scans folders in `os.listdir` order, so
 * its fuzzy pick can vary by platform; here the order is sorted. Like the
 * desktop, an empty name picks the first mask.
 */
export function matchTransition(name: string): TransitionEntry | undefined {
  const raw = (name ?? "").trim();
  const exact = BY_ID.get(raw);
  if (exact) return exact;
  const lower = raw.toLowerCase();
  if (lower) {
    const match = TRANSITIONS.find(
      (t) => t.file.toLowerCase() === lower || stem(t.file).toLowerCase() === lower || t.name.toLowerCase() === lower,
    );
    if (match) return match;
  }
  const search = (name ?? "").toLowerCase().replaceAll(" ", "_");
  return TRANSITIONS.find((t) => {
    const base = stem(t.file).toLowerCase();
    return base.includes(search) || search.includes(base);
  });
}

/**
 * The catalog entry a mask path points at: a stored path
 * (`@transitions/common/fade.svg`) or any absolute path ending in
 * `transitions/<category>/<file>` (a desktop install path). Undefined for
 * other images (user transitions are ordinary media).
 */
export function resolveTransitionAsset(path: string): TransitionEntry | undefined {
  const match = /(?:^@transitions|(?:^|[\\/])transitions)[\\/](common|extra)[\\/]([^\\/]+)$/.exec(path ?? "");
  return match ? BY_LOCATION.get(`${match[1]}/${match[2]}`) : undefined;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/**
 * The transition `reader` the desktop stores for a catalog mask:
 * `json.loads(openshot.QtImageReader(path).Json())` (timeline.py
 * `_load_transition_reader_data`) with the stored path, keys in jsoncpp's
 * sorted order.
 */
export function transitionReader(entry: TransitionEntry): ReaderInfo {
  const divisor = gcd(entry.width, entry.height);
  const fields: Record<string, unknown> = {
    ...structuredClone(MASK_READER_TEMPLATE),
    display_ratio: { den: entry.height / divisor, num: entry.width / divisor },
    file_size: entry.fileSize,
    height: entry.height,
    path: entry.storedPath,
    width: entry.width,
  };
  const sorted = Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]]));
  return sorted as ReaderInfo;
}
