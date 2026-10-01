// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CloudConflictError, CloudError, cloudRouteId, HttpCloudClient, parseCloudRouteId } from "./cloud";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json", ...(next.headers ?? {}) },
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const client = (f: typeof fetch, token: string | null = "jwt") => new HttpCloudClient("https://cloud.example", async () => token, f);

describe("HttpCloudClient", () => {
  it("sends the Supabase token and lists projects", async () => {
    const { fn, calls } = fakeFetch([{ body: { projects: [{ id: "p1", name: "Trip", updatedAt: "2026-09-30T10:00:00Z", revision: "r1" }] } }]);
    const list = await client(fn).listProjects();
    expect(list).toEqual([expect.objectContaining({ id: "p1", name: "Trip", revision: "r1" })]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(calls[0]!.url).toBe("https://cloud.example/v1/projects");
  });

  it("refuses before calling when signed out", async () => {
    const { fn } = fakeFetch([]);
    await expect(client(fn, null).listProjects()).rejects.toMatchObject({ status: 401 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("saves with If-Match, and * when overwriting", async () => {
    const { fn, calls } = fakeFetch([{ body: { id: "p1", revision: "r2" } }, { body: { id: "p1", revision: "r3" } }]);
    const c = client(fn);
    expect(await c.saveProject("p1", { id: "X" } as never, "r1")).toEqual({ revision: "r2" });
    expect((calls[0]!.init.headers as Record<string, string>)["If-Match"]).toBe("r1");
    expect(calls[0]!.init.method).toBe("PUT");
    await c.saveProject("p1", { id: "X" } as never, null);
    expect((calls[1]!.init.headers as Record<string, string>)["If-Match"]).toBe("*");
  });

  it("turns 409 into a conflict carrying the current revision", async () => {
    const { fn } = fakeFetch([{ status: 409, body: { error: { code: "revision_conflict", message: "changed" }, revision: "r9" } }]);
    const error = await client(fn).saveProject("p1", { id: "X" } as never, "r1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudConflictError);
    expect((error as CloudConflictError).currentRevision).toBe("r9");
  });

  it("reads the cloud's nested error message", async () => {
    const { fn } = fakeFetch([{ status: 413, body: { error: { code: "too_large", message: "Project is larger than 20 MB." } } }]);
    const error = await client(fn).createProject("Big").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as CloudError).message).toBe("Project is larger than 20 MB.");
  });

  it("parses the project document with signed media URLs", async () => {
    const { fn } = fakeFetch([
      {
        body: { id: "p1", name: "Trip", revision: "r1", project: { id: "ABC" }, media: [{ fileId: "F1", sha256: "a".repeat(64), url: "https://blob/x?sig" }] },
        headers: { ETag: '"r1"' },
      },
    ]);
    const doc = await client(fn).getProject("p1");
    expect(doc).toMatchObject({ id: "p1", name: "Trip", revision: "r1", project: { id: "ABC" } });
    expect(doc.media[0]).toMatchObject({ sha256: "a".repeat(64), url: "https://blob/x?sig" });
  });

  it("reads media check results and upload tickets", async () => {
    const sha = "b".repeat(64);
    const { fn, calls } = fakeFetch([
      { body: { existing: [sha], missing: [] } },
      { status: 201, body: { sha256: sha, exists: false, uploadUrl: "https://blob/up?sas", uploadHeaders: { "x-ms-blob-type": "BlockBlob" } } },
    ]);
    const c = client(fn);
    expect(await c.checkMedia([sha])).toEqual(new Set([sha]));
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ sha256: [sha] });
    const ticket = await c.requestUpload({ sha256: sha, size: 10, name: "a.mp4", contentType: "video/mp4" });
    expect(ticket).toMatchObject({ exists: false, uploadUrl: "https://blob/up?sas", uploadHeaders: { "x-ms-blob-type": "BlockBlob" } });
  });

  it("parses consent info without auth", async () => {
    const { fn, calls } = fakeFetch([
      {
        body: {
          request: "r",
          client: { id: "https://chatgpt.com/x", name: "ChatGPT", type: "metadata_document", verifiedHost: "chatgpt.com" },
          redirectHost: "chatgpt.com",
          scopes: [{ name: "zenvi:read", description: "Read your projects" }],
        },
      },
    ]);
    const info = await client(fn, null).consentInfo("req1");
    expect(info).toEqual({ clientName: "ChatGPT", verifiedHost: "chatgpt.com", logoUri: undefined, redirectHost: "chatgpt.com", scopes: [{ name: "zenvi:read", description: "Read your projects" }] });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("wraps render requests as { preset, options }", async () => {
    const { fn, calls } = fakeFetch([{ status: 202, body: { renderId: "rnd1", status: "queued", progress: 0 } }]);
    const status = await client(fn).startRender("p1", { preset: "mp4-1080p" });
    expect(status).toMatchObject({ renderId: "rnd1", status: "queued" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ preset: "mp4-1080p" });
  });

  it("approves or denies device codes", async () => {
    const { fn, calls } = fakeFetch([{ body: { status: "denied", clientName: "zenvi CLI" } }]);
    expect(await client(fn).approveDevice("ABCD-EFGH", false)).toEqual({ clientName: "zenvi CLI" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ user_code: "ABCD-EFGH", approve: false });
  });
});

describe("cloud route ids", () => {
  it("round-trips", () => {
    expect(cloudRouteId("p1")).toBe("c_p1");
    expect(parseCloudRouteId("c_p1")).toBe("p1");
    expect(parseCloudRouteId("abc123")).toBeNull();
    expect(parseCloudRouteId("c_")).toBeNull();
  });
});
