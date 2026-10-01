/**
 * @zenvi/render-web in a real browser: WebCodecs decode/encode, Canvas2D
 * compositing and Web Audio, on media generated with ffmpeg.
 *
 *   npx playwright test -c packages/render-web/e2e/playwright.config.ts
 */

import { expect, test } from "@playwright/test";
import { attach, prepareFixtures, type Fixtures } from "./support/fixtures.js";

let fixtures: Fixtures;

test.beforeAll(async () => {
  fixtures = await prepareFixtures();
});

test.afterAll(() => fixtures?.cleanup());

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("page error:", error));
  await attach(page, fixtures);
});

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => i + from);

test("probeMedia writes the desktop's reader info in the browser", async ({ page }) => {
  const names = ["codes.webm", "tone48.wav", "still.png", ...(fixtures.hasH264 ? ["codes.mp4"] : [])];
  const info = await page.evaluate((n) => window.harness.probe(n), names);
  expect(info["codes.webm"]).toMatchObject({
    type: "FFmpegReader",
    vcodec: "vp9",
    width: 160,
    height: 90,
    fps: { num: 30, den: 1 },
    video_length: 60,
    duration: 2,
    has_video: true,
    has_audio: false,
    display_ratio: { num: 16, den: 9 },
    video_timebase: { num: 1, den: 1000 },
    media_type: "video",
  });
  expect(info["tone48.wav"]).toMatchObject({ acodec: "pcm_f32le", sample_rate: 48000, channels: 2, channel_layout: 3, video_length: 90, media_type: "audio" });
  expect(info["still.png"]).toMatchObject({ type: "QtImageReader", width: 64, height: 36, file_size: 64 * 36 * 4, video_length: 108000, media_type: "image" });
  if (fixtures.hasH264) expect(info["codes.mp4"]).toMatchObject({ vcodec: "h264", fps: { num: 30, den: 1 }, video_length: 60 });
});

test("frames are frame-accurate in playback and scrubbing, and freeze past the end", async ({ page }) => {
  const result = await page.evaluate(() => window.harness.frameAccuracy("codes.webm", 30, 60));
  expect(result.sequential).toEqual(range(60));
  for (const { k, code } of result.random) expect(code, `frame ${k}`).toBe(k - 1);
  expect(result.pastEnd).toBe(59);

  const at25 = await page.evaluate(() => window.harness.frameAccuracy("codes25.webm", 25, 50));
  expect(at25.sequential).toEqual(range(50));
});

test("H.264 MP4 decodes frame-accurately too (when the platform decodes it)", async ({ page }) => {
  test.skip(!fixtures.hasH264, "ffmpeg without libx264");
  const result = await page.evaluate(() => window.harness.frameAccuracy("codes.mp4", 30, 60));
  expect(result.sequential).toEqual(range(60));
  for (const { k, code } of result.random) expect(code, `frame ${k}`).toBe(k - 1);
});

test("an expired signed URL is refreshed and read with range requests", async ({ page }) => {
  const result = await page.evaluate(() => window.harness.signedUrl("codes.webm"));
  expect(result).toEqual({ code: 30, refreshes: 1, videoLength: 60 });
});

test("the compositor draws opacity, blend modes, kernels, masks and stills on real canvases", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.compositing());
  const near = (actual: number[], expected: number[], tolerance = 3) => actual.slice(0, expected.length).forEach((v, i) => expect(Math.abs(v - expected[i]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance));
  expect(r.opacityErrors).toEqual([]);
  near(r.opacity.left, [255, 0, 0, 255]);
  near(r.opacity.right, [128, 0, 128, 255]);
  near(r.screen, [255, 255, 0, 255]);
  near(r.invert, [55, 155, 205, 255]);
  expect(r.maskErrors).toEqual([]);
  near(r.mask.left, [0, 0, 0, 255]);
  near(r.mask.right, [255, 255, 255, 255]);
  expect(r.halvedErrors).toEqual([]);
  expect(r.halvedCode).toBe(37);
  near(r.canvasStage.inside, [245, 235, 225, 255]);
  near(r.canvasStage.outside, [0, 0, 0, 255]);
  near(r.stills.png, [200, 50, 50, 255]);
  near(r.stills.svg, [0, 255, 0, 255]);
  expect(r.cacheStable).toBe(true);
  expect(r.videoCode).toBe(11);
});

test("the real engine end to end: ops-built project, planFrame, compositor, export", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.realEngine());
  console.log(`real planFrame layer 0: ${JSON.stringify(r.plan10)}`);
  expect(r.codes).toEqual(range(60));
  expect(r.lastFrame).toBe(60);
  expect(r.plan10).toMatchObject({ width: 160, height: 90, layers: 1, source: { kind: "video", fileId: "codes", frame: 10 } });
  expect((r.plan10.source as { time: number }).time).toBeCloseTo(9 / 30, 9);
  // Preview boxes fit the project and never exceed it (Timeline::SetMaxSize).
  expect(r.preview).toEqual([160, 90]);
  expect(r.small).toEqual([80, 45]);
  expect(r.scaled.corner.slice(0, 3)).toEqual([0, 0, 0]);
  expect(r.scaled.code).toBe(9);
  expect(r.exportedCodes).toEqual([0, 1, 9, 44]);
});

