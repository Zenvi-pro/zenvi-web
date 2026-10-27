/**
 * `zenvi bridge`: the engine bridge as a long-lived process, so the desktop
 * pays Node's start-up once. JSON-RPC 2.0, one message per line on stdin /
 * stdout; requests run one at a time, in order.
 *
 *   hello              → { protocol, engine_version }
 *   tools              → { tools: BridgeTool[] }
 *   run  BridgeRequest → BridgeAnswer
 *   shutdown           → null, then the process exits
 *
 * Diagnostics go to stderr; stdout carries nothing but answers.
 */

import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { HostCapability, ToolAnnotations } from "@zenvi/engine";
import type { JsonSchemaObject } from "@zenvi/engine/tools";
import { missingCapabilities, type Registry } from "../engine/registry.js";
import { VERSION } from "../version.js";
import type { NodeHostOptions } from "@zenvi/render-node";
import { BRIDGE_PROTOCOL, bridgeHost, parseBridgeJson, runBridgeCall, type BridgeRequest } from "./run.js";

export interface BridgeTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations?: ToolAnnotations;
  /** False when the bridge host lacks a capability the tool needs (`missing`). */
  available: boolean;
  missing?: HostCapability[];
}

/** The catalog as the bridge runs it: the `mcp` surface, availability judged on the bridge host. */
export function bridgeTools(registry: Registry, options: Omit<NodeHostOptions, "projectFile"> = {}): BridgeTool[] {
  const host = bridgeHost(path.resolve("catalog.zvn"), [], options);
  return registry.list("mcp", host, { includeUnavailable: true }).map((tool) => {
    const missing = missingCapabilities(tool, host);
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      available: missing.length === 0,
      ...(missing.length ? { missing } : {}),
    };
  });
}

export interface BridgeServerOptions {
  registry: Registry;
  input: Readable;
  output: Writable;
  /** Host options, with the backend token a request may carry (the desktop's session). */
  hostFor: (backendToken: string | undefined) => Omit<NodeHostOptions, "projectFile">;
  log?: (message: string) => void;
}

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Serve until stdin closes or `shutdown`. Resolves when done. */
export async function serveBridge(options: BridgeServerOptions): Promise<void> {
  const { registry, output } = options;
  const send = (body: Record<string, unknown>) => output.write(`${JSON.stringify({ jsonrpc: "2.0", ...body })}\n`);
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Message;
    try {
      message = parseBridgeJson(line) as Message;
    } catch (error) {
      send({ id: null, error: { code: PARSE_ERROR, message: `not JSON: ${(error as Error).message}` } });
      continue;
    }
    const id = message?.id ?? null;
    if (!message || typeof message !== "object" || typeof message.method !== "string") {
      send({ id, error: { code: INVALID_REQUEST, message: "expected a JSON-RPC request" } });
      continue;
    }
    try {
      switch (message.method) {
        case "hello":
          send({ id, result: { protocol: BRIDGE_PROTOCOL, engine_version: VERSION } });
          break;
        case "tools":
          send({ id, result: { tools: bridgeTools(registry, options.hostFor(undefined)) } });
          break;
        case "run": {
          const request = (message.params ?? {}) as BridgeRequest & { backend_token?: string };
          send({ id, result: await runBridgeCall(request, { registry, host: options.hostFor(request.backend_token) }) });
          break;
        }
        case "shutdown":
          send({ id, result: null });
          lines.close();
          return;
        default:
          send({ id, error: { code: METHOD_NOT_FOUND, message: `unknown method ${message.method}` } });
      }
    } catch (error) {
      options.log?.(error instanceof Error && error.stack ? error.stack : String(error));
      send({ id, error: { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : String(error) } });
    }
  }
}
