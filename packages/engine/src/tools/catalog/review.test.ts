import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { addClip, fadeClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { addTitleClip } from "../../ops/titles.js";
import type { MixMeasurement, SheetResult, ToolHost } from "../types.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { fakeShotHost } from "../test-support/fake-shots.js";
import { audioInfo, media, videoInfo } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;
const TOOL = "review_edit_tool";

/** A 120 BPM kick groove: a hit every half second. */
function groove(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let n = 0; n * 0.5 < seconds; n += 1) {
    const start = Math.round(n * 0.5 * SR);
    for (let k = 0; k < SR * 0.25 && start + k < out.length; k += 1) {
      out[start + k] = out[start + k]! + (n % 4 === 0 ? 0.9 : 0.6) * Math.exp(-k / (0.07 * SR)) * Math.sin((2 * Math.PI * (50 + 70 * Math.exp(-k / (0.02 * SR))) * k) / SR);
    }
  }
  return out;
}

interface Rig {
  doc: ProjectDocument;
  host: FakeHost;
  sheets: { tiles: number; columns: number; tileWidth: number; tileHeight: number }[];
  mixes: number;
}

/** `shots` back-to-back clips of `length` seconds over a song; the host mixes and composes sheets like the CLI's. */
function rig(shots: number, length: number, options: { sheet?: boolean; mix?: boolean; title?: string } = {}): Rig {
  const doc = new ProjectDocument(createProject({ id: "REVIEWTOOL" }));
  doc.transaction("fixture", (tx) => {
    addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 60)), { id: "SONGXXXXXX" });
    for (let i = 0; i < shots; i += 1) {
      const path = `/media/shot${i}.mp4`;
      const file = addFile(tx, media(path, videoInfo(path, 20, { has_audio: false })), { id: `SHOT${i}`.padEnd(10, "X") });
      addClip(tx, { fileId: file.id, position: i * length, layer: 1_000_000, start: 0, end: length });
    }
    addClip(tx, { fileId: "SONGXXXXXX", position: 0, layer: 2_000_000, start: 0, end: shots * length });
    if (options.title) {
      addTitleClip(tx, { file: media("/media/title.svg", { ...videoInfo("/media/title.svg", 3600), has_audio: false }), position: 0, duration: 1, layer: 3_000_000 });
    }
  });
  const host = fakeHost(options.title ? { texts: { "/media/title.svg": options.title } } : {});
  const out: Rig = { doc, host, sheets: [], mixes: 0 };
  if (options.sheet !== false) {
    host.frames!.renderSheet = async (_project, tiles, layout): Promise<SheetResult> => {
      out.sheets.push({ tiles: tiles.length, columns: layout.columns, tileWidth: layout.tileWidth, tileHeight: layout.tileHeight });
      const rows = Math.ceil(tiles.length / layout.columns);
      return {
        image: { mimeType: "image/jpeg", data: "/9j/AAAA" },
        width: layout.columns * layout.tileWidth + (layout.columns + 1) * layout.gap,
        height: rows * layout.tileHeight + (rows + 1) * layout.gap,
        luma: tiles.map(() => 0.4),
        peak: tiles.map(() => 0.8),
      };
    };
  }
  if (options.mix !== false) {
    host.audio!.measureMix = async (_project, o): Promise<MixMeasurement> => {
      out.mixes += 1;
      return { lufs: -14.2, peakDb: -1.3, silences: [], pcm: { sampleRate: SR, samples: groove(Math.min(60, (o?.range?.end ?? 30) - (o?.range?.start ?? 0))) } };
    };
  }
  return out;
}

async function review(r: Rig, args: Record<string, unknown> = {}) {
  const before = r.doc.project.history.undo.length;
  const result = await runTool({ doc: r.doc, host: r.host as ToolHost }, TOOL, args);
  // A review reads; it never records an undo step.
  expect(r.doc.project.history.undo.length).toBe(before);
  return result;
}

// The receipt's data is checked field by field below; a loose type keeps the assertions readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dataOf = (result: { data?: unknown }): Record<string, any> => (result.data as { data: Record<string, any> }).data;

