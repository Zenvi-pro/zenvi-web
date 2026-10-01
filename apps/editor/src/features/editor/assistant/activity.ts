/**
 * The Assistant's tool activity rows: one row per tool call.
 *
 * A bridged call reaches the editor twice — the backend reports it
 * (`tool_started` / `tool_progress` / `tool_completed`, its result text being
 * the contract-3 receipt, often truncated) and asks the editor to run it
 * (`tool_call` → our `tool_result`). The two may carry different call ids,
 * so an unseen id is matched to the oldest row of the same tool still
 * waiting for its other half. Receipts show as their `summary`, never JSON.
 */
import type { ChatEvent } from "@/lib/chat/protocol";

export type ToolStatus = "running" | "done" | "error";

export interface ToolActivity {
  callId: string;
  name: string;
  label: string;
  status: ToolStatus;
  detail?: string;
  /** Ran in this editor (tool_call) vs only on the backend (tool_started). */
  local: boolean;
  /** The backend reported it too. */
  reported?: boolean;
  /** `detail` is the editor's own result (it wins over the backend's report). */
  fromEditor?: boolean;
}

export interface ActivityLinks {
  /** Incoming call id → the row it belongs to. */
  alias: Map<string, string>;
}

export function newActivityLinks(): ActivityLinks {
  return { alias: new Map() };
}

/** "slice_clip_at_playhead_tool" → "Slice clip at playhead" */
export function toolLabel(name: string): string {
  const words = name.replace(/_tool$/, "").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
}

const STATUS_TEXT: Record<string, string> = { applied: "Done", unchanged: "No change needed", refused: "Refused", failed: "Failed", error: "Failed" };

/** Readable text for a tool result: a receipt's `summary` (also from truncated JSON), else the text. */
export function summarize(result: string): string | undefined {
  const text = result.trim();
  if (!text) return undefined;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { summary?: unknown; status?: unknown };
      if (typeof parsed.summary === "string" && parsed.summary) return parsed.summary;
      if (typeof parsed.status === "string") return STATUS_TEXT[parsed.status] ?? undefined;
    } catch {
      // Truncated receipt: take what is readable.
      const summary = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
      if (summary) {
        try {
          return JSON.parse(`"${summary[1]}"`) as string;
        } catch {
          return summary[1];
        }
      }
      const status = /"status"\s*:\s*"(\w+)"/.exec(text);
      return status ? STATUS_TEXT[status[1]!] : undefined;
    }
    return undefined;
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

type ToolEvent = Extract<ChatEvent, { type: "tool_call" | "tool_started" | "tool_progress" | "tool_completed" | "tool_result" }>;

/** The row an event belongs to: known id, alias, or the oldest unmatched row of that tool. */
function rowFor(tools: readonly ToolActivity[], links: ActivityLinks, callId: string, name: string, side: "local" | "reported"): string | null {
  const known = links.alias.get(callId) ?? (tools.some((t) => t.callId === callId) ? callId : null);
  if (known) return known;
  if (!name) return null;
  const waiting = tools.find((t) => t.name === name && t.status !== "error" && (side === "local" ? !t.local : !t.reported));
  if (!waiting) return null;
  links.alias.set(callId, waiting.callId);
  return waiting.callId;
}

export function applyToolEvent(tools: readonly ToolActivity[], event: ToolEvent, links: ActivityLinks): ToolActivity[] {
  const name = "name" in event ? event.name : "";
  const side = event.type === "tool_call" || event.type === "tool_result" ? "local" : "reported";
  const id = rowFor(tools, links, event.callId, name, side);
  const patch = (row: ToolActivity): ToolActivity => {
    switch (event.type) {
      case "tool_call":
        return { ...row, local: true, name: row.name || event.name, label: row.label || toolLabel(event.name) };
      case "tool_started":
        return { ...row, reported: true };
      case "tool_progress":
        return row.fromEditor ? row : { ...row, ...(event.line ? { detail: event.line } : {}) };
      case "tool_completed": {
        const detail = summarize(event.summary);
        // The editor's own result (when it ran the call) is the one to show.
        if (row.fromEditor) return { ...row, reported: true };
        return { ...row, reported: true, status: event.ok ? "done" : "error", ...(detail ? { detail } : {}) };
      }
      case "tool_result": {
        const detail = summarize(event.result);
        return { ...row, local: true, fromEditor: true, status: event.ok ? "done" : "error", ...(detail ? { detail } : {}) };
      }
    }
  };
  if (id) return tools.map((t) => (t.callId === id ? patch(t) : t));
  const fresh: ToolActivity = { callId: event.callId, name, label: toolLabel(name), status: "running", local: side === "local" };
  return [...tools, patch(fresh)];
}
