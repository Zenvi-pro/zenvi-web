/**
 * How the desktop stores file paths in project JSON, as pure string
 * functions (zenvi-core src/classes/json_data.py L42 and L228-405,
 * src/classes/assets.py `get_assets_path` / `path_is_under`).
 *
 * Only string values of the keys in `PATH_KEYS` are rewritten, at any depth
 * (the desktop runs a regex over the whole file text, history included).
 *
 * Saving (`toStoredPath`): a path under one of the shared asset folders
 * becomes an alias (`thumbnail/<file>`, `@transitions/<category>/<file>`,
 * `@colors/<rel>`, `@emojis/<file>`, `@assets/<rel>`); a path inside the
 * project folder becomes relative to it; anything else (outside the folder,
 * another drive) stays absolute. Separators are written as `/`.
 *
 * Loading (`fromStoredPath`): aliases resolve against the given roots (left
 * as they are when a root is not given) and every other path is made
 * absolute against the project folder.
 *
 * Paths with a URL scheme (`https:`, `blob:`, `data:`…) are never rewritten;
 * the desktop has no such paths, and resolving them as files would break
 * them. Windows paths are recognised from the project folder
 * (`C:\…`, `C:/…`, `\\server\share`). Comparisons are case-sensitive on
 * every platform, like the desktop's (`os.path.commonpath(...) == root` and
 * `splitdrive` equality), so a differently cased path stays absolute.
 */

/** Keys whose string values are paths (json_data.py L42). */
export const PATH_KEYS: readonly string[] = ["image", "path", "resource", "protobuf_data_path", "lut_path"];
const PATH_KEY_SET = new Set(PATH_KEYS);

/**
 * Folders the aliases stand for. Desktop values in comments; hosts pass
 * their own (the engine's `assets/transitions` for `@transitions`).
 */
export interface PathRoots {
  /** `@transitions/<category>/<file>` — desktop `<app>/transitions`. */
  transitions?: string;
  /** `@emojis/<file>` — desktop `<app>/emojis/color/svg`. */
  emojis?: string;
  /** `@colors/<rel>` (LUTs) — desktop `<app>/colors`. */
  colors?: string;
  /** `@assets/<rel>` — the project's `<name>_assets` folder (`projectAssetsDir`). */
  assets?: string;
  /** Saved as `thumbnail/<file>` — desktop `info.THUMBNAIL_PATH`. Only used when storing. */
  thumbnails?: string;
}

type AliasName = "transitions" | "emojis" | "colors" | "assets";
const ALIASES: readonly AliasName[] = ["transitions", "colors", "emojis", "assets"];

// ---------------------------------------------------------------------------
// Minimal posixpath / ntpath
// ---------------------------------------------------------------------------

interface PathOps {
  readonly sep: string;
  splitRoot(p: string): { drive: string; root: string; rest: string };
  normalize(p: string): string;
  join(a: string, b: string): string;
}

/** posixpath.normpath. */
function posixNormalize(path: string): string {
  if (path === "") return ".";
  let initialSlashes = path.startsWith("/") ? 1 : 0;
  // POSIX keeps exactly two leading slashes; three or more collapse to one.
  if (initialSlashes && path.startsWith("//") && !path.startsWith("///")) initialSlashes = 2;
  const comps: string[] = [];
  for (const comp of path.split("/")) {
    if (comp === "" || comp === ".") continue;
    if (comp !== ".." || (!initialSlashes && comps.length === 0) || (comps.length > 0 && comps[comps.length - 1] === "..")) {
      comps.push(comp);
    } else if (comps.length > 0) {
      comps.pop();
    }
  }
  const joined = "/".repeat(initialSlashes) + comps.join("/");
  return joined || ".";
}

const posix: PathOps = {
  sep: "/",
  splitRoot(p) {
    return p.startsWith("/") ? { drive: "", root: "/", rest: p.replace(/^\/+/, "") } : { drive: "", root: "", rest: p };
  },
  normalize: posixNormalize,
  join(a, b) {
    if (b.startsWith("/")) return b;
    if (a === "" || a.endsWith("/")) return a + b;
    return `${a}/${b}`;
  },
};

