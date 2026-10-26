/**
 * Project JSON in and out: validation, the desktop's load upgrades,
 * serialization and the desktop's stored-path rules.
 */
export { ProjectParseError, type ProjectIssue } from "./errors.js";
export { PROJECT_FORMAT_VERSION } from "./versions.js";
export { parseProject, parseProjectText, serializeProject, type ParseProjectOptions } from "./parse.js";
export { replaceNonFiniteTokens } from "./repair.js";
export {
  PATH_KEYS,
  fromStoredPath,
  fromStoredPaths,
  projectAssetsDir,
  toStoredPath,
  toStoredPaths,
  type PathRoots,
} from "./paths.js";
export {
  EMOJI_CATALOG_ASSET,
  buildEmojiCatalog,
  emojiReaderInfo,
  loadEmojiCatalog,
  parseBundledEmojiCatalog,
  scoreEmoji,
  searchEmojis,
  type BundledEmojiCatalog,
  type EmojiEntry,
  type EmojiMatch,
  type EmojiSource,
  type OpenMojiMeta,
} from "./emojis.js";
