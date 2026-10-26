import { addClip, addFile, createProject, findProfile, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { MemoryMediaStore } from "@/lib/storage/media";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { editorToolRunner } from "./editorTools";
import { EditorSession } from "./session/EditorSession";
import { MediaLibrary } from "./session/media";
import { makeItSnappy, snappyTrack, snappyUndoSteps } from "./snappy";

const reader: ReaderInfo = {
  type: "FFmpegReader",
  path: "media/x/clip.webm",
  has_video: true,
  has_audio: true,
  has_single_image: false,
  duration: 4,
  width: 640,
  height: 360,
  fps: { num: 30, den: 1 },
  video_length: 120,
  pixel_ratio: { num: 1, den: 1 },
  display_ratio: { num: 16, den: 9 },
  sample_rate: 48000,
  channels: 2,
  channel_layout: 3,
};

/** `count` 2-second clips back to back on the bottom track. */
function sessionWithCuts(count: number) {
  const project = createProject({ profile: findProfile("HD 1080p 30 fps")! });
  const meta = { id: "local1", name: "Test", createdAt: 0, updatedAt: 0, width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration: 0, clipCount: 0, fileCount: 0 };
  const media = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe: vi.fn(async () => reader) });
  const session = new EditorSession({ meta, project, repository: new MemoryProjectRepository(), media, cloud: () => null });
  session.edit("Add", (tx) => {
    const file = addFile(tx, { path: "media/x/clip.webm", info: reader, name: "clip.webm" });
    for (let i = 0; i < count; i += 1) addClip(tx, { fileId: file.id, position: i * 2, start: 0, end: 2, layer: tx.project.layers[0]!.number });
  });
  return session;
}

describe("make it snappy", () => {
  it("finds the sequence with the most cuts", () => {
    const session = sessionWithCuts(3);
    expect(snappyTrack(session.project)).toEqual({ layer: session.project.layers[0]!.number, cuts: 2 });
    expect(snappyTrack(sessionWithCuts(1).project)).toBeNull();
  });

  it("runs transitions and sound design as separate undo steps through the agents' tools", async () => {
    const session = sessionWithCuts(3);
    const calls: string[] = [];
    const real = editorToolRunner(session);
    const before = session.doc.undoLabels.length;
    const outcomes = await makeItSnappy(() => session.project, (name, args) => (calls.push(name), real(name, args)));
    expect(calls.slice(0, 2)).toEqual(["apply_motion_transitions_tool", "auto_sound_design_tool"]);
    expect(outcomes.map((o) => [o.step, o.status])).toEqual([
      ["transitions", "done"],
      ["sound", "done"],
      ["master", calls.includes("master_audio_tool") ? "done" : "skipped"],
    ]);
    const steps = snappyUndoSteps(outcomes);
    expect(session.doc.undoLabels.length).toBe(before + steps);
    for (let i = 0; i < steps; i += 1) session.undo();
    expect(session.doc.undoLabels.length).toBe(before);
    expect(session.project.clips).toHaveLength(3);
  });

  it("skips the transitions without a cut and still designs the sound", async () => {
    const session = sessionWithCuts(1);
    const outcomes = await makeItSnappy(() => session.project, editorToolRunner(session));
    expect(outcomes[0]).toMatchObject({ step: "transitions", status: "skipped", undoSteps: 0 });
    expect(outcomes[1]!.step).toBe("sound");
  });
});
