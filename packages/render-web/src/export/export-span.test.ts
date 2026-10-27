import { describe, expect, it } from "vitest";
import type { Project } from "@zenvi/engine";
import { exportSpan } from "./export-project.js";

const clip = (id: string, position: number, seconds: number, mediaType: string) => ({
  id,
  layer: 1,
  position,
  start: 0,
  end: seconds,
  reader: { has_video: mediaType !== "audio", media_type: mediaType },
});
const project = { fps: { num: 30, den: 1 }, clips: [clip("A", 0, 10.27, "video"), clip("BOOM", 8.6, 2.6, "audio")], effects: [] } as unknown as Project;

describe("exportSpan (the editor's Export, range All)", () => {
  it("ends a video at the last picture and notes the sound it left out (W25a E2E bug 2)", () => {
    const span = exportSpan(project, { format: "mp4" });
    expect(span.start).toBe(0);
    // The last picture frame starts before 10.27 s: frame 309 ends at 10.3 s.
    expect(span.end).toBeCloseTo(10.3, 6);
    expect(span.note).toMatch(/^The video ends with the last picture at 10\.27s: 0\.93s of sound after it \(to 11\.20s\) is left out/);
  });

  it("runs a WAV to the end of the sound, and an explicit range wins", () => {
    expect(exportSpan(project, { format: "wav" })).toMatchObject({ end: expect.closeTo(11.2, 6), note: null });
    expect(exportSpan(project, { format: "mp4", range: { start: 1, end: 11.2 } })).toEqual({ start: 1, end: 11.2, note: null });
  });
});
