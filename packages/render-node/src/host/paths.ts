/**
 * Node-side path helpers around the engine's stored-path rules
 * (`@zenvi/engine` io/paths.ts, the port of the desktop's json_data.py):
 * which roots the Node host passes, how a path in memory resolves to a file
 * on disk at render time, and a traversal for rewriting every path key.
 *
 * In memory, local media are absolute (like the desktop) while the portable
 * aliases `@transitions/`, `@emojis/`, `@colors/` stay as they are: the
 * engine and the web editor use them as-is, and the resolver maps them to
 * the bundled assets.
 */

import path from "node:path";
import { fromStoredPath, PATH_KEYS, projectAssetsDir, type PathRoots } from "@zenvi/engine";

const PATH_KEY_SET = new Set(PATH_KEYS);
const PORTABLE_ALIASES = ["@transitions", "@emojis", "@colors"];

/** `@transitions/…`, `@emojis/…` or `@colors/…`: resolved against bundled assets, never rewritten. */
export function isPortableAssetPath(value: string): boolean {
  return PORTABLE_ALIASES.some((alias) => value === alias || value.startsWith(`${alias}/`) || value.startsWith(`${alias}\\`));
}

/** Bundled engine asset folders as the engine's alias roots. */
export function engineAssetRoots(engineAssetsDir: string | undefined): PathRoots {
  if (!engineAssetsDir) return {};
  return {
    transitions: path.join(engineAssetsDir, "transitions"),
    emojis: path.join(engineAssetsDir, "emojis"),
    colors: path.join(engineAssetsDir, "colors"),
  };
}

/** Roots for saving `projectFile`: aliases for the bundled assets and the project's `_assets` folder. */
export function storeRoots(projectFile: string, engineAssetsDir: string | undefined): PathRoots {
  return { ...engineAssetRoots(engineAssetsDir), assets: projectAssetsDir(projectFile) };
}

/** Roots for loading `projectFile`: only `@assets` resolves (portable aliases stay aliases in memory). */
export function loadRoots(projectFile: string): PathRoots {
  return { assets: projectAssetsDir(projectFile) };
}

/** True when `child` is `parent` or inside it (local file-system semantics). */
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** A copy of `value` with `convert` applied to every path key (engine `PATH_KEYS`), at any depth. */
export function mapPathValues<T>(value: T, convert: (p: string) => string): T {
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(v as Record<string, unknown>)) {
        out[key] = PATH_KEY_SET.has(key) && typeof inner === "string" ? convert(inner) : visit(inner);
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
}

/** Map a path as held in memory to a local file (renderers, probes, audio analysis). */
export function createMediaResolver(options: ResolverOptions): (value: string) => string {
  const roots = engineAssetRoots(options.engineAssetsDir);
  return (value: string) => {
    if (options.projectFile) {
      const projectDir = path.dirname(path.resolve(options.projectFile));
      return fromStoredPath(value, projectDir, { ...roots, assets: projectAssetsDir(path.resolve(options.projectFile)) });
    }
    return fromStoredPath(value, process.cwd(), roots);
  };
}
