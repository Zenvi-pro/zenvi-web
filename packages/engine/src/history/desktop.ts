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
 *   key with an upper-case part cannot be addressed.
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
 */

import type { Project } from "../model/types.js";
import { ProjectDocument, type UpdateAction } from "./document.js";
import { formatKey, getAt, type KeyPath } from "./keypath.js";

export interface DesktopAction {
  type: "insert" | "update" | "delete";
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

function addressable(key: KeyPath): boolean {
  return key.every((part) => (typeof part === "string" ? part === part.toLowerCase() : Object.keys(part).every((k) => k === k.toLowerCase())));
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
function direct(action: UpdateAction, replace: boolean): DesktopAction[] | undefined {
  const { key, type, value } = action;
  if (!addressable(key)) return undefined;
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
    const name = field[n - 1];
    if (typeof name !== "string" || !addressable(field)) continue;
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
      if (key[0] === "history") throw new DesktopActionError("the desktop keeps its own undo history", key);
      // The desktop rescales every clip when fps changes (ProjectDataStore.changed); the engine already did.
      if (key.length === 1 && key[0] === "fps") throw new DesktopActionError("changing the frame rate is the desktop's own operation", key);
      const replace = replaced[i] === true;
      const before = tx.project;
      if (action.type === "insert") tx.insert(key, action.value);
      else if (action.type === "delete") tx.delete(key);
      else if (action.type === "update") (replace ? tx.replace : tx.update)(key, action.value);
      else throw new DesktopActionError(`a ${action.type} action has no desktop form`, key);
      out.push(...(direct(action, replace) ?? [lifted(key, before, tx.project)]));
    });
  });
  return out;
}
