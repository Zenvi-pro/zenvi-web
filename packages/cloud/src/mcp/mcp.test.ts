import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import { fakeEngine, fakeProber, fakeRenderer, PNG_1X1 } from "../testing/fakes.js";
import { type Harness, harness, USER_A, USER_B } from "../testing/helpers.js";

type CallResult = {
  isError?: boolean;
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: Record<string, unknown>;
};

async function connect(h: Harness, token: string): Promise<Client> {
  const client = new Client({ name: "zenvi-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://cloud.test/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => h.app.request(url.toString(), init),
  });
  await client.connect(transport);
  return client;
}

async function pat(h: Harness, userId = USER_A, scopes = [SCOPE_READ, SCOPE_WRITE]): Promise<string> {
  return (await h.services.tokens.createPat({ userId, name: "test", scopes, ttlDays: 1 })).token;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  return (await client.callTool({ name, arguments: args })) as CallResult;
}

const rawPost = (h: Harness, token: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
  h.request("POST", "/mcp", { token, json: body, headers: { accept: "application/json, text/event-stream", ...headers } });

const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

const servers: HttpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

describe("/mcp authentication", () => {
  it("answers 401 with a resource_metadata challenge, even for initialize", async () => {
    const h = await harness();
    const res = await rawPost(h, undefined, INITIALIZE);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://cloud.test/.well-known/oauth-protected-resource/mcp", scope="projects.read projects.write"',
    );
    const bad = await rawPost(h, "zvn_oat_" + "x".repeat(43), INITIALIZE);
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("refuses website sessions and tokens minted for another resource", async () => {
    const h = await harness();
    expect((await rawPost(h, await h.userToken(USER_A), INITIALIZE)).status).toBe(401);
    const foreign = await h.services.tokens.issuePair({
      userId: USER_A,
      clientId: "zc_aaaaaaaaaaaaaaaaaaaa",
      clientName: "x",
      scopes: [SCOPE_READ, SCOPE_WRITE],
      resource: "https://other.test/mcp",
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    const res = await rawPost(h, foreign.accessToken, INITIALIZE);
    expect(res.status).toBe(401);
    expect(res.json.error_description).toContain("other.test");
  });

  it("rejects browser origins that are not allowed", async () => {
    const h = await harness();
    const token = await pat(h);
    expect((await rawPost(h, token, INITIALIZE, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rawPost(h, token, INITIALIZE, { origin: "null" })).status).toBe(403);
    expect((await rawPost(h, token, INITIALIZE, { origin: "https://claude.ai" })).status).toBe(200);
    expect((await rawPost(h, token, INITIALIZE, { origin: "http://localhost:6274" })).status).toBe(200);
  });

  it("is stateless: GET and DELETE are 405, no session id is issued", async () => {
    const h = await harness();
    const token = await pat(h);
    const init = await rawPost(h, token, INITIALIZE);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect((await h.request("GET", "/mcp", { token, headers: { accept: "text/event-stream" } })).status).toBe(405);
    expect((await h.request("DELETE", "/mcp", { token })).status).toBe(405);
  });
});

describe("cloud tools", () => {
  it("list with titles, output schemas and every hint explicit", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["list_projects", "create_project", "open_project", "import_media_from_url", "get_upload_link", "open_in_editor", "render_project", "get_render_status", "preview_frame"]),
    );
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema?.type).toBe("object");
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof tool.annotations?.[hint]).toBe("boolean");
      }
      const meta = tool._meta as Record<string, unknown>;
      expect(String(meta["openai/toolInvocation/invoking"]).length).toBeLessThanOrEqual(64);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.list_projects?.annotations?.readOnlyHint).toBe(true);
    expect(byName.create_project?.annotations?.readOnlyHint).toBe(false);
    expect(byName.import_media_from_url?.annotations?.openWorldHint).toBe(true);
    expect((byName.preview_frame?._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe("ui://zenvi/preview-v1.html");
    const init = client.getInstructions();
    expect(init?.length).toBeLessThanOrEqual(512);
    await client.close();
  });

  it("create, list, open and link a project; structuredContent mirrors the JSON text", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const none = await call(client, "get_upload_link");
    expect(none.isError).toBe(true);
    expect(none.content[0]?.text).toContain("No project is open");

    const created = await call(client, "create_project", { name: "Launch video", format: "vertical_1080p", fps: 30 });
    expect(created.isError).toBeFalsy();
    const projectId = created.structuredContent?.project_id as string;
    expect(projectId).toMatch(/^c_/);
    expect(created.structuredContent).toMatchObject({ width: 1080, height: 1920, fps: 30, editor_url: `https://zenvi.test/editor/p/${projectId}` });
    expect(JSON.parse(created.content[1]?.text ?? "{}")).toEqual(created.structuredContent);

    const listed = await call(client, "list_projects");
    expect(listed.structuredContent).toMatchObject({ total: 1, current_project_id: projectId });

    const opened = await call(client, "open_project", { project_id: projectId });
    expect(opened.structuredContent).toMatchObject({ project_id: projectId, name: "Launch video", width: 1080, height: 1920, clips: 0, tracks: 5 });

    const upload = await call(client, "get_upload_link");
    expect(upload.structuredContent?.upload_url).toBe(`https://zenvi.test/editor/p/${projectId}?upload=1`);
    const link = await call(client, "open_in_editor");
    expect(link.structuredContent?.url).toBe(`https://zenvi.test/editor/p/${projectId}`);

    // The stored project is the desktop format with the profile the desktop uses.
    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.profile).toBe("FHD Vertical 1080p 30 fps");
    expect(project.display_ratio).toEqual({ num: 9, den: 16 });
    await client.close();
  });

  it("validates arguments and keeps users apart", async () => {
    const h = await harness();
    const a = await connect(h, await pat(h, USER_A));
    const created = await call(a, "create_project", { name: "A only" });
    const projectId = created.structuredContent?.project_id as string;
    const bad = await call(a, "create_project", { name: "" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toMatch(/^Error: Invalid arguments/);

    const b = await connect(h, await pat(h, USER_B));
    const peek = await call(b, "open_project", { project_id: projectId });
    expect(peek.isError).toBe(true);
    expect(peek.content[0]?.text).toContain("not found");
    await a.close();
    await b.close();
  });

  it("refuses writes on a read-only grant", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h, USER_A, [SCOPE_READ]));
    const res = await call(client, "create_project", { name: "nope" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("projects.write");
    expect((await call(client, "list_projects")).isError).toBeFalsy();
    await client.close();
  });

  it("remembers the open project per connection across requests", async () => {
    const h = await harness();
    const token = await pat(h);
    const first = await connect(h, token);
    const created = await call(first, "create_project", { name: "Keep me" });
    await first.close();
    const second = await connect(h, token);
    const link = await call(second, "open_in_editor");
    expect(link.structuredContent?.project_id).toBe(created.structuredContent?.project_id);
    await second.close();
  });
});

