import { describe, expect, it } from "vitest";
import { audioCodecFromName, canEncodeNamed, chooseCodecs, ExportError, videoCodecFromName, type ChooseOptions, type EncodeSupport } from "./codecs.js";

const support = (video: string[], audio: string[]): EncodeSupport & { videoAsks: string[] } => {
  const videoAsks: string[] = [];
  return {
    videoAsks,
    async canEncodeVideo(codec, options) {
      videoAsks.push(`${codec}@${options.width}x${options.height}`);
      return video.includes(codec);
    },
    async canEncodeAudio(codec) {
      return audio.includes(codec);
    },
  };
};

const base: ChooseOptions = { format: "mp4", width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2, hasAudio: true };

describe("chooseCodecs", () => {
  it("prefers H.264 + AAC in MP4", async () => {
    expect(await chooseCodecs(base, support(["avc", "vp9"], ["aac", "opus"]))).toEqual({ container: "mp4", videoCodec: "avc", audioCodec: "aac", width: 1920, height: 1080, notes: [] });
  });

  it("falls back to WebM VP9 + Opus without H.264 (Chromium without proprietary codecs)", async () => {
    const choice = await chooseCodecs(base, support(["vp9", "vp8"], ["opus"]));
    expect(choice).toMatchObject({ container: "webm", videoCodec: "vp9", audioCodec: "opus" });
    expect(choice.notes[0]).toMatch(/WEBM/);
  });

  it("uses Opus in MP4 without AAC, and never drops the sound silently", async () => {
    expect(await chooseCodecs(base, support(["avc"], ["opus"]))).toMatchObject({ container: "mp4", audioCodec: "opus" });
    await expect(chooseCodecs(base, support(["avc"], []))).rejects.toMatchObject({ code: "no-audio-encoder" });
    const silent = await chooseCodecs({ ...base, allowVideoOnly: true }, support(["avc"], []));
    expect(silent.audioCodec).toBeNull();
    expect(silent.notes).toContain("No audio encoder is available; exporting video only");
    expect((await chooseCodecs({ ...base, hasAudio: false }, support(["avc"], ["aac"]))).audioCodec).toBeNull();
    // Nothing to encode: no audio encoder needed, no note.
    expect(await chooseCodecs({ ...base, hasAudio: false }, support(["avc"], []))).toMatchObject({ container: "mp4", audioCodec: null, notes: [] });
  });

  it("switches to WebM to keep the sound when MP4 has no encodable audio codec", async () => {
    const choice = await chooseCodecs(base, support(["avc", "vp9"], ["vorbis"]));
    expect(choice).toMatchObject({ container: "webm", videoCodec: "vp9", audioCodec: "vorbis" });
    expect(choice.notes.join(" ")).toMatch(/keep the sound/);
  });

  it("honours a requested codec by its FFmpeg name when the container allows it", async () => {
    expect(await chooseCodecs({ ...base, videoCodec: "libx265" }, support(["avc", "hevc"], ["aac"]))).toMatchObject({ container: "mp4", videoCodec: "hevc" });
    expect(await chooseCodecs({ ...base, format: "webm", videoCodec: "libvpx" }, support(["vp9", "vp8"], ["opus"]))).toMatchObject({ videoCodec: "vp8" });
  });

  it("rounds H.264 dimensions down to even and says so", async () => {
    const s = support(["avc"], ["aac"]);
    const choice = await chooseCodecs({ ...base, width: 853, height: 481 }, s);
    expect([choice.width, choice.height]).toEqual([852, 480]);
    expect(s.videoAsks[0]).toBe("avc@852x480");
    expect(choice.notes.at(-1)).toMatch(/852×480/);
    // VP9 keeps odd sizes.
    const vp9 = await chooseCodecs({ ...base, format: "webm", width: 853, height: 481 }, support(["vp9"], ["opus"]));
    expect([vp9.width, vp9.height]).toEqual([853, 481]);
  });

  it("rejects formats the browser cannot produce and browsers with no encoder", async () => {
    await expect(chooseCodecs({ ...base, format: "gif" }, support(["avc"], []))).rejects.toBeInstanceOf(ExportError);
    await expect(chooseCodecs(base, support([], []))).rejects.toMatchObject({ code: "no-encoder" });
    expect(await chooseCodecs({ ...base, format: "wav" }, support([], []))).toMatchObject({ container: "wav", audioCodec: "pcm-s16", videoCodec: null });
  });

  it("maps FFmpeg encoder names", () => {
    expect(videoCodecFromName("libx264")).toBe("avc");
    expect(videoCodecFromName("libvpx-vp9")).toBe("vp9");
    expect(audioCodecFromName("libopus")).toBe("opus");
    expect(audioCodecFromName("nonsense")).toBeUndefined();
  });
});

describe("canEncodeNamed", () => {
  it("says whether a preset's encoders export as named in this browser", async () => {
    const browser = support(["avc", "vp9"], ["aac", "opus"]);
    expect(await canEncodeNamed("mp4", "libx264", "aac", browser)).toBe(true);
    expect(await canEncodeNamed("webm", "libvpx-vp9", "libopus", browser)).toBe(true);
    expect(await canEncodeNamed("mp4", "libx265", "aac", browser)).toBe(false);
    expect(await canEncodeNamed("mov", "prores_ks", "", browser)).toBe(false);
    expect(await canEncodeNamed("webm", "libx264", "", browser)).toBe(false);
    expect(await canEncodeNamed("mp4", "mpeg4", "", browser)).toBe(false);
    expect(await canEncodeNamed("mp4", "libx264", "libmp3lame", browser)).toBe(false);
    expect(await canEncodeNamed("gif", "gif", "", browser)).toBe(false);
    expect(await canEncodeNamed("wav", "", "pcm_s16le", support([], ["pcm-s16"]))).toBe(true);
  });
});
