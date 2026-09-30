import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Principal } from "../auth/principal.js";
import type { Services } from "../container.js";

export type McpPrincipal = Extract<Principal, { kind: "oauth" | "pat" }>;

export interface McpCallContext {
  services: Services;
  principal: McpPrincipal;
  /** Key for per-connection state (OAuth grant or personal token id). */
  connection: string;
  /** Public origin the request arrived on (for links). */
  origin: string;
  signal: AbortSignal;
}

/**
 * Tool annotations with every hint explicit: ChatGPT treats a missing
 * readOnlyHint as a write, and both hosts review these values.
 */
export interface ExplicitAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export type JsonSchemaObject = { type: "object"; [key: string]: unknown };

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema?: JsonSchemaObject;
  annotations: ExplicitAnnotations;
  _meta?: Record<string, unknown>;
  /** OAuth scope a caller needs. */
  scope: string;
  call(ctx: McpCallContext, args: Record<string, unknown>): Promise<CallToolResult>;
}
