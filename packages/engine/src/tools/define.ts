/**
 * Defining tools and running them.
 *
 * A tool implementation receives a `ToolCall` (the ToolContext plus
 * `commit`) and validated input, does any async host work first (probing,
 * downloads, backend calls), then records its change with ONE synchronous
 * `call.commit(tx => …)`. The pipeline around it is a port of zenvi-core
 * agent_tools/execute.py `execute_tool_rich` (ref b63c39be7):
 *
 *   coerce (normalize_args, or the editor tool registry's coerce_args) →
 *   validate (refused receipt, no history) →
 *   refuse desktop arguments not ported yet (pending.ts) →
 *   capability check → run → receipt (+ snapshot delta when history grew).
 *
 * Implementations may return a structured receipt, or the desktop's legacy
 * prose (`"Added clip to timeline at …"` / `"Error: …"`), which is wrapped
 * exactly like execute_tool wraps handler strings.
 */

import { z } from "zod";
import type { Transaction } from "../history/document.js";
import { isOpError } from "../ops/errors.js";
import { contractInputs, contractMeta, type ContractInput, type ContractToolName } from "./schemas.gen.js";
import type { JsonSchemaObject } from "./json-schema.js";
import { aliasArguments } from "./aliases.js";
import { invalidArgumentsMessage, normalizeArgs } from "./coerce.js";
import { coerceEditorArgs, isEditorToolHandler } from "./editor-args.js";
import { pendingArgumentIn, pendingArgumentMessage } from "./pending.js";
import {
  failed,
  fromHandlerText,
  isErrorResult,
  isOkStatus,
  refused,
  type ToolReceipt,
} from "./receipt.js";
import { mutationResult, timelineDelta, timelineSnapshot, type TimelineSnapshot } from "./snapshot.js";
import type {
  HostCapability,
  ToolAnnotations,
  ToolContext,
  ToolDefinition,
  ToolHost,
  ToolImage,
  ToolResult,
  ToolSurface,
} from "./types.js";

/** What an implementation returns. */
export type ToolOutcome = string | ToolReceipt | { receipt: ToolReceipt; images?: ToolImage[] };

/** The context an implementation runs with. */
export interface ToolCall extends ToolContext {
  /** Name of the running tool. */
  readonly tool: string;
  /** The Assistant chat session (hidden `chat_session_id` arg), or "default". */
  readonly session: string;
  /**
   * Record this call's change as ONE undo step (`doc.transaction`). A body
   * that throws rolls back and leaves history untouched. At most once per call.
   */
  commit<T>(body: (tx: Transaction) => T, label?: string): T;
}

/** Tool definition with the catalog's extra facts. */
export interface CatalogTool<I extends z.ZodType = z.ZodType> extends ToolDefinition<I, ToolReceipt> {
  /** JSON Schema for MCP `inputSchema` (the desktop's merged schema for contract tools). */
  readonly inputSchema: JsonSchemaObject;
  /** Contract-3 tool from zenvi-core (vs a direct tool added for coding agents). */
  readonly contract: boolean;
  /** Kept only so stored plans keep working. */
  readonly deprecated: boolean;
  /** Desktop handler (`path:function`) this tool ports, when it is a contract tool. */
  readonly desktopHandler?: string;
}

export interface ToolImplementation<I> {
  annotations: Required<Pick<ToolAnnotations, "readOnlyHint" | "destructiveHint" | "openWorldHint">> & ToolAnnotations;
  /** Capabilities the host must provide; the tool is refused (and hidden from listings) without them. */
  requires?: HostCapability[];
  /**
   * The tool runs other tools on the call's own document, each its own undo
   * step (produce_video_tool: one per stage), so the receipt counts the steps
   * the history grew by, not only this call's own commit.
   */
  stages?: boolean;
  run(call: ToolCall, input: I): Promise<ToolOutcome> | ToolOutcome;
}

const ALL_SURFACES: ToolSurface[] = ["mcp", "cli", "editor"];

