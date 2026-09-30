import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { harness, sampleProject, USER_A, USER_B } from "../testing/helpers.js";
import { attachmentDisposition, normalizeContentType } from "./media.js";

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

describe("media API", () => {
  it("uploads through a single-blob SAS URL, then dedupes by hash", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const bytes = Buffer.from("fake mp4 bytes");
    const hash = sha(bytes);

    expect((await h.request("POST", "/v1/media/check", { token, json: { sha256: [hash] } })).json).toEqual({ existing: [], missing: [hash] });

    const declared = await h.request("POST", "/v1/media", { token, json: { sha256: hash, size: bytes.length, name: "clip.mp4", contentType: "video/mp4" } });
    expect(declared.status).toBe(201);
    expect(declared.json).toMatchObject({ exists: false, blobPath: `u/${USER_A}/media/${hash}` });
    expect(declared.json.uploadHeaders).toEqual({ "x-ms-blob-type": "BlockBlob", "Content-Type": "video/mp4" });
    const url = declared.json.uploadUrl as string;
    expect(new URL(url).searchParams.get("sp")).toBe("cw");

    // Not visible until completed.
    await h.blobs.acceptSignedWrite(url, bytes, "video/mp4");
    expect((await h.request("POST", "/v1/media/check", { token, json: { sha256: [hash] } })).json.missing).toEqual([hash]);

    const done = await h.request("POST", `/v1/media/${hash}/complete`, { token });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ sha256: hash, size: bytes.length, name: "clip.mp4", contentType: "video/mp4", verified: true });

    expect((await h.request("POST", "/v1/media/check", { token, json: { sha256: [hash, "f".repeat(64)] } })).json).toEqual({
      existing: [hash],
      missing: ["f".repeat(64)],
    });
    const again = await h.request("POST", "/v1/media", { token, json: { sha256: hash, size: bytes.length, name: "copy.mp4", contentType: "video/mp4" } });
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ sha256: hash, blobPath: `u/${USER_A}/media/${hash}`, exists: true });

    const read = await h.request("GET", `/v1/media/${hash}/url`, { token });
    expect(read.status).toBe(200);
    expect(await h.blobs.acceptSignedRead(read.json.url)).toEqual(bytes);
    const params = new URL(read.json.url).searchParams;
    expect(params.get("sp")).toBe("r");
    expect(params.get("rsct")).toBe("video/mp4");
    expect(params.get("rscd")).toBe('attachment; filename="clip.mp4"');
  });

  it("signs read URLs for a project's media and lists what is missing", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const bytes = Buffer.from("a picture");
    const hash = sha(bytes);
    const ticket = await h.request("POST", "/v1/media", { token, json: { sha256: hash, size: bytes.length, name: "a.png", contentType: "image/png" } });
    await h.blobs.acceptSignedWrite(ticket.json.uploadUrl, bytes);
    await h.request("POST", `/v1/media/${hash}/complete`, { token });
    const project = sampleProject({
      files: [
        { id: "F1", path: "a.png", media_type: "image", cloud: { sha256: hash, size: bytes.length, name: "a.png" } },
        { id: "F2", path: "/Users/me/local.mov", media_type: "video" },
      ],
    });
    const created = await h.request("POST", "/v1/projects", { token, json: { name: "p", project } });
    const got = await h.request("GET", `/v1/projects/${created.json.id}`, { token });
    expect(got.json.media).toHaveLength(1);
    expect(got.json.media[0]).toMatchObject({ fileId: "F1", sha256: hash, contentType: "image/png", size: bytes.length });
    expect(await h.blobs.acceptSignedRead(got.json.media[0].url)).toEqual(bytes);
    expect(got.json.missingMedia).toEqual([{ fileId: "F2", name: "local.mov", reason: "not_in_cloud" }]);
  });

  it("deletes an upload whose bytes do not match the declared hash or size", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    const hash = sha("the real bytes");
    const ticket = await h.request("POST", "/v1/media", { token, json: { sha256: hash, size: 14, name: "x.mp4", contentType: "video/mp4" } });
    await h.blobs.acceptSignedWrite(ticket.json.uploadUrl, "other  bytes!!");
    const wrongHash = await h.request("POST", `/v1/media/${hash}/complete`, { token });
    expect(wrongHash.status).toBe(422);
    expect(wrongHash.json.error.code).toBe("hash_mismatch");
    expect(await h.blobs.head(`u/${USER_A}/media/${hash}`)).toBeNull();

    const ticket2 = await h.request("POST", "/v1/media", { token, json: { sha256: hash, size: 99, name: "x.mp4", contentType: "video/mp4" } });
    await h.blobs.acceptSignedWrite(ticket2.json.uploadUrl, "the real bytes");
    const wrongSize = await h.request("POST", `/v1/media/${hash}/complete`, { token });
    expect(wrongSize.status).toBe(422);
    expect(wrongSize.json.error.code).toBe("size_mismatch");
  });

  it("enforces the per-file cap, the per-user quota and the content-type allowlist", async () => {
    const h = await harness({ config: { limits: { maxFileBytes: 1000, maxUserBytes: 1500 } } });
    const token = await h.userToken(USER_A);
    const big = await h.request("POST", "/v1/media", { token, json: { sha256: sha("1"), size: 1001, name: "big.mp4", contentType: "video/mp4" } });
    expect(big.status).toBe(413);
    expect(big.json.error.code).toBe("file_too_large");

    const html = await h.request("POST", "/v1/media", { token, json: { sha256: sha("2"), size: 10, name: "x.html", contentType: "text/html" } });
    expect(html.status).toBe(415);

    const first = Buffer.alloc(900, 1);
    const t1 = await h.request("POST", "/v1/media", { token, json: { sha256: sha(first), size: 900, name: "a.wav", contentType: "audio/wav" } });
    await h.blobs.acceptSignedWrite(t1.json.uploadUrl, first);
    expect((await h.request("POST", `/v1/media/${sha(first)}/complete`, { token })).status).toBe(200);
    const over = await h.request("POST", "/v1/media", { token, json: { sha256: sha("3"), size: 700, name: "b.wav", contentType: "audio/wav" } });
    expect(over.status).toBe(413);
    expect(over.json.error.code).toBe("quota_exceeded");
    expect(over.json.quotaBytes).toBe(1500);
  });

  it("keeps each user's media separate", async () => {
    const h = await harness();
    const a = await h.userToken(USER_A);
    const b = await h.userToken(USER_B);
    const bytes = Buffer.from("private");
    const hash = sha(bytes);
    const ticket = await h.request("POST", "/v1/media", { token: a, json: { sha256: hash, size: bytes.length, name: "p.mp3", contentType: "audio/mpeg" } });
    await h.blobs.acceptSignedWrite(ticket.json.uploadUrl, bytes);
    await h.request("POST", `/v1/media/${hash}/complete`, { token: a });

    expect((await h.request("POST", "/v1/media/check", { token: b, json: { sha256: [hash] } })).json.existing).toEqual([]);
    expect((await h.request("GET", `/v1/media/${hash}/url`, { token: b })).status).toBe(404);
    expect((await h.request("POST", `/v1/media/${hash}/complete`, { token: b })).status).toBe(404);
  });

  it("validates hashes", async () => {
    const h = await harness();
    const token = await h.userToken(USER_A);
    expect((await h.request("POST", "/v1/media/check", { token, json: { sha256: ["../etc"] } })).status).toBe(400);
    expect((await h.request("GET", "/v1/media/nothex/url", { token })).status).toBe(400);
  });
});

describe("media helpers", () => {
  it("normalizes content types to the allowlist", () => {
    expect(normalizeContentType("Video/MP4; codecs=avc1")).toBe("video/mp4");
    expect(normalizeContentType("image/svg+xml")).toBe("image/svg+xml");
    expect(normalizeContentType("text/html")).toBeNull();
    expect(normalizeContentType("application/javascript")).toBeNull();
    expect(normalizeContentType(undefined)).toBeNull();
  });

  it("builds ASCII-safe attachment dispositions", () => {
    expect(attachmentDisposition('évé"nt\r\n.mp4')).toBe('attachment; filename="_v_nt_.mp4"');
  });
});
