import { describe, expect, it, vi } from "vitest";
import { EmbedBridge, embedFetch, parseLaunch } from "./bridge";

/** A stand-in for the chat's view that frames the editor. */
function fakeHost() {
  const posted: Record<string, unknown>[] = [];
  const host = { postMessage: (message: Record<string, unknown>) => posted.push(message) } as unknown as Window;
  const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: host as unknown as MessageEventSource }));
  return { host, posted, send };
}

describe("parseLaunch", () => {
  it("reads the token, display mode, theme and full-editor link from the fragment", () => {
    expect(parseLaunch("#token=zvn_emb_x&mode=fullscreen&theme=dark&open=https%3A%2F%2Fzenvi.pro%2Feditor%2Fp%2Fc_1")).toEqual({
      token: "zvn_emb_x",
      mode: "fullscreen",
      theme: "dark",
      openUrl: "https://zenvi.pro/editor/p/c_1",
    });
  });

  it("falls back to inline and drops links that are not https", () => {
    expect(parseLaunch("#mode=sideways&open=javascript%3Aalert(1)")).toEqual({ token: null, mode: "inline", theme: null, openUrl: null });
  });
});

describe("EmbedBridge", () => {
  it("says ready, follows display mode and theme from its host only", () => {
    const { host, posted, send } = fakeHost();
    const bridge = new EmbedBridge(parseLaunch("#token=a"), host);
    const stop = bridge.start();
    expect(posted).toEqual([{ type: "zenvi:ready" }]);
    send({ type: "zenvi:display-mode", mode: "fullscreen" });
    send({ type: "zenvi:theme", theme: "light" });
    expect(bridge.view.getState()).toMatchObject({ mode: "fullscreen", theme: "light" });
    // Another window's messages are ignored.
    window.dispatchEvent(new MessageEvent("message", { data: { type: "zenvi:token", token: "evil" }, source: window }));
    expect(bridge.currentToken()).toBe("a");
    stop();
  });

  it("asks the chat for a new token once, however many requests wait for it", async () => {
    const { host, posted, send } = fakeHost();
    const bridge = new EmbedBridge(parseLaunch("#token=old"), host);
    const stop = bridge.start();
    const first = bridge.refreshToken();
    const second = bridge.refreshToken();
    expect(posted.filter((m) => m.type === "zenvi:token-expired")).toHaveLength(1);
    send({ type: "zenvi:token", token: "new" });
    expect(await first).toBe("new");
    expect(await second).toBe("new");
    expect(bridge.currentToken()).toBe("new");
    stop();
  });

  it("marks the editor expired when the chat has no token to give", async () => {
    const { host, send } = fakeHost();
    const bridge = new EmbedBridge(parseLaunch("#token=old"), host);
    const stop = bridge.start();
    const waiting = bridge.refreshToken();
    send({ type: "zenvi:token-unavailable" });
    expect(await waiting).toBeNull();
    expect(bridge.view.getState().expired).toBe(true);
    stop();
  });

  it("only sends https links up", () => {
    const { host, posted } = fakeHost();
    const bridge = new EmbedBridge(parseLaunch("#token=a"), host);
    bridge.openExternal("http://example.com/x");
    bridge.openExternal("https://zenvi.pro/editor/p/c_1");
    expect(posted).toEqual([{ type: "zenvi:open-external", url: "https://zenvi.pro/editor/p/c_1" }]);
  });
});

describe("embedFetch", () => {
  it("retries a 401 once with the token the chat gave", async () => {
    const { host, send } = fakeHost();
    const bridge = new EmbedBridge(parseLaunch("#token=old"), host);
    const stop = bridge.start();
    const seen: (string | null)[] = [];
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("Authorization");
      seen.push(auth);
      return new Response("{}", { status: auth === "Bearer new" ? 200 : 401 });
    });
    const fetcher = embedFetch(bridge, base as unknown as typeof fetch);
    const pending = fetcher("https://cloud.test/v1/projects/c_1", { headers: { Authorization: "Bearer old" } });
    await vi.waitFor(() => expect(base).toHaveBeenCalledTimes(1));
    send({ type: "zenvi:token", token: "new" });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
    stop();
  });
});