/** ntpath.splitroot for drive-letter and UNC paths (separators already `\`). */
function winSplitRoot(input: string): { drive: string; root: string; rest: string } {
  const p = input.replace(/\//g, "\\");
  if (p.startsWith("\\\\") && p[2] !== "\\") {
    // UNC: \\server\share
    const server = p.indexOf("\\", 2);
    if (server === -1) return { drive: p, root: "", rest: "" };
    const share = p.indexOf("\\", server + 1);
    if (share === -1) return { drive: p, root: "", rest: "" };
    return { drive: p.slice(0, share), root: "\\", rest: p.slice(share + 1) };
  }
  if (/^[A-Za-z]:/.test(p)) {
    const root = p[2] === "\\" ? "\\" : "";
    return { drive: p.slice(0, 2), root, rest: p.slice(2 + root.length) };
  }
  if (p.startsWith("\\")) return { drive: "", root: "\\", rest: p.slice(1) };
  return { drive: "", root: "", rest: p };
}

const win32: PathOps = {
  sep: "\\",
  splitRoot: winSplitRoot,
  /** ntpath.normpath. */
  normalize(path) {
    const { drive, root, rest } = winSplitRoot(path);
    const comps = rest.split("\\");
    let i = 0;
    while (i < comps.length) {
      const comp = comps[i]!;
      if (comp === "" || comp === ".") comps.splice(i, 1);
      else if (comp === "..") {
        if (i > 0 && comps[i - 1] !== "..") {
          comps.splice(i - 1, 2);
          i -= 1;
        } else if (i === 0 && root) comps.splice(i, 1);
        else i += 1;
      } else i += 1;
    }
    const prefix = drive + root;
    if (!prefix && comps.length === 0) comps.push(".");
    return prefix + comps.join("\\");
  },
  /** ntpath.join for two parts. */
  join(a, b) {
    const first = winSplitRoot(a);
    const root = first.root;
    let { drive, rest } = first;
    const next = winSplitRoot(b);
    if (next.root) {
      if (next.drive || !drive) drive = next.drive;
      return drive + next.root + next.rest;
    }
    if (next.drive && next.drive !== drive) {
      if (next.drive.toLowerCase() !== drive.toLowerCase()) return next.drive + next.root + next.rest;
      drive = next.drive;
    }
    if (rest && !rest.endsWith("\\")) rest += "\\";
    rest += next.rest;
    if (rest && !root && drive && !drive.endsWith(":") && !drive.endsWith("\\")) return `${drive}\\${rest}`;
    return drive + root + rest;
  },
};

function opsFor(projectDir: string): PathOps {
  return /^[A-Za-z]:[\\/]/.test(projectDir) || projectDir.startsWith("\\\\") ? win32 : posix;
}

function isAbsolute(ops: PathOps, p: string): boolean {
  const { drive, root } = ops.splitRoot(p);
  if (ops === posix) return root === "/";
  return (Boolean(drive) && Boolean(root)) || drive.startsWith("\\\\");
}

/** os.path.split: (head, tail) around the last separator. */
function split(ops: PathOps, p: string): { head: string; tail: string } {
  const { drive, root, rest } = ops.splitRoot(p);
  const cut = rest.lastIndexOf(ops.sep) + 1;
  const head = rest.slice(0, cut).replace(ops === posix ? /\/+$/ : /\\+$/, "");
  return { head: drive + root + head, tail: rest.slice(cut) };
}

function components(ops: PathOps, p: string): { drive: string; parts: string[] } {
  const { drive, rest } = ops.splitRoot(ops.normalize(p));
  return { drive, parts: rest.split(ops.sep).filter((part) => part !== "" && part !== ".") };
}

/** assets.py `path_is_under`: `path` is `root` or inside it. Both absolute. */
function isUnder(ops: PathOps, path: string, root: string): boolean {
  const p = components(ops, path);
  const r = components(ops, root);
  if (p.drive !== r.drive || r.parts.length > p.parts.length) return false;
  return r.parts.every((part, i) => part === p.parts[i]);
}

/** `os.path.relpath(path, start)` with `/` separators. Both absolute, same drive. */
function relative(ops: PathOps, start: string, path: string): string {
  const s = components(ops, start).parts;
  const p = components(ops, path).parts;
  let i = 0;
  while (i < s.length && i < p.length && s[i] === p[i]) i += 1;
  const rel = [...Array<string>(s.length - i).fill(".."), ...p.slice(i)];
  return rel.length === 0 ? "." : rel.join("/");
}

function forwardSlashes(ops: PathOps, p: string): string {
  return ops === win32 ? p.replace(/\\/g, "/") : p;
}

/** A URL or URI with a scheme of two or more characters (so `C:` is not one). */
function hasScheme(p: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]+:/.test(p);
}

function matchAlias(p: string): { name: AliasName; rest: string } | null {
  for (const name of ALIASES) {
    const token = `@${name}`;
    if (!p.startsWith(token)) continue;
    const after = p.slice(token.length);
    if (after === "" || after.startsWith("/") || after.startsWith("\\")) return { name, rest: after.replace(/^[\\/]+/, "") };
  }
  return null;
}

