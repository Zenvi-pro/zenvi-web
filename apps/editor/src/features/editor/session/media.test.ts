// @vitest-environment node
import { webcrypto } from "node:crypto";
import type { ProjectFile, ReaderInfo } from "@zenvi/engine";
import { describe, expect, it, vi } from "vitest";
import { partialFingerprint } from "@/lib/storage/hash";
import { MemoryMediaStore } from "@/lib/storage/media";
import { toHex } from "@/lib/storage/sha256";
import { contentTypeFor, fileDisplayName, fileHash, matchRelinkCandidates, MediaLibrary, mediaPath } from "./media";

const info: ReaderInfo = {
  type: "FFmpegReader",
  path: "x",
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

function projectFile(partial: Partial<ProjectFile>): ProjectFile {
  return { ...info, id: "F1", media_type: "video", path: "/Users/me/clip.mp4", ...partial } as ProjectFile;
}

describe("content addressing", () => {
  it("uses only the full-file hash in cloud.sha256, never the desktop's partial fingerprint", () => {
    const sha = "c".repeat(64);
    expect(fileHash({ cloud: { sha256: sha, size: 1, name: "a" } })).toBe(sha);
    expect(fileHash({ cloud: undefined, fingerprint: { size: 1, sha256: "d".repeat(64) } } as never)).toBeNull();
  });

  it("derives unique relative paths from the hash", () => {
    expect(mediaPath("0123456789abcdef".repeat(4), 'clip "a".mp4')).toBe("media/0123456789abcdef/clip _a_.mp4");
  });

  it("guesses content types and display names", () => {
    expect(contentTypeFor("A.WEBM")).toBe("video/webm");
    expect(contentTypeFor("x.unknown")).toBe("application/octet-stream");
    expect(fileDisplayName({ path: "C:\\videos\\take2.mov" })).toBe("take2.mov");
    expect(fileDisplayName({ name: "Intro", path: "/x/a.mp4" })).toBe("Intro");
  });
});

describe("partialFingerprint (desktop media_fingerprint.py)", () => {
  it("hashes the size, the first MB and the last MB", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 997) big[i] = i & 0xff;
    const file = new File([big], "big.bin", { lastModified: 1_700_000_000_000 });
    const fp = await partialFingerprint(file);
    const MB = 1024 * 1024;
    const joined = new Uint8Array([...new TextEncoder().encode(String(big.length)), ...big.subarray(0, MB), ...big.subarray(big.length - MB)]);
    expect(fp).toEqual({ size: big.length, mtime: 1_700_000_000, sha256: toHex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", joined))) });
  });

  it("reads small files once", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "s.bin");
    const fp = await partialFingerprint(file);
    const joined = new Uint8Array([...new TextEncoder().encode("3"), 1, 2, 3]);
    expect(fp.sha256).toBe(toHex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", joined))));
  });
});

