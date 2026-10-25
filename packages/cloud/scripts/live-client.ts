/**
 * A Zenvi Cloud for live scripts (reel-live.ts, tool-sweep.ts) to drive, as
 * one person: a deployed one over HTTPS with a personal access token
 * (ZENVI_CLOUD_URL + ZENVI_TOKEN), or one in this process with the real
 * Zenvi backend and blobs in the `zenvi-e2e` container, tokens and project
 * tables in memory (ZENVI_BACKEND_SERVICE_SECRET, AZURE_STORAGE_CONNECTION_STRING,
 * USER_ID; ZENVI_BACKEND_URL defaults to production). Either way the script
 * gets an MCP client and a fetch for the REST API (`/v1/...`).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { SCOPE_READ, SCOPE_WRITE } from "../src/auth/scopes.js";
import { createSupabaseVerifier } from "../src/auth/supabase.js";
import { loadConfig } from "../src/config.js";
import { createServices } from "../src/container.js";
import { loadEngineRegistry } from "../src/mcp/engine.js";
import { nodeAnalyzeAudio, nodeAssetResolver, nodeAssetSource, nodeDecodePcm, nodeFontFamilies, nodeProber, nodeRenderer, nodeTranscribeMedia } from "../src/render/node.js";
import { AzureBlobStore } from "../src/storage/azure.js";
import { MemoryTableStore } from "../src/storage/memory.js";

export interface LiveCloud {
  /** Where the cloud is, for logs: its URL, or "in this process". */
  readonly where: string;
  readonly client: Client;
  /** A REST request to the cloud (`/v1/...`) as the same person. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** The deployed cloud when ZENVI_CLOUD_URL is set, else one in this process. */
export async function connectCloud(name: string): Promise<LiveCloud> {
  return process.env.ZENVI_CLOUD_URL ? remoteCloud(name, process.env.ZENVI_CLOUD_URL, process.env.ZENVI_TOKEN ?? "") : localCloud(name);
}

/**
 * fetch that tries an idempotent request (GET, HEAD, PUT, DELETE) again when the network drops it (a laptop changing
 * networks mid-run fails reads with EADDRNOTAVAIL). Other methods run once: a tool call may have reached the server.
 */
async function idempotentFetch(url: string, init: RequestInit | undefined): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const attempts = ["GET", "HEAD", "PUT", "DELETE"].includes(method) ? 3 : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt >= attempts || !(error instanceof TypeError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

function withToken(init: RequestInit | undefined, token: string): RequestInit {
  return { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), authorization: `Bearer ${token}` } };
}

/** A deployed Zenvi Cloud with a personal access token. */
async function remoteCloud(name: string, url: string, token: string): Promise<LiveCloud> {
  if (!token.startsWith("zvn_")) throw new Error("ZENVI_TOKEN must be a Zenvi personal access token (zvn_pat_…)");
  const base = url.replace(/\/+$/, "");
  const client = new Client({ name, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return { where: base, client, fetch: (path, init) => idempotentFetch(`${base}${path}`, withToken(init, token)) };
}

/** Zenvi Cloud in this process: real backend and blobs, tokens in memory. */
async function localCloud(name: string): Promise<LiveCloud> {
  const secret = process.env.ZENVI_BACKEND_SERVICE_SECRET;
  const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const userId = process.env.USER_ID;
  if (!secret || !connection || !userId) throw new Error("local mode needs ZENVI_BACKEND_SERVICE_SECRET, AZURE_STORAGE_CONNECTION_STRING and USER_ID");

  const config = loadConfig({
    STORAGE: "memory",
    PUBLIC_BASE_URL: "https://cloud.local",
    ZENVI_EDITOR_URL: "https://zenvi.pro/editor",
    ZENVI_BACKEND_URL: process.env.ZENVI_BACKEND_URL ?? "https://api.zenvi.pro",
    ZENVI_BACKEND_SERVICE_SECRET: secret,
    LOG_LEVEL: "warn",
  });
  const { renderer, reason } = await nodeRenderer();
  if (reason) console.warn(`renderer: ${reason}`);
  const services = createServices({
    config,
    blobs: new AzureBlobStore(connection, "zenvi-e2e"),
    tables: new MemoryTableStore(),
    engine: await loadEngineRegistry(),
    renderer,
    prober: nodeProber,
    resolveAsset: nodeAssetResolver(),
    assets: nodeAssetSource(),
    analyzeAudio: nodeAnalyzeAudio,
    decodePcm: nodeDecodePcm,
    transcribeMedia: nodeTranscribeMedia,
    fontFamilies: nodeFontFamilies,
    supabase: createSupabaseVerifier({ supabaseUrl: config.supabaseUrl }),
  });
  const app = createApp(services);
  const token = (await services.tokens.createPat({ userId, name, scopes: [SCOPE_READ, SCOPE_WRITE], ttlDays: 1 })).token;
  const client = new Client({ name, version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://cloud.local/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (url, init) => app.request(url.toString(), init),
    }),
  );
  return { where: "in this process", client, fetch: async (path, init) => app.request(`https://cloud.local${path}`, withToken(init, token)) };
}
