/**
 * The desktop's Emojis dock as a catalog over an OpenMoji set
 * (src/windows/models/emoji_model.py `update_model`,
 * src/classes/emoji_catalog.py `entry_for`, `score`, `search`).
 *
 * The engine ships the desktop's 1,239 SVGs in `assets/emojis/` with
 * `assets/emojis/catalog.json` (the file list plus the openmoji-optimized.json
 * fields the dock reads; scripts/gen-emojis.mjs). Projects store emoji paths
 * as `@emojis/<file>` (see `toStoredPath`); every renderer resolves that
 * alias to the bundled file. A host with another set implements `EmojiSource`.
 */

import type { ReaderInfo } from "../model/types.js";
import { MASK_READER_TEMPLATE } from "../transitions/catalog.data.js";

/** One entry of openmoji-optimized.json (keyed by hexcode, e.g. "1F600"). */
export interface OpenMojiMeta {
  /** The emoji character, e.g. "😀". */
  emoji?: string;
  annotation?: string;
  /** e.g. "smileys-emotion". */
  group?: string;
  subgroups?: string;
  tags?: string;
  openmoji_tags?: string;
  skintone?: string;
  [key: string]: unknown;
}

export interface EmojiEntry {
  /** File name without extension: the OpenMoji hexcode, e.g. `"1F600"`. */
  id: string;
  /** Dock name: the annotation (or the hexcode), capitalized: `"Grinning face"`. */
  name: string;
  /** Group filter label: `"Smileys"` (first word of the group id). */
  group: string;
  /** Group id, e.g. `"smileys-emotion"`; `"user"` without metadata. */
  groupId: string;
  file: string;
  /** What a project stores: `"@emojis/1F600.svg"`. */
  storedPath: string;
  /** The emoji character ("" for OpenMoji extras without one). */
  char: string;
  /** Search words: Unicode tags, OpenMoji tags and subgroups, space-joined. */
  tags: string;
  /** Skin tone modifier ("" for none). */
  skintone: string;
}

export interface EmojiSource {
  /** SVG file names in the emoji folder. */
  files(): Promise<readonly string[]>;
  /** The contents of openmoji-optimized.json. */
  metadata(): Promise<Readonly<Record<string, OpenMojiMeta>>>;
}

/** Python `str.capitalize()`. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function field(meta: OpenMojiMeta, key: string): string {
  const value = meta[key];
  return value === undefined || value === null ? "" : String(value);
}

/** The dock's entries for `files`, sorted by file name, named from `metadata`. */
export function buildEmojiCatalog(files: readonly string[], metadata: Readonly<Record<string, OpenMojiMeta>>): EmojiEntry[] {
  const out: EmojiEntry[] = [];
  for (const file of [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (file.startsWith(".") || file.toLowerCase().includes("thumbs.db")) continue;
    const dot = file.lastIndexOf(".");
    const id = dot > 0 ? file.slice(0, dot) : file;
    const meta = Object.hasOwn(metadata, id) ? metadata[id]! : {};
    const annotation = typeof meta.annotation === "string" ? meta.annotation : id;
    const groupId = typeof meta.group === "string" ? meta.group : "user";
    out.push({
      id,
      name: capitalize(annotation),
      group: capitalize(groupId.split("-")[0]!),
      groupId,
      file,
      storedPath: `@emojis/${file}`,
      char: field(meta, "emoji"),
      tags: ["tags", "openmoji_tags", "subgroups"].map((key) => field(meta, key)).join(" "),
      skintone: field(meta, "skintone"),
    });
  }
  return out;
}

/** Read a source and build its catalog. */
export async function loadEmojiCatalog(source: EmojiSource): Promise<EmojiEntry[]> {
  const [files, metadata] = await Promise.all([source.files(), source.metadata()]);
  return buildEmojiCatalog(files, metadata);
}

/**
 * `openshot.Clip(path).Reader().Json()` for a bundled emoji, which the
 * Emojis dock stores as the file's data (`add_emoji_file`). Every OpenMoji
 * SVG is 72×72; QtImageReader renders it into its 1920×1080 box, so
 * `file_size` is 1080×1080 RGBA (checked against libopenshot 1.0.0).
 */
export function emojiReaderInfo(storedPath: string): ReaderInfo {
  const fields: Record<string, unknown> = {
    ...structuredClone(MASK_READER_TEMPLATE),
    display_ratio: { den: 1, num: 1 },
    file_size: 1080 * 1080 * 4,
    height: 72,
    path: storedPath,
    width: 72,
  };
  return Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]])) as ReaderInfo;
}

/** The bundled catalog's asset path (under the engine's `assets/`). */
export const EMOJI_CATALOG_ASSET = "emojis/catalog.json";

/** `assets/emojis/catalog.json` as written by scripts/gen-emojis.mjs. */
export interface BundledEmojiCatalog {
  files: readonly string[];
  metadata: Readonly<Record<string, OpenMojiMeta>>;
}

/** The bundled catalog from its JSON text. */
export function parseBundledEmojiCatalog(json: string): EmojiEntry[] {
  const data = JSON.parse(json) as Partial<BundledEmojiCatalog>;
  if (!Array.isArray(data.files) || typeof data.metadata !== "object" || data.metadata === null) {
    throw new Error("emoji catalog: expected files and metadata");
  }
  return buildEmojiCatalog(data.files.map(String), data.metadata);
}

// ---------------------------------------------------------------------------
// Search (emoji_catalog.py `score` / `search`)
// ---------------------------------------------------------------------------

