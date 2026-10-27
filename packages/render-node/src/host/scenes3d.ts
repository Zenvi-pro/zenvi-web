/**
 * Zenvi 3D for the Node host: the Blender renderer of @zenvi/scenes3d with
 * this computer's media paths, fonts and ffmpeg. Only offered when Blender
 * is installed (ZENVI_BLENDER, PATH or the usual folders), so hosts without
 * it do not list the 3D tools. ZENVI_SCENES3D=0 turns it off.
 */

import path from "node:path";
import { createScene3dRenderer, findBlender, type Scene3dRenderer } from "@zenvi/scenes3d";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { bundledFontsDir } from "../resources.js";
import { cacheDir, sharedFontIndex } from "../svg/fonts.js";

/** Default title faces, heaviest look first (the bundled Lato last). */
const TITLE_FAMILIES = ["Arial Black", "Inter", "SF Pro Display", "Helvetica Neue", "Montserrat", "Roboto", "DejaVu Sans", "Liberation Sans", "Arial"];

/** Prefer a heavy upright face in a single-font file (Blender loads the first face of a collection). */
function faceScore(file: string): number {
  const name = path.basename(file).toLowerCase();
  let score = /\.(ttc|otc)$/.test(name) ? -4 : 0;
  if (/black|heavy/.test(name)) score += 3;
  else if (/extrabold|ultrabold/.test(name)) score += 2.5;
  else if (/bold/.test(name)) score += 2;
  if (/italic|oblique/.test(name)) score -= 3;
  return score;
}

export async function resolveTitleFont(family: string | undefined): Promise<string | undefined> {
  const index = await sharedFontIndex();
  for (const f of family ? [family] : TITLE_FAMILIES) {
    const files = index.files(f);
    if (files.length > 0) return [...files].sort((a, b) => faceScore(b) - faceScore(a))[0];
  }
  return family ? undefined : path.join(bundledFontsDir(), "Lato-Regular.ttf");
}

export function createNodeScenes3d(options: { env?: NodeJS.ProcessEnv; resolveMedia: (p: string) => string; log?: (m: string) => void }): Scene3dRenderer | undefined {
  const env = options.env ?? process.env;
  if (env.ZENVI_SCENES3D?.trim() === "0") return undefined;
  const blender = findBlender(env);
  if (!blender) return undefined;
  return createScene3dRenderer({
    blender,
    cacheDir: cacheDir(env),
    ffmpeg: resolveBinary("ffmpeg", env),
    resolveMedia: options.resolveMedia,
    resolveFont: resolveTitleFont,
    env,
    log: options.log,
  });
}
