/**
 * MCP tool results. Success carries `structuredContent` plus the same JSON as
 * a text block (MCP 2025-06-18 back-compat rule; ChatGPT shows both to the
 * model), after a human sentence. Failures are `isError` results whose text
 * starts with "Error:" and carry no structuredContent (clients validate it
 * against outputSchema whenever it is present).
 */

import type { ToolImage } from "@zenvi/engine";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * `meta` becomes the result's `_meta`: hosts hand it to the tool's view
 * (ChatGPT `toolResponseMetadata`, MCP Apps `ui/notifications/tool-result`)
 * and never to the model, so view-only secrets (the embedded editor's token)
 * travel there.
 */
export function okResult(text: string, structured: Record<string, unknown>, images: ToolImage[] = [], meta?: Record<string, unknown>): CallToolResult {
  return {
    content: [
      { type: "text", text },
      { type: "text", text: JSON.stringify(structured) },
      ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
    ],
    structuredContent: structured,
    ...(meta ? { _meta: meta } : {}),
  };
}

export function errorResult(message: string): CallToolResult {
  const text = /^error\b/i.test(message) ? message : `Error: ${message}`;
  return { content: [{ type: "text", text }], isError: true };
}
