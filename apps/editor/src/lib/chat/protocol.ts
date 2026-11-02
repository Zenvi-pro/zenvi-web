/**
 * Zenvi Assistant WebSocket protocol (`/api/v1/chat/ws`).
 *
 * Mirrors the desktop client, zenvi-core src/classes/api_client.py
 * `send_message_ws`, and the server, zenvi-backend api/routes/chat.py
 * `chat_websocket`. Every frame is `{ type, data }`.
 */

export type AgentMode = "agent" | "planning";
export type ChatAction = "chat" | "execute_plan" | "cancel_execution";

/** A vision part for the current turn only (not persisted by the backend). */
export interface ChatImage {
  name: string;
  mime_type: string;
  /** Base64 without a data: prefix. */
  image_base64: string;
  [key: string]: unknown;
}

export interface UserMessageData {
  /** The user's text, prefixed with the `[Editor snapshot]` block (see `withEditorSnapshot`). */
  message: string;
  model_id: string | null;
  session_id: string | null;
  auth_token: string | null;
  agent_mode?: AgentMode;
  action?: ChatAction;
  plan_id?: string;
  images?: ChatImage[];
  /** Which editor is talking (the backend ignores unknown fields today). */
  client?: "web";
  /**
   * Editor tools this editor cannot run (engine `unavailableAssistantTools`):
   * desktop-only ones such as ComfyUI, unported ones, and ones the browser
   * lacks. The backend leaves them out of the agent's tools.
   */
  unavailable_tools?: string[];
  /**
   * The engine tools this editor runs (engine `assistantEngineTools`): the
   * styles, brief, sound design and motion tools. The backend offers no
   * engine tool a client did not list.
   */
  engine_tools?: string[];
}

const CONTEXT_BLOCK_RE = /\[(?:Editor snapshot|Selected timeline clip context)\][\s\S]*?\[\/(?:Editor snapshot|Selected timeline clip context)\]\s*/g;

/**
 * Ground the model like the desktop (ai_chat_ui.py `_prepend_editor_snapshot`):
 * the snapshot block goes before the user's text. The backend strips it from
 * history and digests it.
 */
export function withEditorSnapshot(text: string, snapshot: string | null | undefined): string {
  return snapshot ? `${snapshot}\n${text}` : text;
}

/** Remove snapshot blocks from text before showing it (ai_chat_ui.py `_strip_context_blocks`). */
export function stripContextBlocks(text: string): string {
  return text ? text.replace(CONTEXT_BLOCK_RE, "").trimStart() : text;
}

/**
 * What the editor answers a `tool_call` with (engine `toAssistantWire`):
 * success sends the full receipt JSON, failure only its summary (starting
 * with "Error:"), and inspect tools may attach images.
 */
export interface ToolWireResult {
  result: string;
  images?: unknown[];
}

export type ClientFrame =
  | { type: "user_message"; data: UserMessageData }
  | { type: "tool_result"; data: { call_id: string } & ToolWireResult }
  | { type: "ping"; data: Record<string, never> };

export type PlanEventType =
  | "plan_ready"
  | "plan_updated"
  | "plan_step_status"
  | "plan_execution_done"
  | "plan_questions"
  | "mode_changed";

export const PLAN_EVENT_TYPES: readonly PlanEventType[] = [
  "plan_ready",
  "plan_updated",
  "plan_step_status",
  "plan_execution_done",
  "plan_questions",
  "mode_changed",
];

export type ServerFrame =
  | { type: "token"; data: { text?: string } }
  | { type: "tool_call"; data: { call_id?: string; tool_name?: string; tool_args?: Record<string, unknown> } }
  | { type: "tool_started"; data: { call_id?: string; tool_name?: string; tool_args?: Record<string, unknown> } }
  | { type: "tool_progress"; data: { call_id?: string; tool_name?: string; line?: string; detail?: Record<string, unknown> } }
  | { type: "tool_completed"; data: { call_id?: string; ok?: boolean; result?: string } }
  | { type: "assistant_response"; data: { response?: string; session_id?: string; run_id?: string; credits_charged?: number | null } }
  | { type: PlanEventType; data: Record<string, unknown> }
  | { type: "error"; data: { message?: string; code?: string } }
  | { type: "done"; data: Record<string, unknown> }
  | { type: "keepalive" | "pong"; data: Record<string, unknown> };

/** Events the chat UI renders, normalized from server frames and local tool runs. */
export type ChatEvent =
  | { type: "connected" }
  | { type: "token"; text: string }
  | { type: "tool_call"; callId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_started"; callId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_progress"; callId: string; name: string; line: string; detail: Record<string, unknown> }
  | { type: "tool_completed"; callId: string; ok: boolean; summary: string }
  /** A tool the editor ran locally finished; `result` is what was sent back. */
  | { type: "tool_result"; callId: string; name: string; ok: boolean; result: string }
  | { type: "assistant_response"; response: string; sessionId: string }
  | { type: "plan"; kind: PlanEventType; data: Record<string, unknown> }
  | { type: "error"; message: string; code?: string };

/** Backend convention: a tool result that starts with "Error" is a failure. */
export function isErrorResult(result: string): boolean {
  return result.trimStart().startsWith("Error");
}

/** Coerce any thrown value into a result string the backend reads as a failure. */
export function errorResult(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Error") ? message : `Error: tool execution failed: ${message}`;
}

export function parseServerFrame(raw: unknown): ServerFrame | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as { type?: unknown; data?: unknown };
    if (!value || typeof value.type !== "string") return null;
    const data = value.data && typeof value.data === "object" ? value.data : {};
    return { type: value.type, data } as ServerFrame;
  } catch {
    return null;
  }
}
