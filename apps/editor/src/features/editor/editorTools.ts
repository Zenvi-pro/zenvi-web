/**
 * The editor's own buttons, menus and panels run engine tools by name, the
 * same calls the agents make (one undo step each, same receipts), through
 * the Assistant bridge. This module adds what the UI needs on top: whether
 * this surface can run a tool at all, and the receipt as fields.
 */
import { getTool, toolAvailability } from "@zenvi/engine/tools";
import { toast } from "@/ui/Toast";
import { runAssistantTool } from "./assistant/bridge";
import { createToolHost } from "./assistant/host";
import type { EditorSession } from "./session/EditorSession";

/**
 * `ready`: runs here. `elsewhere`: in the catalog but needs a host the browser
 * lacks (headless Chrome, Blender, ffmpeg), so the UI marks it instead of
 * offering it; `where` names the hosts that run it ("desktop or CLI", "CLI").
 * `missing`: not in this build's catalog, so the UI hides it.
 */
export type EditorToolState = { kind: "ready" } | { kind: "elsewhere"; note: string; where: string } | { kind: "missing" };

export function editorToolState(name: string): EditorToolState {
  const tool = getTool(name);
  if (!tool) return { kind: "missing" };
  const availability = toolAvailability(tool);
  if (availability.editor !== "no") return { kind: "ready" };
  // Web-only tools (3D scenes, motion blocks) are "no" on the desktop too: do not send people there.
  const hosts = [availability.desktop !== "no" ? "desktop" : null, availability.cli !== "no" ? "CLI" : null].filter((h) => h !== null);
  return { kind: "elsewhere", note: availability.notes.editor ?? "not available in the browser", where: hosts.length ? hosts.join(" or ") : "another Zenvi host" };
}

export function editorCanRun(name: string): boolean {
  return editorToolState(name).kind === "ready";
}

export interface ToolRun {
  ok: boolean;
  /** Receipt status (`applied`, `unchanged`, `refused`, `error`…), or `error` for a plain-text failure. */
  status: string;
  /** The receipt's summary without the `Error:` prefix. */
  summary: string;
  data: Record<string, unknown>;
  warnings: string[];
  /** Undo steps the call added (receipt `undoSteps`; 0 for reads, failures and no-ops). */
  undoSteps: number;
}

interface ReceiptFields {
  status?: unknown;
  summary?: unknown;
  data?: unknown;
  warnings?: unknown;
  undoSteps?: unknown;
}

export function parseToolResult(text: string): ToolRun {
  let receipt: ReceiptFields | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") receipt = parsed as ReceiptFields;
  } catch {
    // plain text result (failures, desktop-format reads)
  }
  const summary = typeof receipt?.summary === "string" ? receipt.summary : text;
  const failed = summary.startsWith("Error") || receipt?.status === "error" || receipt?.status === "refused";
  return {
    ok: !failed,
    status: typeof receipt?.status === "string" ? receipt.status : failed ? "error" : "applied",
    summary: summary.replace(/^Error:\s*/, ""),
    data: receipt?.data && typeof receipt.data === "object" ? (receipt.data as Record<string, unknown>) : {},
    warnings: Array.isArray(receipt?.warnings) ? receipt.warnings.filter((w): w is string => typeof w === "string") : [],
    undoSteps: !failed && typeof receipt?.undoSteps === "number" ? receipt.undoSteps : 0,
  };
}

export type ToolRunner = (name: string, args: Record<string, unknown>) => Promise<ToolRun>;

export async function runEditorTool(session: EditorSession, name: string, args: Record<string, unknown>): Promise<ToolRun> {
  const wire = await runAssistantTool(session, createToolHost(session, async () => []), name, args, new AbortController().signal);
  return parseToolResult(wire.result);
}

export function editorToolRunner(session: EditorSession): ToolRunner {
  return (name, args) => runEditorTool(session, name, args);
}

/** Run a tool from a gesture and say how it went: the error, "nothing changed", or `done` with the summary. */
export async function runToolWithToast(session: EditorSession, name: string, args: Record<string, unknown>, labels: { done: string; failed: string; unchanged?: string }): Promise<ToolRun> {
  const run = await runEditorTool(session, name, args);
  if (!run.ok) toast.error(labels.failed, { description: run.summary });
  else if (run.status === "unchanged") toast.info(labels.unchanged ?? "Nothing changed", { description: run.summary });
  else toast.success(labels.done, { description: run.summary });
  return run;
}
