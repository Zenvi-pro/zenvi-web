/**
 * The Zenvi Assistant `tool_result` payload for a tool call.
 *
 * Mirrors the desktop bridge, zenvi-core src/classes/api_client.py
 * `_spawn_tool_worker._runner` (ref b63c39be7, L428-470):
 *
 * - success: `result` is the full contract-3 receipt JSON;
 * - receipt status error/refused: `result` is only the receipt's `summary`
 *   (it starts with "Error:"), because the backend classifies a failed call
 *   solely by an "Error" prefix on `result` (api/routes/chat.py; there is no
 *   separate error field);
 * - an exception while running the tool: "Error: tool execution failed: <msg>";
 * - `images`: the vision sidecar, `ImageBlock.to_ws()` shape from
 *   agent_tools/output.py `ws_images` (`{mimeType, data}`), only when the call
 *   produced images.
 */

import { parseReceipt } from "./receipt.js";
import type { ToolResult } from "./types.js";

/** One image in the sidecar: agent_tools/output.py `ImageBlock.to_ws()`. */
export interface AssistantWireImage {
  mimeType: string;
  /** Base64, no data: prefix. */
  data: string;
}

/** `tool_result.data` without `call_id`. */
export interface AssistantWire {
  result: string;
  images?: AssistantWireImage[];
}

/** Convert a tool result to what the bridge sends as `tool_result`. */
export function toAssistantWire(result: ToolResult): AssistantWire {
  const text = result.text ?? "";
  const receipt = parseReceipt(text);
  const failed = receipt !== null && (receipt.status === "error" || receipt.status === "refused");
  const wire: AssistantWire = { result: failed ? String(receipt.summary || text) : text };
  // The desktop drops images from failed receipts (output.py ToolOutput.__post_init__).
  if (!failed && result.images && result.images.length > 0) {
    wire.images = result.images.map((image) => ({ mimeType: image.mimeType, data: image.data }));
  }
  return wire;
}

/** The payload when running the tool threw instead of returning a result. */
export function assistantWireForError(error: unknown): AssistantWire {
  const message = error instanceof Error ? error.message : String(error);
  return { result: `Error: tool execution failed: ${message}` };
}
