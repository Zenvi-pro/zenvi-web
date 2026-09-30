/**
 * Runs Assistant tool calls with the engine's tool catalog, in one place.
 *
 * `runTool` (the catalog's dispatcher) is read from `@zenvi/engine/tools`
 * through the namespace so this picks it up as soon as W4 exports it; until
 * then every call answers with a clear Error result (never a fake success).
 */
import * as tools from "@zenvi/engine/tools";
import { assistantWireForError, buildEditorSnapshot, toAssistantWire, type AssistantWire } from "@zenvi/engine/tools";
import type { ToolContext, ToolHost, ToolResult } from "@zenvi/engine";
import type { EditorSession } from "../session/EditorSession";
import { attachPendingMedia } from "./host";

const ns = tools as unknown as Record<string, unknown>;

type RunTool = (name: string, ctx: ToolContext, args: unknown) => Promise<ToolResult>;

function dispatcher(): RunTool | null {
  const run = ns.runTool ?? ns.callTool;
  return typeof run === "function" ? (run as RunTool) : null;
}

export function toolsAvailable(): boolean {
  return dispatcher() !== null;
}

export async function runAssistantTool(
  session: EditorSession,
  host: ToolHost,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<AssistantWire> {
  const run = dispatcher();
  if (!run) return { result: `Error: ${name} is not available in the web editor yet.` };
  try {
    const result = await run(name, { doc: session.doc, host, signal }, args);
    attachPendingMedia(session);
    return toAssistantWire(result);
  } catch (error) {
    return assistantWireForError(error);
  }
}

/** The `[Editor snapshot]` block the desktop sends with every message. */
export function editorSnapshot(session: EditorSession): string {
  try {
    return buildEditorSnapshot(session.project);
  } catch {
    return "";
  }
}
