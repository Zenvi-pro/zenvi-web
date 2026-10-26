/**
 * Where the bpy scripts live: `packages/scenes3d/blender` in the monorepo,
 * `scenes3d/` next to `zenvi.mjs` in the CLI bundle (the build copies it and
 * defines `__ZENVI_BUNDLE__`), or `ZENVI_SCENES3D_DIR`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

declare const __ZENVI_BUNDLE__: boolean | undefined;

export function scriptsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ZENVI_SCENES3D_DIR?.trim();
  if (override) return override;
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (typeof __ZENVI_BUNDLE__ !== "undefined" && __ZENVI_BUNDLE__) return path.join(here, "scenes3d");
  return path.resolve(here, "..", "blender");
}
