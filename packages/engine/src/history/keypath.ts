/**
 * OpenShot key paths.
 *
 * A key path addresses a value inside the project, e.g.
 * `["clips", { id: "4H5AEUDLOT" }, "effects"]`. String parts index objects
 * (case-insensitive, like zenvi-core `ProjectDataStore.get`); object parts
 * select the first list item whose fields all equal the given values.
 *
 * Ported from zenvi-core src/classes/project_data.py `get` / `_set`.
 */

export type KeyMatch = Record<string, string | number | boolean>;
export type KeyPart = string | KeyMatch;
export type KeyPath = KeyPart[];

type Container = Record<string, unknown> | unknown[];

export interface ResolvedKey {
  /** The object or list that holds the addressed value. */
  parent: Container;
  /** Index into `parent` (number for lists, string for objects). */
  slot: string | number;
  /** The addressed value. */
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findKey(obj: Record<string, unknown>, part: string): string | undefined {
  if (part in obj) return part;
  const lower = part.toLowerCase();
  if (lower in obj) return lower;
  return Object.keys(obj).find((k) => k.toLowerCase() === lower);
}

function matches(item: unknown, match: KeyMatch): boolean {
  if (!isRecord(item)) return false;
  for (const [k, v] of Object.entries(match)) {
    const key = findKey(item, k);
    if (key === undefined || item[key] !== v) return false;
  }
  return true;
}

/**
 * Resolve every part of `path`. Returns `undefined` when any part is missing.
 * An empty path resolves to nothing (the root has no parent slot).
 */
export function resolveKey(root: Record<string, unknown>, path: KeyPath): ResolvedKey | undefined {
  if (path.length === 0) return undefined;
  let parent: Container = root;
  let slot: string | number = "";
  let value: unknown = root;
  for (const part of path) {
    if (typeof part === "string") {
      if (!isRecord(value)) return undefined;
      const key = findKey(value, part);
      if (key === undefined) return undefined;
      parent = value;
      slot = key;
      value = value[key];
    } else {
      if (!Array.isArray(value)) return undefined;
      const index = value.findIndex((item) => matches(item, part));
      if (index < 0) return undefined;
      parent = value;
      slot = index;
      value = value[index];
    }
  }
  return { parent, slot, value };
}

/**
 * `path` spelled the way `root` stores it: each string part and match field
 * as the key it resolves to (lookups are case-insensitive). `undefined` when
 * any part is missing.
 */
export function storedKey(root: Record<string, unknown>, path: KeyPath): KeyPath | undefined {
  const out: KeyPath = [];
  let value: unknown = root;
  for (const part of path) {
    if (typeof part === "string") {
      const key = isRecord(value) ? findKey(value, part) : undefined;
      if (key === undefined) return undefined;
      out.push(key);
      value = (value as Record<string, unknown>)[key];
    } else {
      const item = Array.isArray(value) ? value.find((i) => matches(i, part)) : undefined;
      if (item === undefined) return undefined;
      out.push(Object.fromEntries(Object.entries(part).map(([k, v]) => [findKey(item as Record<string, unknown>, k)!, v])));
      value = item;
    }
  }
  return out;
}

/** Read the value at `path`, or `undefined`. */
export function getAt(root: Record<string, unknown>, path: KeyPath): unknown {
  return resolveKey(root, path)?.value;
}

/** True when both paths address the same location (string parts compare case-insensitively). */
export function sameKey(a: KeyPath, b: KeyPath): boolean {
  if (a.length !== b.length) return false;
  return a.every((part, i) => {
    const other = b[i];
    if (typeof part === "string") {
      return typeof other === "string" && part.toLowerCase() === other.toLowerCase();
    }
    if (typeof other !== "object" || other === null) return false;
    const ak = Object.keys(part);
    const bk = Object.keys(other);
    return ak.length === bk.length && ak.every((k) => part[k] === (other as KeyMatch)[k]);
  });
}

export function formatKey(path: KeyPath): string {
  return path
    .map((part) =>
      typeof part === "string"
        ? part
        : `{${Object.entries(part)
            .map(([k, v]) => `${k}:${String(v)}`)
            .join(",")}}`,
    )
    .join("/");
}
