/**
 * One Assistant turn over one WebSocket, like the desktop (api_client.py
 * `send_message_ws`): open, send `user_message`, stream events, run each
 * `tool_call` locally and answer with `tool_result`, finish on `done` or
 * `error`, then close.
 */
import {
  errorResult,
  isErrorResult,
  parseServerFrame,
  PLAN_EVENT_TYPES,
  type AgentMode,
  type ChatAction,
  type ChatEvent,
  type ChatImage,
  type ClientFrame,
  type PlanEventType,
  type ToolWireResult,
} from "./protocol";

/**
 * Runs one tool call locally. Calls run concurrently, one per `tool_call`,
 * like the desktop's worker-per-call; mutations serialize through the
 * (synchronous) ProjectDocument.
 */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  callId: string,
  signal: AbortSignal,
) => Promise<ToolWireResult | string>;

/** The subset of the browser WebSocket this client uses (injectable for tests). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface ChatTurnOptions {
  url: string;
  message: string;
  modelId?: string | null;
  sessionId?: string | null;
  authToken: string | null;
  agentMode?: AgentMode;
  action?: ChatAction;
  planId?: string;
  images?: ChatImage[];
  executeTool: ToolExecutor;
  onEvent: (event: ChatEvent) => void;
  signal?: AbortSignal;
  socketFactory?: SocketFactory;
  /** Client ping interval (browsers cannot send protocol pings). Default 30 s like the desktop. */
  pingIntervalMs?: number;
  /** How long to wait for in-flight tools after `done`. Default 120 s (desktop join timeout). */
  drainTimeoutMs?: number;
}

export interface ChatTurnResult {
  /** Final assistant text (may be empty). */
  response: string | null;
  sessionId: string | null;
  error: string | null;
  cancelled: boolean;
  /** True when the server sent `done`. */
  completed: boolean;
}

const OPEN = 1;

const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

export function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
  const {
    url,
    executeTool,
    onEvent,
    signal,
    socketFactory = defaultFactory,
    pingIntervalMs = 30_000,
    drainTimeoutMs = 120_000,
  } = options;

  return new Promise<ChatTurnResult>((resolve) => {
    const result: ChatTurnResult = { response: null, sessionId: null, error: null, cancelled: false, completed: false };
    const toolAbort = new AbortController();
    const inflight = new Set<Promise<void>>();
    let lastToolResult: string | null = null;
    let settled = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    let socket: SocketLike;

    const emit = (event: ChatEvent) => {
      try {
        onEvent(event);
      } catch {
        // A rendering bug must not break the protocol.
      }
    };

    const send = (frame: ClientFrame): boolean => {
      if (socket.readyState !== OPEN) return false;
      try {
        socket.send(JSON.stringify(frame));
        return true;
      } catch {
        return false;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      if (ping) clearInterval(ping);
      signal?.removeEventListener("abort", onAbort);
      toolAbort.abort();
      try {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close(1000, "turn complete");
      } catch {
        // already closed
      }
      resolve(result);
    };

    const drainThenFinish = () => {
      if (inflight.size === 0) {
        finish();
        return;
      }
      const timer = setTimeout(finish, drainTimeoutMs);
      Promise.allSettled([...inflight]).then(() => {
        clearTimeout(timer);
        finish();
      });
    };

    function onAbort() {
      result.cancelled = true;
      finish();
    }

    const runTool = (callId: string, name: string, args: Record<string, unknown>) => {
      emit({ type: "tool_call", callId, name, args });
      const job = (async () => {
        let wire: ToolWireResult;
        try {
          const out = await executeTool(name, args, callId, toolAbort.signal);
          wire = typeof out === "string" ? { result: out } : { result: String(out?.result ?? ""), ...(out?.images?.length ? { images: out.images } : {}) };
        } catch (error) {
          wire = { result: errorResult(error) };
        }
        const ok = !isErrorResult(wire.result);
        if (ok && wire.result) lastToolResult = wire.result;
        send({ type: "tool_result", data: { call_id: callId, ...wire } });
        emit({ type: "tool_result", callId, name, ok, result: wire.result });
      })();
      inflight.add(job);
      void job.finally(() => inflight.delete(job));
    };

    if (signal?.aborted) {
      result.cancelled = true;
      resolve(result);
      return;
    }

    try {
      socket = socketFactory(url);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      resolve(result);
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    socket.onopen = () => {
      emit({ type: "connected" });
      const data: ClientFrame & { type: "user_message" } = {
        type: "user_message",
        data: {
          message: options.message,
          model_id: options.modelId ?? null,
          session_id: options.sessionId ?? null,
          auth_token: options.authToken,
          client: "web",
        },
      };
      if (options.agentMode) data.data.agent_mode = options.agentMode;
      if (options.action) data.data.action = options.action;
      if (options.planId) data.data.plan_id = options.planId;
      if (options.images && options.images.length > 0) data.data.images = options.images;
      send(data);
      if (pingIntervalMs > 0) ping = setInterval(() => send({ type: "ping", data: {} }), pingIntervalMs);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (settled) return;
      const frame = parseServerFrame(event.data);
      if (!frame) return;
      const d = frame.data as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
      switch (frame.type) {
        case "tool_call":
          runTool(str(d.call_id), str(d.tool_name), obj(d.tool_args));
          break;
        case "tool_started":
          emit({ type: "tool_started", callId: str(d.call_id), name: str(d.tool_name), args: obj(d.tool_args) });
          break;
        case "tool_progress":
          emit({ type: "tool_progress", callId: str(d.call_id), name: str(d.tool_name), line: str(d.line), detail: obj(d.detail) });
          break;
        case "tool_completed":
          emit({ type: "tool_completed", callId: str(d.call_id), ok: Boolean(d.ok), summary: str(d.result) });
          break;
        case "token":
          if (str(d.text)) emit({ type: "token", text: str(d.text) });
          break;
        case "assistant_response":
          result.response = str(d.response);
          result.sessionId = str(d.session_id) || result.sessionId;
          emit({ type: "assistant_response", response: result.response, sessionId: result.sessionId ?? "" });
          break;
        case "error":
          result.error = str(d.message) || "Unknown error";
          emit({ type: "error", message: result.error, code: str(d.code) || undefined });
          drainThenFinish();
          break;
        case "done":
          result.completed = true;
          drainThenFinish();
          break;
        case "keepalive":
        case "pong":
          break;
        default:
          if ((PLAN_EVENT_TYPES as readonly string[]).includes(frame.type)) {
            emit({ type: "plan", kind: frame.type as PlanEventType, data: d });
          }
      }
    };

    socket.onerror = () => {
      if (!settled && !result.error) result.error = "Could not reach the Zenvi Assistant.";
    };

    socket.onclose = (event: CloseEvent) => {
      if (settled) return;
      if (!result.completed && !result.error) {
        if (event.code === 1008) {
          result.error = "The Assistant rejected your session. Sign in again.";
        } else if (result.response === null && lastToolResult !== null) {
          // Dropped without `done`: surface the last usable tool result, like the desktop.
          result.response = lastToolResult;
        } else if (result.response === null) {
          result.error = "The connection to the Assistant closed before the reply finished.";
        }
      }
      finish();
    };
  });
}
