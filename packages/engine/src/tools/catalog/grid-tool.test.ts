import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import type { Project } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import { planFrame } from "../../render/plan/frame-plan.js";
import type { Affine } from "../../render/types.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { imageInfo, media, videoInfo } from "../test-support/fixture.js";

/** A host that probes the SVGs it wrote for their real size. */
function host(): FakeHost {
  const h = fakeHost();
  const probe = h.media!.probe;
  h.media!.probe = async (path) => {
    const svg = h.written.get(path);
    if (svg === undefined) return probe(path);
    const text = typeof svg === "string" ? svg : new TextDecoder().decode(svg);
    const width = Number(/width="(\d+)"/.exec(text)?.[1]);
    const height = Number(/height="(\d+)"/.exec(text)?.[1]);
    return { ...imageInfo(path), width, height, display_ratio: { num: width, den: height } };
  };
  return h;
}

function verticalProject(): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "GRIDPROJ01", profile: findProfile("FHD Vertical 1080p 30 fps")! }));
  scratch.transaction("fixture", (tx) => {
    for (const name of ["pour", "pages", "notes"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 20)), { id: name.toUpperCase().padEnd(10, "X") });
  });
  const project: Project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return new ProjectDocument(project);
}

const FILES = ["POURXXXXXX", "PAGESXXXXX", "NOTESXXXXX"];
type Data = { layers: { name: string; timeline_clip_id: string }[]; cues: number[] };
const dataOf = (result: { data?: unknown }) => (result.data as { data: Data }).data;

