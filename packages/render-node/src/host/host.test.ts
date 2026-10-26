import { createServer, type Server } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createClip, createProject, createTransition } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeAudio, decodePcm, NoAudioError } from "../audio/analyze.js";
import { probe } from "../probe/probe.js";
import { makeAudio, makeImage, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { createBackendHost } from "./backend.js";
import { createNodeMediaHost, globToRegExp, listPaths, missingOnDisk } from "./media.js";
import { createMediaResolver, isPortableAssetPath, mapPathValues } from "./paths.js";
import { parseProjectFileText, readProjectFile, serializeProjectFile, withProjectLock, writeProjectFile } from "./storage.js";

let dir: string;
let server: Server;
let baseUrl: string;
const requests: Array<{ url: string; auth?: string; body: string }> = [];

beforeAll(async () => {
  dir = await makeTempDir("zenvi-host-");
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", auth: req.headers.authorization, body });
      if (req.url === "/big.bin") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.alloc(4096));
      } else if (req.url?.startsWith("/media/")) {
        void readFile(path.join(dir, "served.mp4")).then((bytes) => {
          res.writeHead(200, { "content-type": "video/mp4", "content-disposition": 'attachment; filename="remote clip.mp4"' });
          res.end(bytes);
        });
      } else if (req.url === "/api/v1/ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
      } else {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "Not authenticated" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await removeDir(dir);
});

describe("stored paths (engine rules, Node roots)", () => {
  it("saves paths the desktop way and loads them back absolute", async () => {
    const projectFile = path.join(dir, "paths", "Trip.zvn");
    await mkdir(path.dirname(projectFile), { recursive: true });
    const assets = path.join(dir, "bundle-assets");
    const info = await probe(await makeImage(dir, "probe-me.png"));
    // Project data is a JSON tree: every entry gets its own copy of the reader info.
    const fileAt = (id: string, p: string) => ({ ...structuredClone(info), id, path: p, media_type: "image" as const });
    const project = createProject();
    project.files = [
      fileAt("F1", path.join(dir, "paths", "clips", "a.png")),
      fileAt("F2", "/media/elsewhere/b.png"),
      fileAt("F3", path.join(dir, "paths", "Trip_assets", "title", "t.png")),
    ];
    const fps = project.fps;
    const layer = project.layers[0]!.number;
    const clip = createClip({ id: "C1", file: project.files[0]!, position: 0, layer, fps });
    const mask = { ...structuredClone(info), path: path.join(assets, "transitions", "extra", "x.jpg") };
    const t1 = createTransition({ id: "T1", layer, position: 0, duration: 1, reader: mask, fps });
    const t2 = createTransition({ id: "T2", layer, position: 1, duration: 1, reader: { ...structuredClone(info), path: "@transitions/common/fade.svg" }, fps });
    project.clips = [clip];
    project.effects = [t1, t2];
    await writeProjectFile(projectFile, project, { engineAssetsDir: assets });
    const stored = JSON.parse(await readFile(projectFile, "utf8")) as {
      files: Array<{ path: string }>;
      clips: Array<{ reader: { path: string } }>;
      effects: Array<{ reader: { path: string } }>;
      version: Record<string, string>;
    };
    expect(stored.files.map((f) => f.path)).toEqual(["clips/a.png", "/media/elsewhere/b.png", "@assets/title/t.png"]);
    expect(stored.clips[0]?.reader.path).toBe("clips/a.png");
    expect(stored.effects.map((t) => t.reader.path)).toEqual(["@transitions/extra/x.jpg", "@transitions/common/fade.svg"]);
    expect(stored.version["openshot-qt"]).not.toBe("0.0.0");
    const back = await readProjectFile(projectFile);
    expect(back.files.map((f) => f.path)).toEqual([path.join(dir, "paths", "clips", "a.png"), "/media/elsewhere/b.png", path.join(dir, "paths", "Trip_assets", "title", "t.png")]);
    // Portable aliases stay aliases in memory; the resolver maps them to the bundle.
    expect(back.effects[0]!.reader.path).toBe("@transitions/extra/x.jpg");
    const resolve = createMediaResolver({ projectFile, engineAssetsDir: assets });
    expect(resolve("@transitions/extra/x.jpg")).toBe(path.join(assets, "transitions", "extra", "x.jpg"));
    expect(resolve("clips/a.png")).toBe(path.join(dir, "paths", "clips", "a.png"));
    expect(resolve("@assets/title/t.png")).toBe(path.join(dir, "paths", "Trip_assets", "title", "t.png"));
  });

  it("rewrites only path keys, everywhere", () => {
    const data = { files: [{ path: "a", name: "a" }], deep: [{ x: { image: "b", resource: "c", lut_path: "d", other: "e" } }] };
    expect(mapPathValues(data, (p) => p.toUpperCase())).toEqual({ files: [{ path: "A", name: "a" }], deep: [{ x: { image: "B", resource: "C", lut_path: "D", other: "e" } }] });
    expect(isPortableAssetPath("@emojis/1F600.svg")).toBe(true);
    expect(isPortableAssetPath("@assets/media/a.mp4")).toBe(false);
  });
});

