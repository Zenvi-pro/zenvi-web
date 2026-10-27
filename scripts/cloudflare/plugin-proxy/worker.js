/**
 * zenvi.pro/plugin → Zenvi Cloud's MCP server.
 *
 * Runs on the routes in wrangler.toml only. MCP traffic (and its RFC 9728
 * metadata) goes to Zenvi Cloud with the path unchanged: the server mounts
 * itself at /plugin through MCP_URL_ALIASES=https://zenvi.pro/plugin. A browser
 * opening the address gets the website's /plugin page instead.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const accept = request.headers.get("accept") ?? "";
    const pageLoad =
      (request.method === "GET" || request.method === "HEAD") &&
      accept.includes("text/html") &&
      !accept.includes("text/event-stream") &&
      !request.headers.has("authorization");
    if (pageLoad) return fetch(request);

    const target = new URL(url.pathname + url.search, env.CLOUD_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("x-forwarded-host", url.host);
    return fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  },
};
