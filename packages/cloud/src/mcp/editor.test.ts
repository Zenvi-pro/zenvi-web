import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import { embedRoute } from "../routes/v1.js";
import { type Harness, harness, sampleProject, USER_A } from "../testing/helpers.js";
import { EDITOR_META_KEY, EDITOR_WIDGET_URI, type EditorSessionMeta } from "./editor-widget.js";

type CallResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
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

async function pat(h: Harness, scopes = [SCOPE_READ, SCOPE_WRITE]): Promise<string> {
  return (await h.services.tokens.createPat({ userId: USER_A, name: "test", scopes, ttlDays: 1 })).token;
}

async function openEditor(h: Harness, client: Client): Promise<{ projectId: string; result: CallResult; session: EditorSessionMeta }> {
  const created = (await client.callTool({ name: "create_project", arguments: { name: "Match day" } })) as CallResult;
  const projectId = created.structuredContent?.project_id as string;
  const result = (await client.callTool({ name: "open_in_editor", arguments: {} })) as CallResult;
  const session = result._meta?.[EDITOR_META_KEY] as EditorSessionMeta;
  return { projectId, result, session };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("open_in_editor (editor embedded in the chat)", () => {
  it("opens the editor view with a project token the model never sees", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "open_in_editor");
    expect(tool?._meta).toMatchObject({ "openai/outputTemplate": EDITOR_WIDGET_URI, "openai/widgetAccessible": true, ui: { resourceUri: EDITOR_WIDGET_URI } });

    const { projectId, result, session } = await openEditor(h, client);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ project_id: projectId, name: "Match day", url: `https://zenvi.test/editor/p/${projectId}`, embedded: true });
    expect(session).toMatchObject({ url: `https://cloud.test/editor/embed/${projectId}`, projectId, openUrl: `https://zenvi.test/editor/p/${projectId}` });
    expect(session.token).toMatch(/^zvn_emb_/);
    // Nothing the model reads carries the token.
    expect(JSON.stringify(result.content)).not.toContain(session.token);
    expect(JSON.stringify(result.structuredContent)).not.toContain(session.token);
    await client.close();
  });

  it("shows the editor when the model opens or creates a project, the way chats start", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const { tools } = await client.listTools();
    for (const name of ["create_project", "open_project"]) {
      expect(tools.find((t) => t.name === name)?._meta, name).toMatchObject({ "openai/outputTemplate": EDITOR_WIDGET_URI, ui: { resourceUri: EDITOR_WIDGET_URI } });
    }
    const created = (await client.callTool({ name: "create_project", arguments: { name: "Match day" } })) as CallResult;
    const projectId = created.structuredContent?.project_id as string;
    const opened = (await client.callTool({ name: "open_project", arguments: { project_id: projectId } })) as CallResult;
    for (const result of [created, opened]) {
      const session = result._meta?.[EDITOR_META_KEY] as EditorSessionMeta;
      expect(session).toMatchObject({ url: `https://cloud.test/editor/embed/${projectId}`, projectId });
      expect(session.token).toMatch(/^zvn_emb_/);
      expect(JSON.stringify([result.content, result.structuredContent])).not.toContain(session.token);
      expect((await h.request("GET", `/v1/projects/${projectId}`, { token: session.token })).status).toBe(200);
    }
    await client.close();
  });

  it("lets the token load, poll, save and render its project, and nothing else", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const { projectId, session } = await openEditor(h, client);
    const other = (await client.callTool({ name: "create_project", arguments: { name: "Other" } })) as CallResult;
    const otherId = other.structuredContent?.project_id as string;
    const token = session.token;

    const loaded = await h.request("GET", `/v1/projects/${projectId}`, { token });
    expect(loaded.status).toBe(200);
    expect(loaded.json.name).toBe("Match day");
    const head = await h.request("GET", `/v1/projects/${projectId}/revision`, { token });
    expect(head.status).toBe(200);
    expect(head.json.revision).toBe(loaded.json.revision);

    const saved = await h.request("PUT", `/v1/projects/${projectId}`, {
      token,
      json: sampleProject({ markers: [{ id: "M1", position: 1, icon: "blue.png", vector: "blue" }] }),
      headers: { "if-match": `"${loaded.json.revision}"` },
    });
    expect(saved.status).toBe(200);
    const after = await h.request("GET", `/v1/projects/${projectId}/revision`, { token });
    expect(after.json.revision).toBe(saved.json.revision);
    expect(after.json.revision).not.toBe(loaded.json.revision);

    expect((await h.request("GET", `/v1/projects/${otherId}`, { token })).status).toBe(404);
    expect((await h.request("PUT", `/v1/projects/${otherId}`, { token, json: sampleProject(), headers: { "if-match": "*" } })).status).toBe(404);
    expect((await h.request("GET", "/v1/projects", { token })).status).toBe(403);
    expect((await h.request("DELETE", `/v1/projects/${projectId}`, { token })).status).toBe(403);
    expect((await h.request("GET", "/v1/tokens", { token })).status).toBe(403);
    expect((await h.request("POST", "/v1/media/check", { token, json: { sha256: [] } })).status).toBe(200);

    const mcp = await h.request("POST", "/mcp", {
      token,
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      headers: { accept: "application/json, text/event-stream" },
    });
    expect(mcp.status).toBe(401);
    await client.close();
  });

  it("keeps the chat's open project when an editor card renews its token, and switches it when the model opens another", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const create = async (name: string) => ((await client.callTool({ name: "create_project", arguments: { name } })) as CallResult).structuredContent?.project_id as string;
    const open = async (args: Record<string, unknown>) => ((await client.callTool({ name: "open_in_editor", arguments: args })) as CallResult).structuredContent?.project_id as string;
    const first = await create("First");
    const second = await create("Second");
    // An older card for the first project renews its token: the chat keeps editing the second.
    expect(await open({ project_id: first, refresh: true })).toBe(first);
    expect(await open({})).toBe(second);
    // The model opening the first project makes it the open one.
    expect(await open({ project_id: first })).toBe(first);
    expect(await open({})).toBe(first);
    // A refresh still checks the project.
    const missing = (await client.callTool({ name: "open_in_editor", arguments: { project_id: "c_missing", refresh: true } })) as CallResult;
    expect(missing.isError).toBe(true);
    await client.close();
  });

  it("gives a read-only connection a read-only editor", async () => {
    const h = await harness();
    const writer = await connect(h, await pat(h));
    const created = (await writer.callTool({ name: "create_project", arguments: { name: "P" } })) as CallResult;
    const projectId = created.structuredContent?.project_id as string;
    const reader = await connect(h, await pat(h, [SCOPE_READ]));
    const result = (await reader.callTool({ name: "open_in_editor", arguments: { project_id: projectId } })) as CallResult;
    const { token } = result._meta?.[EDITOR_META_KEY] as EditorSessionMeta;
    expect((await h.request("GET", `/v1/projects/${projectId}`, { token })).status).toBe(200);
    expect((await h.request("PUT", `/v1/projects/${projectId}`, { token, json: sampleProject(), headers: { "if-match": "*" } })).status).toBe(403);
    await writer.close();
    await reader.close();
  });

  it("ends with the connection: revoking the app's grant revokes its editor tokens", async () => {
    const h = await harness();
    const pair = await h.services.tokens.issuePair({
      userId: USER_A,
      clientId: "zc_aaaaaaaaaaaaaaaaaaaa",
      clientName: "ChatGPT",
      scopes: [SCOPE_READ, SCOPE_WRITE],
      resource: "https://cloud.test/mcp",
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 3600,
    });
    const client = await connect(h, pair.accessToken);
    const { projectId, session } = await openEditor(h, client);
    expect((await h.request("GET", `/v1/projects/${projectId}`, { token: session.token })).status).toBe(200);
    await h.services.tokens.revokeGrant(USER_A, pair.familyId);
    h.clock.advance(60_000);
    expect((await h.request("GET", `/v1/projects/${projectId}`, { token: session.token })).status).toBe(401);
    await client.close();
  });

  it("ends with the personal token too: revoking it revokes the editor tokens it opened, at once", async () => {
    const h = await harness();
    const { token, info } = await h.services.tokens.createPat({ userId: USER_A, name: "chat", scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: 1 });
    const client = await connect(h, token);
    const { projectId, session } = await openEditor(h, client);
    expect((await h.request("GET", `/v1/projects/${projectId}`, { token: session.token })).status).toBe(200);
    await h.services.tokens.revokePat(USER_A, info.id);
    expect((await h.request("GET", `/v1/projects/${projectId}`, { token: session.token })).status).toBe(401);
    await client.close();
  });

  it("expires after its lifetime", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const { projectId, session } = await openEditor(h, client);
    h.clock.advance(13 * 3600_000);
    expect((await h.request("GET", `/v1/projects/${projectId}`, { token: session.token })).status).toBe(401);
    await client.close();
  });

  it("is listed and readable as an MCP Apps view that may frame this origin", async () => {
    const h = await harness();
    const client = await connect(h, await pat(h));
    const { resources } = await client.listResources();
    // The MCP Apps views; the styles library (zenvi://styles/...) is listed next to them.
    expect(resources.map((r) => r.uri).filter((uri) => uri.startsWith("ui://"))).toEqual(["ui://zenvi/preview-v1.html", EDITOR_WIDGET_URI]);
    const read = await client.readResource({ uri: EDITOR_WIDGET_URI });
    const content = read.contents[0] as unknown as { text: string; _meta: Record<string, { csp?: { frameDomains: string[] }; frame_domains?: string[] }> };
    expect(content.text).toContain("ui/initialize");
    expect(content.text).toContain('meta["zenvi/editor"]');
    // A slow editor keeps loading; a link to a tab appears beside it, and goes when the editor reports ready.
    expect(content.text).toContain("Editor not showing? Open it in a new tab");
    expect(content.text).toContain("root.insertBefore(a, frame)");
    // A refused token refresh waits before the next try (the page asks on every 401).
    expect(content.text).toContain("Date.now() < (state.retryAt || 0)");
    expect(content._meta.ui?.csp?.frameDomains).toEqual(["https://cloud.test"]);
    expect(content._meta["openai/widgetCSP"]?.frame_domains).toEqual(["https://cloud.test"]);
    await client.close();
  });
});