describe("project storage", () => {
  it("round-trips with relative paths and the desktop's indent=1 layout", async () => {
    const file = path.join(dir, "rt", "cut.zvn");
    await mkdir(path.dirname(file), { recursive: true });
    const info = await probe(await makeImage(dir, "rt-probe.png"));
    const project = createProject();
    project.files = [{ ...info, id: "F1", path: path.join(dir, "rt", "media", "a.png"), media_type: "image" }];
    await writeProjectFile(file, project);
    const text = await readFile(file, "utf8");
    expect(text.startsWith('{\n "id": ')).toBe(true);
    expect(text).toContain('\n   "path": "media/a.png"');
    const back = await readProjectFile(file);
    expect(back.files[0]!.path).toBe(path.join(dir, "rt", "media", "a.png"));
    expect((await readdir(path.dirname(file))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(serializeProjectFile(back, file)).toBe(text);
  });

  it("rejects files that are not projects with a clear error", () => {
    expect(() => parseProjectFileText("{nope", "/x.zvn")).toThrow(/not a Zenvi project: .*not valid JSON/);
    expect(() => parseProjectFileText("[]", "/x.zvn")).toThrow(/not a Zenvi project/);
    expect(() => parseProjectFileText('{"clips": 3}', "/x.zvn")).toThrow(/not a Zenvi project: clips/);
    expect(() => parseProjectFileText("  ", "/x.zvn")).toThrow(/empty/);
    expect(parseProjectFileText('\ufeff{"clips": [], "fps": {"num": 1, "den": 1}}', "/x.zvn").clips).toEqual([]);
  });

  it("serializes concurrent edits with a lock and breaks stale locks", async () => {
    const file = path.join(dir, "locked.zvn");
    const order: string[] = [];
    await Promise.all([
      withProjectLock(file, async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 150));
        order.push("a-end");
      }),
      new Promise((r) => setTimeout(r, 20)).then(() =>
        withProjectLock(file, async () => {
          order.push("b");
        }),
      ),
    ]);
    expect(order).toEqual(["a-start", "a-end", "b"]);
    await writeFile(`${file}.lock`, JSON.stringify({ pid: 999_999_999, host: (await import("node:os")).hostname(), at: Date.now() }));
    expect(await withProjectLock(file, async () => "got it", 2000)).toBe("got it");
    // Reentrant within one call chain (load → tool → save under one lock).
    expect(await withProjectLock(file, () => withProjectLock(file, async () => "nested", 500), 500)).toBe("nested");
  });
});

