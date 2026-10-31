/**
 * review_render_tool through runTool: the host's detectors are a stub, the
 * frames come from the engine's own compositor (test-support/pixel-host.ts)
 * painting the "rendered file" by its source time, so hashing and the
 * contact sheet run for real.
 */

import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../../render/types.js";
import { ProjectDocument } from "../../history/document.js";
import { repeatedCut } from "../test-support/repeated-cut.js";
import { runTool } from "../registry.js";
import { EditHarness } from "../test-support/edit-harness.js";
import { fakeShotHost } from "../test-support/fake-shots.js";
import { pixelFrameHost } from "../test-support/pixel-host.js";
import type { RenderInspection, RenderInspectOptions } from "../types.js";

type Row = Record<string, unknown>;

/** Vertical stripes `period` pixels wide with footage's grain: different periods hash apart. */
function stripes(width: number, height: number, period: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const on = Math.floor((x * 64) / width / period) % 2 === 0;
      const grain = ((x * 7 + y * 13) % 5) * 6 - 12;
      data.set([(on ? 230 : 20) + grain, (on ? 200 : 30) + grain, (on ? 180 : 40) + grain, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** The "render": shot A (0-2 s), B (2-4 s), A again (4-6 s), C (6-9.2 s), then black. */
function painted(): EditHarness {
  const ed = new EditHarness();
  const probe = ed.host.media!.probe;
  ed.host.media!.probe = async (path) => ({ ...(await probe(path)), duration: 10 });
  ed.host.frames = pixelFrameHost((path, w, h, t) => {
    if (path.endsWith(".svg")) return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    if (t >= 9.2) return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255).map((v, i) => (i % 4 === 3 ? 255 : 0)) };
    return stripes(w, h, t < 2 || (t >= 4 && t < 6) ? 4 : t < 4 ? 2 : 8);
  });
  return ed;
}

function inspection(path: string): RenderInspection {
  return {
    path: `/renders/${path}`,
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    black: [{ start: 9.2, end: 9.967 }],
    frozen: [{ start: 9.2, end: 10 }],
    cuts: [2, 4, 6, 9.2].map((time) => ({ time, score: 40 })),
    silences: [],
    loudness: { integratedLufs: -10.5, rangeLu: 2.6, truePeakDb: 0.5 },
  };
}

describe("review_render_tool", { timeout: 30_000 }, () => {
  it("reports the end on black, the clipping and the repeated shot, with a contact sheet", async () => {
    const ed = painted();
    const asked: RenderInspectOptions[] = [];
    ed.host.media!.inspectRender = async (path, options) => {
      asked.push(options);
      return inspection(path);
    };
    ed.mark();
    const result = await runTool({ doc: ed.doc, host: ed.host }, "review_render_tool", { path: "out.mp4", max_tiles: 6 });
    const receipt = result.data!;
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(0);
    expect(ed.stepsSinceMark()).toBe(0);
    expect(asked[0]).toMatchObject({ blackMinSeconds: 0.06, sceneThreshold: 9 });
    expect(receipt.summary).toMatch(/^Reviewed out\.mp4 \(10\.00s, 1920x1080\): 2 problem\(s\), 2 warning\(s\)\. 5 shot\(s\), 4 distinct/);
    expect(receipt.summary).toContain("- PROBLEM: ends on 0.80s of black from 9.20s");
    expect(receipt.summary).toContain("- PROBLEM: true peak +0.5 dBTP is over the -1.0 dBTP ceiling: it clips; master the audio");
    expect(receipt.summary).toContain("- warning: the same shot appears 2 times (shots #1, #3 at 0.00s, 4.00s)");
    // The watch is of the render made after the fixes, not this one.
    expect(receipt.summary).toContain("rendered again with no PROBLEM left: watch_render_tool {path: the new render} once");
    expect(receipt.summary).not.toContain('watch_render_tool {"path":"out.mp4"}');
    const data = receipt.data as Row;
    expect(data.ok).toBe(false);
    expect(data.repeats).toEqual([{ shots: [1, 3], minGapSeconds: 4 }]);
    expect((data.end as Row).kind).toBe("black");
    const tiles = (data.sheet as Row).tiles as Row[];
    expect(tiles.map((t) => t.flag)).toEqual([null, null, "REPEAT of #1", null, "BLACK", "ENDS ON BLACK"]);
    expect(result.images).toHaveLength(1);
    expect(result.images![0]!.mimeType).toBe("image/png");
  });

  it("warns about back-to-back shots that look the same when the shot model is installed", async () => {
    const ed = painted();
    ed.host.media!.inspectRender = async (path) => inspection(path);
    const shots = fakeShotHost({ "/renders/out.mp4": [[0, "face"], [2, "city"], [6, "dog"], [9.2, "moon"]] });
    ed.host.shots = shots;
    const receipt = (await runTool({ doc: ed.doc, host: ed.host }, "review_render_tool", { path: "out.mp4" })).data!;
    const problems = (receipt.data as Row).problems as { kind: string; at: number; message: string }[];
    expect(problems.filter((p) => p.kind === "near_duplicate_shots")).toEqual([
      expect.objectContaining({ at: 4, message: expect.stringMatching(/^shots 2 and 3 look almost the same \(similarity 1\.00\)/) }),
    ]);
    expect(shots.calls).toEqual(["frames /renders/out.mp4 1.00,3.00,5.00,7.60,9.60"]);
  });

  it("hands back the swap that fixes a repeated shot when the render is of the open timeline", async () => {
    const ed = painted();
    ed.host.media!.inspectRender = async (path) => ({ ...inspection(path), black: [], frozen: [], cuts: [2, 4, 6].map((time) => ({ time, score: 40 })) });
    const doc = new ProjectDocument(repeatedCut(["video"]));
    const receipt = (await runTool({ doc, host: ed.host }, "review_render_tool", { path: "out.mp4" })).data!;
    expect(receipt.summary).toContain('- 4.00s FILEAAAAAA.mp4 → FILEXTRA00.mp4 from 1.20s (unused clip): swap_shot_tool {"clip_id":"CLIPA00002","file_id":"FILEXTRA00","start_seconds":1.2}');
    expect((receipt.data as Row).swaps).toHaveLength(1);
    // The open project has no sound design and no master yet: the review says so, with the calls.
    expect(receipt.summary).toContain("Not finished (the open project)");
    expect(receipt.summary).toContain('- FINISH: No sound design');
    expect(((receipt.data as Row).finish as { kind: string }[]).map((g) => g.kind)).toContain("master");
    // A render of another edit (the harness's 19 s timeline): no swaps, rather than wrong ones.
    const other = (await runTool({ doc: ed.doc, host: ed.host }, "review_render_tool", { path: "out.mp4" })).data!;
    expect((other.data as Row).swaps).toBeNull();
  });

  it("is a clean bill when the render is fine, and refuses where there is no ffmpeg", async () => {
    const ed = painted();
    ed.host.media!.inspectRender = async (path) => ({
      ...inspection(path),
      black: [],
      frozen: [{ start: 8.5, end: 10 }],
      cuts: [{ time: 2, score: 40 }],
      loudness: { integratedLufs: -14.1, rangeLu: 3, truePeakDb: -1.4 },
    });
    const ok = (await runTool({ doc: ed.doc, host: ed.host }, "review_render_tool", { path: "out.mp4" })).data!;
    expect(ok.summary).toMatch(
      /0 problem\(s\), 0 warning\(s\)\. 2 shot\(s\), 2 distinct, 0\.2 cuts\/s; -14\.1 LUFS, true peak -1\.4 dBTP; ends on a 1\.50s hold\./,
    );
    expect((ok.data as Row).ok).toBe(true);
    expect(ok.summary).toContain('\nNext: watch_render_tool {"path":"out.mp4"} once');

    ed.host.media!.inspectRender = async () => {
      throw new Error("No such file");
    };
    const missing = (await runTool({ doc: ed.doc, host: ed.host }, "review_render_tool", { path: "nope.mp4" })).data!;
    expect(missing.summary).toBe("Error: could not read nope.mp4: No such file");

    delete ed.host.media!.inspectRender;
    const none = (await runTool({ doc: ed.doc, host: ed.host }, "review_render_tool", { path: "out.mp4" })).data!;
    expect(none.summary).toMatch(/^Error: review_render_tool is not available in this Zenvi surface: reading a rendered file needs ffmpeg/);
  });
});
