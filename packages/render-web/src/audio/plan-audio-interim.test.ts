import { describe, expect, it } from "vitest";
import { ProjectDocument, addClip, addFile, createProject } from "@zenvi/engine";
import { MediaRegistry } from "../media/registry.js";
import { makeWav } from "../test-support/wav.js";
import { planAudioInterim } from "./plan-audio-interim.js";

async function projectWithTone() {
  const media = new MediaRegistry();
  media.register("tone", { kind: "blob", blob: new File([makeWav({ seconds: 4, channels: 2 }) as BlobPart], "tone.wav") });
  const info = await media.probe({ fileId: "tone" }, { path: "tone.wav" });
  media.dispose();
  const doc = new ProjectDocument(createProject());
  doc.transaction("Import", (tx) => {
    const file = addFile(tx, { path: "tone.wav", info, name: "tone.wav" }, { id: "tone" });
    addClip(tx, { fileId: file.id, position: 2, layer: 1000000, start: 0.5, end: 3, id: "A" });
  });
  return doc;
}

describe("planAudioInterim (until the engine's planAudio ships)", () => {
  it("plans each audible clip at its frame-aligned window with its source offset", async () => {
    const doc = await projectWithTone();
    const plan = planAudioInterim(doc.project, { start: 0, end: 10 });
    expect(plan).toMatchObject({ sampleRate: 48000, channels: 2, start: 0, end: 10 });
    expect(plan.segments).toHaveLength(1);
    const [segment] = plan.segments;
    expect(segment).toMatchObject({ clipId: "A", fileId: "tone", path: "tone.wav", rate: 1, effects: [] });
    expect(segment!.timelineStart).toBeCloseTo(2, 9);
    expect(segment!.sourceStart).toBeCloseTo(0.5, 9);
    expect(segment!.duration).toBeCloseTo(2.5, 9);
    expect(segment!.gain).toEqual([{ t: 0, gain: 1 }]);
    expect(planAudioInterim(doc.project, { start: 5, end: 6 }).segments).toHaveLength(0);
  });

  it("samples a volume fade into per-frame ramps and skips muted clips", async () => {
    const doc = await projectWithTone();
    // Fade in over the clip's first 30 frames (clip frames count from the source start: 0.5 s = frame 16 at 30 fps).
    const fade = { Points: [{ co: { X: 16, Y: 0 }, interpolation: 1 }, { co: { X: 46, Y: 1 }, interpolation: 1 }] };
    doc.transaction("Fade", (tx) => tx.update(["clips", { id: "A" }], { volume: fade }));
    const segment = planAudioInterim(doc.project, { start: 0, end: 10 }).segments[0]!;
    const fps = doc.project.fps.num / doc.project.fps.den;
    expect(segment.gain[0]).toEqual({ t: 0, gain: 0 });
    // Halfway through the ramp: volume(30) = 14/30 lands at the start of clip frame 31.
    expect(segment.gain[15]!.t).toBeCloseTo(15 / fps, 9);
    expect(segment.gain[15]!.gain).toBeCloseTo(14 / 30, 9);
    expect(segment.gain.at(-1)!.gain).toBe(1);
    expect(segment.gain).toHaveLength(Math.round(2.5 * fps) + 1);

    doc.transaction("Mute", (tx) => tx.update(["clips", { id: "A" }], { has_audio: { Points: [{ co: { X: 1, Y: 0 }, interpolation: 2 }] } }));
    expect(planAudioInterim(doc.project, { start: 0, end: 10 }).segments).toHaveLength(0);
  });
});