function apply(t: Affine, x: number, y: number): [number, number] {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

describe("add_motion_template_tool grid", () => {
  it("fills a letterboxed band one tile per beat, re-cuts it 3 → 4 → 6, and merges to the full frame, in one undo step", async () => {
    const doc = verticalProject();
    const result = await runTool({ doc, host: host() }, "add_motion_template_tool", {
      template: "grid",
      file_ids: FILES,
      steps: [3, 4, 6],
      band: "16:9",
      merge: true,
      bpm: "120",
    });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add motion template grid"]);
    const data = dataOf(result);
    const tileIds = new Set(data.layers.filter((l) => l.name.startsWith("tile-")).map((l) => l.timeline_clip_id));
    expect(tileIds.size).toBe(3 + 4 + 6);

    // Beat k is frame 15k at 120 BPM from 0: how many tiles are up 12 frames (the reveal's end) after it.
    const up = (beat: number) => planFrame(doc.project, 15 * beat + 13).layers.filter((l) => tileIds.has(l.clipId ?? "")).length;
    expect([0, 1, 2, 3, 4, 5, 7, 8, 9].map(up)).toEqual([1, 2, 3, 3, 3, 4, 4, 5, 6]);

    // Every tile of the first stages sits inside the band (a 16:9 band across a 1080 × 1920 frame: y 656 to 1264).
    for (const beat of [3, 6, 10]) {
      for (const layer of planFrame(doc.project, 15 * beat + 13).layers.filter((l) => tileIds.has(l.clipId ?? ""))) {
        const [x0, y0] = apply(layer.transform, 0, 0);
        const [x1, y1] = apply(layer.transform, layer.drawWidth, layer.drawHeight);
        expect(Math.min(y0, y1)).toBeGreaterThanOrEqual(656 - 2);
        expect(Math.max(y0, y1)).toBeLessThanOrEqual(1264 + 2);
        expect(Math.min(x0, x1)).toBeGreaterThanOrEqual(-2);
        expect(Math.max(x0, x1)).toBeLessThanOrEqual(1082);
      }
    }

    // The merge: by the template's end the last tile covers the frame.
    const last = doc.project.clips.find((c) => c.id === data.layers.find((l) => l.name === "tile-3-6")!.timeline_clip_id)!;
    const endFrame = Math.round((last.position + last.end - last.start) * 30);
    const grown = planFrame(doc.project, endFrame).layers.find((l) => l.clipId === last.id)!;
    const [gx0, gy0] = apply(grown.transform, 0, 0);
    const [gx1, gy1] = apply(grown.transform, grown.drawWidth, grown.drawHeight);
    expect(Math.min(gx0, gx1)).toBeLessThanOrEqual(1);
    expect(Math.max(gx0, gx1)).toBeGreaterThanOrEqual(1079);
    expect(Math.min(gy0, gy1)).toBeLessThanOrEqual(1);
    expect(Math.max(gy0, gy1)).toBeGreaterThanOrEqual(1919);

    doc.undo();
    expect(doc.project.clips).toEqual([]);
  });

  it("refuses a layout it cannot cut, and tiles too small to read, without touching the project", async () => {
    const doc = verticalProject();
    for (const [args, summary] of [
      [{ template: "grid", file_ids: FILES, tiles: 5 }, /takes 2, 3, 4, 6, 9 tiles/],
      [{ template: "grid", file_ids: FILES, layout: "strips_h", tiles: 6, band: "21:9" }, /px on their short side/],
      [{ template: "grid", file_ids: FILES, merge: true, zoom_into: 2 }, /merge or zoom_into/],
      [{ template: "grid" }, /needs file_ids/],
      [{ template: "ui_cards", file_ids: FILES, layout: "strips_v", tiles: 3 }, /layout, tiles only apply to the grid template/],
      [{ template: "end_card", text: "Hi", phase: 0.2, drift: "in" }, /phase, drift only apply to the grid template/],
      [{ template: "grid", file_ids: FILES, layout: "kaleidoscope" }, /one clip on every tile/],
    ] as const) {
      const result = await runTool({ doc, host: host() }, "add_motion_template_tool", { ...args, bpm: "120" });
      expect(result.ok).toBe(false);
      expect((result.data as { status: string }).status).toBe("refused");
      expect((result.data as { summary: string }).summary).toMatch(summary);
    }
    expect(doc.undoLabels).toEqual([]);
    expect(doc.project.clips).toEqual([]);
  });

  it("zooms into any copy of a 16-copy repeat (zoom_into reaches past 9)", async () => {
    const doc = verticalProject();
    const result = await runTool({ doc, host: host() }, "add_motion_template_tool", {
      template: "grid",
      layout: "repeat",
      tiles: "16",
      zoom_into: "12",
      file_ids: [FILES[0]],
      duration_seconds: "8",
      bpm: "120",
    });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add motion template grid"]);
  });

  it("folds one clip into a mirrored kaleidoscope that pushes in, every segment drawn mirrored by the renderer, in one undo step", async () => {
    const doc = verticalProject();
    const result = await runTool({ doc, host: host() }, "add_motion_template_tool", {
      template: "grid",
      layout: "kaleidoscope",
      tiles: "4",
      drift: "in",
      file_ids: [FILES[0]],
      duration_seconds: "4",
      bpm: "120",
    });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Add motion template grid"]);
    const tileIds = new Set(dataOf(result).layers.filter((l) => l.name.startsWith("tile-")).map((l) => l.timeline_clip_id));
    expect(tileIds.size).toBe(4);
    for (const frame of [2, 60, 119]) {
      const layers = planFrame(doc.project, frame).layers.filter((l) => tileIds.has(l.clipId ?? ""));
      expect(layers).toHaveLength(4);
      // Top-left as shot, top-right mirrored left-right, bottom-left top-bottom, bottom-right both: the transform's signs.
      const flips = layers.map((l) => [Math.sign(l.transform[0]), Math.sign(l.transform[3])]);
      expect(new Set(flips.map((f) => f.join()))).toEqual(new Set(["1,1", "-1,1", "1,-1", "-1,-1"]));
      // The four meet at the frame's centre and cover the frame.
      const boxes = layers.map((l) => {
        const [x0, y0] = apply(l.transform, 0, 0);
        const [x1, y1] = apply(l.transform, l.drawWidth, l.drawHeight);
        return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
      });
      expect(Math.min(...boxes.map((b) => b.x0))).toBeLessThanOrEqual(0);
      expect(Math.max(...boxes.map((b) => b.x1))).toBeGreaterThanOrEqual(1080);
      expect(Math.min(...boxes.map((b) => b.y0))).toBeLessThanOrEqual(0);
      expect(Math.max(...boxes.map((b) => b.y1))).toBeGreaterThanOrEqual(1920);
      for (const b of boxes) expect(b.x0 < 540 + 0.5 && b.x1 > 540 - 0.5 && b.y0 < 960 + 0.5 && b.y1 > 960 - 0.5).toBe(true);
    }
    doc.undo();
    expect(doc.project.clips).toEqual([]);
  });
});
