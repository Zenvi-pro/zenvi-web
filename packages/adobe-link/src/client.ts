/**
 * MCP client for one Zenvi Link server (Streamable HTTP + bearer token),
 * the same approach as packages/cli/src/desktop/client.ts. `callTool`
 * returns the host receipt plus any frame captures.
 */

import http from "node:http";
import { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { catalogFor } from "./catalog/index.js";
import { DEFAULT_TIMEOUT_MS } from "./catalog/types.js";
import type { HostEndpoint } from "./discovery.js";
import { parseHostReceipt, type HostReceipt } from "./receipt.js";

export interface HostImage {
  mimeType: "image/png" | "image/jpeg";
  /** Base64 without a data: prefix. */
  data: string;
}

export interface HostToolResult {
  receipt?: HostReceipt;
  /** The text content (the receipt JSON). */
  text: string;
  images: HostImage[];
  isError: boolean;
}

export interface HostToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
}

/** The server answers within the tool's timeout; wait a little longer than that. */
const RESPONSE_MARGIN_MS = 15_000;

/**
 * fetch for a loopback Zenvi Link server, over node:http. A redirect is never
 * followed (a 3xx is returned as is, so the SDK fails instead of sending the
 * token elsewhere), and nothing times out on the client side: global fetch
 * (undici) gives up on response headers after 300 s, shorter than a render
 * tool's catalog timeout. The server answers every call within that timeout.
 */
export function loopbackFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(String(input));
    const signal = init.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    if (init.body !== undefined && init.body !== null && typeof init.body !== "string") {
      reject(new TypeError("loopbackFetch sends string bodies only"));
      return;
    }
    const method = (init.method ?? "GET").toUpperCase();
    const request = http.request(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method, headers: Object.fromEntries(new Headers(init.headers)) },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = response.statusCode ?? 502;
        const empty = method === "HEAD" || status === 204 || status === 205 || status === 304;
        if (empty) response.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>), { status, statusText: response.statusMessage, headers }));
      },
    );
    request.on("error", reject);
    signal?.addEventListener("abort", () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error("aborted")), { once: true });
    request.end(init.body ?? undefined);
  });
}

export class HostClient {
  private client: Client | undefined;

  constructor(
    readonly endpoint: Pick<HostEndpoint, "host" | "url" | "token">,
    private readonly clientVersion = "0",
  ) {}

  private async connected(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(new URL(this.endpoint.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.endpoint.token}` } },
      fetch: loopbackFetch,
    });
    const client = new Client({ name: "zenvi-cli", version: this.clientVersion }, { capabilities: {} });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async listTools(): Promise<HostToolInfo[]> {
    const client = await this.connected();
    const page = await client.listTools();
    return page.tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema }));
  }

  /** Call a host tool. `timeoutMs` defaults to the catalog's timeout plus a margin. */
  async callTool(name: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}): Promise<HostToolResult> {
    const client = await this.connected();
    const def = catalogFor(this.endpoint.host).find((tool) => tool.name === name);
    const timeout = options.timeoutMs ?? (def?.timeoutMs ?? DEFAULT_TIMEOUT_MS) + RESPONSE_MARGIN_MS;
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
    const content = Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("\n");
    const images: HostImage[] = content
      .filter((block) => block.type === "image" && typeof block.data === "string")
      .map((block) => ({ mimeType: block.mimeType === "image/jpeg" ? "image/jpeg" : "image/png", data: block.data as string }));
    const receipt = parseHostReceipt(result.structuredContent) ?? parseHostReceipt(content.find((block) => block.type === "text")?.text);
    const isError = Boolean(result.isError) || (receipt ? receipt.status === "error" || receipt.status === "refused" : text.startsWith("Error"));
    return { receipt, text, images, isError };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }
}
