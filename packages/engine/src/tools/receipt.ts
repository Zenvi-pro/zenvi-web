/**
 * Versioned tool receipts (contract 3).
 *
 * Port of zenvi-core src/classes/agent_tools/receipt.py (ref b63c39be7). Every
 * tool call returns one of these, serialized as JSON, so the Assistant, Claude
 * Code and the other MCP clients can patch their view of the timeline without
 * re-reading it. Failures keep `summary` starting with "Error:" because the
 * backend and older clients classify results by that prefix.
 */

export const CONTRACT_VERSION = 3;

export type ReceiptStatus = "applied" | "unchanged" | "refused" | "error";

/** A mutation receipt lists at most this many changed clips (receipt.py MUTATION_CLIP_LIMIT). */
export const MUTATION_CLIP_LIMIT = 30;
/** Pure moves of at least this many clips by the same delta collapse into one `shifted` row. */
export const SHIFT_GROUP_MINIMUM = 3;

/**
 * One changed clip. Snapshot-derived rows carry every field below; tools that
 * build their own rows (add_effect_tool) may carry fewer, plus extras.
 */
export interface ReceiptClip {
  id: string;
  /** 1-based track index from the bottom (list_clips_tool `track`). */
  track?: number;
  /** Track number (`layers[].number`). */
  layer?: number;
  position?: number;
  start?: number;
  end?: number;
  durationFrames?: number;
  /** 0-indexed project frame the clip starts on. */
  landedFrame?: number;
  /** Frame the caller asked for, when a placement tool knows it. */
  requestedFrame?: number;
  title?: string;
  [key: string]: unknown;
}

/**
 * A group of clips moved by the same number of frames on one track
 * (`{track, fromFrame, by, count}`), or a tool's own shift row (speech tools
 * report `{clipId, deltaSec}`).
 */
export type ReceiptShift = { [key: string]: unknown };

export interface CreatedTrack {
  /** 0-based index from the bottom of the track stack. */
  index: number;
  id: string;
  /** Track number of the new track. */
  layer?: number;
}

export interface WatchSuggested {
  clipId: string;
  /** Timeline seconds. */
  start: number;
  end: number;
}

/** The wire object. Key order matches receipt.py `to_dict`. */
export interface ToolReceipt {
  contract: typeof CONTRACT_VERSION;
  status: ReceiptStatus;
  tool: string;
  summary: string;
  clips: ReceiptClip[];
  shifted: ReceiptShift[];
  removedClipIds: string[];
  createdTracks: CreatedTrack[];
  markers: { [key: string]: unknown }[];
  removedMarkerIds: string[];
  warnings: string[];
  notes: string[];
  watchSuggested: WatchSuggested | null;
  undoSteps: number;
  clipsNote?: string;
  data?: unknown;
}

/** Optional receipt fields a tool can set. */
export interface ReceiptFields {
  clips?: ReceiptClip[];
  clipsNote?: string;
  shifted?: ReceiptShift[];
  removedClipIds?: string[];
  createdTracks?: CreatedTrack[];
  markers?: { [key: string]: unknown }[];
  removedMarkerIds?: string[];
  warnings?: string[];
  notes?: string[];
  watchSuggested?: WatchSuggested | null;
  data?: unknown;
}

function errorSummary(message: string): string {
  return message.startsWith("Error") ? message : `Error: ${message}`;
}

/** Build a receipt with desktop key order. Failure summaries get the "Error: " prefix. */
export function makeReceipt(
  status: ReceiptStatus,
  tool: string,
  summary: string,
  undoSteps: number,
  fields: ReceiptFields = {},
): ToolReceipt {
  const failed = status === "error" || status === "refused";
  const receipt: ToolReceipt = {
    contract: CONTRACT_VERSION,
    status,
    tool,
    summary: failed ? errorSummary(summary) : summary,
    clips: fields.clips ?? [],
    shifted: fields.shifted ?? [],
    removedClipIds: fields.removedClipIds ?? [],
    createdTracks: fields.createdTracks ?? [],
    markers: fields.markers ?? [],
    removedMarkerIds: fields.removedMarkerIds ?? [],
    warnings: fields.warnings ?? [],
    notes: fields.notes ?? [],
    watchSuggested: fields.watchSuggested ?? null,
    undoSteps: failed ? 0 : undoSteps,
  };
  if (fields.clipsNote !== undefined) receipt.clipsNote = fields.clipsNote;
  if (fields.data !== undefined && fields.data !== null) receipt.data = fields.data;
  return receipt;
}

/** ToolReceipt.applied. `undoSteps` is corrected by the runner from real history. */
export function applied(tool: string, summary: string, fields: ReceiptFields = {}, undoSteps = 1): ToolReceipt {
  return makeReceipt("applied", tool, summary, undoSteps, fields);
}

export function unchanged(tool: string, summary: string, fields: ReceiptFields = {}): ToolReceipt {
  return makeReceipt("unchanged", tool, summary, 0, fields);
}

/** The call was refused: invalid arguments, a policy, or a surface limitation. */
export function refused(tool: string, message: string, fields: ReceiptFields = {}): ToolReceipt {
  return makeReceipt("refused", tool, message, 0, fields);
}

/** The call failed while running. */
export function failed(tool: string, message: string, fields: ReceiptFields = {}): ToolReceipt {
  return makeReceipt("error", tool, message, 0, fields);
}

/** Phrases that mark a legacy informational no-op (receipt.py from_handler_str). */
const UNCHANGED_PHRASES = ["nothing to", "no speech", "already", "no timeline", "no clips", "no files"];

/**
 * Wrap a legacy prose / "Error:" handler string as a receipt, exactly like
 * receipt.py `from_handler_str`: errors by prefix, empty text as "No
 * changes.", informational no-ops as unchanged, everything else applied.
 */
/** Stock failures the desktop words without "Error" (zenvi-backend core/workflows/parse.py is_error_result). */
const STOCK_FAILURE = /^(pexels|freesound) (search|download) error/i;

export function fromHandlerText(tool: string, text: string, mutated: boolean): ToolReceipt {
  const raw = text ?? "";
  if (raw.startsWith("Error") || STOCK_FAILURE.test(raw)) return failed(tool, raw);
  if (raw.trim() === "") return unchanged(tool, "No changes.");
  const lower = raw.toLowerCase();
  if (!mutated && UNCHANGED_PHRASES.some((p) => lower.includes(p))) return unchanged(tool, raw);
  return applied(tool, raw, {}, mutated ? 1 : 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A contract-3 receipt parsed from text, or null when `text` is not one (receipt.py parse_receipt). */
export function parseReceipt(text: string): ToolReceipt | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(payload) || payload.contract !== CONTRACT_VERSION) return null;
  if (!("status" in payload) || !("summary" in payload)) return null;
  return payload as unknown as ToolReceipt;
}

/** The legacy classifier: empty, "Error"-prefixed, or an error/refused receipt (receipt.py is_error_result). */
export function isErrorResult(text: string): boolean {
  if (!text) return true;
  if (text.startsWith("Error") || STOCK_FAILURE.test(text)) return true;
  const receipt = parseReceipt(text);
  if (!receipt) return false;
  return receipt.status === "error" || receipt.status === "refused" || String(receipt.summary ?? "").startsWith("Error");
}

/** True for statuses a caller may treat as success. */
export function isOkStatus(status: ReceiptStatus): boolean {
  return status === "applied" || status === "unchanged";
}
