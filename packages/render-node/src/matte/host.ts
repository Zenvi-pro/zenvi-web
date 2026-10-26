/**
 * `MatteHost` for Node: mattes written next to the project's other assets
 * (`<project>_assets/mattes/`), or a scratch folder for an unsaved project.
 */

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectAssetsDir, type ImportedMedia, type MatteHost } from "@zenvi/engine";
import { uniquePath } from "../host/media.js";
import { fingerprint } from "../probe/fingerprint.js";
import { probe } from "../probe/probe.js";
import { generateMatteVideo } from "./generate.js";
import type { MatteModel } from "./rvm.js";

export interface NodeMatteHostOptions {
  /** The open project file, if any. */
  projectFile: () => string | undefined;
  /** Project path → local file. */
  resolveMedia: (projectPath: string) => string;
  /** The person matting model (`rvmModel()`). */
  model: MatteModel;
  scratchDir?: string;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export function createNodeMatteHost(options: NodeMatteHostOptions): MatteHost {
  return {
    subjects: ["person"],
    async generate(projectPath, request) {
      const local = options.resolveMedia(projectPath);
      const info = await probe(local);
      if (info.has_video === false || info.has_single_image) throw new Error(`${path.basename(local)} has no video to matte`);
      const fps = info.fps && info.fps.num > 0 && info.fps.den > 0 ? info.fps : { num: 30, den: 1 };
      const project = options.projectFile();
      const dir = project ? path.join(projectAssetsDir(project), "mattes") : path.join(options.scratchDir ?? path.join(tmpdir(), "zenvi-media"), "mattes");
      await mkdir(dir, { recursive: true });
      const stem = path.basename(local, path.extname(local)).replace(/[^\w.-]+/g, "_") || "clip";
      const output = await uniquePath(dir, `${stem}.${request.subject}-matte.mp4`);
      options.log?.(`matting ${local} → ${output} (${request.subject}, scale ${request.scale})`);
      const made = await generateMatteVideo({ path: local, width: info.width, height: info.height, fps }, output, options.model, {
        scale: request.scale,
        signal: request.signal ?? options.signal,
      });
      const media: ImportedMedia = { path: output, info: await probe(output), name: path.basename(output) };
      const fp = await fingerprint(output);
      if (fp) media.fingerprint = fp;
      return { media, model: options.model.name, version: options.model.version, license: options.model.license, frames: made.frames, fps: made.fps };
    },
  };
}
