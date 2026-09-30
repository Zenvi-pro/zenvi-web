import { createServer, type Server } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeAudio, NoAudioError } from "../audio/analyze.js";
import { makeAudio, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { createBackendHost } from "./backend.js";
import { createNodeMediaHost, globToRegExp, listPaths } from "./media.js";
import { assetsDirFor, createMediaResolver, mapPaths, toAbsolutePath, toStoredPath } from "./paths.js";
import { parseProjectText, readProjectFile, serializeProjectFile, withProjectLock, writeProjectFile } from "./storage.js";

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

describe("desktop path rules (json_data.py)", () => {
  const project = "/work/edits/Trip.zvn";
  const ctx = { projectFile: project, engineAssetsDir: "/opt/zenvi/assets" };

  it("stores paths relative inside the project folder and absolute outside it", () => {
    expect(toStoredPath("/work/edits/clips/a.mp4", ctx)).toBe("clips/a.mp4");
    expect(toStoredPath("/work/edits/a.mp4", ctx)).toBe("a.mp4");
    expect(toStoredPath("/media/b.mov", ctx)).toBe("/media/b.mov");
    expect(toStoredPath("/work/edits/Trip_assets/title/t.svg", ctx)).toBe("@assets/title/t.svg");
    expect(toStoredPath("/opt/zenvi/assets/transitions/common/fade.svg", ctx)).toBe("@transitions/common/fade.svg");
    expect(toStoredPath("@transitions/extra/x.jpg", ctx)).toBe("@transitions/extra/x.jpg");
    expect(toStoredPath("", ctx)).toBe("");
    expect(toStoredPath("https://example.com/v.mp4", ctx)).toBe("https://example.com/v.mp4");
  });

  it("resolves stored paths back to absolute ones", () => {
    expect(toAbsolutePath("clips/a.mp4", ctx)).toBe("/work/edits/clips/a.mp4");
    expect(toAbsolutePath("../../.openshot_qt/Downloads/x.mp3", ctx)).toBe("/.openshot_qt/Downloads/x.mp3");
    expect(toAbsolutePath("@assets/title/t.svg", ctx)).toBe("/work/edits/Trip_assets/title/t.svg");
    expect(toAbsolutePath("@transitions/common/fade.svg", ctx)).toBe("@transitions/common/fade.svg");
    expect(toAbsolutePath("/abs/v.mp4", ctx)).toBe("/abs/v.mp4");
  });

  it("follows the Windows drive rule", () => {
    const win = { projectFile: "C:\\Users\\me\\Trip.zvn", pathApi: path.win32 };
    expect(toStoredPath("C:\\Users\\me\\clips\\a.mp4", win)).toBe("clips/a.mp4");
    expect(toStoredPath("D:\\media\\b.mp4", win)).toBe("D:/media/b.mp4");
    expect(toAbsolutePath("clips/a.mp4", win)).toBe("C:\\Users\\me\\clips\\a.mp4");
  });

  it("rewrites only path keys, everywhere including history", () => {
    const data = { files: [{ path: "/work/edits/a.mp4", name: "/work/edits/a.mp4" }], history: { undo: [{ value: { image: "/work/edits/t.png" } }] } };
    const stored = mapPaths(data, (p) => toStoredPath(p, ctx));
    expect(stored.files[0]).toEqual({ path: "a.mp4", name: "/work/edits/a.mp4" });
    expect(stored.history.undo[0]!.value.image).toBe("t.png");
  });

  it("names the assets folder like get_assets_path", () => {
    expect(assetsDirFor("/x/My Film.zvn")).toBe("/x/My Film_assets");
  });

  it("resolves portable asset prefixes to the bundled assets", () => {
    const resolve = createMediaResolver({ projectFile: project, engineAssetsDir: "/opt/zenvi/assets" });
    expect(resolve("@transitions/common/fade.svg")).toBe("/opt/zenvi/assets/transitions/common/fade.svg");
    expect(resolve("clips/a.mp4")).toBe("/work/edits/clips/a.mp4");
  });
});

describe("project storage", () => {
  const minimal = (media: string): Project =>
    ({ id: "P1", fps: { num: 30, den: 1 }, clips: [], effects: [], files: [{ id: "F1", path: media }], layers: [], history: { undo: [], redo: [] } }) as unknown as Project;

  it("round-trips with relative paths and the desktop's indent=1 layout", async () => {
    const file = path.join(dir, "rt", "cut.zvn");
    await mkdir(path.dirname(file), { recursive: true });
    await writeProjectFile(file, minimal(path.join(dir, "rt", "media", "a.mp4")));
    const text = await readFile(file, "utf8");
    expect(text).toContain('\n "files": [\n  {\n   "id": "F1",\n   "path": "media/a.mp4"\n  }\n ]');
    const back = await readProjectFile(file);
    expect(back.files[0]!.path).toBe(path.join(dir, "rt", "media", "a.mp4"));
    expect((await readdir(path.dirname(file))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(serializeProjectFile(back, file)).toBe(text);
  });

  it("rejects files that are not projects with a clear error", () => {
    expect(() => parseProjectText("{nope", "/x.zvn")).toThrow(/not valid JSON/);
    expect(() => parseProjectText("[]", "/x.zvn")).toThrow(/not a Zenvi project/);
    expect(() => parseProjectText('{"clips": 3}', "/x.zvn")).toThrow(/must be a list/);
    expect(parseProjectText('\ufeff{"clips": [], "fps": {"num": 1, "den": 1}}', "/x.zvn").clips).toEqual([]);
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
  });
});

describe("media host", () => {
  it("references files by default, copies temp files into the project assets under auto", async () => {
    const media = await makeVideo(dir, "served.mp4", { duration: 1, width: 160, height: 90 });
    const projectFile = path.join(dir, "proj", "edit.zvn");
    const host = createNodeMediaHost({ projectFile: () => projectFile, policy: "reference" });
    const ref = await host.importPath!(media);
    expect(ref.path).toBe(media);
    expect(ref.info.media_type).toBe("video");
    expect(ref.fingerprint?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const auto = createNodeMediaHost({ projectFile: () => projectFile, policy: "auto" });
    const copied = await auto.importPath!(media);
    expect(copied.path).toBe(path.join(dir, "proj", "edit_assets", "media", "served.mp4"));
    expect(copied.info.path).toBe(copied.path);
    await expect(host.importPath!(path.join(dir, "missing.mp4"))).rejects.toThrow(/not found/);
  });

  it("lists files, folders and globs like import_files_tool", async () => {
    const root = path.join(dir, "tree");
    await mkdir(path.join(root, "sub"), { recursive: true });
    for (const f of ["b.mp4", "a.png", "sub/c.mp4", ".hidden"]) await writeFile(path.join(root, f), "x");
    expect(await listPaths(path.join(root, "a.png"))).toEqual({ kind: "file", files: [path.join(root, "a.png")] });
    expect((await listPaths(root)).files).toEqual([path.join(root, "a.png"), path.join(root, "b.mp4"), path.join(root, "sub", "c.mp4")]);
    expect((await listPaths(path.join(root, "**/*.mp4"))).files).toEqual([path.join(root, "b.mp4"), path.join(root, "sub", "c.mp4")]);
    expect((await listPaths(`file://${path.join(root, "b.mp4")}`)).kind).toBe("file");
    expect(await listPaths(path.join(root, "nope.mov"))).toEqual({ kind: "missing", files: [] });
    expect(globToRegExp("*.{mp4,mov}").test("x.MOV")).toBe(process.platform !== "linux");
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
