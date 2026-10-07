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

/** Run one tool against the session's document (the "editor" surface: every contract and direct tool). */
export async function runAssistantTool(session: EditorSession, host: ToolHost, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<AssistantWire> {
  try {
    const result = await runTool({ doc: session.doc, host, signal }, name, args, { surface: "editor" });
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
