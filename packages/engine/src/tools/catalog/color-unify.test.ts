/**
 * unify_grade_tool through runTool, with frames from the engine's own
 * compositor (test-support/pixel-host.ts), so the measuring and the
 * correction passes run for real.
 */

import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../../render/types.js";
import { findColorGrade, scalarY } from "../color-agent.js";
import { runTool } from "../registry.js";
import { EditHarness } from "../test-support/edit-harness.js";
import { pixelFrameHost } from "../test-support/pixel-host.js";

type Row = Record<string, unknown>;

/** A left-to-right ramp around `base` (so the frame has contrast), tinted by `tint`. */
function ramp(width: number, height: number, base: number, tint: readonly [number, number, number] = [0, 0, 0]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const level = base - 60 + (120 * x) / Math.max(1, width - 1);
      const i = (y * width + x) * 4;
      data[i] = level + tint[0];
      data[i + 1] = level + tint[1];
      data[i + 2] = level + tint[2];
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Media painted by file name: "dark" ramps around 50, "bright" around 200, "warm" mid with a red/blue cast, the rest mid grey. */
function painted(): EditHarness {
  const ed = new EditHarness({ playhead: 1 });
  ed.doc.setUntracked(["width"], 160);
  ed.doc.setUntracked(["height"], 90);
  ed.host.frames = pixelFrameHost((path, w, h) => {
    if (path.includes("dark")) return ramp(w, h, 50);
    if (path.includes("bright")) return ramp(w, h, 200);
    if (path.includes("warm")) return ramp(w, h, 120, [40, 0, -40]);
    return ramp(w, h, 120);
  });
  return ed;
}

async function unify(ed: EditHarness, args: Row): Promise<{ data: Row; summary: string; status: string }> {
  const result = await runTool({ doc: ed.doc, host: ed.host }, "unify_grade_tool", args);
  const receipt = result.data!;
  return {
    data: receipt.data as Row,
    summary: receipt.summary,
    status: receipt.status,
  };
}

const exposure = (ed: EditHarness, id: string): number | null => {
  const grade = findColorGrade(ed.clip(id)!.effects);
  return grade ? scalarY(grade as Row, "exposure") : null;
};
const row = (data: Row, id: string): Row => (data.clips as Row[]).find((r) => r.timeline_clip_id === id)!;

describe("unify_grade_tool", { timeout: 60_000 }, () => {
  it("pulls dark and bright shots toward the cut's median look in one undo step", async () => {
    const ed = painted();
    const dark = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), {
      position: 0,
      end: 2,
    });
    const mid = ed.addClip(ed.addFile("video", { name: "mid.mp4" }), {
      position: 2,
      end: 4,
    });
    const bright = ed.addClip(ed.addFile("video", { name: "bright.mp4" }), {
      position: 4,
      end: 6,
    });
    ed.mark();
    const { data, summary, status } = await unify(ed, {});
    expect(status, summary).toBe("applied");
    expect(summary).toMatch(/^Unified the grade: /);
    expect(data).toMatchObject({
      applied: true,
      undo: "one step",
      reference: { kind: "median", closest_clip_id: mid },
    });
    expect(row(data, mid).status).toBe("in_band");
    expect(exposure(ed, mid)).toBeNull();
    expect(exposure(ed, dark)!).toBeGreaterThan(0);
    expect(exposure(ed, bright)!).toBeLessThan(0);
    const before = data.spread_before as Row;
    const after = data.spread_after as Row;
    expect(after.avg_luma as number).toBeLessThan((before.avg_luma as number) / 2);
    expect(((row(data, dark).after as Row).avg_luma as number) - ((row(data, dark).before as Row).avg_luma as number)).toBeGreaterThan(0.05);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(exposure(ed, dark)).toBeNull();
    expect(exposure(ed, bright)).toBeNull();
  });

  it("matches a reference clip without touching it, and evens out a colour cast", async () => {
    const ed = painted();
    const ref = ed.addClip(ed.addFile("video", { name: "mid.mp4" }), {
      position: 0,
      end: 2,
    });
    const warm = ed.addClip(ed.addFile("video", { name: "warm.mp4" }), {
      position: 2,
      end: 4,
    });
    const { data, status, summary } = await unify(ed, {
      reference_clip_id: ref,
    });
    expect(status, summary).toBe("applied");
    expect(data.reference).toEqual({ kind: "clip", timeline_clip_id: ref });
    expect((data.clips as Row[]).map((r) => r.timeline_clip_id)).toEqual([warm]);
    expect(ed.clip(ref)!.effects).toEqual([]);
    const grade = findColorGrade(ed.clip(warm)!.effects) as Row;
    expect(scalarY(grade, "temperature")!).toBeLessThan(0);
    const gapBefore = Math.abs((row(data, warm).gap_before as Row).warm_cool as number);
    const gapAfter = Math.abs((row(data, warm).gap_after as Row).warm_cool as number);
    expect(gapAfter).toBeLessThan(gapBefore);
  });

  it("lays one LUT look over the corrected clips and the reference, after the correction", async () => {
    const ed = painted();
    const ref = ed.addClip(ed.addFile("video", { name: "mid.mp4" }), {
      position: 0,
      end: 2,
    });
    const dark = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), {
      position: 2,
      end: 4,
    });
    ed.mark();
    const { data, status, summary } = await unify(ed, {
      reference_clip_id: ref,
      look: "teal_cinema",
      look_intensity: 0.6,
    });
    expect(status, summary).toBe("applied");
    expect(summary).toMatch(/look teal_cinema on 2 clip\(s\)/);
    for (const id of [ref, dark]) {
      const grade = findColorGrade(ed.clip(id)!.effects) as Row;
      expect(String(grade.lut_path)).toMatch(/teal/i);
    }
    expect(exposure(ed, dark)!).toBeGreaterThan(0);
    expect((data.look as Row).timeline_clip_ids).toEqual(expect.arrayContaining([ref, dark]));
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("dry run reports the corrections and changes nothing; matched clips are a no-op", async () => {
    const ed = painted();
    const a = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), {
      position: 0,
      end: 2,
    });
    ed.addClip(ed.addFile("video", { name: "bright.mp4" }), {
      position: 2,
      end: 4,
    });
    ed.mark();
    const dry = await unify(ed, { dry_run: true });
    expect(dry.summary).toMatch(/^Dry run: .*Nothing changed\.$/);
    expect(dry.data.applied).toBe(false);
    expect(row(dry.data, a).status).not.toBe("in_band");
    expect(ed.stepsSinceMark()).toBe(0);

    const same = painted();
    same.addClip(same.addFile("video", { name: "mid.mp4" }), {
      position: 0,
      end: 2,
    });
    same.addClip(same.addFile("video", { name: "mid2.mp4" }), {
      position: 2,
      end: 4,
    });
    same.mark();
    const noop = await unify(same, {});
    expect(noop.status).toBe("unchanged");
    expect(noop.summary).toMatch(/^Nothing to change: 0 of 2 clip\(s\) brought within the band, 2 already in it/);
    expect(same.stepsSinceMark()).toBe(0);
  });

  it("skips titles and audio by default and refuses what it cannot do", async () => {
    const ed = painted();
    const v = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), {
      position: 0,
      end: 2,
    });
    const title = ed.addClip(ed.addFile("image", { name: "title.svg" }), {
      position: 0,
      end: 2,
      layer: 2_000_000,
    });
    ed.addClip(ed.addFile("audio", { name: "music.mp3" }), {
      position: 0,
      end: 2,
      layer: 3_000_000,
    });
    const one = await unify(ed, {});
    expect(one.summary).toMatch(/^Error: unifying needs two or more clips/);
    const both = await unify(ed, {
      reference_clip_id: v,
      reference_file_id: "X",
    });
    expect(both.summary).toBe("Error: pass reference_clip_id or reference_file_id, not both");
    expect(ed.clip(title)!.effects).toEqual([]);
    const bad = await unify(ed, { timeline_clip_ids: [v], look: "sunny" });
    expect(bad.summary).toMatch(/^Error: 'sunny' is a .* look, not a LUT/);
  });
});
