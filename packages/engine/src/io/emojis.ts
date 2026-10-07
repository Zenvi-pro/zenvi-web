/**
 * The desktop's Emojis dock as a catalog over a host-provided OpenMoji set
 * (src/windows/models/emoji_model.py `update_model`). The engine does not
 * bundle the 1,239 SVGs; a host that ships them (desktop layout:
 * `emojis/color/svg/*.svg` plus `emojis/data/openmoji-optimized.json`)
 * implements `EmojiSource`. Projects store emoji paths as `@emojis/<file>`
 * (see `toStoredPath`).
 */

/** One entry of openmoji-optimized.json (keyed by hexcode, e.g. "1F600"). */
export interface OpenMojiMeta {
  annotation?: string;
  /** e.g. "smileys-emotion". */
  group?: string;
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
    });
  }
  return out;
}

/** Read a source and build its catalog. */
export async function loadEmojiCatalog(source: EmojiSource): Promise<EmojiEntry[]> {
  const [files, metadata] = await Promise.all([source.files(), source.metadata()]);
  return buildEmojiCatalog(files, metadata);
}
