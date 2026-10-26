/**
 * Connector sessions call api.zenvi.pro as the connected person: search and
 * narration in the tool call, AI video as a background job. The server reaches
 * the backend with its own credential, never the web editor's session.
 */

import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { ASSERTION_AUDIENCE, ASSERTION_ISSUER } from "../auth/backend-session.js";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
import { loadConfig, type BackendAuth } from "../config.js";
import { loadEngineRegistry } from "./engine.js";
import { fakeProber } from "../testing/fakes.js";
import { type Harness, harness, USER_A, USER_B } from "../testing/helpers.js";

type CallResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

const servers: HttpServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

const network = {
  policy: { protocols: ["http:", "https:"] as ("http:" | "https:")[], isAllowedAddress: (ip: string) => ip === "127.0.0.1", allowAnyPort: true },
  resolver: async () => [{ address: "127.0.0.1", family: 4 as const }],
};

async function connect(h: Harness): Promise<Client> {
  const token = (await h.services.tokens.createPat({ userId: USER_A, name: "test", scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: 1 })).token;
  const client = new Client({ name: "backend-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("https://cloud.test/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => h.app.request(url.toString(), init),
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  return (await client.callTool({ name, arguments: args })) as CallResult;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SESSION: BackendAuth = { kind: "session", serviceRoleKey: "service-key", anonKey: "anon-key" };
const SECRET = "s".repeat(40);

/** Supabase admin + auth endpoints as the session mode calls them. */
function fakeSupabase(log: string[], options: { email?: string; mintedFor?: string; refreshStatus?: number } = {}): (url: string, init?: RequestInit) => Response | null {
  let minted = 0;
  let refreshed = 0;
  return (url, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const auth = new Headers(init?.headers).get("authorization");
    if (url.includes("/auth/v1/admin/users/")) {
      log.push(`user ${auth}`);
      return jsonResponse({ id: url.split("/").pop(), email: options.email ?? "a@example.com" });
    }
    if (url.endsWith("/auth/v1/admin/generate_link")) {
      log.push(`link ${body.type} ${body.email} ${auth}`);
      return jsonResponse({ properties: { hashed_token: "hashed" } });
    }
    if (url.endsWith("/auth/v1/verify")) {
      minted += 1;
      log.push(`verify ${body.type} ${body.token_hash}`);
      return jsonResponse({ access_token: `user-jwt-${minted}`, refresh_token: `minted-refresh-${minted}`, expires_in: 3600, user: { id: options.mintedFor ?? USER_A } });
    }
    if (url.includes("grant_type=refresh_token")) {
      log.push(`refresh ${body.refresh_token}`);
      if (options.refreshStatus) return jsonResponse({ error_code: "refresh_token_not_found" }, options.refreshStatus);
      refreshed += 1;
      return jsonResponse({ access_token: `refreshed-jwt-${refreshed}`, refresh_token: `rotated-${refreshed}`, expires_in: 3600 });
    }
    return null;
  };
}

describe("backend auth config", () => {
  it("prefers the backend's shared secret, falls back to the service-role key, else turns the tools off", () => {
    const base = { STORAGE: "memory" };
    expect(loadConfig({ ...base, ZENVI_BACKEND_SERVICE_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: "k" }).backendAuth).toEqual({ kind: "assertion", secret: SECRET });
    expect(loadConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_ANON_KEY: "anon" }).backendAuth).toEqual({ kind: "session", serviceRoleKey: "k", anonKey: "anon" });
    expect(loadConfig(base).backendAuth).toEqual({ kind: "off" });
    expect(() => loadConfig({ ...base, ZENVI_BACKEND_SERVICE_SECRET: "short" })).toThrow(/32 characters/);
  });
});

describe("connector backend session", () => {
  it("signs a five-minute assertion for the backend and stores nothing", async () => {
    const h = await harness({ config: { backendAuth: { kind: "assertion", secret: SECRET } } });
    h.services.backendSessions.fetchImpl = async (url) => {
      throw new Error(`no Supabase call expected: ${String(url)}`);
    };
    const token = await h.services.backendSessions.accessToken(USER_A);
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
      issuer: ASSERTION_ISSUER,
      audience: ASSERTION_AUDIENCE,
      currentDate: new Date(h.clock.now()),
    });
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.sub).toBe(USER_A);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300);
    expect(payload.jti).toBeTruthy();
    await expect(jwtVerify(token, new TextEncoder().encode("x".repeat(40)))).rejects.toThrow();
    expect(await h.tables.get("backendsessions", USER_A, "supabase")).toBeNull();
  });

  it("mints its own session, refreshes it alone, ignores a browser token at consent, and forgets it at the last disconnect", async () => {
    const h = await harness({ config: { backendAuth: SESSION } });
    const log: string[] = [];
    const supabase = fakeSupabase(log);
    h.services.backendSessions.fetchImpl = async (url, init) => supabase(String(url), init) ?? jsonResponse({}, 404);

    // An editor build from before this change still sends its refresh token; it is accepted and dropped.
    const clientId = (
      await h.request("POST", "/oauth/register", { json: { client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] } })
    ).json.client_id as string;
    const start = await h.request(
      "GET",
      `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent("https://chatgpt.com/connector_platform_oauth_redirect")}&code_challenge=${"a".repeat(43)}&code_challenge_method=S256&resource=https://cloud.test/mcp`,
    );
    const requestId = new URL(start.headers.get("location") ?? "").searchParams.get("request");
    const consent = await h.request("POST", "/oauth/consent", { token: await h.userToken(USER_A), json: { request: requestId, approve: true, refresh_token: "browser-refresh" } });
    expect(consent.status).toBe(200);
    expect(await h.tables.get("backendsessions", USER_A, "supabase")).toBeNull();

    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt-1");
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt-1");
    expect(log).toEqual(["user Bearer service-key", "link recovery a@example.com Bearer service-key", "verify recovery hashed"]);

    h.clock.advance(3600_000);
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("refreshed-jwt-1");
    expect(log.at(-1)).toBe("refresh minted-refresh-1");
    expect(log.join("\n")).not.toContain("browser-refresh");

    const pair = (clientName: string) =>
      h.services.tokens.issuePair({ userId: USER_A, clientId, clientName, scopes: [SCOPE_READ, SCOPE_WRITE], resource: "https://cloud.test/mcp", accessTtlSeconds: 60, refreshTtlSeconds: 60 });
    const first = await pair("ChatGPT");
    const second = await pair("Claude");
    await h.services.tokens.revokeGrant(USER_A, first.familyId);
    expect(await h.tables.get("backendsessions", USER_A, "supabase")).not.toBeNull();
    await h.services.tokens.revokeGrant(USER_A, second.familyId);
    expect(await h.tables.get("backendsessions", USER_A, "supabase")).toBeNull();
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt-2");
  });

  it("mints a new session when its refresh token is refused", async () => {
    const h = await harness({ config: { backendAuth: SESSION } });
    const log: string[] = [];
    const supabase = fakeSupabase(log, { refreshStatus: 400 });
    h.services.backendSessions.fetchImpl = async (url, init) => supabase(String(url), init) ?? jsonResponse({}, 404);
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt-1");
    h.clock.advance(3600_000);
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt-2");
    expect(log.filter((line) => line.startsWith("refresh"))).toEqual(["refresh minted-refresh-1"]);
  });

  it("never refreshes a browser token stored before this change", async () => {
    const h = await harness({ config: { backendAuth: SESSION } });
    await h.tables.upsert("backendsessions", { partitionKey: USER_A, rowKey: "supabase", refreshToken: "browser-refresh", accessToken: "", expiresAt: "", updatedAt: "" }, "replace");
    const log: string[] = [];
    const supabase = fakeSupabase(log);
    h.services.backendSessions.fetchImpl = async (url, init) => supabase(String(url), init) ?? jsonResponse({}, 404);
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt-1");
    expect(log.join("\n")).not.toContain("browser-refresh");
  });

  it("refuses a minted session that belongs to someone else", async () => {
    const h = await harness({ config: { backendAuth: SESSION } });
    const supabase = fakeSupabase([], { mintedFor: USER_B });
    h.services.backendSessions.fetchImpl = async (url, init) => supabase(String(url), init) ?? jsonResponse({}, 404);
    await expect(h.services.backendSessions.accessToken(USER_A)).rejects.toThrow(/Could not start a Zenvi session/);
    expect(await h.tables.get("backendsessions", USER_A, "supabase")).toBeNull();
  });
});