describe("media host", () => {
  it("references files by default, copies temp files into the project assets under auto", async () => {
    const media = await makeVideo(path.join(dir, "fake-tmp"), "served.mp4", { duration: 1, width: 160, height: 90 });
    await makeVideo(dir, "served.mp4", { duration: 1, width: 160, height: 90 });
    const projectFile = path.join(dir, "proj", "edit.zvn");
    const host = createNodeMediaHost({ projectFile: () => projectFile, policy: "reference" });
    const ref = await host.importPath!(media);
    expect(ref.path).toBe(media);
    expect(ref.info.media_type).toBe("video");
    expect(ref.fingerprint?.sha256).toMatch(/^[0-9a-f]{64}$/);
    // auto: a file from the temp folder is copied when the project lives elsewhere…
    const tempRoot = path.dirname(media);
    const auto = createNodeMediaHost({ projectFile: () => projectFile, policy: "auto", tempRoot });
    const copied = await auto.importPath!(media);
    expect(copied.path).toBe(path.join(dir, "proj", "edit_assets", "media", "served.mp4"));
    expect(copied.info.path).toBe(copied.path);
    // …and referenced when the project is in the temp folder too.
    const inTemp = createNodeMediaHost({ projectFile: () => path.join(tempRoot, "edit.zvn"), policy: "auto", tempRoot });
    expect((await inTemp.importPath!(media)).path).toBe(media);
    await expect(host.importPath!(path.join(dir, "missing.mp4"))).rejects.toThrow(/not found/);
  });

  it("lists files, folders and globs like import_files_tool", async () => {
    const root = path.join(dir, "tree");
    await mkdir(path.join(root, "sub"), { recursive: true });
    for (const f of ["b.mp4", "a.png", "sub/c.mp4", ".hidden"]) await writeFile(path.join(root, f), "x");
    expect(await listPaths(path.join(root, "a.png"))).toEqual({ kind: "file", files: [path.join(root, "a.png")], path: path.join(root, "a.png") });
    expect((await listPaths(root)).files).toEqual([path.join(root, "a.png"), path.join(root, "b.mp4"), path.join(root, "sub", "c.mp4")]);
    expect((await listPaths(path.join(root, "**/*.mp4"))).files).toEqual([path.join(root, "b.mp4"), path.join(root, "sub", "c.mp4")]);
    expect((await listPaths(`file://${path.join(root, "b.mp4")}`)).kind).toBe("file");
    expect(await listPaths(path.join(root, "nope.mov"))).toEqual({ kind: "missing", files: [], path: path.join(root, "nope.mov") });
    expect((await listPaths(`${root}/`)).path).toBe(root);
    expect(globToRegExp("*.{mp4,mov}").test("x.MOV")).toBe(process.platform !== "linux");
  });

  it("tells which project files' media is missing on disk (media_missing), image sequences by their frames", async () => {
    const root = path.join(dir, "missing-check");
    await mkdir(path.join(root, "seq"), { recursive: true });
    for (const f of ["here.mp4", "seq/f_0001.png", "seq/f_0002.png"]) await writeFile(path.join(root, f), "x");
    const fileAt = (id: string, p: string) => ({ id, path: p, media_type: "video" as const });
    const files = [
      fileAt("A", path.join(root, "here.mp4")),
      fileAt("B", path.join(root, "gone.mp4")),
      fileAt("C", path.join(root, "seq", "f_%04d.png")),
      fileAt("D", path.join(root, "seq", "g_%04d.png")),
      fileAt("E", path.join(root, "nofolder", "f_%04d.png")),
      fileAt("F", "@transitions/common/fade.svg"),
      fileAt("G", ""),
    ];
    const resolve = createMediaResolver({ projectFile: path.join(root, "p.zvn"), engineAssetsDir: path.join(root, "assets") });
    await mkdir(path.join(root, "assets", "transitions", "common"), { recursive: true });
    await writeFile(path.join(root, "assets", "transitions", "common", "fade.svg"), "<svg/>");
    expect(await missingOnDisk(files as never, resolve)).toEqual([false, true, false, true, true, false, true]);
  });

  it("downloads URLs into the assets folder with a size cap", async () => {
    const projectFile = path.join(dir, "dl", "edit.zvn");
    const host = createNodeMediaHost({ projectFile: () => projectFile, maxDownloadBytes: 1024 * 1024 });
    const media = await host.importUrl!(`${baseUrl}/media/1`);
    expect(path.basename(media.path)).toBe("remote clip.mp4");
    expect(media.info.has_video).toBe(true);
    const tiny = createNodeMediaHost({ projectFile: () => projectFile, maxDownloadBytes: 100 });
    await expect(tiny.importUrl!(`${baseUrl}/big.bin`)).rejects.toThrow(/limit/);
    expect((await readdir(path.join(dir, "dl", "edit_assets", "media"))).filter((n) => n.startsWith("big"))).toEqual([]);
    await expect(host.importUrl!("ftp://example.com/x")).rejects.toThrow(/http/);
  });

  it("writes generated media into the assets folder without overwriting", async () => {
    const projectFile = path.join(dir, "gen", "edit.zvn");
    const host = createNodeMediaHost({ projectFile: () => projectFile });
    const a = await host.writeGenerated!("title.svg", new TextEncoder().encode("<svg/>"), "image/svg+xml");
    const b = await host.writeGenerated!("title.svg", new TextEncoder().encode("<svg/>"), "image/svg+xml");
    expect(a).toBe(path.join(dir, "gen", "edit_assets", "title", "title.svg"));
    expect(b).toBe(path.join(dir, "gen", "edit_assets", "title", "title (2).svg"));
    const c = await host.writeGenerated!("../voice.mp3", new Uint8Array([1]), "audio/mpeg");
    expect(c).toBe(path.join(dir, "gen", "edit_assets", "media", "voice.mp3"));
  });
});