/** Everyday words for emoji whose OpenMoji annotation differs (emoji_catalog.py ALIASES). */
const ALIASES: Readonly<Record<string, string>> = {
  heart: "red heart",
  love: "red heart",
  lol: "face with tears of joy",
  laugh: "face with tears of joy",
  laughing: "face with tears of joy",
  joy: "face with tears of joy",
  lit: "fire",
  flame: "fire",
  "100": "hundred points",
  party: "party popper",
  tada: "party popper",
  celebrate: "party popper",
  cry: "loudly crying face",
  sad: "crying face",
  smile: "grinning face",
  happy: "grinning face",
  wow: "astonished face",
  shocked: "face screaming in fear",
  money: "money bag",
  check: "check mark button",
  tick: "check mark",
  angry: "enraged face",
  cool: "smiling face with sunglasses",
  kiss: "face blowing a kiss",
  thinking: "thinking face",
  think: "thinking face",
  poop: "pile of poo",
  star: "star",
  sparkle: "sparkles",
  shine: "sparkles",
  rocket: "rocket",
  sun: "sun",
  moon: "crescent moon",
  rain: "cloud with rain",
  snow: "snowflake",
  coffee: "hot beverage",
  pizza: "pizza",
  cake: "birthday cake",
  birthday: "birthday cake",
  gift: "wrapped gift",
  music: "musical notes",
  camera: "camera",
  plane: "airplane",
  car: "automobile",
  home: "house",
  world: "globe showing Europe-Africa",
  earth: "globe showing Europe-Africa",
  warning: "warning",
  question: "red question mark",
  exclamation: "red exclamation mark",
  arrow: "right arrow",
  "mind blown": "exploding head",
  skull: "skull",
  dead: "skull",
  crown: "crown",
  king: "crown",
  trophy: "trophy",
  win: "trophy",
  gold: "1st place medal",
  idea: "light bulb",
  bulb: "light bulb",
  hot: "hot face",
  cold: "cold face",
  sleep: "sleeping face",
  tired: "tired face",
  devil: "smiling face with horns",
  angel: "smiling face with halo",
  ghost: "ghost",
  alien: "alien",
  robot: "robot",
  dog: "dog face",
  cat: "cat face",
  unicorn: "unicorn",
  boom: "collision",
  explosion: "collision",
  lightning: "high voltage",
  zap: "high voltage",
  bomb: "bomb",
  starstruck: "star-struck",
  "party face": "partying face",
  glow: "glowing star",
};

/** Variation selectors 15 and 16 (text / emoji presentation). */
function stripVariationSelectors(text: string): string {
  return text.replace(/[︎️]/g, "");
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** Python `len(str)`: code points. */
function pyLen(text: string): number {
  return [...text].length;
}

/** `score`: how well an entry matches a name ("fire"), a character ("🔥") or a hexcode ("1F525"). 0 = no match. */
export function scoreEmoji(entry: EmojiEntry, query: string): number {
  const q = String(query ?? "").trim();
  if (!q) return 1;
  const ql = q.toLowerCase();
  if (entry.char && stripVariationSelectors(entry.char) === stripVariationSelectors(q)) return 100;
  const code = ql.replaceAll("u+", "").replaceAll(" ", "-");
  const own = entry.id.toLowerCase();
  if (own === code || own.replaceAll("-fe0f", "") === code) return 100;
  const name = entry.name.toLowerCase();
  const alias = Object.hasOwn(ALIASES, ql) ? ALIASES[ql] : undefined;
  const penalty = entry.skintone ? 5 : 0;
  if (alias && name === alias.toLowerCase()) return 95;
  if (name === ql) return 90 - penalty;
  const qw = words(ql);
  const nw = words(name);
  if (qw.length > 0 && qw.every((w) => nw.includes(w))) return 70 - penalty - nw.length * 0.5 - pyLen(name) / 100;
  if (name.startsWith(ql)) return 60 - penalty - pyLen(name) / 100;
  const tw = words(entry.tags);
  if (qw.length > 0 && qw.every((w) => tw.includes(w) || nw.includes(w))) return 40 - penalty - nw.length * 0.5;
  if (name.includes(ql) || entry.tags.toLowerCase().includes(ql)) return 20 - penalty;
  return 0;
}

/** `_group_ok`: a group filter matches the group id or the dock's label, by prefix or substring. */
function inGroup(entry: EmojiEntry, group: string): boolean {
  if (!group) return true;
  const g = group.trim().toLowerCase().replaceAll(" ", "-").replaceAll("&", "");
  return entry.groupId.startsWith(g) || entry.group.toLowerCase().startsWith(g) || entry.groupId.includes(g);
}

export interface EmojiMatch {
  score: number;
  entry: EmojiEntry;
}

/** `search`: the best matches, best first (ties by name), at most `limit` (at least 1). */
export function searchEmojis(catalog: readonly EmojiEntry[], query: string, group = "", limit = 10): EmojiMatch[] {
  const ranked: EmojiMatch[] = [];
  for (const entry of catalog) {
    if (!inGroup(entry, group)) continue;
    const score = scoreEmoji(entry, query);
    if (score > 0) ranked.push({ score, entry });
  }
  ranked.sort((a, b) => b.score - a.score || (a.entry.name < b.entry.name ? -1 : a.entry.name > b.entry.name ? 1 : 0));
  return ranked.slice(0, Math.max(1, Math.trunc(limit)));
}