const CAPABILITY_NAMES: Record<HostCapability, string> = {
  media: "media import",
  player: "playback",
  ui: "the editor UI",
  exporter: "video rendering",
  frames: "frame rendering",
  backend: "the Zenvi backend (sign in to Zenvi)",
  stock: "stock search (sign in to Zenvi)",
  storage: "project storage",
  audio: "audio analysis",
  assets: "the bundled title templates and emoji",
  mattes: "subject matting (onnxruntime-node: the zenvi CLI and Zenvi Cloud)",
  shots: "shot embeddings (SigLIP in onnxruntime-node: the zenvi CLI)",
  motion: "Zenvi Motion block rendering (headless Chrome: the zenvi CLI, zenvi mcp and Zenvi Cloud)",
  scenes3d: "Zenvi 3D (Blender on this computer)",
  fx: "Zenvi FX (ffmpeg renders on this computer)",
  library: "the public sound libraries (Openverse)",
  watch: "watching a render with sound (the zenvi CLI and Zenvi Cloud, signed in to Zenvi)",
};

/**
 * The refusal for something this surface cannot do. The Zenvi Assistant is
 * told that "Error: … not available …" means "do not retry" (zenvi-backend
 * #40), so every surface limitation uses this wording.
 */
export function unavailableMessage(tool: string, reason: string): string {
  return `Error: ${tool} is not available in this Zenvi surface: ${reason}`;
}

/** A refused receipt for a surface limitation (see `unavailableMessage`). */
export function unavailable(tool: string, reason: string): ToolReceipt {
  return refused(tool, unavailableMessage(tool, reason));
}

/** Human name of a host capability, for refusals and docs. */
export function capabilityName(capability: HostCapability): string {
  return CAPABILITY_NAMES[capability] ?? capability;
}

