/**
 * JSON Schema of the contract-3 receipt every catalog tool returns, for MCP
 * `outputSchema` (the receipt travels as `structuredContent`). Mirrors
 * `ToolReceipt` in receipt.ts.
 */

import type { JsonSchema } from "./json-schema.js";

const STRINGS: JsonSchema = { type: "array", items: { type: "string" } };

export const RECEIPT_OUTPUT_SCHEMA: JsonSchema & { type: "object" } = {
  type: "object",
  description: "Zenvi tool receipt (contract 3). A failed call has status error or refused and a summary starting with \"Error:\".",
  properties: {
    contract: { type: "integer", enum: [3] },
    status: { type: "string", enum: ["applied", "unchanged", "refused", "error"] },
    tool: { type: "string" },
    summary: { type: "string", description: "One line for a person or a model." },
    clips: {
      type: "array",
      description: "Clips this call created or changed: id, track (1 = bottom), layer, position/start/end seconds, landedFrame.",
      items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    shifted: { type: "array", description: "Groups of clips moved by the same delta on one track.", items: { type: "object" } },
    removedClipIds: STRINGS,
    createdTracks: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, id: { type: "string" }, layer: { type: "integer" } },
        required: ["index", "id"],
      },
    },
    markers: { type: "array", items: { type: "object" } },
    removedMarkerIds: STRINGS,
    warnings: STRINGS,
    notes: STRINGS,
    watchSuggested: {
      description: "A timeline window worth watching to check the edit, or null.",
      anyOf: [
        {
          type: "object",
          properties: { clipId: { type: "string" }, start: { type: "number" }, end: { type: "number" } },
          required: ["clipId", "start", "end"],
        },
        { type: "null" },
      ],
    },
    undoSteps: { type: "integer", minimum: 0, description: "Undo steps this call recorded (0 or 1)." },
    clipsNote: { type: "string" },
    data: { description: "Tool-specific payload." },
  },
  required: [
    "contract",
    "status",
    "tool",
    "summary",
    "clips",
    "shifted",
    "removedClipIds",
    "createdTracks",
    "markers",
    "removedMarkerIds",
    "warnings",
    "notes",
    "watchSuggested",
    "undoSteps",
  ],
};
