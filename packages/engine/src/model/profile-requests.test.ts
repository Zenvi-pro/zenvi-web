/**
 * Profile requests and custom profile files, from zenvi-core develop
 * tests/test_editor_tools_project_export_profiles.py (resolution) and
 * classes/project_profile.py (the file format).
 */

import { describe, expect, it } from "vitest";
import {
  ensureProfile,
  flipProfile,
  matchProfile,
  profileCatalog,
  ProfileRequestError,
  resolveProfileRequest,
  socialPreset,
  socialProfile,
  type ProfileContext,
} from "./profile-requests.js";
import { aspectText, describeProfile, orientationOf, parseProfileFile, profileFileText, profileFpsFraction, reducedDisplayRatio, type CatalogProfile } from "./profiles.js";

function ctx(projectFps = 30, custom: CatalogProfile[] = []): ProfileContext {
  return { catalog: profileCatalog(custom), projectFps };
}

const resolve = (request: string, fps: number | null = null, c = ctx()) => resolveProfileRequest(c, request, fps).profile;

describe("resolveProfileRequest", () => {
  it("maps social presets to real profiles", () => {
    const reel = resolve("Instagram Reels");
    expect([reel.width, reel.height, reel.fps.num, reel.description]).toEqual([1080, 1920, 30, "FHD Vertical 1080p 30 fps"]);
    expect(resolve("instagram_post").description).toBe("HD Square 1080p 30 fps");
    expect(resolve("4:5").height).toBe(1350);
    expect(resolve("youtube_4k").width).toBe(3840);
    const cinema = resolve("cinema");
    expect([cinema.width, cinema.fps.num, cinema.fps.den]).toEqual([1920, 24, 1]);
    expect(resolve("tiktok", 60).fps.num).toBe(60);
    expect(resolve("1280x720").description).toBe("HD 720p 30 fps");
    expect(resolve("FHD 1080p 29.97 fps").fps.num).toBe(30000);
    expect(resolve("01920x1080p0030_16-09").description).toBe("FHD 1080p 30 fps");
  });

  it("keeps the project's frame rate for a social preset", () => {
    expect(resolve("tiktok", null, ctx(25)).description).toBe("FHD Vertical 1080p 25 fps");
  });

  it("refuses unknown and ambiguous requests with help", () => {
    expect(() => resolve("hologram")).toThrow(ProfileRequestError);
    expect(() => resolve("hologram")).toThrow(/Social presets: instagram_reel, instagram_story/);
    expect(() => resolve("NTSC")).toThrow(/'NTSC' matches \d+ profiles \(.*\.\.\.\); use the exact name or add fps/);
    expect(() => resolve("")).toThrow("name a profile or social preset");
  });

  it("makes a custom profile only when no profile has the size and rate", () => {
    const made = ensureProfile(ctx(), 1000, 1000, { num: 30, den: 1 });
    expect(made.create).toBe(true);
    expect(made.profile).toMatchObject({ description: "Custom 1000x1000 30 fps", key: "01000x1000p0030_01-01", user: true, display_ratio: { num: 1, den: 1 } });
    expect(ensureProfile(ctx(), 1920, 1080, { num: 25, den: 1 })).toMatchObject({ create: false, profile: { description: "FHD PAL 1080p 25 fps" } });
    const kept = ensureProfile(ctx(30, [{ ...made.profile, user: true }]), 1000, 1000, { num: 30, den: 1 });
    expect(kept).toMatchObject({ create: false, profile: { description: "Custom 1000x1000 30 fps" } });
    expect(ensureProfile(ctx(), 1000, 1000, { num: 30000, den: 1001 }).profile.description).toBe("Custom 1000x1000 29.97 fps");
  });

  it("prefers progressive, square-pixel, built-in profiles of a size", () => {
    const best = matchProfile(profileCatalog(), 1920, 1080, 29.97)!;
    expect(best.description).toBe("FHD 1080p 29.97 fps");
    expect(matchProfile(profileCatalog(), 1920, 1080, 31)).toBeNull();
  });

  it("flips a profile to portrait, landscape or square", () => {
    const c = ctx();
    const fhd = resolveProfileRequest(c, "FHD 1080p 30 fps");
    expect(flipProfile(c, fhd, "portrait", null).profile.description).toBe("FHD Vertical 1080p 30 fps");
    expect(flipProfile(c, fhd, "square", null).profile.description).toBe("HD Square 1080p 30 fps");
    expect(flipProfile(c, fhd, "landscape", null)).toBe(fhd);
  });

  it("knows social preset aliases", () => {
    expect(socialPreset("Instagram Reels")?.key).toBe("instagram_reel");
    expect(socialPreset("tiktok_video")?.key).toBe("tiktok");
    expect(socialPreset("YT Shorts")?.exportPreset).toBe("YouTube Shorts");
    expect(socialPreset("betamax")).toBeNull();
  });

  it("names the built-in profile of a social preset (agents ask for these, W25a E2E bug 9)", () => {
    for (const name of ["instagram_reel", "reels", "tiktok", "youtube_short", "shorts"]) {
      expect(socialProfile(name)?.description, name).toBe("FHD Vertical 1080p 30 fps");
    }
    expect(socialProfile("youtube")?.description).toBe("FHD 1080p 30 fps");
    expect([socialProfile("square_post")?.width, socialProfile("square_post")?.height]).toEqual([1080, 1080]);
    expect(socialProfile("tiktok", 60)?.description).toBe("FHD Vertical 1080p 60 fps");
    expect(socialProfile("betamax")).toBeNull();
  });
});

describe("profile files and receipts", () => {
  it("reads and writes the profile editor's key=value files", () => {
    const text = "description=Phone 720x1280 24\nframe_rate_num=24\nframe_rate_den=1\nwidth=720\nheight=1280\nprogressive=1\n";
    const p = parseProfileFile(text, "00720x1280p0024_09-16")!;
    expect(p).toMatchObject({ width: 720, height: 1280, fps: { num: 24, den: 1 }, pixel_ratio: { num: 1, den: 1 }, display_ratio: { num: 720, den: 1280 }, progressive: true });
    expect(parseProfileFile(profileFileText(p), p.key)).toEqual(p);
    expect(profileFileText(p).split("\n")[0]).toBe("description=Phone 720x1280 24");
    expect(parseProfileFile("description=x\nwidth=0\nheight=10\nframe_rate_num=30\n", "k")).toBeNull();
    expect(parseProfileFile("width=10\nheight=10\nframe_rate_num=30\n", "k")).toBeNull();
    expect(parseProfileFile("description=i\nwidth=1920\nheight=1080\nframe_rate_num=25\nframe_rate_den=\nprogressive=0\nspherical=1\n", "k")).toMatchObject({
      fps: { num: 25, den: 1 },
      progressive: false,
      spherical: true,
    });
  });

  it("describes profiles like the desktop's receipts", () => {
    const d = describeProfile({ ...resolve("FHD Vertical 1080p 29.97 fps"), user: false });
    expect(d).toMatchObject({ name: "FHD Vertical 1080p 29.97 fps", fps: 29.97, aspect: "9:16", orientation: "portrait", interlaced: false, user: false });
    expect([aspectText(1080, 1350), orientationOf(1, 1), reducedDisplayRatio(720, 576, 64, 45)]).toEqual(["4:5", "square", { num: 16, den: 9 }]);
    expect([profileFpsFraction(23.98), profileFpsFraction(12.5), profileFpsFraction(60)]).toEqual([
      { num: 24000, den: 1001 },
      { num: 25, den: 2 },
      { num: 60, den: 1 },
    ]);
  });
});