test("kernel resources: corner radius, opacity before canvas effects, video masks, kernel audio, text", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.kernelResources());
  const near = (actual: number[], expected: number[], tolerance = 4) => actual.slice(0, expected.length).forEach((v, i) => expect(Math.abs(v - expected[i]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance));
  expect(r.errors).toEqual([]);
  near(r.corners.corner, [0, 0, 0, 255]);
  near(r.corners.center, [255, 255, 255, 255]);
  near(r.corners.edgeMid, [255, 255, 255, 255]);
  near(r.opacityFirst, [255, 255, 255, 255]);
  expect(r.videoMaskCode).toBe(43);
  near(r.audioPixel, [128, 128, 128, 255], 6);
  expect(r.text.ascent).toBeGreaterThan(20);
  expect(r.text.descent).toBeGreaterThan(3);
  expect(r.text.advance).toBeGreaterThan(60);
  expect(r.text.inkWidth).toBeGreaterThan(50);
  expect(r.text.inked).toBeGreaterThan(300);
  expect(r.text.outside).toBe(0);
});

test("export produces a playable file of the right length whose frames match the timeline", async ({ page }) => {
  for (const format of ["webm", "mp4"] as const) {
    const result = await page.evaluate((f) => window.harness.exportRoundTrip(f), format);
    console.log(`export ${format}: ${result.mime}, ${result.size} bytes in ${Math.round(result.elapsed)} ms; notes: ${result.notes.join("; ") || "none"}`);
    expect(result.info.has_video).toBe(true);
    expect(result.info.has_audio).toBe(true);
    expect(result.info.width).toBe(160);
    expect(result.info.height).toBe(90);
    expect(result.info.fps).toEqual({ num: 30, den: 1 });
    expect(Math.abs((result.info.video_length as number) - 60)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.info.duration - 2)).toBeLessThan(0.05);
    expect(result.codes).toEqual(range(60));
    expect(Math.max(...result.peaks)).toBeGreaterThan(0.3);
    expect(result.progress.monotonic).toBe(true);
    expect(result.progress.last).toMatchObject({ fraction: 1, stage: "finalizing", frames: 60 });
    if (format === "webm") expect(result.mime).toMatch(/^video\/webm/);
    else expect(result.mime).toMatch(/^video\/(mp4|webm)/);
  }
});

test("export streams into an OPFS file, and a cancelled one leaves no partial file", async ({ page }) => {
  const done = await page.evaluate(() => window.harness.exportToOpfs(false));
  expect(done.ok, done.message).toBe(true);
  expect(done.mime).toMatch(/^video\/webm/);
  expect(done.bytes).toBe(done.fileSize);
  // WebM has no stream durations: the segment's (Opus padding included) can round to one more frame.
  expect(Math.abs(Number(done.videoLength) - 60)).toBeLessThanOrEqual(1);
  expect(done.hasAudio).toBe(true);
  expect(done.code).toBe(30);
  const cancelled = await page.evaluate(() => window.harness.exportToOpfs(true));
  expect(cancelled.ok).toBe(false);
  expect(cancelled.message).toContain("stop streaming");
  expect(cancelled.fileSize).toBe(0);
});

test("exports keep the clips' sound: an audio stream with each tone where its clip is (QA repro)", async ({ page }) => {
  for (const format of ["mp4", "webm"] as const) {
    const r = await page.evaluate((f) => window.harness.exportWithAudio(f), format);
    console.log(`export ${format} with audio: ${r.mime} ${r.acodec}; first ${r.first.rms.toFixed(3)} rms ${r.first.hz.toFixed(0)} Hz, second ${r.second.rms.toFixed(3)} rms ${r.second.hz.toFixed(0)} Hz; notes: ${r.notes.join("; ") || "none"}`);
    expect(r.hasAudio).toBe(true);
    expect(r.duration).toBeCloseTo(4, 1);
    // 0.3 amplitude sines: RMS ≈ 0.21.
    expect(r.first.rms).toBeGreaterThan(0.12);
    expect(r.second.rms).toBeGreaterThan(0.12);
    expect(Math.abs(r.first.hz - 440)).toBeLessThan(15);
    expect(Math.abs(r.second.hz - 660)).toBeLessThan(15);
  }
});

test("export can be cancelled", async ({ page }) => {
  const result = await page.evaluate(() => window.harness.exportCancel());
  expect(result.rejected).toBe(true);
  expect(result.message).toContain("user cancelled");
});

test("exportFrame renders the frame at a time", async ({ page }) => {
  const result = await page.evaluate(() => window.harness.exportStill(1.5));
  expect(result).toEqual({ type: "image/png", code: 45 });
});

