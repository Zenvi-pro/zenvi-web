import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  libopenshotReaderJson,
  makeAudio,
  makeImage,
  makeTempDir,
  makeVideo,
  removeDir,
  writeText,
} from "../test-support/fixtures.js";
import { jpegOrientation } from "./exif.js";
import { fingerprint, sha256File } from "./fingerprint.js";
import { desktopMediaType, isAudioOnlyMedia } from "./media-type.js";
import { probe, ProbeError } from "./probe.js";

let dir: string;
const files: Record<string, string> = {};

/** Insert an EXIF APP1 segment with the given orientation after the JPEG SOI marker. */
function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); // one IFD entry
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-probe-");
  files.mp4 = await makeVideo(dir, "clip.mp4", { fps: "30000/1001", duration: 2, audioHz: 1000 });
  files.webm = await makeVideo(dir, "clip.webm", { fps: "25", duration: 1, audioHz: 440, width: 160, height: 90 });
  files.silent = await makeVideo(dir, "silent.mp4", { fps: "24", duration: 1 });
  files.mp3 = await makeAudio(dir, "tone.mp3", { hz: 440, duration: 1.5 });
  files.wav = await makeAudio(dir, "tone.wav", { hz: 440, duration: 1, channels: 2, sampleRate: 44100 });
  files.png = await makeImage(dir, "still.png", { width: 64, height: 48 });
  files.jpg = await makeImage(dir, "still.jpg", { width: 40, height: 20 });
  files.svg = await writeText(
    dir,
    "title.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#123456"/></svg>',
  );
  const rotated = withExifOrientation(await readFile(files.jpg), 6);
  files.rotatedJpg = path.join(dir, "portrait.jpg");
  await writeFile(files.rotatedJpg, rotated);
}, 60_000);

afterAll(() => removeDir(dir));

describe("probe", () => {
  it("reports video + audio like FFmpegReader", async () => {
    const info = await probe(files.mp4!);
    expect(info.type).toBe("FFmpegReader");
    expect(info.media_type).toBe("video");
    expect(info.has_video).toBe(true);
    expect(info.has_audio).toBe(true);
    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
    expect(info.fps).toEqual({ num: 30000, den: 1001 });
    expect(info.video_length).toBe(59);
    // duration is float32(frames / fps), like libopenshot's float field
    expect(info.duration).toBe(Math.fround(59 / (30000 / 1001)));
    expect(info.display_ratio).toEqual({ num: 4, den: 3 });
    expect(info.pixel_ratio).toEqual({ num: 1, den: 1 });
    expect(info.pixel_format).toBe(0);
    expect(info.vcodec).toBe("h264");
    expect(info.acodec).toBe("aac");
    expect(info.sample_rate).toBe(48000);
    expect(info.channels).toBe(1);
    expect(info.channel_layout).toBe(4);
    expect(info.duration_strategy).toBe("VideoPreferred");
    expect(info.path).toBe(files.mp4);
    // jsoncpp writes keys sorted; media_type is appended by the desktop
    const keys = Object.keys(info);
    expect(keys.slice(0, -1)).toEqual([...keys.slice(0, -1)].sort());
    expect(keys[keys.length - 1]).toBe("media_type");
  });

  it("uses defaults for audio-only files (30 fps, 720x480)", async () => {
    const info = await probe(files.mp3!);
    expect(info.type).toBe("FFmpegReader");
    expect(info.media_type).toBe("audio");
    expect(info.has_video).toBe(false);
    expect(info.fps).toEqual({ num: 30, den: 1 });
    expect(info.video_timebase).toEqual({ num: 1, den: 30 });
    expect(info.width).toBe(720);
    expect(info.height).toBe(480);
    expect(info.video_length).toBe(45);
    expect(info.duration).toBe(1.5);
    expect(info.acodec).toBe("mp3float");
    expect(info.pixel_format).toBe(-1);
    expect(info.vcodec).toBe("");
  });

  it("reports stills as QtImageReader with a one-hour duration", async () => {
    const info = await probe(files.png!);
    expect(info.type).toBe("QtImageReader");
    expect(info.media_type).toBe("image");
    expect(info.has_single_image).toBe(true);
    expect(info.width).toBe(64);
    expect(info.height).toBe(48);
    expect(info.duration).toBe(3600);
    expect(info.video_length).toBe(108000);
    expect(info.vcodec).toBe("QImage");
    expect(info.file_size).toBe(64 * 48 * 4);
    expect(info.duration_strategy).toBeUndefined();
  });

  it("reads SVG size with resvg", async () => {
    const info = await probe(files.svg!);
    expect(info.type).toBe("QtImageReader");
    expect(info.media_type).toBe("image");
    expect([info.width, info.height]).toEqual([1920, 1080]);
    expect(info.display_ratio).toEqual({ num: 16, den: 9 });
  });

  it("applies EXIF orientation like QImageReader autoTransform", async () => {
    expect(jpegOrientation(await readFile(files.rotatedJpg!))).toBe(6);
    const info = await probe(files.rotatedJpg!);
    expect([info.width, info.height]).toEqual([20, 40]);
  });

  it("fails clearly on missing and non-media files", async () => {
    await expect(probe(path.join(dir, "missing.mp4"))).rejects.toBeInstanceOf(ProbeError);
    const junk = await writeText(dir, "junk.mp4", "not a video");
    await expect(probe(junk)).rejects.toThrow(/could not open/i);
  });

  it("matches libopenshot's reader JSON exactly (when the bindings are installed)", async () => {
    const all = Object.values(files);
    const oracle = await libopenshotReaderJson(all);
    if (!oracle) return; // bindings not available (CI): covered by the assertions above
    for (const file of all) {
      const expected = oracle[file]!;
      expect(expected.error, file).toBeUndefined();
      const { media_type: _mediaType, ...actual } = await probe(file);
      expect({ file, ...actual }).toEqual({ file, ...expected });
    }
  }, 60_000);
});

