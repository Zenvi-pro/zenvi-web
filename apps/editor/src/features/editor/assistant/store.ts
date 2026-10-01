/**
 * Assistant conversation state per open project, and the send/stop actions.
 * Lives outside React so a turn keeps running when the panel is hidden.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { getAccessToken } from "@/lib/auth";
import { fetchModelCatalog, type ModelInfo } from "@/lib/backend";
import { stripContextBlocks, withEditorSnapshot, type AgentMode, type ChatEvent } from "@/lib/chat/protocol";
import { runChatTurn } from "@/lib/chat/turn";
import { chatSocketUrl } from "@/lib/env";
import type { EditorSession } from "../session/EditorSession";
import { editorSnapshot, runAssistantTool } from "./bridge";
import { applyToolEvent, newActivityLinks, type ToolActivity } from "./activity";
import { createToolHost } from "./host";

export type { ToolActivity, ToolStatus } from "./activity";
export { toolLabel } from "./activity";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "note";
  text: string;
  streaming?: boolean;
  error?: string;
  tools: ToolActivity[];
  createdAt: number;
}

export interface AssistantState {
  messages: ChatMessage[];
  running: boolean;
  sessionId: string | null;
  modelId: string | null;
  models: ModelInfo[] | null;
  modelsError: string | null;
  mode: AgentMode;
}

const MODEL_KEY = "zenvi.assistant.model";
const MAX_SAVED = 60;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Controller {
  store: StoreApi<AssistantState>;
  abort: AbortController | null;
}

const controllers = new WeakMap<EditorSession, Controller>();

function storageKey(session: EditorSession): string {
  return `zenvi.assistant.${session.meta.getState().id}`;
}

function load(session: EditorSession): Pick<AssistantState, "messages" | "sessionId"> {
  try {
    const raw = localStorage.getItem(storageKey(session));
    if (!raw) return { messages: [], sessionId: null };
    const parsed = JSON.parse(raw) as { messages?: ChatMessage[]; sessionId?: string | null };
    return { messages: (parsed.messages ?? []).map((m) => ({ ...m, streaming: false })), sessionId: parsed.sessionId ?? null };
  } catch {
    return { messages: [], sessionId: null };
  }
}

function save(session: EditorSession, state: AssistantState): void {
  try {
    localStorage.setItem(storageKey(session), JSON.stringify({ sessionId: state.sessionId, messages: state.messages.slice(-MAX_SAVED) }));
  } catch {
    // Storage full or blocked: the conversation just is not remembered.
  }
}

export function assistantStore(session: EditorSession): StoreApi<AssistantState> {
  let controller = controllers.get(session);
  if (!controller) {
    let modelId: string | null = null;
    try {
      modelId = localStorage.getItem(MODEL_KEY);
    } catch {
      modelId = null;
    }
    const store = createStore<AssistantState>(() => ({ ...load(session), running: false, modelId, models: null, modelsError: null, mode: "agent" }));
    controller = { store, abort: null };
    controllers.set(session, controller);
  }
  return controller.store;
}

export async function loadModels(session: EditorSession): Promise<void> {
  const store = assistantStore(session);
  try {
    const catalog = await fetchModelCatalog();
    const available = catalog.models.filter((m) => m.available);
    const current = store.getState().modelId;
    const modelId = current && available.some((m) => m.model_id === current) ? current : catalog.defaultModelId || available[0]?.model_id || null;
    store.setState({ models: available, modelId, modelsError: null });
  } catch (error) {
    store.setState({ models: [], modelsError: error instanceof Error ? error.message : String(error) });
  }
}

export function setModel(session: EditorSession, modelId: string): void {
  assistantStore(session).setState({ modelId });
  try {
    localStorage.setItem(MODEL_KEY, modelId);
  } catch {
    // ignore
  }
}

export function newChat(session: EditorSession): void {
  stop(session);
  const store = assistantStore(session);
  store.setState({ messages: [], sessionId: null });
  save(session, store.getState());
}

export function stop(session: EditorSession): void {
  const controller = controllers.get(session);
  controller?.abort?.abort();
}

function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "video/*,audio/*,image/*";
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function send(session: EditorSession, text: string): Promise<void> {
  const store = assistantStore(session);
  const controller = controllers.get(session)!;
  const message = text.trim();
  if (!message || store.getState().running) return;
  const token = await getAccessToken();
  const userMessage: ChatMessage = { id: uid(), role: "user", text: message, tools: [], createdAt: Date.now() };
  const reply: ChatMessage = { id: uid(), role: "assistant", text: "", streaming: true, tools: [], createdAt: Date.now() };
  store.setState((s) => ({ messages: [...s.messages, userMessage, reply], running: true }));

  const patchReply = (fn: (m: ChatMessage) => ChatMessage) =>
    store.setState((s) => ({ messages: s.messages.map((m) => (m.id === reply.id ? fn(m) : m)) }));

  if (!token) {
    patchReply((m) => ({ ...m, streaming: false, error: "Sign in to use the Zenvi Assistant." }));
    store.setState({ running: false });
    return;
  }

  const abort = new AbortController();
  controller.abort = abort;
  const host = createToolHost(session, pickFiles);
  const links = newActivityLinks();
  const onToolEvent = (event: Parameters<typeof applyToolEvent>[1]) => patchReply((m) => ({ ...m, tools: applyToolEvent(m.tools, event, links) }));

  const onEvent = (event: ChatEvent) => {
    switch (event.type) {
      case "token":
        patchReply((m) => ({ ...m, text: m.text + event.text }));
        break;
      case "tool_call":
      case "tool_started":
      case "tool_progress":
      case "tool_completed":
      case "tool_result":
        onToolEvent(event);
        break;
      case "assistant_response":
        patchReply((m) => ({ ...m, text: stripContextBlocks(event.response) || m.text }));
        break;
      case "plan":
        if (event.kind === "plan_ready" || event.kind === "plan_execution_done") {
          const note: ChatMessage = { id: uid(), role: "note", text: event.kind === "plan_ready" ? "The Assistant prepared a plan." : "Plan finished.", tools: [], createdAt: Date.now() };
          store.setState((s) => ({ messages: [...s.messages, note] }));
        }
        break;
      case "error":
        patchReply((m) => ({ ...m, error: event.message }));
        break;
      case "connected":
        break;
    }
  };

  const state = store.getState();
  const result = await runChatTurn({
    url: chatSocketUrl(),
    message: withEditorSnapshot(message, editorSnapshot(session)),
    modelId: state.modelId,
    sessionId: state.sessionId,
    authToken: token,
    agentMode: state.mode,
    executeTool: (name, args, _callId, signal) => runAssistantTool(session, host, name, args, signal),
    onEvent,
    signal: abort.signal,
  });
  controller.abort = null;
  patchReply((m) => ({
    ...m,
    streaming: false,
    text: m.text || (result.response ? stripContextBlocks(result.response) : ""),
    error: result.cancelled ? undefined : (m.error ?? result.error ?? undefined),
    tools: m.tools.map((t) => (t.status === "running" ? { ...t, status: result.cancelled ? "error" : "done", detail: result.cancelled ? "Stopped" : t.detail } : t)),
  }));
  if (result.cancelled) patchReply((m) => ({ ...m, text: m.text || "Stopped." }));
  store.setState((s) => ({ running: false, sessionId: result.sessionId ?? s.sessionId }));
  save(session, store.getState());
}
