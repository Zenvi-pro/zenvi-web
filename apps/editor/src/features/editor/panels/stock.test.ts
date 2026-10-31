import { createProject, findProfile, type ReaderInfo } from "@zenvi/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryMediaStore } from "@/lib/storage/media";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { useToasts } from "@/ui/Toast";
import { EditorSession } from "../session/EditorSession";
import { MediaLibrary } from "../session/media";
import { importStock, type FreesoundSound } from "./stock";

const reader: ReaderInfo = {
  type: "FFmpegReader",
  path: "freesound_871400.mp3",
  has_video: false,
  has_audio: true,
  has_single_image: false,
  duration: 136,
  width: 0,
  height: 0,
  fps: { num: 30, den: 1 },
  video_length: 0,
  pixel_ratio: { num: 1, den: 1 },
  display_ratio: { num: 1, den: 1 },
  sample_rate: 44100,
  channels: 2,
  channel_layout: 3,
};

const sound: FreesoundSound = {
  id: 871400,
  name: "Piano loops 215",
  duration: 136,
  username: "someone",
  license: "http://creativecommons.org/publicdomain/zero/1.0/",
  tags: ["piano"],
  previews: { hq_mp3: "https://cdn.freesound.org/previews/871/871400_5674468-hq.mp3", lq_mp3: "https://cdn.freesound.org/previews/871/871400_5674468-lq.mp3" },
  images: { waveform_m: "", waveform_l: "" },
};

function session(probe: () => Promise<ReaderInfo> = async () => reader) {
  const project = createProject({ profile: findProfile("HD Vertical 1080p 30 fps") ?? findProfile("HD 1080p 30 fps")! });
  const meta = { id: "local1", name: "Test", createdAt: 0, updatedAt: 0, width: 1080, height: 1920, fps: { num: 30, den: 1 }, duration: 0, clipCount: 0, fileCount: 0 };
  const media = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe: vi.fn(probe) });
  return new EditorSession({ meta, project, repository: new MemoryProjectRepository(), media, cloud: () => null });
}

/** A CDN serving 3 MB in byte ranges, like cdn.freesound.org (Content-Range exposed). */
function cdn(file: Uint8Array, status = 206) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (status !== 206) return new Response("gone", { status });
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? "";
    const [, a, b] = range.match(/^bytes=(\d+)-(\d*)$/) ?? [];
    const start = Number(a ?? 0);
    const end = Math.min(file.length - 1, b ? Number(b) : file.length - 1);
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { "content-type": "audio/mpeg", "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${file.length}` },
    });
  });
}

const toasts = () => useToasts.getState().toasts.map((t) => `${t.kind}: ${t.title}${t.description ? ` (${t.description})` : ""}`);

describe("importStock", () => {
  beforeEach(() => useToasts.setState({ toasts: [] }));
  afterEach(() => vi.unstubAllGlobals());

  it("downloads a Freesound preview in ranges, reports progress, and lands it in Project Files", async () => {
    const fetchMock = cdn(new Uint8Array(3_069_708).fill(7));
    vi.stubGlobal("fetch", fetchMock);
    const s = session();
    const progress: Array<number | null> = [];
    await importStock(s, { kind: "freesound", sound }, null, { onProgress: (f) => progress.push(f) });
    expect(s.project.files.map((f) => f.name)).toEqual(["freesound_871400.mp3"]);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(1);
    expect(toasts()).toEqual(["success: Stock audio imported"]);
  });

  it("says the import failed (not imported) when every download fails, with no undo step", async () => {
    vi.stubGlobal("fetch", cdn(new Uint8Array(10), 404));
    const s = session();
    const steps = s.doc.undoLabels.length;
    await importStock(s, { kind: "freesound", sound }, null);
    expect(s.project.files).toEqual([]);
    expect(s.doc.undoLabels.length).toBe(steps);
    expect(toasts()).toEqual(["error: Import failed (Freesound download error: Download failed (404).)"]);
  });

  it("stops when cancelled and says so", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
          const abort = () => reject(new DOMException("aborted", "AbortError"));
          if (init?.signal?.aborted) abort();
          init?.signal?.addEventListener("abort", abort);
        })));
    const s = session();
    const steps = s.doc.undoLabels.length;
    const controller = new AbortController();
    const done = importStock(s, { kind: "freesound", sound }, null, { signal: controller.signal });
    controller.abort();
    await done;
    expect(s.project.files).toEqual([]);
    expect(s.doc.undoLabels.length).toBe(steps);
    expect(toasts()).toEqual(["info: Import cancelled"]);
  });

  it("says imported, not cancelled, when the cancel comes after the download finished", async () => {
    vi.stubGlobal("fetch", cdn(new Uint8Array(3_069_708).fill(7)));
    const controller = new AbortController();
    // The click lands while the file is being probed: too late to stop the import.
    const s = session(async () => {
      controller.abort();
      return reader;
    });
    await importStock(s, { kind: "freesound", sound }, null, { signal: controller.signal });
    expect(controller.signal.aborted).toBe(true);
    expect(s.project.files.map((f) => f.name)).toEqual(["freesound_871400.mp3"]);
    expect(toasts()).toEqual(["success: Stock audio imported"]);
  });
});