describe("backend host", () => {
  it("sends the bearer token and JSON, and maps errors", async () => {
    const backend = createBackendHost({ baseUrl: `${baseUrl}/`, token: async () => "tok-123" });
    expect(await backend.request("/api/v1/ok", { body: { q: 1 } })).toEqual({ ok: true, echo: { q: 1 } });
    expect(requests.at(-1)?.auth).toBe("Bearer tok-123");
    await expect(backend.request("/api/v1/private")).rejects.toThrow(/401: Not authenticated.*zenvi login/);
    const down = createBackendHost({ baseUrl: "http://127.0.0.1:9" });
    await expect(down.request("/api/v1/ok")).rejects.toThrow(/Cannot reach/);
  });

  it("shows a credit or tier refusal in the backend's own words (detail.message)", async () => {
    const message = "Out of credits for image generation. Need 3, have 0. Upgrade your plan or enable overage to continue.";
    const backend = createBackendHost({
      baseUrl,
      fetchImpl: async () => new Response(JSON.stringify({ detail: { code: "insufficient_credits", required: 3, balance: 0, message } }), { status: 402 }),
    });
    await expect(backend.request("/api/v1/generation/image", { body: { prompt: "a fox" } })).rejects.toMatchObject({ status: 402, message: `Zenvi backend 402: ${message}` });
  });
});

describe("analyzeAudio", () => {
  it("returns a 30 ms RMS envelope at 16 kHz", async () => {
    const tone = await makeAudio(dir, "tone.wav", { hz: 440, duration: 1, amplitude: 0.5 });
    const env = await analyzeAudio(tone);
    expect(env.sampleRate).toBe(16000);
    expect(env.frameSize).toBe(480);
    expect(env.rms.length).toBeGreaterThanOrEqual(33);
    const mid = env.rms[10]!;
    expect(mid).toBeGreaterThan(0.33);
    expect(mid).toBeLessThan(0.38);
    const silent = await makeVideo(dir, "noaudio.mp4", { duration: 1, width: 64, height: 48 });
    await expect(analyzeAudio(silent)).rejects.toBeInstanceOf(NoAudioError);
  });
});

describe("decodePcm", () => {
  it("decodes mono by default and both channels when asked (a mono source on both sides)", async () => {
    const tone = await makeAudio(dir, "tone-pcm.wav", { hz: 440, duration: 0.5, amplitude: 0.5 });
    const mono = await decodePcm(tone, { sampleRate: 48000 });
    expect(mono.right).toBeUndefined();
    const stereo = await decodePcm(tone, { sampleRate: 48000, channels: 2 });
    expect(stereo.samples.length).toBe(mono.samples.length);
    expect(stereo.right).toHaveLength(mono.samples.length);
    expect(stereo.right![1000]).toBeCloseTo(stereo.samples[1000]!, 5);
    expect(Math.max(...stereo.samples.slice(0, 4800).map(Math.abs))).toBeGreaterThan(0.3);
  });
});
