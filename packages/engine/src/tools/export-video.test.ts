/**
 * export_video_tool with the desktop's arguments, get_export_settings_tool
 * and set_export_setting_tool, ported from zenvi-core develop 1f80cb3d0
 * tests/test_editor_tools_project_export_render.py (export plans, renders,
 * settings) and called through runTool with the Assistant's string
 * arguments. The fake exporter records the options each render gets; its
 * `exportDelivery` stands in for each surface (files: the CLI, download:
 * the web editor, job: Zenvi Cloud), `encodable` for its encoders.
 */

import { describe, expect, it } from "vitest";
import { setProfile } from "../ops/project.js";
import { planExport, resolveExportPreset } from "../presets/plan.js";
import { EditHarness } from "./test-support/edit-harness.js";
import type { FakeHostOptions } from "./test-support/fake-host.js";
import type { ContainerFormat } from "./types.js";

type Row = Record<string, unknown>;

/** The desktop tests' studio: a 1080p30 project with a 10 s clip at 1 s (first clip 1 s, last clip end 11 s). */
function studio(host: FakeHostOptions = {}): EditHarness & { clipId: string } {
  const ed = new EditHarness({ host: { projectPath: null, ...host } });
  ed.doc.transaction("setup", (tx) => setProfile(tx, "FHD 1080p 30 fps"));
  const file = ed.addFile("video", { duration: 10, hasAudio: true });
  const clipId = ed.addClip(file, { position: 1 });
  ed.mark();
  return Object.assign(ed, { clipId });
}

const render = (ed: EditHarness, args: Row): Promise<Row> => ed.receipt("export_video_tool", { show_dialog: "false", ...args });