describe("renders and frames over MCP", () => {
  it("explain that rendering is unavailable without a renderer", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    await call(client, "create_project", { name: "P" });
    const res = await call(client, "render_project", {});
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("not available");
    await client.close();
  });

  it("start a render, return the same job on retry, and report the download link", async () => {
    const renderer = fakeRenderer();
    const h = await harness({ renderer });
    const client = await connect(h, await pat(h));
    await call(client, "create_project", { name: "Trailer" });
    const started = await call(client, "render_project", { preset: "mp4-720p" });
    expect(started.isError).toBeFalsy();
    const renderId = started.structuredContent?.render_id as string;
    expect(renderId).toMatch(/^r_/);
    const again = await call(client, "render_project", { preset: "mp4-720p" });
    expect(again.structuredContent?.render_id).toBe(renderId);

    await h.services.renders.drain();
    const status = await call(client, "get_render_status", { render_id: renderId, wait_seconds: 0 });
    expect(status.structuredContent).toMatchObject({ render_id: renderId, status: "done", progress: 1, format: "mp4", width: 1280, height: 720 });
    const url = status.structuredContent?.url as string;
    expect((await h.blobs.acceptSignedRead(url)).toString()).toBe("FAKE mp4 1280x720");
    expect(renderer.renders).toBe(1);
    await client.close();
  });

  it("preview a frame as image content plus a link", async () => {
    const h = await harness({ renderer: fakeRenderer() });
    const client = await connect(h, await pat(h));
    await call(client, "create_project", { name: "P" });
    const res = await call(client, "preview_frame", { time_seconds: 1.5, width: 320 });
    expect(res.isError).toBeFalsy();
    const image = res.content.find((c) => c.type === "image");
    expect(image?.mimeType).toBe("image/png");
    expect(Buffer.from(image?.data ?? "", "base64")).toEqual(PNG_1X1);
    expect(await h.blobs.acceptSignedRead(res.structuredContent?.image_url as string)).toEqual(PNG_1X1);
    await client.close();
  });
});