describe("review_edit_tool", () => {
  it("returns one small sheet image and a structured receipt for an edit that cuts on the beat", async () => {
    const r = rig(20, 0.5);
    const result = await review(r);
    expect(result.ok, result.text).toBe(true);
    expect(result.images).toHaveLength(1);
    expect(result.images![0]!.mimeType).toBe("image/jpeg");
    const data = dataOf(result);
    expect(data).toMatchObject({ pace: "fast", shots: { count: 20, medianSeconds: 0.5, maxSeconds: 0.5 }, cuts: { count: 19, hard: 19, transitions: 0 }, audioClips: 1 });
    expect(data.cuts.perSecond).toBeCloseTo(1.9, 1);
    expect(data.shots.lengthsSeconds).toHaveLength(20);
    expect(data.rhythm).toMatchObject({ bpm: expect.any(Number) });
    expect(data.rhythm.onTransient).toBeGreaterThan(0.8);
    expect(data.mix).toMatchObject({ lufs: -14.2, peakDb: -1.3 });
    expect(data.problems).toEqual([]);
    expect(data.ok).toBe(true);
    // The sheet costs under 2K image tokens and is sampled when the edit is long.
    expect(data.sheet.approxImageTokens).toBeLessThan(2000);
    expect(data.sheet.tiles).toBeLessThanOrEqual(24);
    expect(data.sheet).toMatchObject({ cutsTotal: 19, cutsShown: 11 });
    expect(result.text).toContain("No problems found.");
    expect(result.text).toContain("Only 11 of 19 cuts are on the sheet");
  });

  it("lists problems with times when the edit is a slideshow cut off the beat", async () => {
    const r = rig(6, 1.6);
    const result = await review(r);
    const data = dataOf(result);
    const codes = data.problems.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["long-hold", "cuts-off-beat", "slow-pace"]));
    const off = data.problems.find((p: { code: string }) => p.code === "cuts-off-beat");
    expect(off.times.length).toBeGreaterThan(0);
    expect(off.fix).toMatch(/beat/);
    expect(data.ok).toBe(false);
    expect(result.text).toMatch(/3 problems, worst first .*: long-hold@0\.00s, slow-pace@0\.00s, cuts-off-beat@3\.20s\./);
    // The same edit is fine when it is meant to be slow.
    expect(dataOf(await review(r, { pace: "slow" })).problems.map((p: { code: string }) => p.code)).not.toContain("slow-pace");
  });

  it("zooms in on a range with bigger frames", async () => {
    const r = rig(20, 0.5);
    await review(r);
    const wide = r.sheets[0]!;
    const result = await review(r, { start: 2, end: 4, tile_width: 320 });
    const data = dataOf(result);
    expect(data.range).toEqual({ start: 2, end: 4 });
    expect(data.cuts.count).toBe(4);
    expect(r.sheets[1]!.tileWidth).toBeGreaterThan(wide.tileWidth);
    expect(r.sheets[1]!.tileWidth).toBeLessThanOrEqual(320);
    expect(data.sheet.cutsShown).toBe(4);
  });

  it("skips the sheet and the audio mixdown when asked", async () => {
    const r = rig(10, 0.5);
    const result = await review(r, { image: "false", audio: "false" });
    expect(result.ok, result.text).toBe(true);
    expect(result.images ?? []).toEqual([]);
    expect(r.sheets).toHaveLength(0);
    expect(r.mixes).toBe(0);
    expect(dataOf(result).sheet).toBeNull();
    expect(dataOf(result).rhythm).toBeNull();
  });

  it("still reviews the timeline on a surface that cannot compose sheets or mix audio", async () => {
    const r = rig(10, 0.5, { sheet: false, mix: false });
    const result = await review(r);
    expect(result.ok, result.text).toBe(true);
    expect(result.images ?? []).toEqual([]);
    const data = dataOf(result);
    expect(data.shots.count).toBe(10);
    expect(data.mix).toBeNull();
    expect((result.data as { warnings: string[] }).warnings.join(" ")).toMatch(/contact sheet/);
  });

  it("flags black frames and white flashes the sheet showed", async () => {
    const r = rig(6, 1);
    r.host.frames!.renderSheet = async (_p, tiles) => ({
      image: { mimeType: "image/jpeg", data: "AAAA" },
      width: 100,
      height: 100,
      luma: tiles.map((t) => (t.label === "2.00 in" ? 0.0 : 0.4)),
      peak: tiles.map((t) => (t.label === "2.00 in" ? 0.0 : 0.8)),
    });
    const data = dataOf(await review(r));
    expect(data.problems.find((p: { code: string }) => p.code === "black-frame")).toMatchObject({ severity: "high", at: expect.closeTo(2, 1) });
  });

  it("takes the first frame of a fade from black for the fade, not a black frame", async () => {
    const r = rig(6, 1);
    r.doc.transaction("fade in", (tx) => fadeClip(tx, String(tx.project.clips.find((c) => c.file_id === "SHOT0XXXXX")!.id), { fadeIn: 0.5 }));
    const marks: (string | undefined)[] = [];
    r.host.frames!.renderSheet = async (_p, tiles) => {
      marks.push(...tiles.map((t) => t.mark));
      return { image: { mimeType: "image/jpeg", data: "AAAA" }, width: 100, height: 100, luma: tiles.map((t) => (t.seconds < 0.1 ? 0 : 0.4)), peak: tiles.map((t) => (t.seconds < 0.1 ? 0 : 0.8)) };
    };
    const data = dataOf(await review(r));
    expect(data.problems.map((p: { code: string }) => p.code)).not.toContain("black-frame");
    // The host borders only what the data would flag: the fading first tile gets no mark, the others may be black.
    expect(marks[0]).toBeUndefined();
    expect(marks.slice(1).every((m) => m === "black")).toBe(true);
  });

  it("estimates title text outside the safe area from the title's SVG", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><text style="font-size:120px"><tspan x="1700" y="540">WAY TOO FAR RIGHT</tspan></text></svg>';
    const data = dataOf(await review(rig(8, 0.5, { title: svg })));
    expect(data.text.clips).toBe(1);
    expect(data.problems.map((p: { code: string }) => p.code)).toContain("text-off-frame");
  });

  it("refuses an empty timeline and an upside-down range without touching history", async () => {
    const empty = new ProjectDocument(createProject({ id: "EMPTYPROJ0" }));
    const result = await runTool({ doc: empty, host: fakeHost() }, TOOL, {});
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Error: the timeline has no video or image clips to review");
    const r = rig(4, 0.5);
    const bad = await review(r, { start: 3, end: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain("Error: end must be after start");
    const outside = await review(r, { start: 30, end: 40 });
    expect(outside.ok).toBe(false);
    expect(outside.text).toContain("Error: no video or image clips in 30-40 s; the edit runs to 2.00 s.");
  });

  it("survives a mixdown failure and says so", async () => {
    const r = rig(10, 0.5);
    r.host.audio!.measureMix = async () => {
      throw new Error("ffmpeg exploded");
    };
    const result = await review(r);
    expect(result.ok, result.text).toBe(true);
    expect((result.data as { warnings: string[] }).warnings.join(" ")).toContain("Could not measure the audio: ffmpeg exploded");
    expect(dataOf(result).mix).toBeNull();
  });
});

