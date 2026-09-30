/**
 * MCP client for a running desktop app (Streamable HTTP + bearer token).
 * The desktop returns contract-3 receipts as JSON text content, plus image
 * content for inspect tools (zenvi-core agent_tools/output.py `mcp_content`).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolImage } from "@zenvi/engine";
import { parseReceipt, type ToolReceipt } from "@zenvi/engine/tools";
import type { DesktopEndpoint } from "./discovery.js";

export interface DesktopToolResult {
  receipt?: ToolReceipt;
  text: string;
  images: ToolImage[];
  isError: boolean;
}

export interface DesktopToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Long enough for an export running on the desktop. */
const CALL_TIMEOUT_MS = 60 * 60 * 1000;

export class DesktopClient {
  private client: Client | undefined;

  constructor(
    readonly endpoint: DesktopEndpoint,
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

  async listTools(): Promise<DesktopToolInfo[]> {
    const client = await this.connected();
    const tools: DesktopToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      for (const tool of page.tools) tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<DesktopToolResult> {
    const client = await this.connected();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS, resetTimeoutOnProgress: true });
    const content = Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
    const texts = content.filter((c) => c.type === "text").map((c) => String(c.text ?? ""));
    const images: ToolImage[] = content
      .filter((c) => c.type === "image" && typeof c.data === "string")
      .map((c) => ({ mimeType: (c.mimeType as ToolImage["mimeType"]) ?? "image/jpeg", data: c.data as string }));
    const text = texts.join("\n");
    const structured = result.structuredContent as ToolReceipt | undefined;
    const receipt = structured && structured.contract === 3 ? structured : (parseReceipt(texts[0] ?? "") ?? undefined);
    const isError = Boolean(result.isError) || (receipt ? receipt.status === "error" || receipt.status === "refused" : text.startsWith("Error"));
    return { receipt, text, images, isError };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }
}