describe("backend tools on the remote MCP server", () => {
  async function mediaPort(): Promise<number> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "video/mp4" }).end(Buffer.from("generated-bytes"));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  async function ready(authorizations: string[]): Promise<{ h: Harness; client: Client; projectId: string; port: number }> {
    const h = await harness({ engine: await loadEngineRegistry(), prober: fakeProber, network, config: { backendAuth: SESSION } });
    const port = await mediaPort();
    const supabase = fakeSupabase([]);
    h.services.backendSessions.fetchImpl = async (url, init) => {
      const target = String(url);
      const auth = supabase(target, init);
      if (auth) return auth;
      const headers = new Headers(init?.headers);
      authorizations.push(headers.get("authorization") ?? "");
      if (target.endsWith("/api/v1/indexing/status")) return jsonResponse({ configured: true });
      if (target.endsWith("/api/v1/search")) {
        return jsonResponse({ results: [{ video_id: "VID1", start: 1.5, end: 3, transcription: "the beach at dusk", filename: "clip.mp4", media_type: "video" }] });
      }
      if (target.endsWith("/api/v1/generation/tts")) return jsonResponse({ success: true, audio_base64: Buffer.from("mp3-bytes").toString("base64") });
      if (target.endsWith("/api/v1/generation/video")) return jsonResponse({ video_url: `http://media.test:${port}/generated.mp4` });
      return jsonResponse({ error: `unexpected ${target}` }, 404);
    };
    const client = await connect(h);
    const projectId = (await call(client, "create_project", { name: "Teaser" })).structuredContent?.project_id as string;
    const current = await h.services.projects.get(USER_A, projectId);
    const probed = await fakeProber.probe("clip.mp4");
    await h.services.projects.save(
      USER_A,
      projectId,
      {
        ...current.project,
        files: [
          {
            ...probed,
            id: "FILE000001",
            path: "clip.mp4",
            name: "clip.mp4",
            media_type: "video",
            ai_metadata: { index: { status: "ready", index_id: "IDX1", video_id: "VID1", index_name: "proj", provider: "twelvelabs" } },
          },
        ],
      },
      current.revision,
    );
    return { h, client, projectId, port };
  }

  it("searches and narrates with the person's backend token", async () => {
    const seen: string[] = [];
    const { h, client, projectId } = await ready(seen);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("search_clips_tool");
    expect(names).toContain("generate_tts_and_add_to_timeline_tool");
    expect(names).toContain("generate_video");
    expect(names).not.toContain("generate_video_and_add_to_timeline_tool");

    const found = await call(client, "search_clips_tool", { query: "beach" });
    expect(found.isError).toBeFalsy();
    expect(found.content[0]?.text).toContain("clip.mp4");
    expect(seen).toContain("Bearer user-jwt-1");

    const voice = await call(client, "generate_tts_and_add_to_timeline_tool", { text: "Welcome to the show" });
    expect(voice.isError).toBeFalsy();
    expect(voice.content[0]?.text).toContain("Added TTS audio");
    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.clips.some((clip) => clip.file_id && project.files.some((file) => file.id === clip.file_id && file.media_type === "audio"))).toBe(true);
    await client.close();
  });

  it("offers no backend tools when the server cannot reach the backend", async () => {
    const h = await harness({ engine: await loadEngineRegistry(), prober: fakeProber, network });
    const client = await connect(h);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("generate_tts_and_add_to_timeline_tool");
    expect(names).not.toContain("generate_video");
    expect(names).not.toContain("search_pexels_videos_tool");
    await client.close();
  });

  it("searches stock with the deployment's own keys when the backend is off", async () => {
    const stock = {
      searchPexelsVideos: async (query: string) => ({
        total: 1,
        videos: [{ id: 5, width: 1080, height: 1920, duration: 7, user_name: "Ana", video_files: [{ quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: `https://cdn.test/${query}.mp4` }] }],
      }),
      searchFreesound: async () => ({ total: 0, sounds: [] }),
    };
    const h = await harness({ engine: await loadEngineRegistry(), prober: fakeProber, network, stock });
    const client = await connect(h);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["search_pexels_videos_tool", "search_freesound_music_tool", "import_stock_media_tool"]));
    expect(names).not.toContain("generate_tts_and_add_to_timeline_tool");
    await call(client, "create_project", { name: "Stock", format: "vertical_1080p" });
    const found = await call(client, "search_pexels_videos_tool", { query: "surf" });
    expect(found.isError).toBeFalsy();
    expect(found.content[0]?.text).toContain("id=5  duration=0:07  res=1080×1920  portrait  user=Ana  link=https://cdn.test/surf.mp4");
    await client.close();
  });

  it("places a generated video after the background job finishes", async () => {
    const seen: string[] = [];
    const { h, client, projectId } = await ready(seen);
    const started = await call(client, "generate_video", { prompt: "a sunset over the sea" });
    expect(started.isError).toBeFalsy();
    const generationId = started.structuredContent?.generation_id as string;
    expect(generationId).toMatch(/^g_[a-z0-9]{16}$/);
    expect(started.structuredContent?.status).toBe("queued");

    const again = await call(client, "generate_video", { prompt: "a sunset over the sea" });
    expect(again.structuredContent?.generation_id).toBe(generationId);

    await h.services.generations.drain();
    const status = await call(client, "get_generation_status", { generation_id: generationId, wait_seconds: 0 });
    expect(status.structuredContent).toMatchObject({ status: "done", project_id: projectId });
    expect(status.content[0]?.text).toContain("timeline");
    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.files.some((file) => file.path === "generated.mp4")).toBe(true);
    expect(project.clips.length).toBeGreaterThan(0);
    expect(seen).toContain("Bearer user-jwt-1");
    await client.close();
  });

  it("records the refusal on the generation job when the server cannot get a session", async () => {
    const h = await harness({ prober: fakeProber, network, config: { backendAuth: SESSION } });
    h.services.backendSessions.fetchImpl = async () => jsonResponse({ msg: "Invalid API key" }, 401);
    const client = await connect(h);
    await call(client, "create_project", { name: "P" });
    const started = await call(client, "generate_video", { prompt: "a red bicycle" });
    await h.services.generations.drain();
    const status = await call(client, "get_generation_status", {
      generation_id: started.structuredContent?.generation_id as string,
      wait_seconds: 0,
    });
    expect(status.structuredContent?.status).toBe("error");
    expect(status.content[0]?.text).toContain("Zenvi sign-in refused the server's request (HTTP 401)");
    await client.close();
  });

  it("generates an image into the project as the connected person, and shows the backend's credit refusal in its own words", async () => {
    const h = await harness({ engine: await loadEngineRegistry(), prober: fakeProber, network, config: { backendAuth: { kind: "assertion", secret: SECRET } } });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let credits = 1;
    const bodies: unknown[] = [];
    h.services.backendSessions.fetchImpl = async (url, init) => {
      expect(String(url)).toBe("https://api.zenvi.pro/api/v1/generation/image");
      bodies.push(JSON.parse(String(init?.body)));
      if (credits-- > 0) return jsonResponse({ image_base64: png, mime_type: "image/png" });
      const message = "Out of credits for image generation. Need 3, have 0. Upgrade your plan or enable overage to continue.";
      return jsonResponse({ detail: { code: "insufficient_credits", required: 3, balance: 0, message } }, 402);
    };
    const client = await connect(h);
    await call(client, "create_project", { name: "P", format: "vertical_1080p" });
    const made = await call(client, "generate_image_and_add_to_timeline_tool", { prompt: "a red fox in snow" });
    expect(made.isError, made.content[0]?.text).toBeFalsy();
    expect(made.content[0]?.text).toMatch(/^Added clip to timeline at position 0\.0s on track .*timeline_clip_id=\w+/);
    expect(bodies[0]).toEqual({ prompt: "a red fox in snow", width: 1080, height: 1920 });
    const projectId = String(made.structuredContent?.project_id);
    const stored = (await h.services.projects.get(USER_A, projectId)).project;
    const image = stored.files.at(-1)!;
    expect(image).toMatchObject({ media_type: "image", name: "a red fox in snow", tags: "ai_generated", cloud: { content_type: "image/png" } });
    expect(String(image.path)).toMatch(/^@assets\/generated\/generated_[a-z0-9]{12}\.png$/);
    expect(stored.clips.some((c) => c.file_id === image.id)).toBe(true);

    const refused = await call(client, "generate_image_and_add_to_timeline_tool", { prompt: "a red fox" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe(
      "Error: Zenvi backend returned HTTP 402: Out of credits for image generation. Need 3, have 0. Upgrade your plan or enable overage to continue.",
    );
    await client.close();
  });

  it("sends the assertion from the background job too", async () => {
    const h = await harness({ prober: fakeProber, network, config: { backendAuth: { kind: "assertion", secret: SECRET } } });
    const port = await mediaPort();
    const bearers: string[] = [];
    h.services.backendSessions.fetchImpl = async (url, init) => {
      bearers.push(new Headers(init?.headers).get("authorization") ?? "");
      expect(String(url)).toBe("https://api.zenvi.pro/api/v1/generation/video");
      return jsonResponse({ video_url: `http://media.test:${port}/generated.mp4` });
    };
    const client = await connect(h);
    await call(client, "create_project", { name: "P" });
    const started = await call(client, "generate_video", { prompt: "a red bicycle" });
    await h.services.generations.drain();
    const status = await call(client, "get_generation_status", { generation_id: started.structuredContent?.generation_id as string, wait_seconds: 0 });
    expect(status.structuredContent?.status).toBe("done");
    const { payload } = await jwtVerify(bearers[0]!.replace(/^Bearer /, ""), new TextEncoder().encode(SECRET), {
      issuer: ASSERTION_ISSUER,
      audience: ASSERTION_AUDIENCE,
      currentDate: new Date(h.clock.now()),
    });
    expect(payload.sub).toBe(USER_A);
    await client.close();
  });
});
