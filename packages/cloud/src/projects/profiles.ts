/**
 * The project formats `create_project` offers, resolved through the engine's
 * copy of the desktop profile table (zenvi-core src/profiles), so a cloud
 * project stores exactly the `profile` description, size, rate and aspect the
 * desktop would.
 */

import { type Profile, profilesMatching } from "@zenvi/engine";

export const PROJECT_FORMATS = ["landscape_1080p", "landscape_720p", "landscape_4k", "vertical_1080p", "square_1080p"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const PROJECT_FPS = [24, 25, 30, 50, 60] as const;
export type ProjectFps = (typeof PROJECT_FPS)[number];

const SIZES: Record<ProjectFormat, { width: number; height: number }> = {
  landscape_1080p: { width: 1920, height: 1080 },
  landscape_720p: { width: 1280, height: 720 },
  landscape_4k: { width: 3840, height: 2160 },
  vertical_1080p: { width: 1080, height: 1920 },
  square_1080p: { width: 1080, height: 1080 },
};

export function profileFor(format: ProjectFormat, fps: ProjectFps): Profile {
  const { width, height } = SIZES[format];
  const profile = profilesMatching(width, height, { num: fps, den: 1 })[0];
  if (!profile) throw new Error(`no desktop profile for ${width}x${height} at ${fps} fps`);
  return profile;
}
