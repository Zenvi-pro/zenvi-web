/**
 * Reading and writing project JSON (`.zvn`, OpenShot `.osp` lineage).
 *
 * `parseProject` is the desktop's `ProjectDataStore.load` without the file
 * system (zenvi-core src/classes/project_data.py L456-544): validate, fill
 * missing top-level keys from a new default project, run the load upgrades,
 * and keep every key it does not know. Two load steps are intentionally not
 * ported, because they overwrite saved data with the desktop user's local
 * preferences:
 *
 * - re-applying the profile named by `profile` (L527-532), which on the
 *   desktop also reverts sizes/rates set without a profile change and falls
 *   back to "HD 720p 30 fps" when the profile is unknown;
 * - `apply_default_audio_settings` (L535), which replaces the saved sample
 *   rate and channels with the preference values.
 *
 * Paths are left exactly as stored; see `fromStoredPaths` / `toStoredPaths`.
 */

import type { Project } from "../model/types.js";
import { createProject } from "../model/defaults.js";
import { findProfile } from "../model/profiles.js";
import { idFactory } from "../model/ids.js";
import { ProjectParseError } from "./errors.js";
import { validateProject } from "./schema.js";
import { upgradeProjectData } from "./migrate.js";
import { repairProjectText, replaceNonFiniteTokens } from "./repair.js";
import { BETA_VERSION, PROJECT_FORMAT_VERSION } from "./versions.js";

type Data = Record<string, unknown>;

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python truthiness of a JSON value. */
function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

export interface ParseProjectOptions {
  /**
   * Id generator for objects the load creates: a missing project id, the
   * template id "T0", Crop effects migrated from OpenShot 2.5. Default:
   * random desktop-style ids unique within the project.
   */
  newId?: () => string;
}

/**
 * Validate and upgrade project JSON (an already parsed value) into a
 * `Project`. The input is not modified. Throws `ProjectParseError` listing
 * every structural problem found.
 *
 * A project without a `version` stamp is read the way the desktop reads it:
 * as an OpenShot beta ("0.0.0") project, so clip alpha values are flipped.
 * Projects written by `serializeProject` always carry a current stamp.
 */
export function parseProject(json: unknown, options: ParseProjectOptions = {}): Project {
  if (!isRecord(json)) throw new ProjectParseError([{ path: "", message: "expected a JSON object" }]);
  let data: Data;
  try {
    data = structuredClone(json);
  } catch {
    throw new ProjectParseError([{ path: "", message: "expected plain JSON data" }]);
  }

  // load() L466-468: a missing or empty history becomes empty stacks.
  if (!truthy(data.history)) data.history = { undo: [], redo: [] };

  const issues = validateProject(data);
  if (issues.length > 0) throw new ProjectParseError(issues);

  const newId = options.newId ?? idFactory(data as Project);
  fillDefaults(data);
  upgradeProjectData(data, { newId });
  // The data now has current semantics; stamp it so a later save (or a raw
  // JSON.stringify of the document) never re-runs the upgrades.
  data.version = { ...(data.version as Data), ...PROJECT_FORMAT_VERSION };
  return data as Project;
}

/**
 * Parse project file text: the desktop's corruption repairs
 * (`repairProjectText`), then `JSON.parse` (tolerating the `NaN` /
 * `Infinity` tokens Python writes), then `parseProject`.
 */
export function parseProjectText(text: string, options: ParseProjectOptions = {}): Project {
  const repaired = repairProjectText(text);
  let json: unknown;
  try {
    json = JSON.parse(repaired);
  } catch (error) {
    const tolerant = replaceNonFiniteTokens(repaired);
    if (tolerant === null) throw new ProjectParseError([{ path: "", message: `not valid JSON (${(error as Error).message})` }]);
    try {
      json = JSON.parse(tolerant);
    } catch (retryError) {
      throw new ProjectParseError([{ path: "", message: `not valid JSON (${(retryError as Error).message})` }]);
    }
  }
  return parseProject(json, options);
}

/**
 * The project file text to save: the project with the engine's version stamp
 * (other `version` keys kept), indented like the desktop
 * (`json.dumps(data, ensure_ascii=False, indent=1)`). Unknown keys are kept.
 * Every project written to disk, storage or the network must go through
 * here: a "0.0.0" stamp makes the desktop flip clip alpha on open.
 */
export function serializeProject(project: Project): string {
  const version = isRecord(project.version) ? project.version : {};
  return JSON.stringify({ ...project, version: { ...version, ...PROJECT_FORMAT_VERSION } }, null, 1);
}

/** Fill missing top-level keys from a new project (json_data.py `merge_settings`), plus nested containers the engine reads. */
function fillDefaults(data: Data): void {
  const profileName = typeof data.profile === "string" && findProfile(data.profile) ? data.profile : undefined;
  // A missing id becomes the template id "T0", which the upgrade replaces with a fresh one.
  const defaults = createProject({ profile: profileName, id: "T0" }) as unknown as Data;
  // createProject() stamps the current format, but a file WITHOUT a version is
  // an OpenShot beta project: the desktop merges it over _default.project, whose
  // stamp is "0.0.0", and runs the beta upgrades. Keep that inference.
  if (!isRecord(data.version)) data.version = { "openshot-qt": BETA_VERSION, libopenshot: BETA_VERSION };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in data)) data[key] = value;
  }

  const history = data.history as Data;
  if (!Array.isArray(history.undo)) history.undo = [];
  if (!Array.isArray(history.redo)) history.redo = [];

  const version = data.version as Data;
  if (typeof version["openshot-qt"] !== "string") version["openshot-qt"] = BETA_VERSION;
  if (typeof version.libopenshot !== "string") version.libopenshot = BETA_VERSION;

  // The desktop treats a null override map as empty everywhere it reads it.
  if (data.export_overrides === null) data.export_overrides = {};

  for (const clip of data.clips as Data[]) {
    if (!Array.isArray(clip.effects)) clip.effects = [];
  }
}
