/**
 * A small MCP Apps view (ext-apps spec 2026-01-26) that shows what
 * `preview_frame` and `get_render_status` return: the frame image, or the
 * finished video with a download button, or render progress.
 *
 * It speaks the standard postMessage protocol (`ui/initialize` →
 * `ui/notifications/initialized`, then `ui/notifications/tool-result`,
 * `ui/open-link`, `ui/notifications/size-changed`) and also reads ChatGPT's
 * `window.openai.toolOutput` compatibility global. No external scripts; the
 * only remote content is the signed blob URL in the tool result.
 */

export const WIDGET_URI = "ui://zenvi/preview-v1.html";
export const WIDGET_MIME = "text/html;profile=mcp-app";

/** Tool `_meta` linking a tool to the view (standard key + ChatGPT alias). */
export function widgetToolMeta(): Record<string, unknown> {
  return { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI };
}

export function widgetResourceMeta(blobOrigin: string): Record<string, unknown> {
  return {
    ui: { csp: { resourceDomains: [blobOrigin], connectDomains: [] }, prefersBorder: true },
    "openai/widgetDescription": "Shows the previewed frame, or the rendered video with its download link.",
    "openai/widgetPrefersBorder": true,
    // redirect_domains lets the Download button open the signed blob link (ChatGPT openExternal).
    "openai/widgetCSP": { resource_domains: [blobOrigin], connect_domains: [], redirect_domains: [blobOrigin] },
  };
}

export const WIDGET_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zenvi preview</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #17171a; --muted: #6b6b76; --accent: #6d4aff; --track: #e7e7ee; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17171a; --fg: #f4f4f6; --muted: #a1a1ab; --track: #2c2c33; } }
  :root[data-theme="light"] { --bg: #ffffff; --fg: #17171a; --muted: #6b6b76; --track: #e7e7ee; }
  :root[data-theme="dark"] { --bg: #17171a; --fg: #f4f4f6; --muted: #a1a1ab; --track: #2c2c33; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { padding: 12px; display: grid; gap: 10px; }
  img, video { width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px; background: #000; display: block; }
  audio { width: 100%; }
  .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .muted { color: var(--muted); }
  button { font: inherit; border: 0; border-radius: 8px; padding: 8px 14px; background: var(--accent); color: #fff; cursor: pointer; }
  .bar { height: 8px; border-radius: 4px; background: var(--track); overflow: hidden; }
  .bar > div { height: 100%; background: var(--accent); width: 0; transition: width .3s; }
  .error { color: #d93b3b; }
</style>
</head>
<body>
<main id="root"><p class="muted">Waiting for Zenvi…</p></main>
<script>
(function () {
  var root = document.getElementById("root");
  var nextId = 1;
  var pending = {};
  function post(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve) { pending[id] = resolve; });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function openLink(url) {
    if (window.openai && typeof window.openai.openExternal === "function") { window.openai.openExternal({ href: url }); return; }
    request("ui/open-link", { url: url });
  }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text) node.textContent = text;
    return node;
  }
  function size(bytes) {
    if (typeof bytes !== "number") return "";
    var units = ["B", "KB", "MB", "GB"]; var i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return (i === 0 ? bytes : bytes.toFixed(1)) + " " + units[i];
  }
  function safeUrl(value) { return typeof value === "string" && /^https:\\/\\//.test(value) ? value : null; }
  function render(data) {
    if (!data || typeof data !== "object") return;
    root.textContent = "";
    var image = safeUrl(data.image_url);
    if (image) {
      root.appendChild(el("img", { src: image, alt: "Frame at " + data.time_seconds + " s" }));
      root.appendChild(el("div", { class: "muted" }, "Frame at " + data.time_seconds + " s"));
    } else if (data.status) {
      var url = safeUrl(data.url);
      if (data.status === "done" && url) {
        var fmt = String(data.format || "");
        if (fmt === "gif") root.appendChild(el("img", { src: url, alt: "Rendered GIF" }));
        else if (fmt === "mp3" || fmt === "wav") root.appendChild(el("audio", { src: url, controls: "" }));
        else root.appendChild(el("video", { src: url, controls: "", playsinline: "", preload: "metadata" }));
        var row = el("div", { class: "row" });
        row.appendChild(el("span", { class: "muted" }, (data.width && data.height ? data.width + "×" + data.height + " · " : "") + fmt.toUpperCase() + (data.size_bytes ? " · " + size(data.size_bytes) : "")));
        var button = el("button", {}, "Download");
        button.addEventListener("click", function () { openLink(url); });
        row.appendChild(button);
        root.appendChild(row);
      } else if (data.status === "error") {
        root.appendChild(el("p", { class: "error" }, "Render failed: " + (data.error || "unknown error")));
      } else {
        var pct = Math.round((Number(data.progress) || 0) * 100);
        root.appendChild(el("div", {}, data.status === "queued" ? "Render queued…" : "Rendering… " + pct + "%"));
        var bar = el("div", { class: "bar" }); var fill = el("div", {}); fill.style.width = pct + "%"; bar.appendChild(fill);
        root.appendChild(bar);
        root.appendChild(el("div", { class: "muted" }, "Ask to check the render status again to refresh."));
      }
    }
    reportSize();
  }
  function reportSize() {
    notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight });
  }
  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.id !== undefined && pending[msg.id] && !msg.method) { pending[msg.id](msg.result); delete pending[msg.id]; return; }
    if (msg.method === "ui/notifications/tool-result" && msg.params) render(msg.params.structuredContent);
    else if (msg.method === "ui/notifications/host-context-changed" && msg.params && msg.params.theme) document.documentElement.dataset.theme = msg.params.theme;
    else if (msg.method === "ui/resource-teardown" || msg.method === "ping") post({ jsonrpc: "2.0", id: msg.id, result: {} });
  });
  if (window.openai) {
    if (window.openai.theme) document.documentElement.dataset.theme = window.openai.theme;
    if (window.openai.toolOutput) render(window.openai.toolOutput);
    window.addEventListener("openai:set_globals", function (event) {
      var globals = event.detail && event.detail.globals;
      if (globals && globals.toolOutput) render(globals.toolOutput);
    });
  }
  request("ui/initialize", {
    appInfo: { name: "zenvi-preview", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: "2026-01-26"
  }).then(function (result) {
    var theme = result && result.hostContext && result.hostContext.theme;
    if (theme) document.documentElement.dataset.theme = theme;
    notify("ui/notifications/initialized", {});
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.documentElement);
})();
</script>
</body>
</html>
`;
