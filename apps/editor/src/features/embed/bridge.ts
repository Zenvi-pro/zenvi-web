/**
 * The editor's side of the chat embed (packages/cloud/src/mcp/editor-widget.ts).
 *
 * The view that frames this page passes the project token, the display mode
 * and the full-editor link in the URL fragment (never sent to a server), and
 * later updates by postMessage: `zenvi:token`, `zenvi:token-unavailable`,
 * `zenvi:display-mode`, `zenvi:theme`. What only the chat host can do goes up
 * the same way: `zenvi:request-display-mode`, `zenvi:open-external`,
 * `zenvi:follow-up`, `zenvi:token-expired`. Nothing secret is ever posted up.
 *
 * Opened outside a chat (a link in a new tab), the bridge still works: links
 * open in a new tab and display-mode requests are ignored.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

export type DisplayMode = "inline" | "fullscreen" | "pip";

export interface EmbedLaunch {
  token: string | null;
  mode: DisplayMode;
  theme: string | null;
  /** The project in the full editor on zenvi.pro. */
  openUrl: string | null;
}

export interface EmbedViewState {
  mode: DisplayMode;
  theme: string | null;
  /** True when the token ran out and the chat could not give a new one. */
  expired: boolean;
}

const MODES: readonly DisplayMode[] = ["inline", "fullscreen", "pip"];
const TOKEN_WAIT_MS = 20_000;

function isMode(value: unknown): value is DisplayMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/** Read the launch parameters from `hash` (`#token=…&mode=…&theme=…&open=…`). */
export function parseLaunch(hash: string): EmbedLaunch {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const mode = params.get("mode");
  const open = params.get("open");
  return {
    token: params.get("token") || null,
    mode: isMode(mode) ? mode : "inline",
    theme: params.get("theme") || null,
    openUrl: open && /^https:\/\//.test(open) ? open : null,
  };
}

/** Read and remove the launch fragment, so the token does not stay in the address or the history. */
export function takeLaunch(): EmbedLaunch {
  const launch = parseLaunch(window.location.hash);
  if (window.location.hash) {
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch {
      // Sandboxed history: the fragment just stays.
    }
  }
  return launch;
}

export class EmbedBridge {
  readonly view: StoreApi<EmbedViewState>;
  private token: string | null;
  private readonly framed: boolean;
  private waiters: ((token: string | null) => void)[] = [];

  constructor(
    private readonly launch: EmbedLaunch,
    private readonly host: Window = window.parent,
  ) {
    this.token = launch.token;
    this.framed = host !== window;
    this.view = createStore<EmbedViewState>(() => ({ mode: launch.mode, theme: launch.theme, expired: false }));
  }

  get openUrl(): string | null {
    return this.launch.openUrl;
  }

  get inChat(): boolean {
    return this.framed;
  }

  currentToken(): string | null {
    return this.token;
  }

  /** Listen to the framing view and say we are ready. Returns the stop function. */
  start(): () => void {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== this.host) return;
      const msg = event.data as { type?: unknown; token?: unknown; mode?: unknown; theme?: unknown } | null;
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "zenvi:token" && typeof msg.token === "string" && msg.token) {
        this.token = msg.token;
        this.view.setState({ expired: false });
        this.settle(msg.token);
      } else if (msg.type === "zenvi:token-unavailable") {
        this.settle(null);
      } else if (msg.type === "zenvi:display-mode" && isMode(msg.mode)) {
        this.view.setState({ mode: msg.mode });
      } else if (msg.type === "zenvi:theme" && typeof msg.theme === "string") {
        this.view.setState({ theme: msg.theme });
      }
    };
    window.addEventListener("message", onMessage);
    this.post({ type: "zenvi:ready" });
    return () => window.removeEventListener("message", onMessage);
  }

  requestDisplayMode(mode: DisplayMode): void {
    if (this.framed) this.post({ type: "zenvi:request-display-mode", mode });
  }

  openExternal(url: string): void {
    if (!/^https:\/\//.test(url)) return;
    if (this.framed) this.post({ type: "zenvi:open-external", url });
    else window.open(url, "_blank", "noopener");
  }

  /** Send a message to the chat as the person (e.g. "Render this project"). */
  followUp(text: string): void {
    if (this.framed && text.trim()) this.post({ type: "zenvi:follow-up", text });
  }

  /** The token ran out: ask the chat for a new one (null when it has none to give). */
  refreshToken(): Promise<string | null> {
    if (!this.framed) {
      this.view.setState({ expired: true });
      return Promise.resolve(null);
    }
    const wait = new Promise<string | null>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(() => this.settle(null, resolve), TOKEN_WAIT_MS);
    });
    if (this.waiters.length === 1) this.post({ type: "zenvi:token-expired" });
    return wait.then((token) => {
      if (!token) this.view.setState({ expired: true });
      return token;
    });
  }

  private settle(token: string | null, only?: (token: string | null) => void): void {
    const waiting = only ? this.waiters.filter((w) => w === only) : this.waiters;
    this.waiters = only ? this.waiters.filter((w) => w !== only) : [];
    for (const resolve of waiting) resolve(token);
  }

  private post(message: Record<string, unknown>): void {
    if (this.framed) this.host.postMessage(message, "*");
  }
}

/**
 * fetch for the embed's cloud client: on a 401 it asks the chat for a new
 * token once and retries with it.
 */
export function embedFetch(bridge: EmbedBridge, base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    if (response.status !== 401) return response;
    const token = await bridge.refreshToken();
    if (!token) return response;
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return base(input, { ...init, headers });
  };
}
