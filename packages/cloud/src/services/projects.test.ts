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
    const bad = await h.request("POST", "/v1/projects", { token, json: { name: "x", project: { width: -5 } } });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("invalid_project");

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