export function missingCapabilities(requires: readonly HostCapability[] | undefined, host: ToolHost): HostCapability[] {
  return (requires ?? []).filter((cap) => host[cap] === undefined || host[cap] === null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The ToolResult for a receipt: `text` is the receipt JSON (what the
 * Assistant bridge sends back), `data` the receipt, `ok` for applied /
 * unchanged. Images only travel with a successful receipt.
 */
export function resultFor(receipt: ToolReceipt, images?: ToolImage[]): ToolResult<ToolReceipt> {
  const ok = isOkStatus(receipt.status);
  const result: ToolResult<ToolReceipt> = { ok, text: JSON.stringify(receipt), data: receipt };
  // output.py ToolOutput drops images from failed receipts.
  if (ok && images && images.length > 0) result.images = images;
  return result;
}

interface CallState {
  committed: boolean;
  before?: TimelineSnapshot;
  after?: TimelineSnapshot;
  undoBefore: number;
  undoAfter: number;
}

function fillEmpty(receipt: ToolReceipt, before: TimelineSnapshot, after: TimelineSnapshot): void {
  const delta = timelineDelta(before, after);
  if (receipt.clips.length === 0 && delta.clips.length > 0) {
    receipt.clips = delta.clips;
    if (delta.clipsNote !== undefined && receipt.clipsNote === undefined) receipt.clipsNote = delta.clipsNote;
  }
  if (receipt.shifted.length === 0) receipt.shifted = delta.shifted;
  if (receipt.removedClipIds.length === 0) receipt.removedClipIds = delta.removedClipIds;
  if (receipt.createdTracks.length === 0) receipt.createdTracks = delta.createdTracks;
  if (receipt.markers.length === 0) receipt.markers = delta.markers;
  if (receipt.removedMarkerIds.length === 0) receipt.removedMarkerIds = delta.removedMarkerIds;
}

/** Map an exception from an op or implementation to a receipt. */
function receiptForError(tool: string, error: unknown, host: ToolHost): ToolReceipt {
  if (isOpError(error)) {
    return error.code === "unsupported" ? unavailable(tool, error.message) : failed(tool, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  host.log?.(`tool ${tool} failed: ${error instanceof Error && error.stack ? error.stack : message}`);
  return failed(tool, message || "tool failed");
}

/**
 * Run one tool: the whole desktop execute_tool pipeline. Never throws for
 * user errors. A wrong argument name with one reading (`clip_id` for
 * `timeline_clip_id`) is accepted and named in the receipt's warnings.
 */
export async function executeTool<I extends z.ZodType>(
  tool: CatalogTool<I>,
  impl: ToolImplementation<z.output<I>>,
  ctx: ToolContext,
  rawArgs: unknown,
): Promise<ToolResult<ToolReceipt>> {
  const aliased = aliasArguments(tool.inputSchema, rawArgs);
  const result = await runPipeline(tool, impl, ctx, aliased.args);
  if (aliased.notes.length === 0 || !result.data) return result;
  const receipt = result.data;
  receipt.warnings = [...aliased.notes, ...receipt.warnings];
  return { ...result, text: JSON.stringify(receipt) };
}

async function runPipeline<I extends z.ZodType>(
  tool: CatalogTool<I>,
  impl: ToolImplementation<z.output<I>>,
  ctx: ToolContext,
  rawArgs: unknown,
): Promise<ToolResult<ToolReceipt>> {
  const name = tool.name;
  const session =
    isRecord(rawArgs) && typeof rawArgs.chat_session_id === "string" && rawArgs.chat_session_id.trim()
      ? rawArgs.chat_session_id.trim()
      : "default";

  // Editor tools coerce like the desktop's @editor_tool registry; the older tools like normalize_args.
  const args = isEditorToolHandler(tool.desktopHandler)
    ? coerceEditorArgs(tool.inputSchema, rawArgs)
    : normalizeArgs(tool.inputSchema, rawArgs);
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue ? invalidArgumentsMessage(name, issue, args, tool.inputSchema, parsed.error.issues) : `Error: Invalid arguments for ${name}.`;
    return resultFor(refused(name, message));
  }
  // A desktop argument this surface does not honour yet is refused, never ignored.
  const pendingArg = tool.contract ? pendingArgumentIn(name, parsed.data, tool.inputSchema) : undefined;
  if (pendingArg) return resultFor(refused(name, pendingArgumentMessage(name, pendingArg)));

  const missing = missingCapabilities(tool.requires, ctx.host);
  if (missing.length > 0) {
    const needs = missing.map(capabilityName).join(" and ");
    return resultFor(unavailable(name, `it needs ${needs}, which this host does not provide.`));
  }

  const doc = ctx.doc;
  const state: CallState = { committed: false, undoBefore: doc.undoLabels.length, undoAfter: doc.undoLabels.length };
  const stagedFrom = impl.stages ? { snapshot: timelineSnapshot(doc.project), undo: doc.undoLabels.length } : undefined;
  const call: ToolCall = {
    ...ctx,
    tool: name,
    session,
    commit<T>(body: (tx: Transaction) => T, label?: string): T {
      if (state.committed) throw new Error(`${name} committed twice; one tool call must be one undo step`);
      state.committed = true;
      const before = timelineSnapshot(doc.project);
      const undoBefore = doc.undoLabels.length;
      const result = doc.transaction(label ?? tool.title, body);
      state.before = before;
      state.after = timelineSnapshot(doc.project);
      state.undoBefore = undoBefore;
      state.undoAfter = doc.undoLabels.length;
      return result;
    },
  };

  let outcome: ToolOutcome;
  try {
    outcome = await impl.run(call, parsed.data as z.output<I>);
  } catch (error) {
    return resultFor(receiptForError(name, error, ctx.host));
  }
  if (stagedFrom) {
    state.before = stagedFrom.snapshot;
    state.after = timelineSnapshot(doc.project);
    state.undoBefore = stagedFrom.undo;
    state.undoAfter = doc.undoLabels.length;
  }

  const mutated = state.undoAfter > state.undoBefore;
  const undoSteps = mutated ? state.undoAfter - state.undoBefore : 0;

  if (typeof outcome === "string") {
    // execute.py: prose results, classified by prefix, enriched from snapshots when history grew.
    if (outcome.startsWith("Error") || isErrorResult(outcome)) return resultFor(fromHandlerText(name, outcome, false));
    const receipt = fromHandlerText(name, outcome, mutated);
    if (mutated && state.before && state.after && receipt.status === "applied") {
      return resultFor(mutationResult(state.before, state.after, name, receipt.summary, { undoSteps }));
    }
    receipt.undoSteps = mutated ? undoSteps : 0;
    return resultFor(receipt);
  }

  const receipt = "receipt" in outcome && !("contract" in outcome) ? outcome.receipt : (outcome as ToolReceipt);
  const images = "receipt" in outcome && !("contract" in outcome) ? outcome.images : undefined;
  if (receipt.status === "error" || receipt.status === "refused") {
    receipt.undoSteps = 0;
    if (mutated) {
      ctx.host.log?.(`tool ${name} returned ${receipt.status} after recording an undo step`);
    }
    return resultFor(receipt);
  }
  if (mutated && state.before && state.after) {
    receipt.undoSteps = undoSteps;
    fillEmpty(receipt, state.before, state.after);
  } else {
    receipt.undoSteps = 0;
    // execute.py: an "applied" receipt that changed nothing and carries nothing is "unchanged".
    if (
      receipt.status === "applied" &&
      receipt.clips.length === 0 &&
      receipt.removedClipIds.length === 0 &&
      !(images && images.length > 0) &&
      receipt.data === undefined &&
      !receipt.summary.startsWith("Error")
    ) {
      receipt.status = "unchanged";
    }
  }
  return resultFor(receipt, images);
}

function buildTool<I extends z.ZodType>(
  base: Omit<CatalogTool<I>, "run">,
  impl: ToolImplementation<z.output<I>>,
): CatalogTool<I> {
  const tool: CatalogTool<I> = {
    ...base,
    run: (ctx, input) => executeTool(tool, impl, ctx, input),
  };
  return tool;
}

/** A contract-3 tool: name, title, description and schemas come from schemas.gen.ts. */
export function contractTool<N extends ContractToolName>(
  name: N,
  impl: ToolImplementation<ContractInput<N>> & { deprecated?: boolean },
): CatalogTool {
  const meta = contractMeta[name];
  const surfaces: ToolSurface[] = meta.assistant ? ["assistant", ...ALL_SURFACES] : [...ALL_SURFACES];
  const base: Omit<CatalogTool, "run"> = {
    name,
    title: meta.title,
    description: meta.description,
    input: contractInputs[name] as unknown as z.ZodType,
    inputSchema: meta.inputSchema,
    annotations: { title: meta.title, ...impl.annotations } as ToolAnnotations,
    surfaces,
    requires: impl.requires,
    contract: true,
    deprecated: impl.deprecated ?? false,
    desktopHandler: meta.handler,
  };
  return buildTool(base, impl as unknown as ToolImplementation<unknown>);
}

export interface DirectToolSpec<I extends z.ZodObject> extends ToolImplementation<z.output<I>> {
  name: string;
  title: string;
  description: string;
  input: I;
  surfaces?: ToolSurface[];
}

/** A direct tool for coding agents (not in the desktop contract). */
export function directTool<I extends z.ZodObject>(spec: DirectToolSpec<I>): CatalogTool {
  const { $schema: _schema, ...json } = z.toJSONSchema(spec.input, { io: "input" }) as Record<string, unknown>;
  const inputSchema = { ...json, type: "object", additionalProperties: false } as JsonSchemaObject;
  const base: Omit<CatalogTool, "run"> = {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: spec.input as unknown as z.ZodType,
    inputSchema,
    annotations: { title: spec.title, ...spec.annotations } as ToolAnnotations,
    surfaces: spec.surfaces ?? [...ALL_SURFACES],
    requires: spec.requires,
    contract: false,
    deprecated: false,
  };
  return buildTool(base, spec as unknown as ToolImplementation<unknown>);
}