describe("review_edit_tool near-duplicate shots", () => {
  /** Four 1 s shots: shot1 and shot2 show the same city street from two files; the others differ. */
  function lookRig(ready: boolean) {
    const r = rig(4, 1);
    const shots = fakeShotHost(
      { "/media/shot0.mp4": [[0, "face"]], "/media/shot1.mp4": [[0, "city"]], "/media/shot2.mp4": [[0, "city"]], "/media/shot3.mp4": [[0, "dog"]] },
      { ready, durations: { "/media/shot0.mp4": 20, "/media/shot1.mp4": 20, "/media/shot2.mp4": 20, "/media/shot3.mp4": 20 }, tints: { "/media/shot2.mp4": 0.2 } },
    );
    r.host.shots = shots;
    return { r, shots };
  }

  it("flags back-to-back shots that look the same, with swaps for the second", async () => {
    const { r, shots } = lookRig(true);
    const problems = dataOf(await review(r)).problems as { code: string; at: number; shots?: number[]; message: string }[];
    const near = problems.find((p) => p.code === "near-duplicate-shots");
    expect(near).toMatchObject({ at: 2, shots: [2] });
    expect(near!.message).toMatch(/shot1\.mp4 → shot2\.mp4 at 2\.00s, similarity 0\.98/);
    // Not embedded yet: one frame from the middle of each shot, nothing cached, no download.
    expect(shots.calls.every((c) => c.startsWith("frames "))).toBe(true);
  });

  it("does nothing without the model installed", async () => {
    const { r, shots } = lookRig(false);
    const problems = dataOf(await review(r)).problems as { code: string }[];
    expect(problems.some((p) => p.code === "near-duplicate-shots")).toBe(false);
    expect(shots.calls).toEqual([]);
  });
});