describe("media type (image_types.py)", () => {
  it("prefers the extension over stream flags", () => {
    expect(desktopMediaType({ path: "/a/song.mp3", has_video: true, has_audio: true })).toBe("audio");
    expect(desktopMediaType({ path: "/a/pic.PNG", has_video: true, has_audio: false })).toBe("image");
    expect(desktopMediaType({ path: "/a/clip.mov", has_video: true, has_audio: true })).toBe("video");
    expect(desktopMediaType({ path: "/a/voice.m4a", has_video: false, has_audio: true })).toBe("audio");
    expect(desktopMediaType({ path: "/a/x.bin", has_video: false, has_audio: false })).toBe("video");
    expect(isAudioOnlyMedia({ path: "/a/cover.mp3", has_video: true, has_audio: true })).toBe(true);
    expect(isAudioOnlyMedia({ path: "/a/v.mp4", has_video: true, has_audio: true, media_type: "video" })).toBe(false);
  });
});

describe("fingerprints", () => {
  it("hashes size + head + tail like media_fingerprint.py", async () => {
    const small = await writeText(dir, "small.bin", "hello");
    const fp = await fingerprint(small);
    const { createHash } = await import("node:crypto");
    // sha256("5" + "hello"): decimal size, then the bytes
    expect(fp).toMatchObject({ size: 5, sha256: createHash("sha256").update("5hello").digest("hex") });
    const big = Buffer.alloc(3 * 1024 * 1024 + 7);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251;
    const bigPath = path.join(dir, "big.bin");
    await writeFile(bigPath, big);
    const expected = createHash("sha256")
      .update(String(big.length))
      .update(big.subarray(0, 1024 * 1024))
      .update(big.subarray(big.length - 1024 * 1024))
      .digest("hex");
    expect((await fingerprint(bigPath))?.sha256).toBe(expected);
    expect(await sha256File(bigPath)).toBe(createHash("sha256").update(big).digest("hex"));
    expect(await fingerprint(path.join(dir, "nope"))).toBeUndefined();
    expect(await fingerprint(path.join(dir, "seq_%04d.png"))).toBeUndefined();
  });
});
