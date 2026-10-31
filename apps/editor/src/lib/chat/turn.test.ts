// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResult, isErrorResult, stripContextBlocks, withEditorSnapshot, type ChatEvent } from "./protocol";
import { runChatTurn, type SocketLike } from "./turn";

/** A scripted fake of the browser WebSocket. */
class FakeSocket implements SocketLike {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: Array<{ type: string; data: Record<string, unknown> }> = [];
  closed: { code?: number } | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  server(type: string, data: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ type, data }) } as MessageEvent);
  }

  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as { type: string; data: Record<string, unknown> });
  }

  close(code?: number) {
    this.readyState = 3;
    this.closed = { code };
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function start(overrides: Partial<Parameters<typeof runChatTurn>[0]> = {}) {
  const events: ChatEvent[] = [];
  const executeTool = vi.fn(async (name: string) => `ran ${name}`);
  const promise = runChatTurn({
    url: "wss://api.example/api/v1/chat/ws",
    message: "split the clip",
    modelId: "openai/gpt-4o-mini",
    sessionId: "s1",
    authToken: "jwt",
    executeTool,
    onEvent: (e) => events.push(e),
    socketFactory: (url) => new FakeSocket(url),
    pingIntervalMs: 0,
    ...overrides,
  });
  const socket = FakeSocket.last!;
  return { promise, socket, events, executeTool };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runChatTurn", () => {
  it("sends user_message on open with the desktop payload shape", () => {
    const { socket } = start({ agentMode: "planning", images: [{ name: "a.png", mime_type: "image/png", image_base64: "AAAA" }], unavailableTools: ["create_media_with_comfyui_tool"] });
    socket.open();
    expect(socket.url).toBe("wss://api.example/api/v1/chat/ws");
    expect(socket.sent[0]).toEqual({
      type: "user_message",
      data: {
        message: "split the clip",
        model_id: "openai/gpt-4o-mini",
        session_id: "s1",
        auth_token: "jwt",
        client: "web",
        agent_mode: "planning",
        images: [{ name: "a.png", mime_type: "image/png", image_base64: "AAAA" }],
        unavailable_tools: ["create_media_with_comfyui_tool"],
      },
    });
  });

  it("streams tokens and resolves with the final response on done", async () => {
    const { promise, socket, events } = start();
    socket.open();
    socket.server("token", { text: "Hel" });
    socket.server("token", { text: "lo" });
    socket.server("assistant_response", { response: "Hello", session_id: "s2" });
    socket.server("done", {});
    const result = await promise;
    expect(result).toMatchObject({ response: "Hello", sessionId: "s2", error: null, completed: true });
    expect(events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")).toBe("Hello");
    expect(socket.closed).not.toBeNull();
  });

  it("runs tool calls locally and replies with tool_result", async () => {
    const { promise, socket, executeTool, events } = start();
    socket.open();
    socket.server("tool_call", { call_id: "c1", tool_name: "slice_clip_at_playhead_tool", tool_args: { keep: "both" } });
    await flush();
    expect(executeTool).toHaveBeenCalledWith("slice_clip_at_playhead_tool", { keep: "both" }, "c1", expect.any(AbortSignal));
    expect(socket.sent[1]).toEqual({ type: "tool_result", data: { call_id: "c1", result: "ran slice_clip_at_playhead_tool" } });
    expect(events).toContainEqual({ type: "tool_result", callId: "c1", name: "slice_clip_at_playhead_tool", ok: true, result: "ran slice_clip_at_playhead_tool" });
    socket.server("done");
    await promise;
  });

  it("turns a thrown tool error into an Error result", async () => {
    const { promise, socket } = start({
      executeTool: async () => {
        throw new Error("clip not found");
      },
    });
    socket.open();
    socket.server("tool_call", { call_id: "c9", tool_name: "remove_clip_tool", tool_args: {} });
    await flush();
    const reply = socket.sent[1]!;
    expect(reply.type).toBe("tool_result");
    expect(String(reply.data.result)).toBe("Error: tool execution failed: clip not found");
    socket.server("done");
    await promise;
  });

  it("sends the wire result with an images sidecar when a tool returns one", async () => {
    const { promise, socket } = start({
      executeTool: async () => ({ result: '{"ok":true}', images: [{ mimeType: "image/png", data: "AAAA" }] }),
    });
    socket.open();
    socket.server("tool_call", { call_id: "w1", tool_name: "watch_clip_tool", tool_args: {} });
    await flush();
    expect(socket.sent[1]).toEqual({
      type: "tool_result",
      data: { call_id: "w1", result: '{"ok":true}', images: [{ mimeType: "image/png", data: "AAAA" }] },
    });
    socket.server("done");
    await promise;
  });

  it("runs concurrent tool calls without waiting for each other", async () => {
    const releases: Array<(v: string) => void> = [];
    const { promise, socket } = start({ executeTool: () => new Promise<string>((r) => releases.push(r)) });
    socket.open();
    socket.server("tool_call", { call_id: "a", tool_name: "list_files_tool", tool_args: {} });
    socket.server("tool_call", { call_id: "b", tool_name: "list_layers_tool", tool_args: {} });
    await flush();
    expect(releases).toHaveLength(2);
    releases[1]!("layers");
    await flush();
    expect(socket.sent.at(-1)).toEqual({ type: "tool_result", data: { call_id: "b", result: "layers" } });
    releases[0]!("files");
    socket.server("done");
    await promise;
  });

  it("waits for in-flight tools after done before closing", async () => {
    let release!: (v: string) => void;
    const { promise, socket } = start({ executeTool: () => new Promise<string>((r) => (release = r)) });
    socket.open();
    socket.server("tool_call", { call_id: "slow", tool_name: "export_video_tool", tool_args: {} });
    socket.server("done");
    await flush();
    expect(socket.closed).toBeNull();
    release("exported");
    const result = await promise;
    expect(socket.sent.at(-1)).toEqual({ type: "tool_result", data: { call_id: "slow", result: "exported" } });
    expect(result.completed).toBe(true);
  });

  it("reports server errors", async () => {
    const { promise, socket, events } = start();
    socket.open();
    socket.server("error", { code: "unauthenticated", message: "missing or invalid auth_token" });
    const result = await promise;
    expect(result.error).toBe("missing or invalid auth_token");
    expect(events).toContainEqual({ type: "error", message: "missing or invalid auth_token", code: "unauthenticated" });
  });

  it("surfaces the last tool result when the socket drops without done", async () => {
    const { promise, socket } = start();
    socket.open();
    socket.server("tool_call", { call_id: "c1", tool_name: "get_project_info_tool", tool_args: {} });
    await flush();
    socket.drop();
    const result = await promise;
    expect(result.response).toBe("ran get_project_info_tool");
    expect(result.error).toBeNull();
  });

  it("explains a policy close (bad token)", async () => {
    const { promise, socket } = start();
    socket.open();
    socket.drop(1008);
    expect((await promise).error).toMatch(/Sign in again/);
  });

  it("cancels: closes the socket and aborts running tools", async () => {
    const controller = new AbortController();
    let toolSignal: AbortSignal | null = null;
    const { promise, socket } = start({
      signal: controller.signal,
      executeTool: (_n, _a, _c, signal) => {
        toolSignal = signal;
        return new Promise<string>(() => undefined);
      },
    });
    socket.open();
    socket.server("tool_call", { call_id: "c1", tool_name: "watch_clip_tool", tool_args: {} });
    await flush();
    controller.abort();
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(socket.closed).not.toBeNull();
    expect(toolSignal!.aborted).toBe(true);
  });

  it("pings every interval while open", async () => {
    vi.useFakeTimers();
    const { promise, socket } = start({ pingIntervalMs: 30_000 });
    socket.open();
    vi.advanceTimersByTime(61_000);
    expect(socket.sent.filter((f) => f.type === "ping")).toHaveLength(2);
    socket.server("done");
    await vi.runAllTimersAsync();
    await promise;
  });

  it("forwards tool activity and plan events", async () => {
    const { promise, socket, events } = start();
    socket.open();
    socket.server("tool_started", { call_id: "b1", tool_name: "search_clips_tool", tool_args: { query: "sunset" } });
    socket.server("tool_progress", { call_id: "b1", tool_name: "search_clips_tool", line: "searching", detail: { n: 1 } });
    socket.server("tool_completed", { call_id: "b1", ok: true, result: "3 matches" });
    socket.server("plan_ready", { plan_id: "p1" });
    socket.server("keepalive");
    socket.server("done");
    await promise;
    expect(events.map((e) => e.type)).toEqual(["connected", "tool_started", "tool_progress", "tool_completed", "plan"]);
  });
});

describe("editor snapshot", () => {
  const snap = "[Editor snapshot]\nProject files count: 0\nTIMELINE: (empty or unavailable)\n[/Editor snapshot]\n";

  it("prepends the snapshot block like the desktop", () => {
    expect(withEditorSnapshot("trim the intro", snap)).toBe(`${snap}\ntrim the intro`);
    expect(withEditorSnapshot("hi", "")).toBe("hi");
  });

  it("strips snapshot blocks for display", () => {
    expect(stripContextBlocks(withEditorSnapshot("trim the intro", snap))).toBe("trim the intro");
    expect(stripContextBlocks("[Selected timeline clip context]x[/Selected timeline clip context] ok")).toBe("ok");
  });
});

describe("result conventions", () => {
  it("classifies results by the Error prefix", () => {
    expect(isErrorResult("Error: nope")).toBe(true);
    expect(isErrorResult("Done")).toBe(false);
    expect(errorResult(new Error("Error: already prefixed"))).toBe("Error: already prefixed");
    expect(errorResult("boom")).toBe("Error: tool execution failed: boom");
  });
});