describe("the preview view resource", () => {
  it("is listed and readable as an MCP Apps HTML resource with a CSP for blob storage", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const { resources } = await client.listResources();
    expect(resources[0]).toMatchObject({ uri: "ui://zenvi/preview-v1.html", mimeType: "text/html;profile=mcp-app" });
    const read = await client.readResource({ uri: "ui://zenvi/preview-v1.html" });
    const content = read.contents[0] as unknown as { text: string; _meta: { ui: { csp: { resourceDomains: string[] } } } };
    expect(content.text).toContain("ui/initialize");
    expect(content._meta.ui.csp.resourceDomains).toEqual(["https://blob.memory.invalid"]);
    await expect(client.readResource({ uri: "ui://zenvi/other.html" })).rejects.toThrow();
    await client.close();
  });
});

describe("import_media_from_url", () => {
  async function mediaServer(body: Buffer, contentType = "video/mp4"): Promise<number> {
    const server = createServer((req, res) => {
      if (req.url === "/redirect-internal") {
        res.writeHead(302, { location: "http://internal.test/secret" }).end();
        return;
      }
      res.writeHead(200, { "content-type": contentType, "content-length": String(body.length) }).end(body);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  const network = {
    policy: { protocols: ["http:", "https:"] as ("http:" | "https:")[], isAllowedAddress: (ip: string) => ip === "127.0.0.1", allowAnyPort: true },
    resolver: async (host: string) => (host === "internal.test" ? [{ address: "10.0.0.5", family: 4 as const }] : [{ address: "127.0.0.1", family: 4 as const }]),
  };

  it("downloads into the user's library, adds one bin entry, and is idempotent", async () => {
    const h = await harness({ prober: fakeProber, network });
    const port = await mediaServer(Buffer.from("not really an mp4"));
    const client = await connect(h, await pat(h));
    const created = await call(client, "create_project", { name: "P" });
    const projectId = created.structuredContent?.project_id as string;

    const first = await call(client, "import_media_from_url", { url: `http://media.test:${port}/beach.mp4` });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ project_id: projectId, name: "beach.mp4", media_type: "video", already_in_project: false, width: 320, height: 240 });
    const second = await call(client, "import_media_from_url", { url: `http://media.test:${port}/beach.mp4` });
    expect(second.structuredContent).toMatchObject({ file_id: first.structuredContent?.file_id, already_in_project: true });

    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.files).toHaveLength(1);
    expect(project.files[0]).toMatchObject({ path: "beach.mp4", media_type: "video", cloud: { name: "beach.mp4", content_type: "video/mp4" } });
    expect((project.history.undo as unknown[]).length).toBeGreaterThan(0);
    expect(await h.services.media.get(USER_A, first.structuredContent?.sha256 as string)).toMatchObject({ verified: true });
    await client.close();
  });

  it("keeps two different files that share a name", async () => {
    const h = await harness({ prober: fakeProber, network });
    const server = createServer((req, res) => res.writeHead(200, { "content-type": "video/mp4" }).end(`bytes of ${req.url}`));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const client = await connect(h, await pat(h));
    const projectId = (await call(client, "create_project", { name: "P" })).structuredContent?.project_id as string;
    const a = await call(client, "import_media_from_url", { url: `http://media.test:${port}/a/clip.mp4` });
    const b = await call(client, "import_media_from_url", { url: `http://media.test:${port}/b/clip.mp4` });
    expect(b.structuredContent?.file_id).not.toBe(a.structuredContent?.file_id);
    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.files.map((f) => f.path)).toEqual(["clip.mp4", `clip-${String(b.structuredContent?.sha256).slice(0, 8)}.mp4`]);
    await client.close();
  });

  it("refuses redirects to private addresses and web pages", async () => {
    const h = await harness({ prober: fakeProber, network });
    const port = await mediaServer(Buffer.from("<html></html>"), "text/html");
    const client = await connect(h, await pat(h));
    await call(client, "create_project", { name: "P" });
    const internal = await call(client, "import_media_from_url", { url: `http://media.test:${port}/redirect-internal` });
    expect(internal.isError).toBe(true);
    expect(internal.content[0]?.text).toContain("does not connect to");
    const page = await call(client, "import_media_from_url", { url: `http://media.test:${port}/index.html` });
    expect(page.isError).toBe(true);
    expect(page.content[0]?.text).toContain("web page");
    await client.close();
  });
});

