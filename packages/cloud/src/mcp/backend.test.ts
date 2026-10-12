/**
 * Connector sessions call api.zenvi.pro as the signed-in person: search and
 * narration in the tool call, AI video as a background job.
 */

import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { RECONNECT_MESSAGE } from "../auth/backend-session.js";
import { SCOPE_READ, SCOPE_WRITE } from "../auth/scopes.js";
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

describe("connector backend session", () => {
  it("stores a refresh token at consent and drops it when the last app is disconnected", async () => {
    const h = await harness();
    const clientId = (
      await h.request("POST", "/oauth/register", { json: { client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] } })
    ).json.client_id as string;
    const challenge = "a".repeat(43);
    const start = await h.request(
      "GET",
      `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent("https://chatgpt.com/connector_platform_oauth_redirect")}&code_challenge=${challenge}&code_challenge_method=S256&resource=https://cloud.test/mcp`,
    );
    const requestId = new URL(start.headers.get("location") ?? "").searchParams.get("request");
    const jwt = await h.userToken(USER_A);
    const consent = await h.request("POST", "/oauth/consent", { token: jwt, json: { request: requestId, approve: true, refresh_token: "refresh-1" } });
    expect(consent.status).toBe(200);

    let refreshes = 0;
    h.services.backendSessions.fetchImpl = async (url) => {
      expect(String(url)).toContain("grant_type=refresh_token");
      refreshes += 1;
      return jsonResponse({ access_token: "user-jwt", refresh_token: "refresh-2", expires_in: 3600 });
    };
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt");
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt");
    expect(refreshes).toBe(1);

    const first = await h.services.tokens.issuePair({
      userId: USER_A,
      clientId,
      clientName: "ChatGPT",
      scopes: [SCOPE_READ, SCOPE_WRITE],
      resource: "https://cloud.test/mcp",
      accessTtlSeconds: 60,
      refreshTtlSeconds: 60,
    });
    const second = await h.services.tokens.issuePair({
      userId: USER_A,
      clientId,
      clientName: "Claude",
      scopes: [SCOPE_READ, SCOPE_WRITE],
      resource: "https://cloud.test/mcp",
      accessTtlSeconds: 60,
      refreshTtlSeconds: 60,
    });
    await h.services.tokens.revokeGrant(USER_A, first.familyId);
    expect(await h.services.backendSessions.accessToken(USER_A)).toBe("user-jwt");
    await h.services.tokens.revokeGrant(USER_A, second.familyId);
    expect(await h.services.backendSessions.accessToken(USER_A)).toBeNull();
  });

  it("does not keep another person's session", async () => {
    const h = await harness();
    await h.services.backendSessions.save(USER_A, "refresh-a");
    expect(await h.services.backendSessions.accessToken(USER_B)).toBeNull();
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
    const h = await harness({ engine: await loadEngineRegistry(), prober: fakeProber, network });
    const port = await mediaPort();
    h.services.backendSessions.fetchImpl = async (url, init) => {
      const target = String(url);
      if (target.includes("grant_type=refresh_token")) return jsonResponse({ access_token: "user-jwt", refresh_token: "refresh-2", expires_in: 3600 });
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
    await h.services.backendSessions.save(USER_A, "refresh-1");
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
    expect(seen).toContain("Bearer user-jwt");

    const voice = await call(client, "generate_tts_and_add_to_timeline_tool", { text: "Welcome to the show" });
    expect(voice.isError).toBeFalsy();
    expect(voice.content[0]?.text).toContain("Added TTS audio");
    const { project } = await h.services.projects.get(USER_A, projectId);
    expect(project.clips.some((clip) => clip.file_id && project.files.some((file) => file.id === clip.file_id && file.media_type === "audio"))).toBe(true);
    await client.close();
  });

  it("asks to reconnect when no Zenvi session is stored", async () => {
    const h = await harness({ engine: await loadEngineRegistry(), prober: fakeProber, network });
    const client = await connect(h);
    await call(client, "create_project", { name: "P" });
    const voice = await call(client, "generate_tts_and_add_to_timeline_tool", { text: "Welcome to the show" });
    expect(voice.isError).toBe(true);
    expect(voice.content[0]?.text).toContain(RECONNECT_MESSAGE);
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
    expect(seen).toContain("Bearer user-jwt");
    await client.close();
  });

  it("records a reconnect error on the generation job when Allow was skipped", async () => {
    const h = await harness({ prober: fakeProber, network });
    const client = await connect(h);
    await call(client, "create_project", { name: "P" });
    const started = await call(client, "generate_video", { prompt: "a red bicycle" });
    await h.services.generations.drain();
    const status = await call(client, "get_generation_status", {
      generation_id: started.structuredContent?.generation_id as string,
      wait_seconds: 0,
    });
    expect(status.structuredContent?.status).toBe("error");
    expect(status.content[0]?.text).toContain("Allow");
    await client.close();
  });
});
