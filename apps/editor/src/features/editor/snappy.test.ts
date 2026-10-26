import { addClip, addFile, createProject, findProfile, setClipProperty, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { MemoryMediaStore } from "@/lib/storage/media";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { editorToolRunner, type ToolRunner } from "./editorTools";
import { EditorSession } from "./session/EditorSession";
import { MediaLibrary } from "./session/media";
import { mainSequence } from "./cuts";
import { makeItSnappy, snappySummary, snappyUndoAll, snappyUndoSteps, type SnappyOutcome } from "./snappy";

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

/** `count` 2-second clips on the bottom track, back to back or `gap` seconds apart. */
function sessionWithCuts(count: number, gap = 0) {
  const project = createProject({ profile: findProfile("HD 1080p 30 fps")! });
  const meta = { id: "local1", name: "Test", createdAt: 0, updatedAt: 0, width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration: 0, clipCount: 0, fileCount: 0 };
  const media = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe: vi.fn(async () => reader) });
  const session = new EditorSession({ meta, project, repository: new MemoryProjectRepository(), media, cloud: () => null });
  session.edit("Add", (tx) => {
    const file = addFile(tx, { path: "media/x/clip.webm", info: reader, name: "clip.webm" });
    for (let i = 0; i < count; i += 1) addClip(tx, { fileId: file.id, position: i * (2 + gap), start: 0, end: 2, layer: tx.project.layers[0]!.number });
  });
  return session;
}

/**
 * The editor's tools, with master_audio_tool answered as a mastered mix would be: the
 * test session's media never loads, so the browser has nothing to mix (mastering itself is
 * tested in the engine and by the editor e2e export).
 */
function withMastering(run: ToolRunner): ToolRunner {
  return async (name, args) =>
    name === "master_audio_tool"
      ? { ok: true, status: "applied", summary: "Mastered to -14 LUFS.", data: { after: { integratedLufs: -14 } }, warnings: [], undoSteps: 0 }
      : run(name, args);
}

describe("make it snappy", () => {
  it("finds the sequence with the most cuts", () => {
    const session = sessionWithCuts(3);
    expect(mainSequence(session.project)).toEqual({ layer: session.project.layers[0]!.number, cuts: 2 });
    expect(mainSequence(sessionWithCuts(1).project)).toBeNull();
  });

  it("runs transitions and sound design as separate undo steps through the agents' tools", async () => {
    const session = sessionWithCuts(3);
    const calls: string[] = [];
    const real = withMastering(editorToolRunner(session));
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

  it("closes one-frame gaps (double-click placement) first, as its own undo step", async () => {
    const session = sessionWithCuts(3, 1 / 30);
    expect(mainSequence(session.project)).toBeNull();
    const before = session.doc.undoLabels.length;
    const outcomes = await makeItSnappy(() => session.project, editorToolRunner(session));
    expect(outcomes.slice(0, 2).map((o) => [o.step, o.status])).toEqual([
      ["gaps", "done"],
      ["transitions", "done"],
    ]);
    expect(session.doc.undoLabels.length).toBe(before + snappyUndoSteps(outcomes));
    expect(session.project.clips.filter((c) => c.layer === session.project.layers[0]!.number)[0]!.position).toBe(0);
  });

  it("skips the transitions without a cut and still designs the sound", async () => {
    const session = sessionWithCuts(1);
    const outcomes = await makeItSnappy(() => session.project, editorToolRunner(session));
    expect(outcomes[0]).toMatchObject({ step: "transitions", status: "skipped", undoSteps: 0 });
    expect(outcomes[1]!.step).toBe("sound");
  });

  it("Undo all undoes the chain once, and never after another edit", async () => {
    const session = sessionWithCuts(3);
    const before = session.doc.undoLabels.length;
    const steps = snappyUndoSteps(await makeItSnappy(() => session.project, editorToolRunner(session)));
    const undoAll = snappyUndoAll(session, steps);
    expect(undoAll()).toBe(true);
    expect(session.doc.undoLabels.length).toBe(before);
    expect(undoAll()).toBe(false);
    expect(session.doc.undoLabels.length).toBe(before);
  });

  it("Undo all refuses once the person undid a step and edited (same undo depth)", async () => {
    const session = sessionWithCuts(3);
    const steps = snappyUndoSteps(await makeItSnappy(() => session.project, editorToolRunner(session)));
    const undoAll = snappyUndoAll(session, steps);
    const depth = session.doc.undoLabels.length;
    session.undo();
    session.edit("Rename", (tx) => setClipProperty(tx, session.project.clips[0]!.id, "title", "mine"));
    const labels = session.doc.undoLabels;
    expect(labels).toHaveLength(depth);
    expect(undoAll()).toBe(false);
    expect(session.doc.undoLabels).toEqual(labels);
  });

  it("designs the sound as loud as the transitions: hype cuts get hype sound", async () => {
    for (const [style, intensity] of [["hype", "hype"], [undefined, "hype"], ["cinematic", "normal"]] as const) {
      const session = sessionWithCuts(3);
      const args: Record<string, unknown>[] = [];
      const real = editorToolRunner(session);
      await makeItSnappy(() => session.project, (name, a) => (name === "auto_sound_design_tool" && args.push(a), real(name, a)), { style });
      expect(args).toEqual([{ intensity }]);
    }
  });

  it("leads its summary with one line of what changed, from the receipts", async () => {
    const session = sessionWithCuts(3);
    const outcomes = await makeItSnappy(() => session.project, withMastering(editorToolRunner(session)));
    const summary = snappySummary(outcomes);
    const [headline] = summary.description.split("\n");
    expect(headline).toMatch(/^2 transitions · \d+ sounds?( · mastered to −\d+ LUFS)?$/);
    expect(summary.issues).toEqual([]);
    expect(summary.details).toContain("✓ Motion transitions: Added 2 motion transition(s)");
    expect(summary.details).toMatch(/\d undo steps; Undo all takes them back\.$/);
  });

  it("says up front when there was no cut for the transitions, not only under Details", async () => {
    const session = sessionWithCuts(3, 1);
    const outcomes = await makeItSnappy(() => session.project, editorToolRunner(session));
    expect(outcomes.find((o) => o.step === "transitions")?.status).toBe("skipped");
    expect(snappySummary(outcomes).issues).toContain("Motion transitions skipped: No clips play back to back, so there is no cut to move");
  });

  it("calls out a failed step in one line, and says once that mastering is missing", () => {
    const outcomes: SnappyOutcome[] = [
      { step: "transitions", label: "Motion transitions", status: "done", detail: "Added 23 motion transition(s) on Track 1 (hype): whip@0.50s, …", brief: "23 transitions", undoSteps: 1 },
      { step: "sound", label: "Sound design", status: "failed", detail: "failed to store the sound effects: quota exceeded. Free some space and retry.", undoSteps: 0 },
      { step: "master", label: "Master audio", status: "skipped", detail: "Not mastered: mastering is not in this build yet.", undoSteps: 0 },
    ];
    const summary = snappySummary(outcomes);
    expect(summary.description).toBe("23 transitions\nNot mastered: mastering is not in this build yet.");
    expect(summary.issues).toEqual(["Sound design failed: failed to store the sound effects"]);
    expect(summary.details).not.toContain("mastering");
    expect(summary.details).toContain("✕ Sound design: failed to store the sound effects: quota exceeded. Free some space and retry.");
    expect(snappySummary([{ ...outcomes[2]!, step: "master", status: "done", brief: "mastered to −14 LUFS", undoSteps: 1 }]).description).toBe("mastered to −14 LUFS");
  });
});
