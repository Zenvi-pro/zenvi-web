/**
 * Project path → local file, for cloud renders and frame previews.
 *
 * Renderers ask for media by the path stored in the project (a file's
 * `path`, a clip's `reader.path`, an `@transitions/…` asset). In Zenvi Cloud
 * the bytes of project files live content-addressed in blob storage, so a
 * path is mapped back to its project file, then to the file's sha256 and a
 * download; built-in assets come from the renderer's asset folder.
 */

import type { Project, ProjectFile } from "@zenvi/engine";
import { displayName, fileSha256 } from "../projects/model.js";
import type { PathResolver } from "./renderer.js";

export interface ResolveDeps {
  /** Local path of a project file's bytes (downloaded or cached). */
  fetchFile(file: ProjectFile, sha256: string): Promise<string>;
  /** Built-in assets (`@transitions/…`), when this build ships them. */
  resolveAsset?: (projectPath: string) => string | undefined;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Project files by every path the project uses for them: `file.path` and clips' `reader.path`. */
export function filesByPath(project: Project): Map<string, ProjectFile> {
  const byPath = new Map<string, ProjectFile>();
  for (const file of project.files) if (typeof file.path === "string") byPath.set(file.path, file);
  const byId = new Map(project.files.map((file) => [file.id, file]));
  for (const clip of project.clips) {
    const readerPath = clip.reader?.path;
    const file = byId.get(clip.file_id);
    if (typeof readerPath === "string" && file && !byPath.has(readerPath)) byPath.set(readerPath, file);
  }
  return byPath;
}

export function projectPathResolver(project: Project, deps: ResolveDeps): PathResolver {
  const byPath = filesByPath(project);
  return async (projectPath) => {
    // A bin file can point at a bundled asset (an emoji sticker is `@emojis/<file>`, as the desktop
    // stores it): those bytes ship with the renderer, so they need no upload.
    if (projectPath.startsWith("@")) {
      const bundled = deps.resolveAsset?.(projectPath);
      if (bundled) return bundled;
    }
    const file = byPath.get(projectPath);
    if (file) {
      const sha = fileSha256(file);
      if (!sha) throw new Error(`"${displayName(file)}" is not in Zenvi Cloud. Upload it, then try again.`);
      return deps.fetchFile(file, sha);
    }
    const asset = deps.resolveAsset?.(projectPath);
    if (asset) return asset;
    throw new Error(`"${baseName(projectPath)}" is not in Zenvi Cloud.`);
  };
}
