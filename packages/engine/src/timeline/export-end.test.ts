import { describe, expect, it } from "vitest";
import type { Clip, Project } from "../model/types.js";
import { audioCutNote, defaultExportEnd, isVisualClip, pictureEnd } from "./export-end.js";

const clip = (id: string, position: number, seconds: number, reader: Record<string, unknown> = { has_video: true, media_type: "video" }): Clip =>
  ({ id, layer: 1, position, start: 0, end: seconds, reader }) as unknown as Clip;
const sound = (id: string, position: number, seconds: number): Clip => clip(id, position, seconds, { has_video: false, media_type: "audio" });
const project = (clips: Clip[]): Project => ({ fps: { num: 30, den: 1 }, clips, effects: [] }) as unknown as Project;

describe("defaultExportEnd", () => {
  it("ends a video at the last picture when sound runs past it (W25a E2E bug 2: 0.93 s of black)", () => {
    const p = project([clip("A", 0, 10.27), sound("BOOM", 8.6, 2.6)]);
    expect(pictureEnd(p)).toBe(10.27);
    const end = defaultExportEnd(p, true);
    expect(end).toEqual({ end: 10.27, contentEnd: 11.2, audioCut: expect.closeTo(0.93, 6) });
    expect(audioCutNote(end, "end_seconds")).toBe(
      "the video ends with the last picture at 10.27s: 0.93s of sound after it (to 11.20s) is left out instead of playing over black; pass end_seconds=11.20 to keep it",
    );
    expect(audioCutNote(end)).toMatch(/; render with an end of 11\.20s to keep it$/);
  });

  it("runs to the last item for audio formats, a picture that ends last, and timelines with no picture", () => {
    const tail = project([clip("A", 0, 10), sound("BOOM", 8, 4)]);
    expect(defaultExportEnd(tail, false)).toEqual({ end: 12, contentEnd: 12, audioCut: 0 });
    const clean = project([clip("A", 0, 10), sound("MUSIC", 0, 9)]);
    expect(defaultExportEnd(clean, true)).toEqual({ end: 10, contentEnd: 10, audioCut: 0 });
    expect(audioCutNote(defaultExportEnd(clean, true))).toBeNull();
    const podcast = project([sound("VOICE", 0, 30)]);
    expect(defaultExportEnd(podcast, true).end).toBe(30);
  });

  it("does not count a clip whose picture is switched off", () => {
    const hidden = { ...clip("B", 0, 20), has_video: { Points: [{ co: { X: 1, Y: 0 } }] } } as unknown as Clip;
    expect(isVisualClip(hidden)).toBe(false);
    expect(pictureEnd(project([clip("A", 0, 5), hidden]))).toBe(5);
  });
});
