/**
 * Project JSON in and out: validation, the desktop's load upgrades,
 * serialization and the desktop's stored-path rules.
 */
export { ProjectParseError, type ProjectIssue } from "./errors.js";
export { PROJECT_FORMAT_VERSION } from "./versions.js";
export { parseProject, parseProjectText, serializeProject, type ParseProjectOptions } from "./parse.js";
export {
  PATH_KEYS,
  fromStoredPath,
  fromStoredPaths,
  projectAssetsDir,
  toStoredPath,
  toStoredPaths,
  type PathRoots,
} from "./paths.js";
