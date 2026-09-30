/**
 * Project file paths, desktop style.
 *
 * zenvi-core stores media paths relative to the project on save and resolves
 * them on open (src/classes/json_data.py `convert_paths_to_relative` /
 * `convert_paths_to_absolute`, L287-400). Only these keys are rewritten,
 * anywhere in the document (history included): image, path, resource,
 * protobuf_data_path, lut_path.
 *
 * In memory the Node host keeps local media absolute (like the desktop) but
 * leaves the portable asset prefixes `@transitions/`, `@emojis/`, `@colors/`
 * as they are: the engine and the web editor use them as-is, and the media
 * resolver maps them to the bundled assets at render time.
 */

import nodePath from "node:path";

export const PATH_KEYS = new Set(["image", "path", "resource", "protobuf_data_path", "lut_path"]);

type PathApi = typeof nodePath.posix;

/** `<dir>/<stem[:248]>_assets` (zenvi-core src/classes/assets.py `get_assets_path`). */
export function assetsDirFor(projectFile: string, p: PathApi = nodePath): string {
  const stem = p.basename(projectFile, p.extname(projectFile)).slice(0, 248);
  return p.join(p.dirname(projectFile), `${stem}_assets`);
}

/** assets.py `path_is_under`: true when `child` is `parent` or inside it. */
export function pathIsUnder(child: string, parent: string, p: PathApi = nodePath): boolean {
  const rel = p.relative(p.resolve(parent), p.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
}

const PORTABLE_PREFIXES = ["@transitions", "@emojis", "@colors"];

export function isPortableAssetPath(value: string): boolean {
  return PORTABLE_PREFIXES.some((prefix) => value.startsWith(`${prefix}/`) || value === prefix);
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^[a-z]:[\\/]/i.test(value);
}

export interface PathContext {
  /** Absolute path of the .zvn file. */
  projectFile: string;
  /** Where the bundled engine assets live (transitions, emojis), for recognising them on save. */
  engineAssetsDir?: string;
  pathApi?: PathApi;
}

/** Open: relative and `@assets/` paths become absolute (json_data.py `replace_string_to_absolute`). */
export function toAbsolutePath(value: string, ctx: PathContext): string {
  const p = ctx.pathApi ?? nodePath;
  if (value === "" || isUrl(value) || isPortableAssetPath(value)) return value;
  if (value.includes("@assets")) {
    return p.normalize(value.replace("@assets", assetsDirFor(ctx.projectFile, p)));
  }
  return p.resolve(p.dirname(ctx.projectFile), value);
}

function splitDrive(value: string, p: PathApi): string {
  if (p.sep !== "\\") return "";
  const m = /^([a-zA-Z]:|\\\\[^\\]+\\[^\\]+)/.exec(value);
  return m ? m[1]!.toLowerCase() : "";
}

/** Save: the desktop's relative form (json_data.py `replace_string_to_relative`). */
export function toStoredPath(value: string, ctx: PathContext): string {
  const p = ctx.pathApi ?? nodePath;
  if (value === "" || isUrl(value) || isPortableAssetPath(value) || value.startsWith("@assets/")) return value;
  const projectFolder = p.dirname(ctx.projectFile);
  const abs = p.isAbsolute(value) ? p.normalize(value) : p.normalize(p.join(projectFolder, value));
  const folder = p.dirname(abs);
  const file = p.basename(abs);
  const slash = (s: string) => s.replace(/\\/g, "/");

  const engine = ctx.engineAssetsDir;
  if (engine) {
    const transitions = p.join(engine, "transitions");
    if (pathIsUnder(abs, transitions, p)) return slash(p.join("@transitions", p.relative(transitions, abs)));
    const emojis = p.join(engine, "emojis");
    if (pathIsUnder(abs, emojis, p)) return `@emojis/${file}`;
    const colors = p.join(engine, "colors");
    if (pathIsUnder(abs, colors, p)) return slash(`@colors/${p.relative(colors, abs)}`);
  }
  const assets = assetsDirFor(ctx.projectFile, p);
  if (pathIsUnder(folder, assets, p)) return slash(p.join("@assets", p.relative(assets, abs)));

  if (splitDrive(abs, p) !== splitDrive(projectFolder, p)) return slash(abs);
  // Keep paths outside the project folder absolute so moving the .zvn does
  // not break external media references.
  if (!pathIsUnder(abs, projectFolder, p)) return slash(abs);
  const relFolder = p.relative(projectFolder, folder);
  return slash(relFolder === "" || relFolder === "." ? file : p.join(relFolder, file));
}

/** Apply `convert` to every path key in a JSON value, returning a converted deep copy. */
export function mapPaths<T>(value: T, convert: (path: string) => string): T {
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(v as Record<string, unknown>)) {
        out[key] = PATH_KEYS.has(key) && typeof inner === "string" ? convert(inner) : visit(inner);
      }
      return out;
    }
    return v;
  };
  return visit(value) as T;
}

export interface ResolverOptions {
  /** The open project file (relative and `@assets` paths resolve against it). */
  projectFile?: string;
  engineAssetsDir?: string;
  /** Desktop user folder (`~/.openshot_qt`), where user transitions/emojis live. */
  userDataDir?: string;
}

/**
 * Map a path as stored in memory to a local file: absolute paths as-is,
 * `@transitions/…` to the bundled transitions, relative paths against the
 * project folder.
 */
export function createMediaResolver(options: ResolverOptions): (value: string) => string {
  return (value: string) => {
    if (value.startsWith("@transitions/") && options.engineAssetsDir) {
      return nodePath.join(options.engineAssetsDir, "transitions", value.slice("@transitions/".length));
    }
    if (value.startsWith("@emojis/") && options.engineAssetsDir) {
      return nodePath.join(options.engineAssetsDir, "emojis", value.slice("@emojis/".length));
    }
    if (value.startsWith("@colors/") && options.engineAssetsDir) {
      return nodePath.join(options.engineAssetsDir, "colors", value.slice("@colors/".length));
    }
    if (options.projectFile) return toAbsolutePath(value, { projectFile: options.projectFile });
    return nodePath.resolve(value);
  };
}