describe("engine tools on the cloud", () => {
  it("run in one transaction per call, save with If-Match and keep undo history", async () => {
    const engine = fakeEngine();
    const h = await harness({ engine });
    const client = await connect(h, await pat(h));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("add_marker_tool");
    expect(names).not.toContain("play_tool");
    const add = tools.find((t) => t.name === "add_marker_tool");
    expect(add?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(Object.keys((add?.inputSchema.properties as object) ?? {})).toEqual(expect.arrayContaining(["position", "project_id"]));

    const created = await call(client, "create_project", { name: "P" });
    const projectId = created.structuredContent?.project_id as string;
    const before = await h.services.projects.revision(USER_A, projectId);
    const added = await call(client, "add_marker_tool", { position: "2.5" });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent).toEqual({ ok: true, project_id: projectId, data: { created: [{ kind: "marker", id: "M1" }] } });

    const stored = await h.services.projects.get(USER_A, projectId);
    expect(stored.revision).not.toBe(before);
    expect(stored.project.markers).toEqual([{ id: "M1", position: 2.5, icon: "blue.png" }]);
    expect(stored.project.history.undo).toHaveLength(1);

    const counted = await call(client, "count_markers_tool", {});
    expect(counted.structuredContent).toMatchObject({ data: { count: 1 } });
    expect(await h.services.projects.revision(USER_A, projectId)).toBe(stored.revision);
    await client.close();
  });

  it("replays the change when someone else saved in between", async () => {
    let interfere: (() => Promise<void>) | null = null;
    const engine = fakeEngine({ beforeAddMarker: async () => { const run = interfere; interfere = null; await run?.(); } });
    const h = await harness({ engine });
    const client = await connect(h, await pat(h));
    const projectId = (await call(client, "create_project", { name: "P" })).structuredContent?.project_id as string;
    interfere = async () => {
      // Another editor renames a track and saves while the tool runs.
      const current = await h.services.projects.get(USER_A, projectId);
      const project = { ...current.project, layers: current.project.layers.map((l, i) => (i === 0 ? { ...l, label: "Voice" } : l)) };
      await h.services.projects.save(USER_A, projectId, project, current.revision);
    };
    const res = await call(client, "add_marker_tool", { position: 1 });
    expect(res.isError).toBeFalsy();
    const stored = await h.services.projects.get(USER_A, projectId);
    expect(stored.project.layers[0]?.label).toBe("Voice");
    expect(stored.project.markers).toHaveLength(1);
    expect(engine.runs.filter((n) => n === "add_marker_tool")).toHaveLength(2);
    await client.close();
  });

  it("leave the project untouched when the tool fails validation", async () => {
    const h = await harness({ engine: fakeEngine() });
    const client = await connect(h, await pat(h));
    const projectId = (await call(client, "create_project", { name: "P" })).structuredContent?.project_id as string;
    const before = await h.services.projects.revision(USER_A, projectId);
    const res = await call(client, "add_marker_tool", { position: -1 });
    expect(res.isError).toBe(true);
    expect(await h.services.projects.revision(USER_A, projectId)).toBe(before);
    await client.close();
  });
});