describe("MediaLibrary", () => {
  const probe = vi.fn(async () => info);

  it("imports: stores by full hash, probes, and records fingerprint + cloud ref", async () => {
    const store = new MemoryMediaStore();
    const library = new MediaLibrary({ store: async () => store, probe });
    const file = new File([new Uint8Array([9, 8, 7, 6])], "clip.webm", { type: "video/webm" });
    const [item] = await library.importFiles([file]);
    const sha = toHex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new Uint8Array([9, 8, 7, 6]))));
    expect(item!.media.cloud).toEqual({ sha256: sha, size: 4, content_type: "video/webm", name: "clip.webm" });
    expect(item!.media.path).toBe(mediaPath(sha, "clip.webm"));
    expect(item!.media.fingerprint?.sha256).not.toBe(sha);
    expect(await store.has(sha)).toBe(true);
  });

  it("resolves files the browser has and reports the rest as missing", async () => {
    const store = new MemoryMediaStore();
    const sha = "e".repeat(64);
    await store.put(sha, new Blob([new Uint8Array([1])]), "have.mp4");
    const registry = { register: vi.fn(), unregister: vi.fn() };
    const library = new MediaLibrary({ store: async () => store, probe, registry });
    const have = projectFile({ id: "HAVE", cloud: { sha256: sha, size: 1, name: "have.mp4" } });
    const missing = projectFile({ id: "GONE" });
    await library.sync({ files: [have, missing] } as never);
    const status = library.status.getState();
    expect(status.HAVE?.status).toBe("ready");
    expect(status.GONE?.status).toBe("missing");
    expect(registry.register).toHaveBeenCalledWith("HAVE", expect.objectContaining({ kind: "blob" }));
    expect(library.missing({ files: [have, missing] } as never).map((f) => f.id)).toEqual(["GONE"]);
    await library.sync({ files: [] } as never);
    expect(registry.unregister).toHaveBeenCalledWith("HAVE");
  });

  it("relinks a picked file and says whether it matches the desktop fingerprint", async () => {
    const store = new MemoryMediaStore();
    const library = new MediaLibrary({ store: async () => store, probe });
    const bytes = new Uint8Array([5, 5, 5]);
    const file = new File([bytes], "clip.mp4", { lastModified: 1_000 });
    const fp = await partialFingerprint(file);
    const target = projectFile({ id: "T", fingerprint: { size: 3, sha256: fp.sha256 } });
    const { patch, matchesFingerprint } = await library.relink(target, file);
    expect(matchesFingerprint).toBe(true);
    expect(patch.cloud?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(library.status.getState().T?.status).toBe("ready");
    const other = await library.relink(projectFile({ id: "U", fingerprint: { size: 3, sha256: "0".repeat(64) } }), file);
    expect(other.matchesFingerprint).toBe(false);
  });

  it("keeps the extra keys the desktop stores in file.cloud when relinking", async () => {
    const library = new MediaLibrary({ store: async () => new MemoryMediaStore(), probe });
    const file = new File([new Uint8Array([4, 2])], "take.mov", { lastModified: 2_000_000 });
    const sha = toHex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new Uint8Array([4, 2]))));
    const same = projectFile({ id: "S", cloud: { sha256: sha, size: 2, name: "take.mov", mtime: 1_700_000_000.5, origin: "desktop" } as never });
    expect((await library.relink(same, file)).patch.cloud).toEqual({ sha256: sha, size: 2, name: "take.mov", content_type: "video/quicktime", mtime: 1_700_000_000.5, origin: "desktop" });
    // Different bytes: mtime now dates the picked file, so the desktop re-hashes instead of trusting it.
    const changed = projectFile({ id: "C", cloud: { sha256: "b".repeat(64), size: 9, name: "old.mov", mtime: 1_700_000_000.5, origin: "desktop" } as never });
    expect((await library.relink(changed, file)).patch.cloud).toMatchObject({ sha256: sha, mtime: 2_000, origin: "desktop" });
  });

  it("loads cloud files from the signed URLs sent with the project, matched by file id", async () => {
    const registry = { register: vi.fn(), unregister: vi.fn() };
    const mediaUrl = vi.fn(async (sha: string) => `https://blob.example/${sha}?fresh`);
    const library = new MediaLibrary({
      store: async () => new MemoryMediaStore(),
      probe,
      registry,
      cloud: () => ({ enabled: true, mediaUrl }) as never,
      // The cloud matched this desktop file by its fingerprint; the file has no cloud.sha256.
      cloudMedia: [{ fileId: "DESK", sha256: "f".repeat(64), url: "https://blob.example/f?sig=1" }],
    });
    const desk = projectFile({ id: "DESK", fingerprint: { size: 1, sha256: "f".repeat(64) } });
    await library.sync({ files: [desk] } as never);
    expect(library.status.getState().DESK).toEqual({ status: "ready", origin: "cloud" });
    expect(mediaUrl).not.toHaveBeenCalled();
    const spec = registry.register.mock.calls[0]![1] as { kind: string; url: string; refresh: () => Promise<string> };
    expect(spec).toMatchObject({ kind: "url", url: "https://blob.example/f?sig=1" });
    expect(await spec.refresh()).toBe(`https://blob.example/${"f".repeat(64)}?fresh`);
  });

  it("reports a file the cloud does not have as missing (not as an error)", async () => {
    const { CloudError } = await import("@/lib/cloud");
    const library = new MediaLibrary({
      store: async () => new MemoryMediaStore(),
      probe,
      cloud: () => ({ enabled: true, mediaUrl: async () => Promise.reject(new CloudError("Not found", 404)) }) as never,
    });
    const gone = projectFile({ id: "G", cloud: { sha256: "9".repeat(64), size: 1, name: "g.mp4" } });
    await library.sync({ files: [gone] } as never);
    expect(library.status.getState().G?.status).toBe("missing");
  });
});

describe("matchRelinkCandidates", () => {
  it("matches by basename, case-insensitively, preferring equal size", () => {
    const a = projectFile({ id: "A", path: "/Volumes/Footage/Take1.MP4", fingerprint: { size: 200, sha256: "x" } });
    const b = projectFile({ id: "B", path: "C:\\music\\song.mp3" });
    const picks = [new File([new Uint8Array(100)], "take1.mp4"), new File([new Uint8Array(200)], "take1.mp4"), new File([new Uint8Array(1)], "song.mp3")];
    const matches = matchRelinkCandidates([a, b], picks);
    expect(matches.get("A")?.size).toBe(200);
    expect(matches.get("B")?.name).toBe("song.mp3");
  });
});
