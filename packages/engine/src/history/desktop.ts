/**
 * One engine transaction as the calls zenvi-core's UpdateManager makes
 * (`insert` / `update` / `delete`), for the engine bridge: the desktop runs a
 * tool here and replays the result as one undo step (docs/ENGINE_BRIDGE.md).
 *
 * The desktop applies each call through `ProjectDataStore._set`
 * (src/classes/project_data.py:220), whose rules differ from
 * ProjectDocument's:
 *
 * - String key parts and match fields are lower-cased before lookup, so a
 *   field stored under an upper-case name cannot be addressed, however the
 *   engine spelled it (engine lookups ignore case).
 * - An update with a non-object value at a nested key writes the *root* key
 *   of that name (`self._data[my_key] = values`); an object value is always
 *   merged (`obj.update`), with `objects` maps merged per id.
 * - Inserts append to top-level lists only.
 *
 * Every action the desktop would apply differently is sent instead as an
 * update of the nearest addressable object above it, carrying the value the
 * engine left there (`{ [name]: value }` merges exactly one field). The
 * actions are replayed on a scratch document to read those values. What
 * cannot be expressed at all is refused before the desktop changes anything.
 *
 * Untracked changes (`ProjectDocument.setUntracked`: cached transcripts, the
 * saved playhead, export overrides) follow the same rules and are sent as
 * `update_untracked`, which the desktop applies without an undo step.
 */

import type { Project } from "../model/types.js";
import { ProjectDocument, type UpdateAction } from "./document.js";
import { formatKey, getAt, storedKey, type KeyPath } from "./keypath.js";

export interface DesktopAction {
  /** `update_untracked`: UpdateManager.update_untracked, an update outside the undo history. */
  type: "insert" | "update" | "delete" | "update_untracked";
  key: KeyPath;
  /** Inserted item or update values; absent for delete. */
  value?: unknown;
}

export class DesktopActionError extends Error {
  constructor(
    message: string,
    readonly key: KeyPath,
  ) {
    super(message);
    this.name = "DesktopActionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const lowerCase = (k: string): boolean => k === k.toLowerCase();

/**
 * Whether `_set` finds `key` in `project`: every part and match field is
 * stored under a lower-case name, and match fields are written lower-case too
 * (`_set` reads `key_part[subkey.lower()]`).
 */
function addressable(project: Project, key: KeyPath): boolean {
  if (!key.every((part) => typeof part === "string" || Object.keys(part).every(lowerCase))) return false;
  const stored = storedKey(project as unknown as Record<string, unknown>, key) ?? key;
  return stored.every((part) => (typeof part === "string" ? lowerCase(part) : Object.keys(part).every(lowerCase)));
}

/** The desktop's merge gives the engine's result: every old field is overwritten, and no `objects` map is merged per id. */
function mergeMatches(old: unknown, value: unknown, replace: boolean): boolean {
  if (!isRecord(old) || !isRecord(value)) return false;
  if (isRecord(old.objects) && isRecord(value.objects)) return false;
  return !replace || Object.keys(old).every((k) => k in value);
}

/**
 * The action as is, when the desktop applies it exactly like the engine did;
 * a replaced item of a top-level list as delete + insert (it moves to the
 * end of the list, which nothing keyed by id depends on).
 */
function direct(action: UpdateAction, replace: boolean, before: Project): DesktopAction[] | undefined {
  const { key, type, value } = action;
  if (!addressable(before, key)) return undefined;
  if (type === "insert") return key.length === 1 ? [{ type, key, value }] : undefined;
  if (type === "delete") return key.length >= 2 ? [{ type, key }] : undefined;
  if (mergeMatches(action.old_values, value, replace)) return [{ type: "update", key, value }];
  if (key.length === 1 && !isRecord(value)) return [{ type: "update", key, value }];
  if (key.length === 2 && typeof key[1] === "object" && isRecord(value) && value.id === key[1].id) {
    return [{ type: "delete", key }, { type: "insert", key: key.slice(0, 1), value }];
  }
  return undefined;
}

/**
 * The update that leaves the deepest addressable field on `key`'s path as
 * `now` holds it: `{ [name]: value }` on its parent, or the root key itself.
 */
function lifted(key: KeyPath, before: Project, now: Project): DesktopAction {
  for (let n = key.length; n >= 1; n -= 1) {
    const field = key.slice(0, n);
    // The field as the project stores it: `{ [name]: value }` must merge into that field, not a new spelling of it.
    const name = (storedKey(now as unknown as Record<string, unknown>, field) ?? field)[n - 1];
    if (typeof name !== "string" || !addressable(now, field)) continue;
    const value = getAt(now as unknown as Record<string, unknown>, field);
    if (value === undefined) continue;
    if (n === 1) {
      if (!isRecord(value) || mergeMatches(getAt(before as unknown as Record<string, unknown>, field), value, true)) return { type: "update", key: field, value };
      break;
    }
    // A parent update holding `objects` would be merged per id again.
    if (name === "objects" && isRecord(value)) continue;
    return { type: "update", key: field.slice(0, -1), value: { [name]: value } };
  }
  throw new DesktopActionError(`the desktop cannot apply this change to ${formatKey(key)}`, key);
}

/**
 * Translate one transaction (`ChangeEvent.previous`, `.actions`,
 * `.replaced`) into desktop UpdateManager calls, in order. Throws
 * DesktopActionError when one cannot be expressed.
 */
export function toDesktopActions(previous: Project, actions: readonly UpdateAction[], replaced: readonly boolean[] = []): DesktopAction[] {
  const scratch = new ProjectDocument(previous, { historyLimit: 0 });
  const out: DesktopAction[] = [];
  scratch.transaction("bridge", (tx) => {
    actions.forEach((action, i) => {
      const { key } = action;
      const root = typeof key[0] === "string" ? key[0].toLowerCase() : undefined;
      if (root === "history") throw new DesktopActionError("the desktop keeps its own undo history", key);
      // The desktop rescales every clip when fps changes (ProjectDataStore.changed); the engine already did.
      // A change inside `fps` is lifted to an update of `fps` itself, so it is refused too.
      if (root === "fps") throw new DesktopActionError("changing the frame rate is the desktop's own operation", key);
      const replace = replaced[i] === true;
      const before = tx.project;
      if (action.type === "insert") tx.insert(key, action.value);
      else if (action.type === "delete") tx.delete(key);
      else if (action.type === "update") (replace ? tx.replace : tx.update)(key, action.value);
      else throw new DesktopActionError(`a ${action.type} action has no desktop form`, key);
      out.push(...(direct(action, replace, before) ?? [lifted(key, before, tx.project)]));
    });
  });
  return out;
}

/**
 * Translate one untracked change (`ChangeEvent.previous`, `.project`,
 * `.untracked`) into `update_untracked` calls. The desktop has no untracked
 * insert or delete, so a change that needs one is refused.
 */
export function toDesktopUntracked(previous: Project, project: Project, key: KeyPath): DesktopAction[] {
  const at = (p: Project) => getAt(p as unknown as Record<string, unknown>, key);
  const write: UpdateAction = { type: "update", key, value: at(project), old_values: at(previous), transaction: "untracked" };
  return toDesktopActions(previous, [write], [true]).map((action) => {
    if (action.type !== "update") throw new DesktopActionError(`the desktop cannot change ${formatKey(key)} without an undo step`, key);
    return { ...action, type: "update_untracked" };
  });
}