function requireAbsoluteDir(ops: PathOps, projectDir: string): void {
  if (!isAbsolute(ops, projectDir)) throw new TypeError(`projectDir must be an absolute path: ${projectDir}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The form the desktop saves `path` in (json_data.py
 * `replace_string_to_relative`). `projectDir` is the folder of the project
 * file, absolute.
 */
export function toStoredPath(path: string, projectDir: string, roots: PathRoots = {}): string {
  const ops = opsFor(projectDir);
  requireAbsoluteDir(ops, projectDir);
  if (path === "" || hasScheme(path) || matchAlias(path)) return path;

  const abs = ops.normalize(isAbsolute(ops, path) ? path : ops.join(projectDir, path));
  const { head: folder, tail: file } = split(ops, abs);
  // The desktop matches the alias folders against the file's folder.
  const under = (root: string | undefined): root is string => Boolean(root) && isUnder(ops, folder, root!);

  if (under(roots.thumbnails)) return `thumbnail/${file}`;
  if (under(roots.transitions)) return `@transitions/${relative(ops, roots.transitions, abs)}`;
  if (under(roots.colors)) return `@colors/${relative(ops, roots.colors, abs)}`;
  if (under(roots.emojis)) return `@emojis/${relative(ops, roots.emojis, abs)}`;
  if (under(roots.assets)) return `@assets/${relative(ops, roots.assets, abs)}`;

  // Another drive, or outside the project folder: keep it absolute so moving
  // the project file does not break the reference.
  if (ops.splitRoot(abs).drive !== ops.splitRoot(projectDir).drive || !isUnder(ops, abs, projectDir)) {
    return forwardSlashes(ops, abs);
  }
  return relative(ops, projectDir, abs);
}

/**
 * The absolute form of a stored path (json_data.py
 * `replace_string_to_absolute`). Aliases whose root is not given are
 * returned unchanged.
 */
export function fromStoredPath(path: string, projectDir: string, roots: PathRoots = {}): string {
  const ops = opsFor(projectDir);
  requireAbsoluteDir(ops, projectDir);
  if (path === "") return "";
  const alias = matchAlias(path);
  if (alias) {
    const root = roots[alias.name];
    return root ? ops.normalize(alias.rest ? ops.join(root, alias.rest) : root) : path;
  }
  if (hasScheme(path)) return path;
  return ops.normalize(ops.join(projectDir, path));
}

function rewritePaths<T>(project: T, rewrite: (path: string) => string): T {
  const copy = structuredClone(project);
  const stack: unknown[] = [copy];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) if (typeof item === "object" && item !== null) stack.push(item);
    } else if (typeof node === "object" && node !== null) {
      const record = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === "string") {
          if (PATH_KEY_SET.has(key)) record[key] = rewrite(value);
        } else if (typeof value === "object" && value !== null) {
          stack.push(value);
        }
      }
    }
  }
  return copy;
}

/** A copy of `project` with every path in its stored form (see `toStoredPath`). */
export function toStoredPaths<T>(project: T, projectDir: string, roots: PathRoots = {}): T {
  requireAbsoluteDir(opsFor(projectDir), projectDir);
  return rewritePaths(project, (path) => toStoredPath(path, projectDir, roots));
}

/** A copy of `project` with every stored path made absolute (see `fromStoredPath`). */
export function fromStoredPaths<T>(project: T, projectDir: string, roots: PathRoots = {}): T {
  requireAbsoluteDir(opsFor(projectDir), projectDir);
  return rewritePaths(project, (path) => fromStoredPath(path, projectDir, roots));
}

/**
 * The project's assets folder (assets.py `get_assets_path`): next to the
 * project file, named after it (at most 248 characters) plus `_assets`, e.g.
 * `/videos/Trip.zvn` → `/videos/Trip_assets`.
 */
export function projectAssetsDir(projectFilePath: string): string {
  const ops = opsFor(projectFilePath);
  const { head: dir, tail: name } = split(ops, projectFilePath);
  // os.path.splitext: split at the last dot unless it is part of the leading dots.
  const leadingDots = /^\.*/.exec(name)![0].length;
  const dot = name.lastIndexOf(".");
  const stem = dot >= leadingDots ? name.slice(0, dot) : name;
  const folder = `${Array.from(stem).slice(0, 248).join("")}_assets`;
  return dir ? ops.join(dir, folder) : folder;
}
