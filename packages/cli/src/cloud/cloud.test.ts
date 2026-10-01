import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createProject, ProjectDocument, addFile, type Project } from "@zenvi/engine";
import { probe, readProjectFile, writeProjectFile } from "@zenvi/render-node";
import { makeAudio, makeTempDir, makeVideo, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { testEnv } from "../test-support/harness.js";
import { CloudClient } from "./client.js";
import { CLOUD_MARKER_KEY, cloudProjectJson, cloudRef, getLink, projectIdFrom, pullProject, pushProject } from "./sync.js";

let root: string;
let server: Server;
let base: string;
const blobs = new Map<string, Buffer>();
const declared = new Map<string, { name: string; contentType: string; size: number }>();
const projects = new Map<string, { name: string; project: unknown; revision: number }>();
const log: string[] = [];
let auth = "";

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

beforeAll(async () => {
  root = await makeTempDir("zenvi-cloud-");
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", base);
      const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(data));
      };
      log.push(`${req.method} ${url.pathname}`);
      if (url.pathname.startsWith("/blob/")) {
        const hash = url.pathname.slice(6);
        if (req.method === "PUT") {
          if (req.headers["x-ms-blob-type"] !== "BlockBlob" || !req.headers["content-length"]) return send(400, { error: "bad put" });
          blobs.set(hash, body);
          return send(201, {});
        }
        const blob = blobs.get(hash);
        if (!blob) return send(404, {});
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(blob);
      }
      auth = String(req.headers.authorization ?? "");
      if (auth !== "Bearer zvn_pat_test") return send(401, { error: "unauthorized", message: "Sign in" });
      const json = body.length ? (JSON.parse(body.toString()) as Record<string, unknown>) : {};
      if (url.pathname === "/v1/media/check") {
        const hashes = json.sha256 as string[];
        return send(200, { existing: hashes.filter((h) => blobs.has(h)), missing: hashes.filter((h) => !blobs.has(h)) });
      }
      if (url.pathname === "/v1/media" && req.method === "POST") {
        const hash = String(json.sha256);
        declared.set(hash, { name: String(json.name), contentType: String(json.contentType), size: Number(json.size) });
        if (blobs.has(hash)) return send(200, { sha256: hash, blobPath: `m/${hash}`, exists: true });
        return send(201, { sha256: hash, blobPath: `m/${hash}`, exists: false, uploadUrl: `${base}/blob/${hash}?sig=1`, uploadHeaders: { "x-ms-blob-type": "BlockBlob", "Content-Type": String(json.contentType) } });
      }
      const complete = /^\/v1\/media\/([0-9a-f]{64})\/complete$/.exec(url.pathname);
      if (complete) {
        const blob = blobs.get(complete[1]!);
        if (!blob || sha(blob) !== complete[1]) return send(422, { error: "hash_mismatch" });
        return send(200, { sha256: complete[1], verified: true });
      }
      if (url.pathname === "/v1/projects" && req.method === "POST") {
        const id = `p${projects.size + 1}`;
        projects.set(id, { name: String(json.name), project: json.project, revision: 1 });
        return send(201, { id, name: json.name, revision: "1", editorUrl: `https://zenvi.test/editor/p/${id}` });
      }
      const one = /^\/v1\/projects\/([A-Za-z0-9]+)$/.exec(url.pathname);
      if (one) {
        const entry = projects.get(one[1]!);
        if (!entry) return send(404, { error: "not_found" });
        if (req.method === "PUT") {
          const ifMatch = String(req.headers["if-match"] ?? "");
          if (ifMatch !== "*" && ifMatch !== `"${entry.revision}"`) return send(409, { error: "conflict", revision: String(entry.revision) });
          entry.project = json;
          entry.revision += 1;
          return send(200, { id: one[1], revision: String(entry.revision) });
        }
        if (req.method === "PATCH") {
          entry.name = String(json.name);
          return send(200, { id: one[1], name: entry.name });
        }
        const project = entry.project as Project;
        const media = project.files
          .filter((f) => f.cloud && blobs.has(f.cloud.sha256))
          .map((f) => ({ fileId: f.id, sha256: f.cloud!.sha256, name: f.cloud!.name, size: f.cloud!.size, url: `${base}/blob/${f.cloud!.sha256}` }));
        return send(200, { id: one[1], name: entry.name, revision: String(entry.revision), project, media, missingMedia: [] });
      }
      if (url.pathname === "/v1/projects") return send(200, { projects: [...projects].map(([id, p]) => ({ id, name: p.name })) });
      send(404, { error: "not_found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await removeDir(root);
});

async function localProject(): Promise<{ file: string; project: Project }> {
  const work = path.join(root, "work");
  const a = await makeVideo(work, "shot.mp4", { duration: 1, width: 160, height: 90 });
  const b = await makeAudio(work, "music.mp3", { duration: 1 });
  // Same bytes under another name: uploaded once.
  const dup = path.join(work, "copy-of-shot.mp4");
  await copyFile(a, dup);
  const doc = new ProjectDocument(createProject());
  const infos = await Promise.all([a, b, dup].map((p) => probe(p)));
  doc.transaction("import", (tx) => {
    infos.forEach((info) => addFile(tx, { path: info.path, info, name: path.basename(info.path) }));
  });
  const file = path.join(work, "trip.zvn");
  await writeProjectFile(file, doc.toJSON());
  return { file, project: await readProjectFile(file) };
}

describe("push and pull", () => {
  const config = () => loadConfig(testEnv(root, { ZENVI_CLOUD_URL: base, ZENVI_EDITOR_URL: "https://zenvi.test/editor" }));
  const client = () => new CloudClient(base, async () => "zvn_pat_test");

  it("uploads missing media once (full SHA-256), stores cloud refs and file-name paths, and links the file", async () => {
    const { file, project } = await localProject();
    const result = await pushProject({ config: config(), client: client(), projectFile: file, project });
    expect(result).toMatchObject({ projectId: "p1", created: true, uploaded: 2, reused: 0, editorUrl: "https://zenvi.test/editor/p/p1" });
    expect(blobs.size).toBe(2);
    const stored = projects.get("p1")!.project as Project;
    const names = stored.files.map((f) => f.path);
    expect(names).toEqual(["shot.mp4", "music.mp3", "copy-of-shot.mp4"]);
    for (const f of stored.files) {
      expect(f.cloud?.sha256).toBe(sha(await readFile(project.files.find((x) => x.id === f.id)!.path)));
      expect(JSON.stringify(f)).not.toContain(root);
    }
    expect(declared.get(stored.files[0]!.cloud!.sha256)?.contentType).toBe("video/mp4");
    // The desktop's shape (zenvi-core #238): whole-file sha256, size, name, content_type, mtime.
    const shot = stored.files[0]!.cloud as unknown as Record<string, unknown>;
    expect(Object.keys(shot).sort()).toEqual(["content_type", "mtime", "name", "sha256", "size"]);
    expect(typeof shot.mtime).toBe("number");
    expect(result.cloudRefs[stored.files[0]!.id]).toMatchObject({ sha256: shot.sha256, mtime: shot.mtime });
    expect(await getLink(config(), file)).toMatchObject({ projectId: "p1", revision: "1" });

    // Second push updates the same project with If-Match and uploads nothing.
    const again = await pushProject({ config: config(), client: client(), projectFile: file, project });
    expect(again).toMatchObject({ projectId: "p1", created: false, uploaded: 0, reused: 2 });
    expect(projects.get("p1")!.revision).toBe(2);
  });

  it("reuses a stored hash while size and mtime match, and keeps unknown cloud keys", async () => {
    const { file, project } = await localProject();
    const first = await pushProject({ config: config(), client: client(), projectFile: file, project, force: true });
    const shotId = project.files[0]!.id;
    const fake = "f".repeat(64);
    const withRefs = structuredClone(project);
    withRefs.files[0]!.cloud = { ...first.cloudRefs[shotId]!, sha256: fake, desktop_extra: "kept" } as never;
    const checked: string[] = [];
    const spy = new CloudClient(base, async () => "zvn_pat_test");
    const original = spy.checkMedia.bind(spy);
    spy.checkMedia = async (hashes) => {
      checked.push(...hashes);
      return original(hashes);
    };
    const again = await pushProject({ config: config(), client: spy, projectFile: file, project: withRefs, force: true }).catch(() => undefined);
    expect(checked).toContain(fake);
    void again;
    const ref = cloudRef({ ...project.files[0]!, cloud: { sha256: fake, size: 1, name: "n", desktop_extra: "kept" } }, { sha256: "a".repeat(64), size: 2, contentType: "video/mp4", name: "shot.mp4", mtime: 3 });
    expect(ref).toEqual({ sha256: "a".repeat(64), size: 2, name: "shot.mp4", content_type: "video/mp4", mtime: 3, desktop_extra: "kept" });
    // A changed mtime means re-hash.
    withRefs.files[0]!.cloud = { ...first.cloudRefs[shotId]!, sha256: fake, mtime: 1 } as never;
    checked.length = 0;
    await pushProject({ config: config(), client: spy, projectFile: file, project: withRefs, force: true });
    expect(checked).not.toContain(fake);
  });

  it("reports a conflict when the cloud copy changed since the last push", async () => {
    const { file, project } = await localProject();
    projects.get("p1")!.revision = 99;
    await expect(pushProject({ config: config(), client: client(), projectFile: file, project })).rejects.toThrow(/changed since your last push/);
    const forced = await pushProject({ config: config(), client: client(), projectFile: file, project, force: true });
    expect(forced.projectId).toBe("p1");
  });

  it("pulls a project into a folder with local media paths", async () => {
    const result = await pullProject({ config: config(), client: client(), id: "https://zenvi.test/editor/p/p1", cwd: path.join(root, "pulled") });
    expect(result.downloaded).toBe(3);
    const pulled = await readProjectFile(result.projectFile);
    for (const f of pulled.files) {
      expect(f.path.startsWith(path.join(path.dirname(result.projectFile), "trip_assets", "media"))).toBe(true);
      expect(sha(await readFile(f.path))).toBe(f.cloud!.sha256);
    }
    // Pulling again reuses what is on disk.
    const again = await pullProject({ config: config(), client: client(), id: "p1", cwd: path.join(root, "pulled") });
    expect(again).toMatchObject({ downloaded: 0, reused: 3 });
  });

  it("never pulls over another project: names that sanitize alike get their own folder; local edits need --force", async () => {
    const cwd = path.join(root, "collide");
    const empty = () => JSON.parse(JSON.stringify(createProject())) as unknown;
    projects.set("p7", { name: "Trip/One", project: empty(), revision: 1 });
    projects.set("p8", { name: "Trip:One", project: empty(), revision: 1 });
    const pull = (id: string, extra: { dir?: string; force?: boolean } = {}) => pullProject({ config: config(), client: client(), id, cwd, ...extra });
    const markerOf = async (file: string) => (JSON.parse(await readFile(file, "utf8")) as Record<string, { project_id?: string }>)[CLOUD_MARKER_KEY]?.project_id;

    const first = await pull("p7");
    expect(first.projectFile).toBe(path.join(cwd, "Trip_One", "Trip_One.zvn"));
    expect(await markerOf(first.projectFile)).toBe("p7");
    const second = await pull("p8");
    expect(second.projectFile).toBe(path.join(cwd, "Trip_One (2)", "Trip_One.zvn"));
    expect(await markerOf(first.projectFile)).toBe("p7");
    expect(await markerOf(second.projectFile)).toBe("p8");
    // The same project pulls into its own folder again.
    expect((await pull("p7")).projectFile).toBe(first.projectFile);
    expect((await pull("p8")).projectFile).toBe(second.projectFile);

    // An explicit folder holding another project is only replaced with --force.
    await expect(pull("p8", { dir: "Trip_One" })).rejects.toThrow(/belongs to cloud project p7/);
    expect(await markerOf(first.projectFile)).toBe("p7");

    // Local edits since the last sync are never replaced silently.
    const edited = JSON.parse(await readFile(first.projectFile, "utf8")) as Record<string, unknown>;
    await writeFile(first.projectFile, JSON.stringify({ ...edited, scale: 20 }));
    await expect(pull("p7")).rejects.toThrow(/not in Zenvi Cloud yet/);
    expect((await pull("p7", { force: true })).projectFile).toBe(first.projectFile);

    // A local project that was never in the cloud is not replaced either.
    await mkdir(path.join(cwd, "Solo"), { recursive: true });
    await writeProjectFile(path.join(cwd, "Solo", "Solo.zvn"), createProject());
    projects.set("p9", { name: "Solo", project: empty(), revision: 1 });
    expect((await pull("p9")).projectFile).toBe(path.join(cwd, "Solo (2)", "Solo.zvn"));
    await expect(pull("p9", { dir: "Solo" })).rejects.toThrow(/belongs to a local project/);

    // The marker is local: pushing a pulled project does not upload it.
    const pulled = await readProjectFile(first.projectFile);
    await pushProject({ config: config(), client: client(), projectFile: first.projectFile, project: pulled });
    expect(projects.get("p7")!.project as Record<string, unknown>).not.toHaveProperty(CLOUD_MARKER_KEY);
  });

  it("tells signed-out users to log in", async () => {
    await expect(new CloudClient(base, async () => undefined).listProjects()).rejects.toThrow(/not signed in/);
    await expect(new CloudClient(base, async () => "zvn_pat_wrong").listProjects()).rejects.toThrow(/401/);
  });

  it("keeps portable asset paths and names unknown absolute paths", () => {
    const project = { files: [], clips: [{ id: "c", reader: { path: "@transitions/common/fade.svg" }, image: "/Users/x/.openshot_qt/thumbnail/c.png" }] } as unknown as Project;
    const warnings: string[] = [];
    const out = cloudProjectJson(project, [], (w) => warnings.push(w));
    expect(out.clips[0]!.reader.path).toBe("@transitions/common/fade.svg");
    expect(out.clips[0]!.image).toBe("c.png");
    expect(warnings).toEqual([]);
    expect(projectIdFrom("https://zenvi.pro/editor/p/abc123?x=1")).toBe("abc123");
  });
});
