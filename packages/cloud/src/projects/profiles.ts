/**
 * The project formats `create_project` offers, with the exact profile
 * descriptions the desktop uses (zenvi-core src/profiles/<WxH>p<rate>_<ratio>).
 * Stand-in until the engine's profile catalog (W1 `model/profiles.ts`) is
 * exported; owner W7.
 */

export const PROJECT_FORMATS = ["landscape_1080p", "landscape_720p", "landscape_4k", "vertical_1080p", "square_1080p"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const PROJECT_FPS = [24, 25, 30, 50, 60] as const;
export type ProjectFps = (typeof PROJECT_FPS)[number];

export interface ProfileSpec {
  width: number;
  height: number;
  displayRatio: { num: number; den: number };
  fps: { num: number; den: number };
  description: string;
}

const SIZES: Record<ProjectFormat, { width: number; height: number; ratio: [number, number]; names: Record<ProjectFps, string> }> = {
  landscape_1080p: {
    width: 1920,
    height: 1080,
    ratio: [16, 9],
    names: { 24: "FHD 1080p 24 fps", 25: "FHD PAL 1080p 25 fps", 30: "FHD 1080p 30 fps", 50: "FHD PAL 1080p 50 fps", 60: "FHD 1080p 60 fps" },
  },
  landscape_720p: {
    width: 1280,
    height: 720,
    ratio: [16, 9],
    names: { 24: "HD 720p 24 fps", 25: "HD 720p 25 fps", 30: "HD 720p 30 fps", 50: "PAL HD 720p 50 fps", 60: "HD 720p 60 fps" },
  },
  landscape_4k: {
    width: 3840,
    height: 2160,
    ratio: [16, 9],
    names: { 24: "4K UHD 2160p 24 fps", 25: "4K UHD 2160p 25 fps", 30: "4K UHD 2160p 30 fps", 50: "4K UHD 2160p 50 fps", 60: "4K UHD 2160p 60 fps" },
  },
  vertical_1080p: {
    width: 1080,
    height: 1920,
    ratio: [9, 16],
    names: {
      24: "FHD Vertical 1080p 24 fps",
      25: "FHD Vertical 1080p 25 fps",
      30: "FHD Vertical 1080p 30 fps",
      50: "FHD Vertical 1080p 50 fps",
      60: "FHD Vertical 1080p 60 fps",
    },
  },
  square_1080p: {
    width: 1080,
    height: 1080,
    ratio: [1, 1],
    names: { 24: "HD Square 1080p 24 fps", 25: "HD Square 1080p 25 fps", 30: "HD Square 1080p 30 fps", 50: "HD Square 1080p 50 fps", 60: "HD Square 1080p 60 fps" },
  },
};

export function profileFor(format: ProjectFormat, fps: ProjectFps): ProfileSpec {
  const size = SIZES[format];
  return {
    width: size.width,
    height: size.height,
    displayRatio: { num: size.ratio[0], den: size.ratio[1] },
    fps: { num: fps, den: 1 },
    description: size.names[fps],
  };
}
