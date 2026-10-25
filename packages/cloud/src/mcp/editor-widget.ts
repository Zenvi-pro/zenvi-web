/**
 * The editor view (MCP Apps spec 2026-01-26, plus ChatGPT's `window.openai`):
 * the Zenvi editor inside the chat, like an app panel next to the
 * conversation. The view itself is a thin shell. It frames the editor's
 * embed route, which this server hosts on its own origin
 * (`/editor/embed/:projectId`, http/editor.ts), and relays what only the host
 * can do:
 *
 *   editor -> shell              shell -> host
 *   zenvi:request-display-mode   ui/request-display-mode | openai.requestDisplayMode
 *   zenvi:open-external          ui/open-link | openai.openExternal
 *   zenvi:follow-up              ui/message | openai.sendFollowUpMessage
 *   zenvi:token-expired          tools/call open_in_editor | openai.callTool
 *
 * and passes the host's theme and display mode down (`zenvi:theme`,
 * `zenvi:display-mode`). The editor's token arrives in the tool result's
 * `_meta` (never shown to the model) and goes to the frame in the URL
 * fragment, so it is never sent to a server or written to a log; a refreshed
 * token is posted to the frame's exact origin only.
 */

export const EDITOR_WIDGET_URI = "ui://zenvi/editor-v1.html";
export const EDITOR_WIDGET_MIME = "text/html;profile=mcp-app";

/** `_meta` key of a result that opens the editor: what the view frames. */
export const EDITOR_META_KEY = "zenvi/editor";

export interface EditorSessionMeta {
  /** The embed route, without the token. */
  url: string;
  token: string;
  expiresAt: string;
  projectId: string;
  /** The full web editor on zenvi.pro (the person's own sign-in). */
  openUrl: string;
}

/** Tool `_meta` linking a tool to the editor view (standard key + ChatGPT alias); the view may call it to refresh its token. */
export function editorWidgetToolMeta(): Record<string, unknown> {
  return {
    ui: { resourceUri: EDITOR_WIDGET_URI, visibility: ["model", "app"] },
    "openai/outputTemplate": EDITOR_WIDGET_URI,
    "openai/widgetAccessible": true,
  };
}

export function editorWidgetResourceMeta(embedOrigin: string): Record<string, unknown> {
  return {
    ui: { csp: { frameDomains: [embedOrigin], resourceDomains: [], connectDomains: [] }, prefersBorder: true },
    "openai/widgetDescription": "The Zenvi video editor with the project open: preview, timeline, titles, effects and transitions.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": { frame_domains: [embedOrigin], resource_domains: [], connect_domains: [], redirect_domains: ["https://zenvi.pro", embedOrigin] },
  };
}