describe("embedRoute", () => {
  it("names the project of project routes and allows media routes", () => {
    expect(embedRoute("GET", "/v1/projects/c_abc")).toEqual({ projectId: "c_abc" });
    expect(embedRoute("GET", "/v1/projects/c_abc/renders/r_1")).toEqual({ projectId: "c_abc" });
    expect(embedRoute("POST", "/v1/media")).toEqual({});
    expect(embedRoute("PATCH", "/v1/projects/c_abc")).toBeNull();
    expect(embedRoute("GET", "/v1/projects")).toBeNull();
    expect(embedRoute("GET", "/v1/me")).toBeNull();
  });
});

describe("hosted editor build", () => {
  async function dist(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "zenvi-editor-dist-"));
    dirs.push(dir);
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Zenvi</title>");
    await writeFile(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
    await writeFile(path.join(dir, "favicon.svg"), "<svg/>");
    return dir;
  }

  it("serves the embed page frameable by chat hosts, and assets with long caching", async () => {
    const h = await harness({ config: { editorDist: await dist() } });
    const page = await h.request("GET", "/editor/embed/c_abc");
    expect(page.status).toBe(200);
    expect(page.text).toContain("<title>Zenvi</title>");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors https:");
    expect(page.headers.get("x-frame-options")).toBeNull();
    expect(page.headers.get("cache-control")).toBe("no-cache");

    const asset = await h.request("GET", "/editor/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("x-frame-options")).toBe("DENY");
  });

  it("sends every other editor route to zenvi.pro and never leaves the build folder", async () => {
    const h = await harness({ config: { editorDist: await dist() } });
    const redirect = await h.request("GET", "/editor/p/c_abc");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://zenvi.test/editor/p/c_abc");
    const escape = await h.request("GET", "/editor/..%2F..%2Fetc%2Fpasswd");
    expect(escape.status).toBe(302);
    expect(escape.text).not.toContain("root:");
    // A malformed percent escape is not a server error.
    expect((await h.request("GET", "/editor/%E0%A4")).status).toBe(302);
  });

  it("answers editor routes itself when the deployment's editor is its own /editor (no redirect loop)", async () => {
    const h = await harness({ config: { editorDist: await dist(), editorUrl: "https://cloud.test/editor" } });
    const page = await h.request("GET", "/editor/p/c_abc");
    expect(page.status).toBe(200);
    expect(page.text).toContain("<title>Zenvi</title>");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    const client = await connect(h, await pat(h));
    const created = (await client.callTool({ name: "create_project", arguments: { name: "Lab" } })) as CallResult;
    expect(created.structuredContent?.editor_url).toMatch(/^https:\/\/cloud\.test\/editor\/p\//);
  });

  it("says so when the build has no editor", async () => {
    const h = await harness();
    expect((await h.request("GET", "/editor/embed/c_abc")).status).toBe(503);
  });
});
