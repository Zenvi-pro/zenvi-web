import { addClip, addFile, parseProject, PROJECT_FORMAT_VERSION, ProjectDocument } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { harness, sampleProject, USER_A, USER_B } from "../testing/helpers.js";

describe("projects API", () => {
  it("creates, lists, reads, renames and deletes a project", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);

    const created = await h.request("POST", "/v1/projects", { token, json: { name: "Holiday cut" } });
    expect(created.status).toBe(201);
    expect(created.json.id).toMatch(/^c_[a-z0-9]{16}$/);
    expect(created.json.editorUrl).toBe(`https://zenvi.test/editor/p/${created.json.id}`);
    expect(created.headers.get("etag")).toBe(`"${created.json.revision}"`);
    const id = created.json.id as string;

    const list = await h.request("GET", "/v1/projects", { token });
    expect(list.json.projects).toHaveLength(1);
    expect(list.json.projects[0]).toMatchObject({ id, name: "Holiday cut", revision: created.json.revision });

    const got = await h.request("GET", `/v1/projects/${id}`, { token });
    expect(got.status).toBe(200);
    expect(got.json.project).toMatchObject({ width: 1280, height: 720, fps: { num: 30, den: 1 }, clips: [], profile: "HD 720p 30 fps" });
    expect(got.json.revision).toBe(created.json.revision);
    expect(got.json.media).toEqual([]);

    const renamed = await h.request("PATCH", `/v1/projects/${id}`, { token, json: { name: "  Final   cut " } });
    expect(renamed.json.name).toBe("Final cut");
    expect((await h.request("GET", "/v1/projects", { token })).json.projects[0].name).toBe("Final cut");

    expect((await h.request("DELETE", `/v1/projects/${id}`, { token })).status).toBe(204);
    expect((await h.request("GET", `/v1/projects/${id}`, { token })).status).toBe(404);
    expect(h.blobs.paths().filter((p) => p.includes(id))).toEqual([]);
  });

  it("keeps unknown desktop keys through a round trip", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const project = sampleProject({
      zenvi_ai: { index: [1, 2, 3] },
      files: [{ id: "F1", path: "/x.mp4", tags: "a", cloud: { sha256: "0".repeat(64), size: 1, name: "x.mp4", mtime: 1727700000.5 } }],
    });
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "Imported", project } });
    const got = await h.request("GET", `/v1/projects/${created.json.id}`, { token });
    expect(got.json.project.zenvi_ai).toEqual({ index: [1, 2, 3] });
    expect(got.json.project.files[0].tags).toBe("a");
    expect(got.json.project.files[0].cloud.mtime).toBe(1727700000.5);
    expect(got.json.missingMedia).toEqual([{ fileId: "F1", name: "x.mp4", sha256: "0".repeat(64), reason: "not_uploaded" }]);
  });

  it("never treats the desktop's partial fingerprint as a cloud content address", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    // Media whose full SHA-256 happens to equal a file's fingerprint.sha256 must still not be linked to it.
    const bytes = Buffer.from("cloud bytes");
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const ticket = await h.request("POST", "/v1/media", { token, json: { sha256: sha, size: bytes.length, name: "c.mp4", contentType: "video/mp4" } });
    await h.blobs.acceptSignedWrite(ticket.json.uploadUrl, bytes);
    await h.request("POST", `/v1/media/${sha}/complete`, { token });
    const project = sampleProject({
      files: [{ id: "F1", path: "/Users/me/c.mp4", media_type: "video", fingerprint: { sha256: sha, size: bytes.length, mtime: 1 } }],
    });
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "Desktop", project } });
    const got = await h.request("GET", `/v1/projects/${created.json.id}`, { token });
    expect(got.json.media).toEqual([]);
    expect(got.json.missingMedia).toEqual([{ fileId: "F1", name: "c.mp4", reason: "not_in_cloud" }]);
  });

  it("does not list a bundled emoji sticker as missing media", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const project = sampleProject({ files: [{ id: "E1", path: "@emojis/1F525.svg", media_type: "image", name: "Fire" }] });
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "Stickers", project } });
    const got = await h.request("GET", `/v1/projects/${created.json.id}`, { token });
    expect(got.json.media).toEqual([]);
    expect(got.json.missingMedia).toEqual([]);
  });

  it("stamps every stored project with the engine's format version (never the 0.0.0 template stamp)", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "Fresh" } });
    const got = await h.request("GET", `/v1/projects/${created.json.id}`, { token });
    expect(got.json.project.version).toEqual(PROJECT_FORMAT_VERSION);
    // The blob itself is serializeProject output: the desktop's indented layout with the stamp.
    const blob = await h.blobs.read(`u/${USER_A}/p/${created.json.id}/project.json`);
    const text = blob?.data.toString("utf8") ?? "";
    expect(text).toContain('"openshot-qt": "1.0.188"');
    expect(text.startsWith("{\n")).toBe(true);
  });

  it("keeps clip alpha at 1 through save, load and the desktop's load upgrades", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "Alpha" } });
    const id = created.json.id as string;
    const loaded = await h.request("GET", `/v1/projects/${id}`, { token });
    // Edit the stored JSON as-is (no client-side parse), the way MCP edits do:
    // a ProjectDocument over the loaded project, the engine's ops, then save.
    const doc = new ProjectDocument(loaded.json.project);
    doc.transaction("Import", (tx) =>
      addFile(tx, {
        path: "clip.mp4",
        name: "clip.mp4",
        info: { type: "FFmpegReader", path: "clip.mp4", has_video: true, has_audio: false, has_single_image: false, duration: 4, width: 320, height: 240, fps: { num: 30, den: 1 }, video_length: 120, pixel_ratio: { num: 1, den: 1 }, display_ratio: { num: 4, den: 3 }, sample_rate: 0, channels: 0, channel_layout: 0 },
        cloud: { sha256: "a".repeat(64), size: 1, name: "clip.mp4" },
      }),
    );
    const fileId = doc.project.files[0]!.id;
    doc.transaction("Add clip", (tx) => addClip(tx, { fileId, position: 0, layer: doc.project.layers[0]!.number }));
    const alphaOf = (project: unknown) => (project as { clips: { alpha: { Points: { co: { Y: number } }[] } }[] }).clips[0]!.alpha.Points[0]!.co.Y;
    expect(alphaOf(doc.project)).toBe(1);
    await h.services.projects.save(USER_A, id, doc.toJSON(), loaded.json.revision);

    const again = await h.request("GET", `/v1/projects/${id}`, { token });
    expect(again.json.project.version).toEqual(PROJECT_FORMAT_VERSION);
    // What the desktop, the editor and the CLI do on open: parseProject. A "0.0.0"
    // stamp here would run the OpenShot beta migration and turn alpha to 0.
    expect(alphaOf(parseProject(again.json.project))).toBe(1);

    // A client sending back exactly what it loaded changes nothing either.
    const resaved = await h.request("PUT", `/v1/projects/${id}`, { token, json: again.json.project, headers: { "if-match": again.json.revision } });
    expect(resaved.status).toBe(200);
    const third = await h.request("GET", `/v1/projects/${id}`, { token });
    expect(alphaOf(third.json.project)).toBe(1);
    expect(alphaOf(parseProject(third.json.project))).toBe(1);
  });

  it("never lets one user see or change another user's project", async () => {
    const h = await harness();
    const a = await h.userToken(USER_A);
    const b = await h.userToken(USER_B);
    const created = await h.request("POST", "/v1/projects", { token: a, json: { name: "A's" } });
    const id = created.json.id as string;
    const rev = created.json.revision as string;

    expect((await h.request("GET", "/v1/projects", { token: b })).json.projects).toEqual([]);
    expect((await h.request("GET", `/v1/projects/${id}`, { token: b })).status).toBe(404);
    expect((await h.request("PUT", `/v1/projects/${id}`, { token: b, json: sampleProject(), headers: { "if-match": rev } })).status).toBe(404);
    expect((await h.request("PATCH", `/v1/projects/${id}`, { token: b, json: { name: "mine now" } })).status).toBe(404);
    expect((await h.request("DELETE", `/v1/projects/${id}`, { token: b })).status).toBe(404);
    expect((await h.request("POST", `/v1/projects/${id}/renders`, { token: b, json: {} })).status).toBe(404);
    expect((await h.request("GET", `/v1/projects/${id}`, { token: a })).json.name).toBe("A's");
  });

  it("saves with If-Match and answers 409 with the current revision on a stale write", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "P" } });
    const id = created.json.id as string;
    const first = created.json.revision as string;

    const missing = await h.request("PUT", `/v1/projects/${id}`, { token, json: sampleProject() });
    expect(missing.status).toBe(428);

    const saved = await h.request("PUT", `/v1/projects/${id}`, { token, json: sampleProject({ width: 1920, height: 1080 }), headers: { "if-match": `"${first}"` } });
    expect(saved.status).toBe(200);
    expect(saved.json.revision).not.toBe(first);
    expect(saved.json.stats).toMatchObject({ width: 1920, height: 1080 });

    const stale = await h.request("PUT", `/v1/projects/${id}`, { token, json: sampleProject(), headers: { "if-match": first } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("revision_conflict");
    expect(stale.json.revision).toBe(saved.json.revision);

    const forced = await h.request("PUT", `/v1/projects/${id}`, { token, json: sampleProject(), headers: { "if-match": "*" } });
    expect(forced.status).toBe(200);
  });

  it("rejects invalid and oversized project JSON", async () => {
    const h = await harness({ config: { limits: { maxProjectBytes: 2048 } } });
    const token = await h.userToken(USER_A);
    const bad = await h.request("POST", "/v1/projects", { token, json: { name: "x", project: { width: -5, clips: [{ id: "C1" }] } } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("invalid_project");
    expect(bad.json.issues.length).toBeGreaterThan(0);
    expect(bad.json.issues[0]).toEqual({ path: expect.any(String), message: expect.any(String) });

    const huge = await h.request("POST", "/v1/projects", { token, json: { name: "x", project: sampleProject({ notes: "x".repeat(5000) }) } });
    expect(huge.status).toBe(413);

    const notJson = await h.request("POST", "/v1/projects", { token, body: "{nope", headers: { "content-type": "application/json" } });
    expect(notJson.status).toBe(400);
  });

  it("404s malformed ids instead of touching storage paths", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    expect((await h.request("GET", "/v1/projects/..%2F..%2Fsecrets", { token })).status).toBe(404);
    expect((await h.request("GET", "/v1/projects/c_short", { token })).status).toBe(404);
  });
});
