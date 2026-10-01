import { addClip, addFile, createProject, findProfile, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { MemoryMediaStore } from "@/lib/storage/media";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { EditorSession } from "../session/EditorSession";
import { MediaLibrary } from "../session/media";
import { fileHash } from "../session/media";
import { runAssistantTool } from "./bridge";
import { attachPendingMedia, createToolHost } from "./host";

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

function sessionWithClip() {
  const project = createProject({ profile: findProfile("HD 1080p 30 fps")! });
  const meta = { id: "local1", name: "Test", createdAt: 0, updatedAt: 0, width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration: 0, clipCount: 0, fileCount: 0 };
  const media = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe: vi.fn(async () => reader) });
  const session = new EditorSession({ meta, project, repository: new MemoryProjectRepository(), media, cloud: () => null });
  const clip = session.edit("Add", (tx) => {
    const file = addFile(tx, { path: "media/x/clip.webm", info: reader, name: "clip.webm" });
    return addClip(tx, { fileId: file.id, position: 0, layer: tx.project.layers[0]!.number });
  })!;
  return { session, clip };
}

describe("Assistant bridge → engine runTool", () => {
  it("runs a real read-only tool and answers with the desktop's text", async () => {
    const { session, clip } = sessionWithClip();
    const before = session.doc.undoLabels.length;
    const wire = await runAssistantTool(session, createToolHost(session, async () => []), "get_timeline_state_tool", {}, new AbortController().signal);
    expect(wire.result).not.toMatch(/^Error/);
    expect(wire.result).toContain(clip.id);
    expect(session.doc.undoLabels.length).toBe(before);
  });

  it("records a mutating tool as one undo step", async () => {
    const { session, clip } = sessionWithClip();
    const before = session.doc.undoLabels.length;
    const wire = await runAssistantTool(session, createToolHost(session, async () => []), "remove_clip_tool", { timeline_clip_id: clip.id }, new AbortController().signal);
    expect(wire.result).not.toMatch(/^Error/);
    expect(session.project.clips).toHaveLength(0);
    expect(session.doc.undoLabels.length).toBe(before + 1);
  });

  it("refuses unknown tools without touching history", async () => {
    const { session } = sessionWithClip();
    const before = session.doc.undoLabels.length;
    const wire = await runAssistantTool(session, createToolHost(session, async () => []), "no_such_tool", {}, new AbortController().signal);
    expect(wire.result).toMatch(/^Error: no_such_tool is not available/);
    expect(session.doc.undoLabels.length).toBe(before);
  });
});

describe("media tools generate", () => {
  it("gives generated files (titles, voiceovers) a content ref, so they reload and upload", async () => {
    const { session } = sessionWithClip();
    const host = createToolHost(session, async () => []);
    const path = await host.media!.writeGenerated!("Hello.svg", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml");
    expect(path).toMatch(/^media\/[0-9a-f]{16}\/Hello\.svg$/);
    // The tool adds the file knowing only the path.
    session.edit("Add title", (tx) => addFile(tx, { path, info: { ...reader, path, has_single_image: true, has_audio: false }, name: "Hello.svg" }));
    attachPendingMedia(session);
    const file = session.project.files.find((f) => f.path === path)!;
    expect(fileHash(file)).toMatch(/^[0-9a-f]{64}$/);
    expect(file.cloud).toMatchObject({ name: "Hello.svg", content_type: "image/svg+xml" });
    expect(session.media.spec(file.id)).toBeDefined();
    expect(session.doc.undoLabels.at(-1)).toBe("Add title");
  });
});

describe("audio analysis (remove silence, ducking)", () => {
  it("measures RMS per 30 ms frame of the mono mix", async () => {
    const { mixToMono, rmsFrames } = await import("./audioAnalysis");
    const left = new Float32Array(960).fill(0.5);
    const right = new Float32Array(960).fill(-0.5);
    right.fill(0.5, 480);
    const mono = mixToMono([left, right]);
    const rms = rmsFrames(mono, 480);
    expect(Array.from(rms)).toEqual([0, 0.5]);
    expect(rmsFrames(new Float32Array(500).fill(1), 480)).toHaveLength(2);
  });
});