export const EDITOR_WIDGET_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zenvi editor</title>
<style>
  :root { color-scheme: dark; --bg: #09090b; --fg: #f4f4f6; --muted: #a1a1ab; --accent: #7c5cff; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  #frame { display: block; width: 100%; border: 0; background: var(--bg); }
  .card { padding: 16px; display: grid; gap: 10px; }
  .muted { color: var(--muted); }
  a { color: var(--accent); }
</style>
</head>
<body>
<div id="root"><p class="card muted">Opening the Zenvi editor…</p></div>
<script>
(function () {
  "use strict";
  var root = document.getElementById("root");
  var oa = window.openai;
  var state = { editor: null, frame: null, origin: null, mode: "inline", theme: null, projectId: null, refreshing: false, ready: false };
  var READY_MS = 10000;
  var nextId = 1;
  var pending = {};

  function post(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error("timeout")); } }, 60000);
    });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }

  function inlineHeight() {
    var max = oa && typeof oa.maxHeight === "number" && oa.maxHeight > 200 ? oa.maxHeight : 640;
    return Math.min(560, max);
  }
  function size() {
    if (!state.frame) return;
    var height = state.mode === "fullscreen" ? window.innerHeight : inlineHeight();
    state.frame.style.height = height + "px";
    if (state.mode !== "fullscreen") {
      notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: height });
      if (oa && typeof oa.notifyIntrinsicHeight === "function") oa.notifyIntrinsicHeight(height);
    }
  }
  function toFrame(message) {
    if (state.frame && state.frame.contentWindow && state.origin) state.frame.contentWindow.postMessage(message, state.origin);
  }
  function setMode(mode) {
    if (mode !== "fullscreen" && mode !== "inline" && mode !== "pip") return;
    state.mode = mode;
    size();
    toFrame({ type: "zenvi:display-mode", mode: mode });
  }
  function requestMode(mode) {
    var done = function (result) { setMode((result && result.mode) || mode); };
    if (oa && typeof oa.requestDisplayMode === "function") Promise.resolve(oa.requestDisplayMode({ mode: mode })).then(done, function () {});
    else request("ui/request-display-mode", { mode: mode }).then(done, function () {});
  }
  function openLink(url) {
    if (oa && typeof oa.openExternal === "function") { oa.openExternal({ href: url }); return; }
    request("ui/open-link", { url: url }).catch(function () {});
  }
  function followUp(text) {
    if (oa && typeof oa.sendFollowUpMessage === "function") { oa.sendFollowUpMessage({ prompt: text }); return; }
    request("ui/message", { role: "user", content: [{ type: "text", text: text }] }).catch(function () {});
  }
  function callTool(name, args) {
    if (oa && typeof oa.callTool === "function") return Promise.resolve(oa.callTool(name, args));
    return request("tools/call", { name: name, arguments: args });
  }
  function editorMeta(meta) {
    var editor = meta && meta["${EDITOR_META_KEY}"];
    return editor && typeof editor.url === "string" && typeof editor.token === "string" && /^https?:\\/\\//.test(editor.url) ? editor : null;
  }
  function message(text, link, label) {
    root.textContent = "";
    var card = document.createElement("div");
    card.className = "card";
    var p = document.createElement("p");
    p.className = "muted";
    p.textContent = text;
    card.appendChild(p);
    if (link) {
      var a = document.createElement("a");
      a.href = link; a.textContent = label || "Open in Zenvi"; a.target = "_blank"; a.rel = "noopener";
      a.addEventListener("click", function (event) { event.preventDefault(); openLink(link); });
      card.appendChild(a);
    }
    root.appendChild(card);
    state.frame = null;
  }
  function show(result) {
    if (!result) return;
    var structured = result.structuredContent || {};
    var editor = editorMeta(result._meta);
    if (!editor) {
      if (typeof structured.url === "string" && !state.frame) message("The editor could not open here.", structured.url);
      return;
    }
    if (state.frame && state.editor && state.editor.url === editor.url) {
      state.editor = editor;
      toFrame({ type: "zenvi:token", token: editor.token });
      return;
    }
    state.editor = editor;
    state.projectId = editor.projectId || structured.project_id || null;
    state.origin = new URL(editor.url).origin;
    var frame = document.createElement("iframe");
    frame.id = "frame";
    frame.title = "Zenvi editor";
    frame.setAttribute("allow", "fullscreen; clipboard-write; autoplay");
    var hash = "token=" + encodeURIComponent(editor.token) + "&mode=" + state.mode + (state.theme ? "&theme=" + encodeURIComponent(state.theme) : "") + "&open=" + encodeURIComponent(editor.openUrl || "");
    frame.src = editor.url + "#" + hash;
    root.textContent = "";
    root.appendChild(frame);
    state.frame = frame;
    state.ready = false;
    size();
    // A host that cannot frame the editor (no frame-domain support) leaves it blank: offer a tab instead.
    setTimeout(function () {
      if (state.frame === frame && !state.ready) message("The editor could not open inside this chat.", editor.url + "#" + hash, "Open the Zenvi editor");
    }, READY_MS);
  }
  function refreshToken() {
    if (state.refreshing || !state.projectId) return;
    state.refreshing = true;
    callTool("open_in_editor", { project_id: state.projectId }).then(function (result) {
      state.refreshing = false;
      var editor = editorMeta(result && (result._meta || result.meta));
      if (editor) { state.editor = editor; toFrame({ type: "zenvi:token", token: editor.token }); }
      else toFrame({ type: "zenvi:token-unavailable" });
    }, function () {
      state.refreshing = false;
      toFrame({ type: "zenvi:token-unavailable" });
    });
  }
  function applyContext(context) {
    if (!context) return;
    if (context.theme) { state.theme = context.theme; toFrame({ type: "zenvi:theme", theme: context.theme }); }
    if (context.displayMode && context.displayMode !== state.mode) setMode(context.displayMode);
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (state.frame && event.source === state.frame.contentWindow) {
      if (event.origin !== state.origin || !msg || typeof msg.type !== "string") return;
      if (msg.type === "zenvi:ready") {
        state.ready = true;
        toFrame({ type: "zenvi:display-mode", mode: state.mode });
        if (state.theme) toFrame({ type: "zenvi:theme", theme: state.theme });
      } else if (msg.type === "zenvi:request-display-mode") requestMode(msg.mode === "fullscreen" ? "fullscreen" : "inline");
      else if (msg.type === "zenvi:open-external" && typeof msg.url === "string" && /^https:\\/\\//.test(msg.url)) openLink(msg.url);
      else if (msg.type === "zenvi:follow-up" && typeof msg.text === "string" && msg.text.trim()) followUp(msg.text.slice(0, 2000));
      else if (msg.type === "zenvi:token-expired") refreshToken();
      return;
    }
    if (event.source !== window.parent || !msg || msg.jsonrpc !== "2.0") return;
    if (msg.id !== undefined && !msg.method) {
      var waiter = pending[msg.id];
      if (waiter) { delete pending[msg.id]; if (msg.error) waiter.reject(msg.error); else waiter.resolve(msg.result); }
      return;
    }
    if (msg.method === "ui/notifications/tool-result") show(msg.params);
    else if (msg.method === "ui/notifications/host-context-changed") applyContext(msg.params);
    else if (msg.method === "ui/resource-teardown" || msg.method === "ping") post({ jsonrpc: "2.0", id: msg.id, result: {} });
  });

  if (oa) {
    if (oa.theme) state.theme = oa.theme;
    if (oa.displayMode) state.mode = oa.displayMode;
    if (oa.toolOutput || oa.toolResponseMetadata) show({ structuredContent: oa.toolOutput, _meta: oa.toolResponseMetadata });
    window.addEventListener("openai:set_globals", function (event) {
      var globals = event.detail && event.detail.globals;
      if (!globals) return;
      applyContext({ theme: globals.theme, displayMode: globals.displayMode });
      if (globals.toolOutput !== undefined || globals.toolResponseMetadata !== undefined) {
        show({ structuredContent: globals.toolOutput || oa.toolOutput, _meta: globals.toolResponseMetadata || oa.toolResponseMetadata });
      }
    });
  }
  request("ui/initialize", {
    appInfo: { name: "zenvi-editor", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    protocolVersion: "2026-01-26"
  }).then(function (result) {
    applyContext(result && result.hostContext);
    notify("ui/notifications/initialized", {});
  }, function () {});
  window.addEventListener("resize", size);
})();
</script>
</body>
</html>
`;
