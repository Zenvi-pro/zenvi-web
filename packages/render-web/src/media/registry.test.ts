import { describe, expect, it } from "vitest";
import { MediaRegistry, MediaUnavailableError } from "./registry.js";
import { makeWav } from "../test-support/wav.js";

function manualTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    timers: {
      setTimeout: (fn: () => void) => {
        const id = next++;
        pending.set(id, fn);
        return id;
      },
      clearTimeout: (id: unknown) => {
        pending.delete(id as number);
      },
    },
    fireAll() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    get count() {
      return pending.size;
    },
  };
}

const wav = (seconds = 1, channels = 2) => new File([makeWav({ seconds, channels }) as BlobPart], "tone.wav", { type: "audio/wav" });

describe("MediaRegistry", () => {
  it("opens inputs lazily, shares them between leases and describes the streams", async () => {
    const media = new MediaRegistry();
    media.register("F1", { kind: "blob", blob: wav(1.5) });
    const [a, b] = await Promise.all([media.acquire({ fileId: "F1" }), media.acquire({ fileId: "F1" })]);
    expect(a.media).toBe(b.media);
    expect(a.media.video).toBeNull();
    expect(a.media.audio).toMatchObject({ codec: "pcm-s16", sampleRate: 8000, channels: 2 });
    expect(a.media.timeOffset).toBe(0);
    expect(await a.media.duration()).toBeCloseTo(1.5, 3);
    a.release();
    b.release();
    media.dispose();
  });

  it("closes an input only after every lease is released and it sits idle", async () => {
    const clock = manualTimers();
    const media = new MediaRegistry({ timers: clock.timers, idleMs: 1000 });
    media.register("F1", { kind: "blob", blob: wav() });
    const a = await media.acquire({ fileId: "F1" });
    const b = await media.acquire({ fileId: "F1" });
    a.release();
    expect(clock.count).toBe(0);
    b.release();
    b.release(); // releasing twice is harmless
    expect(clock.count).toBe(1);
    const first = b.media.input;
    clock.fireAll();
    expect(first.disposed).toBe(true);
    const c = await media.acquire({ fileId: "F1" });
    expect(c.media.input).not.toBe(first);
    expect(c.media.input.disposed).toBe(false);
    c.release();
    media.dispose();
  });

  it("re-registering new bytes bumps the version and notifies caches", async () => {
    const media = new MediaRegistry();
    const seen: string[] = [];
    media.onInvalidate((key) => seen.push(key));
    media.register("F1", { kind: "blob", blob: wav(1) });
    const v1 = await media.acquire({ fileId: "F1" });
    expect(v1.media.version).toBe(1);
    media.register("F1", { kind: "blob", blob: wav(2) });
    expect(seen).toEqual(["file:F1"]);
    const v2 = await media.acquire({ fileId: "F1" });
    expect(v2.media.version).toBe(2);
    expect(await v2.media.duration()).toBeCloseTo(2, 3);
    // The old input stays usable for whoever still holds it, then goes away.
    expect(v1.media.input.disposed).toBe(false);
    v1.release();
    expect(v1.media.input.disposed).toBe(true);
    expect(v2.media.input.disposed).toBe(false);
    v2.release();
    media.dispose();
  });

  it("resolves path-only media (transition masks) through resolvePath and prefers file ids", async () => {
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="720" height="576"/>'], { type: "image/svg+xml" });
    const media = new MediaRegistry({
      resolvePath: (path) => (path.startsWith("@transitions/") ? { kind: "blob", blob: svg, name: path.split("/").pop()! } : undefined),
    });
    expect(media.kindOf({ path: "@transitions/common/fade.svg" })).toBe("svg");
    expect(await (await media.blob({ path: "@transitions/common/fade.svg" })).text()).toContain("<svg");
    const info = await media.probe({ path: "@transitions/common/fade.svg" });
    expect(info).toMatchObject({ type: "QtImageReader", width: 720, height: 576 });

    media.register("T1", { kind: "blob", blob: wav(), name: "voice.wav" });
    expect(media.keyOf({ fileId: "T1", path: "@transitions/common/fade.svg" })).toBe("file:T1");
    expect(media.kindOf({ fileId: "T1" })).toBe("av");
    expect(media.has({ path: "/nowhere.mp4" })).toBe(false);
    await expect(media.acquire({ fileId: "missing" })).rejects.toBeInstanceOf(MediaUnavailableError);
    media.dispose();
  });

  it("classifies OPFS files stored under an id by their original name", async () => {
    const handle = (name: string, file: File) => ({ kind: "file", name, getFile: async () => file }) as unknown as FileSystemFileHandle;
    const svgFile = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"/>'], "f-1");
    const media = new MediaRegistry();
    media.register("S", { kind: "opfs", handle: handle("f-1", svgFile), name: "logo.svg" });
    media.register("P", { kind: "opfs", handle: handle("f-2", new File([new Uint8Array(8)], "f-2")), name: "Photo.PNG" });
    media.register("A", { kind: "opfs", handle: handle("f-3", new File([makeWav({ seconds: 0.5 }) as BlobPart], "f-3")), name: "voice.wav" });
    // The project path has no extension (a storage key): the name decides.
    expect(media.kindOf({ fileId: "S", path: "files/f-1" })).toBe("svg");
    expect(media.kindOf({ fileId: "P" })).toBe("image");
    expect(media.kindOf({ fileId: "A", path: "files/f-3" })).toBe("av");
    // A project path with an extension still decides first.
    expect(media.kindOf({ fileId: "P", path: "/media/clip.svg" })).toBe("svg");
    expect(await media.probe({ fileId: "S", path: "files/f-1" })).toMatchObject({ type: "QtImageReader", width: 64, height: 32, path: "files/f-1", media_type: "image" });
    expect(await media.probe({ fileId: "A", path: "files/f-3" })).toMatchObject({ has_audio: true, has_video: false, media_type: "audio", path: "files/f-3" });

    // Without a name the same bytes read as audio/video, and a new name is a change.
    const bare = handle("f-1", svgFile);
    media.register("N", { kind: "opfs", handle: bare });
    expect(media.kindOf({ fileId: "N" })).toBe("av");
    const before = media.versionOf({ fileId: "N" });
    media.register("N", { kind: "opfs", handle: bare, name: "logo.svg" });
    expect(media.versionOf({ fileId: "N" })).toBe(before + 1);
    expect(media.kindOf({ fileId: "N" })).toBe("svg");
    media.dispose();
  });

  it("caches probe results until the file changes", async () => {
    const media = new MediaRegistry();
    media.register("F1", { kind: "blob", blob: wav(1) });
    const a = await media.probe({ fileId: "F1" });
    expect(await media.probe({ fileId: "F1" })).toBe(a);
    expect(a).toMatchObject({ type: "FFmpegReader", acodec: "pcm_s16le", channels: 2, sample_rate: 8000, video_length: 30, media_type: "audio" });
    media.invalidate({ fileId: "F1" });
    expect(await media.probe({ fileId: "F1" })).not.toBe(a);
    media.dispose();
  });
});
