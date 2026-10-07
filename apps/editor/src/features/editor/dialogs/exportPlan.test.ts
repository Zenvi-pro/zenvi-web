// @vitest-environment node
import { createProject, findProfile } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import {
  activePick,
  choiceFor,
  cloudRenderOptions,
  describeChoice,
  exportOptionsFor,
  presetById,
  PROJECT_PROFILE,
  profileOptions,
  QUICK_PICKS,
  targetOptions,
  targetSupport,
} from "./exportPlan";

const project = createProject({ profile: findProfile("HD 1080p 30 fps")! });

describe("export plan (desktop Simple tab on the engine presets)", () => {
  it("defaults to MP4 (h.264) at the project's own size and the highest quality", () => {
    const choice = choiceFor(project, presetById(QUICK_PICKS[0]!.presetId));
    expect(choice).toMatchObject({ presetId: "format_mp4_x264", profile: PROJECT_PROFILE, quality: "High", sound: true });
    expect(activePick(choice)).toBe("project");
    const options = exportOptionsFor(project, choice);
    expect(options).toMatchObject({ format: "mp4", width: 1920, height: 1080, fps: { num: 30, den: 1 }, videoCodec: "libx264", audioCodec: "aac" });
    expect(describeChoice(project, choice)).toBe("MP4 · H.264 + AAC · 1920 × 1080 · 30 fps · CRF 20");
  });

  it("uses the target's allowed profiles (YouTube keeps the project's 1080p30)", () => {
    const choice = choiceFor(project, presetById("youtube_HD"));
    expect(profileOptions(project, presetById("youtube_HD")).some((o) => o.value === PROJECT_PROFILE)).toBe(false);
    expect(exportOptionsFor(project, choice)).toMatchObject({ width: 1920, height: 1080, videoBitrate: 12_000_000 });
  });

  it("drops the audio stream when sound is off", () => {
    const options = exportOptionsFor(project, { ...choiceFor(project, presetById("format_mp4_x264")), sound: false });
    expect(options.channels).toBe(0);
    expect(options.audioCodec).toBeUndefined();
    expect(describeChoice(project, { ...choiceFor(project, presetById("format_mp4_x264")), sound: false })).toContain("H.264 · no sound");
  });

  it("knows where each target runs: browser, Zenvi Cloud, or the desktop app", () => {
    expect(targetSupport(presetById("format_webm_libvp9"))).toMatchObject({ container: "webm", browser: true });
    expect(targetSupport(presetById("format_gif"))).toMatchObject({ container: "gif", browser: false, cloud: true });
    expect(targetSupport(presetById("format_avi_x264"))).toMatchObject({ browser: false, cloud: false });
    const all = targetOptions("All Formats", false);
    expect(all.find((o) => o.value === "format_gif")).toMatchObject({ hint: "Zenvi Cloud", disabled: true });
    expect(targetOptions("All Formats", true).find((o) => o.value === "format_gif")?.disabled).toBe(false);
    expect(all.find((o) => o.value === "format_avi_x264")).toMatchObject({ hint: "Desktop app", disabled: true });
  });

  it("sends a cloud render only the documented option keys", () => {
    const options = exportOptionsFor(project, { ...choiceFor(project, presetById("format_mp4_x264")), range: { start: 1, end: 3 } });
    expect(Object.keys(cloudRenderOptions(options)).sort()).toEqual(["audioBitrate", "channels", "format", "fps", "height", "quality", "range", "sampleRate", "width"].filter((k) => k in cloudRenderOptions(options)).sort());
    expect(cloudRenderOptions(options)).not.toHaveProperty("videoCodec");
    expect(cloudRenderOptions(options)).not.toHaveProperty("crf");
    expect(cloudRenderOptions(options).range).toEqual({ start: 1, end: 3 });
  });
});