describe("export plans (build_export_plan)", () => {
  it("resolves presets by title, everyday name and social name", () => {
    expect(resolveExportPreset("Instagram Reels").title).toBe("Instagram Reels");
    expect(resolveExportPreset("instagram_reel").title).toBe("Instagram Reels");
    expect(resolveExportPreset("tiktok").title).toBe("TikTok");
    expect(resolveExportPreset("gif").title).toBe("GIF (animated)");
    expect(resolveExportPreset("MP3").exportTo).toBe("Audio Only");
    expect(resolveExportPreset("youtube_4k").title).toBe("YouTube (4K)");
    expect(resolveExportPreset("prores").videoCodec).toBe("prores_ks");
    expect(resolveExportPreset("webm").title).toBe("WEBM (vp9)");
    expect(() => resolveExportPreset("betamax")).toThrow(/no export preset matches 'betamax'/);
    expect(() => resolveExportPreset("mkv h.264")).toThrow(/'mkv h\.264' matches several presets: MKV \(h\.264 dx\), MKV \(h\.264 nv\)/);
  });

  it("exports MP4 (h.264) at High over the whole timeline by default", async () => {
    const ed = studio();
    const data = await render(ed, {});
    expect([data.preset, data.quality, data.export_type]).toEqual(["MP4 (h.264)", "High", "video_audio"]);
    expect([data.video_bitrate, data.acodec]).toEqual(["20 crf", "aac"]);
    // First clip to last clip.
    expect([data.start_seconds, data.end_seconds, data.start_frame, data.end_frame]).toEqual([1, 11, 31, 330]);
    expect(data.path).toBe("Untitled Project.mp4");
    expect(ed.host.exports[0]).toEqual({
      format: "mp4",
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      quality: "high",
      range: { start: 1, end: 11 },
      output: "Untitled Project.mp4",
      videoCodec: "libx264",
      crf: 20,
      audioCodec: "aac",
      audioBitrate: 160000,
      sampleRate: 48000,
      channels: 2,
    });
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("picks a preset's profile closest to the project, and says when that re-frames the clips", async () => {
    const ed = studio();
    const reels = await render(ed, { preset: "Instagram Reels", quality: "med" });
    expect([reels.width, reels.height, reels.fps]).toEqual([1080, 1920, 30]);
    expect([reels.video_bitrate, reels.audio_bitrate]).toEqual(["4.5 Mb/s", "128 kb/s"]);
    expect((reels.notes as string[]).some((n) => n.includes("re-frames every clip"))).toBe(true);
    ed.doc.transaction("vertical", (tx) => setProfile(tx, "FHD Vertical 1080p 30 fps"));
    const vertical = await render(ed, { preset: "Instagram Reels" });
    expect(vertical.profile).toBe("FHD Vertical 1080p 30 fps");
    expect(vertical.notes).toEqual([]);
  });

  it("scales All Formats bitrates with the frame size and rate", async () => {
    const data = await render(studio(), { preset: "MOV (mpeg4)", quality: "high" });
    expect(data.video_bitrate).toBe(`${((1920 * 1080 * 30 * 0.12) / 1e6).toFixed(2)} Mb/s`);
  });

  it("plans GIF, MP3, WAV and image sequences", async () => {
    const ed = studio();
    const gif = await render(ed, { preset: "GIF", width: "480", height: "270" });
    expect([gif.export_type, gif.acodec]).toEqual(["video_only", ""]);
    expect(String(gif.path)).toMatch(/\.gif$/);
    expect(ed.host.exports.at(-1)).toMatchObject({ format: "gif", width: 480, height: 270 });
    expect(ed.host.exports.at(-1)!.channels).toBeUndefined();
    const mp3 = await render(ed, { preset: "MP3" });
    expect([mp3.export_type, mp3.vcodec]).toEqual(["audio_only", ""]);
    expect(String(mp3.path)).toMatch(/\.mp3$/);
    expect(ed.host.exports.at(-1)).toMatchObject({ format: "mp3", audioCodec: "libmp3lame", audioBitrate: 192000 });
    const wav = await render(ed, { preset: "MP3", container: "wav" });
    expect(wav.acodec).toBe("pcm_s16le");
    expect(String(wav.path)).toMatch(/\.wav$/);
    const flac = await render(ed, { export_type: "audio_only", container: "flac" });
    expect([flac.acodec, flac.path]).toEqual(["flac", "Untitled Project.flac"]);
    // Audio Only from an MP4 preset: an MPEG-4 file with only its sound, as the desktop writes.
    const m4a = await render(ed, { export_type: "audio_only" });
    expect([m4a.acodec, m4a.path]).toEqual(["aac", "Untitled Project.mp4"]);
    expect(ed.host.exports.at(-1)!.format).toBe("m4a");
    const seq = await render(ed, { export_type: "image_sequence", image_format: "jpg", file_name: "frames", end: "1.2" });
    expect([seq.path, seq.vcodec, seq.vformat]).toEqual(["frames-%05d.jpg", "mjpeg", "jpg"]);
    expect([seq.frame_files, seq.first_frame]).toEqual([36, "frames-00001.jpg"]);
    expect(ed.host.exports.at(-1)).toMatchObject({ format: "jpg-sequence", range: { start: 0, end: 36 / 30 } });
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("follows ranges, paths and the checks on them", async () => {
    const ed = studio();
    const custom = await render(ed, { start: "2", end: "7", output_path: "~/zenvi-test/reel" });
    expect([custom.range, custom.start_frame, custom.end_frame]).toEqual(["custom", 61, 210]);
    expect(custom.path).toBe("~/zenvi-test/reel.mp4");
    expect(ed.host.exports.at(-1)!.range).toEqual({ start: 2, end: 7 });
    expect((await render(ed, { output_path: "out/a.mov" })).vformat).toBe("mov");
    // A .gif path with an MP4 preset would hand the GIF muxer H.264/AAC.
    await ed.refused("export_video_tool", { show_dialog: "false", output_path: "out/a.gif" }, "a .gif file needs the GIF preset", "preset='GIF'");
    expect((await render(ed, { preset: "GIF", output_path: "out/a.gif" })).vcodec).toBe("gif");
    await ed.refused("export_video_tool", { show_dialog: "false", start: "5", end: "3" }, "the range ends (3.000s) before it starts (5.000s)");
    await ed.refused("export_video_tool", { show_dialog: "false", start: "50", end: "60" }, "the range starts at 50.000s, after the last clip ends (11.000s)");
    await ed.refused("export_video_tool", { show_dialog: "false", range: "selection" }, "no clips are selected in the timeline; select some or give start/end seconds");
    ed.selectIds([ed.clipId]);
    expect((await render(ed, { range: "selection" })).start_seconds).toBe(1);
    await ed.refused("export_video_tool", { show_dialog: "false", width: "1001", height: "500" }, "export size 1001x500 is invalid; width and height must be positive even numbers");
    await ed.refused("export_video_tool", { show_dialog: "false", video_bitrate: "fast" }, "video_bitrate must look like '8 Mb/s', '192 kb/s' or '23 crf', got 'fast'");
    await ed.refused("export_video_tool", { show_dialog: "false", channels: "quad" }, "channels must be mono, stereo, surround, 5.1 or 7.1");
  });

  it("takes size, frame rate, codecs, rates and channels from the call", async () => {
    const ed = studio();
    const data = await render(ed, {
      profile: "1280x720",
      fps: "60",
      video_codec: "libx265",
      video_bitrate: "6 Mb/s",
      audio_bitrate: "128 kb/s",
      sample_rate: "44100",
      channels: "mono",
      quality: "low",
    });
    expect([data.width, data.height, data.fps, data.vcodec, data.video_bitrate, data.sample_rate, data.channels]).toEqual([1280, 720, 60, "libx265", "6 Mb/s", 44100, 1]);
    expect(data.notes).toContain("export frame rate 60.000 differs from the project's; keyframes are rescaled for the render");
    expect(ed.host.exports.at(-1)).toMatchObject({
      width: 1280,
      height: 720,
      fps: { num: 60, den: 1 },
      videoCodec: "libx265",
      videoBitrate: 6000000,
      audioBitrate: 128000,
      sampleRate: 44100,
      channels: 1,
      quality: "low",
      range: { start: 1, end: 11 },
    });
    expect((await render(ed, { width: "3840", height: "2160", fps: "29.97" })).fps).toBe(29.97);
    expect(ed.host.exports.at(-1)!.fps).toEqual({ num: 30000, den: 1001 });
    const lossless = await render(ed, { preset: "lossless" });
    expect(lossless.video_bitrate).toBe("0 crf");
    expect(ed.host.exports.at(-1)).toMatchObject({ crf: 0, quality: "lossless" });
    // Video Only has no audio stream.
    await render(ed, { export_type: "video_only" });
    expect(ed.host.exports.at(-1)!.channels).toBe(0);
    expect(ed.host.exports.at(-1)!.audioCodec).toBeUndefined();
  });

  it("names the file after the project file, else 'Untitled Project'; a folder output_path keeps that name", async () => {
    const saved = studio({ projectPath: "/films/promo.zvn" });
    expect((await render(saved, {})).path).toBe("promo.mp4");
    expect((await render(saved, { folder: "renders" })).path).toBe("renders/promo.mp4");
    expect((await render(saved, { folder: "renders", file_name: "cut 2" })).path).toBe("renders/cut 2.mp4");
    const withFolder = studio({ folders: ["/exports/finals"] });
    expect((await render(withFolder, { output_path: "/exports/finals" })).path).toBe("/exports/finals/Untitled Project.mp4");
    expect((await render(withFolder, { output_path: "/exports/finals/x" })).path).toBe("/exports/finals/x.mp4");
    withFolder.doc.setUntracked(["export_overrides"], { output_path: "/exports/finals" });
    expect((await render(withFolder, {})).path).toBe("/exports/finals/Untitled Project.mp4");
    withFolder.doc.setUntracked(["export_overrides"], {});
    // An explicit container renames the extension.
    expect((await render(withFolder, { output_path: "cut.mp4", container: "mkv" })).path).toBe("cut.mkv");
  });
});

describe("export_video_tool renders", () => {
  it("renders with the planned settings and no undo step", async () => {
    const ed = studio();
    const call = await ed.call("export_video_tool", { show_dialog: "false", preset: "YouTube", start: "1", end: "6", file_name: "yt" });
    expect(call.summary).toBe("Exported 5.00s of video with 'YouTube' (High) to yt.mp4 (0.0 MB), 1920x1080 at 30.0 fps.");
    const data = call.data as Row;
    expect([data.size_bytes, data.duration_seconds, data.start_frame, data.end_frame]).toEqual([1234, 5, 31, 180]);
    expect(ed.host.exports.at(-1)).toMatchObject({ videoBitrate: 12000000, audioCodec: "aac", sampleRate: 48000, output: "yt.mp4" });
    expect(call.undoSteps).toBe(0);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("refuses an output that is an input file, an empty timeline and a failed render", async () => {
    const ed = studio();
    const source = String(ed.doc.project.files[0]!.path);
    await ed.refused("export_video_tool", { show_dialog: "false", output_path: source }, `${source} is one of the project's input files`);
    const failing = studio();
    failing.host.exporter!.export = async () => {
      throw new Error("Encoding failed (exit code 1)");
    };
    await failing.refused("export_video_tool", { show_dialog: "false" }, "Error: export failed: Encoding failed (exit code 1)");
    const empty = new EditHarness({ host: { projectPath: null } });
    await empty.refused("export_video_tool", { show_dialog: "false" }, "the timeline is empty; add clips before exporting");
    expect(empty.host.exports).toHaveLength(0);
  });

  it("opens the editor's Export dialog for the Assistant's default call, and renders when arguments say what", async () => {
    const ed = studio();
    const dialog = await ed.call("export_video_tool");
    expect(dialog.summary).toBe("Opened the Export Video dialog for the user; nothing was rendered.");
    expect(dialog.data).toEqual({ dialog_opened: true });
    expect(ed.host.calls).toContain("openExportDialog");
    expect(ed.host.exports).toHaveLength(0);
    await ed.receipt("export_video_tool", { preset: "TikTok" });
    expect(ed.host.exports).toHaveLength(1);
    const cli = studio({ omit: ["ui.openExportDialog"] });
    await cli.receipt("export_video_tool");
    expect(cli.host.exports).toHaveLength(1);
  });

  it("refuses interlaced output everywhere: no web encoder interlaces", async () => {
    for (const exportDelivery of ["files", "download", "job"] as const) {
      const ed = studio({ exportDelivery });
      const refused = await ed.refused("export_video_tool", { show_dialog: "false", interlaced: "true" }, "cannot export interlaced video", "Call it again without interlaced");
      expect(refused.summary).not.toMatch(/not available/);
      expect(ed.host.exports).toHaveLength(0);
    }
    await studio().receipt("export_video_tool", { show_dialog: "false", interlaced: "false" });
  });

  it("refuses containers the engine's exporters do not write, saying what this surface can export", async () => {
    const ed = studio({ encodable: (format) => ["mp4", "mov", "mkv", "webm", "wav"].includes(format) });
    await ed.refused("export_video_tool", { show_dialog: "false", preset: "AVI (h.264)" }, "this Zenvi surface cannot write AVI files (Zenvi desktop can); it can export MP4, MOV, MKV, WebM and WAV.");
    await ed.refused("export_video_tool", { show_dialog: "false", preset: "GIF" }, "this Zenvi surface cannot write GIF files; it can export MP4, MOV, MKV, WebM and WAV.");
    await ed.refused("export_video_tool", { show_dialog: "false", export_type: "image_sequence" }, "cannot write PNG image sequences");
    expect(ed.host.exports).toHaveLength(0);
    const cli = studio();
    await cli.refused("export_video_tool", { show_dialog: "false", preset: "dvd" }, "cannot write DVD files (Zenvi desktop can); it can export MP4, MOV, MKV, WebM, GIF, MP3, WAV, FLAC and M4A, and PNG, JPG, BMP and TIFF image sequences");
  });

  it("checks codecs before rendering: a named codec the host lacks is refused, a preset's audio codec is swapped", async () => {
    /** ffmpeg's muxer rules for WebM, and no libvorbis (like Homebrew's ffmpeg). */
    const webmRules = (format: ContainerFormat, video: string, audio: string): boolean => {
      if (audio === "libvorbis" || video === "prores_ks") return false;
      if (format !== "webm") return true;
      return (!video || ["libvpx-vp9", "libvpx", "libsvtav1", "libaom-av1"].includes(video)) && (!audio || ["libopus", "libvorbis"].includes(audio));
    };
    const ed = studio({ encodable: webmRules });
    await ed.refused("export_video_tool", { show_dialog: "false", container: "webm" }, "cannot encode video codec 'libx264' in WebM; it encodes libvpx-vp9, libvpx, libsvtav1 and libaom-av1 there");
    const webm = await ed.call("export_video_tool", { show_dialog: "false", preset: "WEBM" });
    expect(webm.status).toBe("applied");
    expect(webm.warnings).toEqual(["This Zenvi surface cannot encode 'libvorbis' audio; the sound is libopus instead (the same WebM file otherwise)."]);
    expect(ed.host.exports.at(-1)).toMatchObject({ format: "webm", videoCodec: "libvpx-vp9", audioCodec: "libopus", crf: 26 });
    expect((webm.data as Row).acodec).toBe("libopus");
    await ed.refused("export_video_tool", { show_dialog: "false", preset: "WEBM", audio_codec: "libvorbis" }, "cannot encode audio codec 'libvorbis' in WebM; it encodes libopus there");
    await ed.refused("export_video_tool", { show_dialog: "false", preset: "prores" }, "cannot encode video codec 'prores_ks' in MOV; it encodes libx264, libx265");
    expect(ed.host.exports).toHaveLength(1);
  });

  it("in the web editor: downloads under the planned name, refuses folders", async () => {
    const ed = studio({ exportDelivery: "download" });
    await ed.refused("export_video_tool", { show_dialog: "false", folder: "renders" }, "this Zenvi surface has no folders (the browser downloads the file); call it again without folder");
    expect((await render(ed, { file_name: "teaser", preset: "webm" })).path).toBe("teaser.webm");
    const named = await ed.call("export_video_tool", { show_dialog: "false", output_path: "/Users/me/Movies/final.mov" });
    expect(named.warnings).toEqual(["This Zenvi surface has no folders: the file is named final.mov."]);
    expect(ed.host.exports.at(-1)!.output).toBe("final.mov");
  });

  it("in Zenvi Cloud: starts a render job and says how to get the file", async () => {
    const ed = studio({ exportDelivery: "job", exportName: "Launch teaser" });
    const call = await ed.call("export_video_tool", { show_dialog: "false", preset: "YouTube", start: "1", end: "3", width: "1280", height: "720" });
    expect(call.summary).toBe(
      "Started rendering 2.00s of video with 'YouTube' (High), 1280x720 at 30.0 fps as Launch teaser.mp4: render r_fakejob00000001 is queued. " +
        'Call get_render_status with render_id "r_fakejob00000001" for the download link.',
    );
    expect(call.data).toMatchObject({ render_id: "r_fakejob00000001", status: "queued", path: "Launch teaser.mp4", start_frame: 31, end_frame: 90 });
    await ed.refused("export_video_tool", { show_dialog: "false", folder: "x" }, "Zenvi Cloud answers with a download link");
  });

  it("range='selection' needs an editor's selection", async () => {
    const cli = studio({ omit: ["ui.selectedIds"] });
    await cli.refused("export_video_tool", { show_dialog: "false", range: "selection" }, "this Zenvi surface has no timeline selection; give start/end seconds instead");
  });
});

describe("export settings (set_export_setting_tool, get_export_settings_tool)", () => {
  it("are checked, kept outside undo, and used by the next export", async () => {
    const ed = studio();
    await ed.refused("set_export_setting_tool", { key: "colour_depth", value: "10" }, "unknown export setting 'colour_depth'; valid keys:", "video_bitrate");
    await ed.refused("set_export_setting_tool", { key: "width", value: "1001" }, "width must be an even number >= 2, got '1001'");
    await ed.refused("set_export_setting_tool", { key: "quality", value: "ultra" }, "quality must be low, med or high");
    await ed.refused("set_export_setting_tool", { key: "video_codec", value: "prores_ks" }, "this Zenvi surface cannot encode 'prores_ks'");
    expect((await ed.receipt("set_export_setting_tool", { key: "preset", value: "tiktok" })).stored).toEqual({ preset: "TikTok" });
    expect((await ed.receipt("set_export_setting_tool", { key: "start", value: "2" })).stored).toEqual({ start_frame: 61 });
    expect((await ed.receipt("set_export_setting_tool", { key: "vcodec", value: "libx264" })).stored).toEqual({ video_codec: "libx264" });
    expect((await ed.receipt("set_export_setting_tool", { key: "channels", value: "mono" })).stored).toEqual({ channels: 1, channel_layout: 4 });
    expect((await ed.receipt("set_export_setting_tool", { key: "fps", value: "29.97" })).stored).toEqual({ fps_num: 30000, fps_den: 1001 });
    const again = await ed.call("set_export_setting_tool", { key: "preset", value: "TikTok" });
    expect([again.status, again.summary]).toEqual(["unchanged", "preset is already TikTok."]);
    expect(ed.stepsSinceMark()).toBe(0);
    expect(ed.doc.canUndo).toBe(true);

    const settings = await ed.call("get_export_settings_tool");
    const effective = (settings.data as Row).effective as Row;
    expect([effective.preset, effective.start_seconds, effective.channels]).toEqual(["TikTok", 2, 1]);
    expect(settings.summary).toBe("Next export: 'TikTok' High video_audio 1080x1920 29.97 fps, 2.0-11.0s -> Untitled Project.mp4.");
    expect(Object.keys((settings.data as Row).valid_keys as Row)).toContain("preset");

    await render(ed, { file_name: "stored" });
    expect(ed.host.exports.at(-1)).toMatchObject({ range: { start: 60 / (30000 / 1001), end: 330 / (30000 / 1001) }, channels: 1, fps: { num: 30000, den: 1001 } });
    expect((await ed.receipt("set_export_setting_tool", { key: "start", clear: "true" })).cleared).toEqual(["start_frame"]);
    const all = await ed.receipt("set_export_setting_tool", { clear: "true" });
    expect(new Set(all.cleared as string[])).toEqual(new Set(["preset", "video_codec", "channels", "channel_layout", "fps_num", "fps_den"]));
    expect(all.overrides).toEqual({});
    expect(((await ed.receipt("get_export_settings_tool")).effective as Row).preset).toBe("MP4 (h.264)");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("reads overrides an earlier web version stored under their own names", () => {
    const ed = studio();
    ed.doc.setUntracked(["export_overrides"], { start: "2", end: "4s", fps: "24", export_type: "video_only", container: "mov", channels: 1 });
    const plan = planExport(ed.doc.project);
    expect([plan.start_frame, plan.end_frame, plan.fps_num, plan.export_type, plan.vformat, plan.channels, plan.channel_layout]).toEqual([49, 96, 24, "video_only", "mov", 1, 4]);
  });

  it("say why nothing can be exported yet", async () => {
    const empty = new EditHarness({ host: { projectPath: null } });
    const settings = await empty.call("get_export_settings_tool");
    expect(settings.summary).toBe("Nothing to export yet: the timeline is empty; add clips before exporting");
    expect((settings.data as Row).effective).toBeNull();
  });
});
