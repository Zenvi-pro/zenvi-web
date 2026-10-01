/**
 * Runs tool calls with the engine's tool catalog, in one place: the
 * Assistant's `tool_call`s and the editor's own tool UI (command palette,
 * Stock, Generate, add to timeline) all come through here, so results,
 * receipts and undo steps are identical everywhere.
 */
import type { ToolHost } from "@zenvi/engine";
import { assistantWireForError, buildEditorSnapshot, runTool, toAssistantWire, type AssistantWire } from "@zenvi/engine/tools";
import type { EditorSession } from "../session/EditorSession";
import { attachPendingMedia } from "./host";

/** Where a call comes from: the backend's tool calls, or the editor's own UI. */
export type ToolCaller = "assistant" | "editor";

/**
 * Run one tool against the session's document. `surface` "assistant" refuses
 * the direct (non-contract) tools, as the desktop's bridge does.
 */
export async function runAssistantTool(
  session: EditorSession,
  host: ToolHost,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  surface: ToolCaller = "assistant",
): Promise<AssistantWire> {
  try {
    const result = await runTool({ doc: session.doc, host, signal }, name, args, { surface });
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
