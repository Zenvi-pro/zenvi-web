/**
 * MCP client for one Zenvi Link server (Streamable HTTP + bearer token),
 * the same approach as packages/cli/src/desktop/client.ts. `callTool`
 * returns the host receipt plus any frame captures.
 */

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
