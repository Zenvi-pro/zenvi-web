/**
 * Zenvi FX for the Node host: the ffmpeg FX renderer with this computer's
 * media paths. Renders of a saved project go to its
 * `<project>_assets/links/zenvi-fx/` (where the desktop keeps linked
 * renders, so they travel with the project); an unsaved project's go to
 * the per-user cache. ZENVI_FX=0 turns it off; ZENVI_FX_HWACCEL=0 turns
 * off VideoToolbox decoding.
 */

import path from "node:path";
import { projectAssetsDir, type FxHost } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { createFxRenderer } from "../fx/render.js";
import { cacheDir } from "../svg/fonts.js";

export function createNodeFx(options: {
  env?: NodeJS.ProcessEnv;
  resolveMedia: (p: string) => string;
  projectFile: () => string | undefined;
  log?: (m: string) => void;
}): FxHost | undefined {
  const env = options.env ?? process.env;
  if (env.ZENVI_FX?.trim() === "0") return undefined;
  const cache = path.join(cacheDir(env), "fx");
  return createFxRenderer({
    ffmpeg: resolveBinary("ffmpeg", env),
    ffprobe: resolveBinary("ffprobe", env),
    outputDir: () => {
      const project = options.projectFile();
      return project ? path.join(projectAssetsDir(project), "links", "zenvi-fx") : cache;
    },
    lookupDirs: () => [cache],
    resolveMedia: options.resolveMedia,
    hwaccel: env.ZENVI_FX_HWACCEL?.trim() !== "0",
    log: options.log,
  });
}
