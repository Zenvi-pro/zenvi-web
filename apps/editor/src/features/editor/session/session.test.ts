import { addClip, addFile, createProject, findProfile, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { MemoryMediaStore } from "@/lib/storage/media";
import { useToasts } from "@/ui/Toast";
import { EditorSession } from "./EditorSession";
import { MediaLibrary } from "./media";
import { clickSelect, EMPTY_SELECTION, pruneSelection } from "./uiStore";

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

function newSession() {
  const project = createProject({ profile: findProfile("HD 1080p 30 fps")! });
  const repository = new MemoryProjectRepository();
  const meta = { id: "local1", name: "Test", createdAt: 0, updatedAt: 0, width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration: 0, clipCount: 0, fileCount: 0 };
  const media = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe: vi.fn(async () => reader) });
  const session = new EditorSession({ meta, project, repository, media, cloud: () => null });
  return { session, repository };
}

function withClip(session: EditorSession) {
  return session.edit("Add", (tx) => {
    const file = addFile(tx, { path: "media/x/clip.webm", info: reader, name: "clip.webm" });
    return addClip(tx, { fileId: file.id, position: 0, layer: tx.project.layers[0]!.number });
  })!;
}

describe("EditorSession", () => {
  it("records one undo step per edit and undoes it", () => {
    const { session } = newSession();
    const clip = withClip(session);
    expect(session.project.clips.map((c) => c.id)).toEqual([clip.id]);
    expect(session.doc.undoLabels).toEqual(["Add"]);
    session.undo();
    expect(session.project.clips).toEqual([]);
    session.redo();
    expect(session.project.clips).toHaveLength(1);
  });

  it("turns a refused op into a warning toast and leaves history untouched", () => {
    const { session } = newSession();
    const before = session.doc.undoLabels.length;
    const result = session.edit("Add", (tx) => addClip(tx, { fileId: "NOPE", position: 0, layer: tx.project.layers[0]!.number }));
    expect(result).toBeUndefined();
    expect(session.doc.undoLabels.length).toBe(before);
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ kind: "warning" });
  });

  it("previews on a scratch copy without recording anything", () => {
    const { session } = newSession();
    const clip = withClip(session);
    const undo = session.doc.undoLabels.length;
    session.preview((tx) => void tx.update(["clips", { id: clip.id }], { position: 3 }));
    expect(session.displayProject().clips[0]!.position).toBe(3);
    expect(session.project.clips[0]!.position).toBe(0);
    expect(session.doc.undoLabels.length).toBe(undo);
    session.endPreview();
    expect(session.displayProject().clips[0]!.position).toBe(0);
  });

  it("prunes the selection when items disappear", () => {
    const { session } = newSession();
    const clip = withClip(session);
    session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: [clip.id] } });
    session.undo();
    expect(session.ui.getState().selection.clips).toEqual([]);
  });

  it("saves the document with UI state (playhead, zoom) without touching history", async () => {
    const { session, repository } = newSession();
    withClip(session);
    session.seek(1.5);
    session.ui.setState({ pxPerSecond: 50 });
    await session.autosave.flush();
    const stored = await repository.load("local1");
    expect(stored?.project.playhead_position).toBe(1.5);
    expect(stored?.project.scale).toBeCloseTo(100 / 50);
    expect(stored?.project.history.undo.length).toBeGreaterThan(0);
    expect(stored?.meta.clipCount).toBe(1);
    await session.dispose();
  });

  it("clamps seeks to the content", () => {
    const { session } = newSession();
    withClip(session);
    session.seek(99);
    expect(session.playback.getState().time).toBeCloseTo(4);
    session.seek(-1);
    expect(session.playback.getState().time).toBe(0);
  });
});

describe("selection helpers", () => {
  it("replaces on click and toggles with a modifier", () => {
    const one = clickSelect(EMPTY_SELECTION, "clip", "a", false);
    expect(one.clips).toEqual(["a"]);
    const two = clickSelect(one, "clip", "b", true);
    expect(two.clips).toEqual(["a", "b"]);
    expect(clickSelect(two, "clip", "a", true).clips).toEqual(["b"]);
    expect(clickSelect(two, "transition", "t", false)).toEqual({ ...EMPTY_SELECTION, transitions: ["t"] });
  });

  it("keeps identity when nothing was removed", () => {
    const s = { ...EMPTY_SELECTION, clips: ["a"] };
    const all = { clip: () => true, transition: () => true, marker: () => true, effect: () => true };
    expect(pruneSelection(s, all)).toBe(s);
    expect(pruneSelection(s, { ...all, clip: () => false }).clips).toEqual([]);
  });
});
