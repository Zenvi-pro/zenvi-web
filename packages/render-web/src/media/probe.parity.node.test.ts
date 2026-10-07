/**
 * probeMedia vs libopenshot 1.0.
 *
 * Generates small media with ffmpeg, probes it with `probeMedia` (Mediabunny
 * demuxes in Node; nothing is decoded) and compares with the reader JSON
 * libopenshot writes for the same file (desktop Python bindings). Without the
 * bindings (CI) it checks the fields that do not depend on encoder versions.
 */

import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReaderInfo } from "@zenvi/engine";
import { probeMedia } from "./probe.js";
import { ffmpeg, hasFfmpeg, inParallel, libopenshotReaderJson, makeTempDir, type TempDir } from "../test-support/node/fixtures.js";

const FIXTURES: Record<string, string[]> = {
  "a.webm": ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus", "-shortest"],
  "b.mp4": ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2:sample_rate=44100", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
  "c.mp3": ["-f", "lavfi", "-i", "sine=f=440:d=2", "-c:a", "libmp3lame"],
  "st.wav": ["-f", "lavfi", "-i", "sine=f=440:d=1", "-ac", "2", "-c:a", "pcm_s16le"],
  "st.flac": ["-f", "lavfi", "-i", "sine=f=440:d=1", "-ac", "2", "-c:a", "flac"],
  "st.ogg": ["-f", "lavfi", "-i", "sine=f=440:d=1", "-ac", "2", "-c:a", "libopus"],
  "v8.webm": ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=1", "-c:v", "libvpx", "-b:v", "100k"],
  "s51.m4a": ["-f", "lavfi", "-i", "sine=f=440:d=1", "-af", "pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0", "-c:a", "aac"],
};
const SVGS: Record<string, string> = {
  "mask.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="576" viewBox="0 0 720 576"><rect width="720" height="576" fill="#888"/></svg>',
  "inches.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="10mm"><rect width="10" height="10"/></svg>',
};

/** Fields that follow from how the fixtures were generated, whatever the ffmpeg build. */
const STRUCTURAL: Record<string, Partial<ReaderInfo>> = {
  "a.webm": { type: "FFmpegReader", has_video: true, has_audio: true, width: 320, height: 180, fps: { num: 30, den: 1 }, vcodec: "vp9", acodec: "opus", channels: 1, channel_layout: 4, sample_rate: 48000, video_stream_index: 0, audio_stream_index: 1, video_timebase: { num: 1, den: 1000 }, audio_timebase: { num: 1, den: 1000 }, display_ratio: { num: 16, den: 9 }, pixel_format: 0, video_length: 60 },
  "b.mp4": { type: "FFmpegReader", has_video: true, has_audio: true, width: 320, height: 180, fps: { num: 30000, den: 1001 }, vcodec: "h264", acodec: "aac", channels: 1, sample_rate: 44100, audio_timebase: { num: 1, den: 44100 }, pixel_format: 0 },
  "c.mp3": { type: "FFmpegReader", has_video: false, has_audio: true, width: 720, height: 480, fps: { num: 30, den: 1 }, vcodec: "", acodec: "mp3float", audio_timebase: { num: 1, den: 14112000 }, display_ratio: { num: 1, den: 1 }, pixel_format: -1, video_stream_index: -1, audio_stream_index: 0, media_type: "audio" },
  "st.wav": { acodec: "pcm_s16le", audio_bit_rate: 1411200, channels: 2, channel_layout: 3, sample_rate: 44100, video_length: 30, duration: 1 },
  "st.flac": { acodec: "flac", channels: 2, channel_layout: 3, sample_rate: 44100, audio_timebase: { num: 1, den: 44100 }, video_length: 30 },
  "st.ogg": { acodec: "opus", channels: 2, sample_rate: 48000, audio_timebase: { num: 1, den: 48000 } },
  "v8.webm": { vcodec: "vp8", has_audio: false, acodec: "", channels: 0, channel_layout: 4, sample_rate: 0, audio_timebase: { num: 1, den: 1 }, fps: { num: 24, den: 1 }, video_length: 24, duration: 1 },
  "s51.m4a": { channels: 6, channel_layout: 63, has_video: false, media_type: "audio" },
  "rot90.mp4": { width: 180, height: 320, display_ratio: { num: 9, den: 16 } },
  "mask.svg": { type: "QtImageReader", width: 720, height: 576, file_size: 720 * 576 * 4, video_length: 108000, duration: 3600, vcodec: "QImage", display_ratio: { num: 5, den: 4 }, has_single_image: true, media_type: "image" },
  "inches.svg": { width: 180, height: 35 },
};

/**
 * Known divergences, each with the reason. Everything else must match
 * libopenshot exactly.
 */
const ALLOWED: Record<string, string[]> = {
  // FFmpeg reads the LAME gapless header and drops encoder padding (2.0 s);
  // Mediabunny reports every frame (2.0375 s): one frame longer.
  "c.mp3": ["duration", "video_length"],
  // FFmpeg's Ogg format duration counts the Opus pre-skip, so its format
  // bitrate (used as the stream bitrate) is slightly lower.
  "st.ogg": ["audio_bit_rate"],
};

describe.skipIf(!hasFfmpeg())("probeMedia parity with libopenshot FFmpegReader/QtImageReader", () => {
  let tmp: TempDir;
  let reference: Record<string, Record<string, unknown>> | null = null;
  const probed: Record<string, ReaderInfo> = {};

  beforeAll(async () => {
    tmp = makeTempDir();
    const dir = tmp.dir;
    await inParallel([
      ...Object.entries(FIXTURES).map(([name, args]) => () => ffmpeg(dir, [...args, name])),
      async () => {
        await ffmpeg(dir, ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "base.mp4"]);
        await ffmpeg(dir, ["-display_rotation", "90", "-i", "base.mp4", "-c", "copy", "rot90.mp4"]);
      },
    ]);
    for (const [name, text] of Object.entries(SVGS)) writeFileSync(tmp.path(name), text);
    const names = [...Object.keys(FIXTURES), "rot90.mp4", ...Object.keys(SVGS)];
    const referencePromise = libopenshotReaderJson(dir, names);
    for (const name of names) {
      probed[name] = await probeMedia({ kind: "blob", blob: new File([tmp.read(name) as BlobPart], name) }, { path: name });
    }
    reference = await referencePromise;
  }, 240_000);

  afterAll(() => tmp?.cleanup());

  it.each(Object.keys(STRUCTURAL))("%s: structural fields", (name) => {
    const info = probed[name]!;
    for (const [key, value] of Object.entries(STRUCTURAL[name]!)) {
      expect.soft(info[key], `${name}.${key}`).toEqual(value);
    }
  });

  it("rotated video carries libopenshot's rotate tag", () => {
    expect(probed["rot90.mp4"]!.metadata?.rotate).toBe("-90.000000");
  });

  it("matches libopenshot field for field when its bindings are installed", (ctx) => {
    if (!reference) ctx.skip();
    for (const [name, expected] of Object.entries(reference!)) {
      const info = probed[name]!;
      const allowed = new Set<string>(ALLOWED[name] ?? []);
      for (const [key, value] of Object.entries(expected)) {
        if (allowed.has(key)) continue;
        if (key === "metadata") {
          // Mediabunny exposes fewer tags than FFmpeg; what it does report must agree.
          for (const [tag, tagValue] of Object.entries(info.metadata ?? {})) {
            expect.soft((value as Record<string, string>)[tag], `${name}.metadata.${tag}`).toBe(tagValue);
          }
          continue;
        }
        expect.soft(info[key], `${name}.${key}`).toEqual(value);
      }
    }
  });
});