test("audio mixes offline without seams, at the clip's position, same-rate and resampled", async ({ page }) => {
  for (const [name, rate] of [
    ["tone48.wav", 48000],
    ["tone44.wav", 48000],
  ] as const) {
    const r = await page.evaluate(([n, sr]) => window.harness.audioMix(n, sr), [name, rate] as const);
    console.log(`${name} → ${rate}: max error ${r.maxError.toExponential(2)}, body ${r.body.toExponential(2)}, seams ${r.seamDiffs.map((d) => d.toExponential(2)).join(", ")}`);
    expect(r.length).toBe(r.expectedLength);
    expect(r.silenceBefore).toBeLessThan(1e-4);
    expect(r.maxError).toBeLessThan(name === "tone48.wav" ? 1e-4 : 2e-2);
    for (const d of r.seamDiffs) expect(d).toBeLessThan(r.body * 3 + 1e-3);
  }
});

test("gain envelopes, speed and audio kernels shape the mix", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.audioShaping());
  expect(r.fadeEarly).toBeLessThan(0.1);
  expect(r.fadeLate).toBeGreaterThan(0.4);
  expect(r.normalCrossingsPerSecond).toBeCloseTo(440, -1);
  expect(r.fastCrossingsPerSecond).toBeCloseTo(880, -1);
  expect(r.effectPeak).toBeCloseTo(0.125, 2);
});

test("the default engine's audio effects run in the mix, continuously across frame-aligned windows", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.realAudioEffects());
  // Delay 0.25 s, 100 % wet: silence, then the source 12000 samples late.
  expect(r.delay.effects).toEqual(["Delay"]);
  expect(r.delay.length).toBe(3 * 48000);
  expect(r.delay.pieceLength).toBe(3 * 48000);
  expect(r.delay.windows).toBeGreaterThan(5);
  expect(r.delay.head).toBe(0);
  expect(r.delay.delayError).toBeLessThan(1e-6);
  expect(r.delay.windowDiff).toBe(0);
  // Noise draws per sample in block order: equal only when windows split between frames.
  expect(r.noise.effects).toEqual(["Noise"]);
  expect(r.noise.noiseChange).toBeGreaterThan(0.01);
  expect(r.noise.windowDiff).toBe(0);
});

test("PreviewPlayer seeks, coalesces, plays on the audio clock, pauses on a frame and loops", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.player());
  console.log(`player: advanced ${r.advanced.toFixed(3)} s in ~0.9 s, ${r.timeEvents} time events; errors: ${r.errors.join("; ") || "none"}`);
  if (r.advanced <= 0.25) console.log(`  clock trace:\n  ${r.trace.join("\n  ")}`);
  expect(r.size).toEqual([320, 180]);
  expect(r.seekCode).toBe(30);
  expect(r.coalescedCode).toBe(45);
  // ~0.9 s of wall time, minus the audio start delay and output latency (more on a loaded machine).
  expect(r.advanced).toBeGreaterThan(0.25);
  expect(r.advanced).toBeLessThan(1.3);
  expect(r.monotonic).toBe(true);
  expect(r.paused.code).toBe(r.paused.expected);
  expect(r.looped).toBe(true);
  expect(r.ended.playing).toBe(false);
  expect(r.ended.frame).toBe(60);
  expect(r.duration).toBeCloseTo(2, 6);
  expect(r.errors).toEqual([]);
});

test("scrubbing long-GOP media shows a keyframe at once, then the exact frame", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.scrub());
  expect(r.preview).toEqual({ exact: false, code: 0 });
  expect(r.exact).toEqual({ exact: true, code: 45 });
  expect(r.againExact).toBe(true);
  // The player drew the keyframe first and settled on the exact frame (1.2 s → frame index 36).
  expect(r.shown[0]).toBe(0);
  expect(r.shown.at(-1)).toBe(36);
  expect(r.finalCode).toBe(36);
});

test("thumbnails and waveforms for the timeline", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.timelineHelpers());
  expect(r.count).toBe(4);
  expect(r.size).toEqual([80, 45]);
  // Keyframes every 30 frames: thumbnails at 0.25/0.75/1.25/1.75 s show frames 0, 0, 30, 30.
  expect(r.codes).toEqual([0, 0, 30, 30]);
  expect(r.exactCodes).toEqual([15, 45]);
  expect(r.stillCount).toBe(3);
  expect(r.stillSize).toEqual([36, 20]);
  expect(r.audioThumbs).toBe(0);
  expect(r.peaks).toHaveLength(30);
  for (const p of r.peaks) expect(p).toBeCloseTo(0.5, 2);
  expect(r.silentVideo).toEqual([0, 0, 0, 0, 0]);
});

test("playback cost: 720p VP9 at preview size", async ({ page }) => {
  const r = await page.evaluate(() => window.harness.playbackCost());
  console.log(`720p VP9 → 640×360: sequential ${r.sequentialMs.toFixed(1)} ms/frame, random seek ${r.seekMs.toFixed(1)} ms, cached ${r.cachedMs.toFixed(2)} ms`);
  // Lenient bounds (shared, loaded CI machines); the log line is the signal.
  expect(r.sequentialMs).toBeLessThan(100);
  expect(r.cachedMs).toBeLessThan(r.seekMs);
});
