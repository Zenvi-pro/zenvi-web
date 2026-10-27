/**
 * /mcp — remote MCP over Streamable HTTP, stateless: every POST gets a fresh
 * Server + transport (JSON responses), so the endpoint survives restarts and
 * horizontal scaling and never hands out Mcp-Session-Ids.
 *
 * Mounted at /mcp (resource `<origin>/mcp`) and at the path of each MCP URL
 * alias (resource = the alias, e.g. `https://zenvi.pro/plugin`, which a proxy
 * forwards here).
 *
 * Auth for the whole server, including `initialize`:
 *   - OAuth access tokens issued by this service for exactly that resource
 *     (RFC 8707 audience check on every request);
 *   - personal access tokens (`zvn_pat_…`, e.g. Claude Code `--header`).
 * Anything else gets 401 + `WWW-Authenticate: Bearer resource_metadata=…`,
 * which is what starts sign-in in ChatGPT and Claude.
 * A browser Origin that is not on the allowlist gets 403 (DNS rebinding).
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Hono } from "hono";
import { connectionKey } from "../auth/principal.js";
import { RESOURCE_SCOPES } from "../auth/scopes.js";
import { bearerToken } from "../auth/tokens.js";
import type { Services } from "../container.js";
import type { AppEnv } from "../http/context.js";
import { errorMessage } from "../http/log.js";
import { mcpResource, protectedResourceMetadataUrl } from "../oauth/service.js";
import { createMcpServer } from "../mcp/server.js";
import type { McpPrincipal, McpTool } from "../mcp/types.js";

/** Whole-request budget, under ChatGPT's ~60 s tool-call limit. */
const CALL_BUDGET_MS = 55_000;

export function challenge(resource: string, error?: { code: string; description: string }): string {
  const parts = [
    `resource_metadata="${protectedResourceMetadataUrl(resource)}"`,
    `scope="${RESOURCE_SCOPES.join(" ")}"`,
  ];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(", ")}`;
}

/** `resource` is the MCP URL this mount serves; the default is `<origin>/mcp`. */
export function mcpRoutes(services: Services, tools: readonly McpTool[], originAllowed: (origin: string) => boolean, resource?: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.all("/", async (c) => {
    const origin = c.get("origin");
    const served = resource ?? mcpResource(origin);
    // MCP transport rule: a present, invalid Origin gets 403 (DNS rebinding). "null" is an opaque origin.
    const browserOrigin = c.req.header("origin");
    if (browserOrigin !== undefined && (browserOrigin === "null" || !originAllowed(browserOrigin))) {
      return c.json({ error: "forbidden_origin", error_description: "This Origin may not call the Zenvi MCP server." }, 403);
    }

    const token = bearerToken(c.req.header("authorization"));
    if (!token) {
      c.header("WWW-Authenticate", challenge(served));
      return c.json({ error: "invalid_token", error_description: "Sign in to Zenvi to use this server." }, 401);
    }
    const principal = await services.auth.authenticate(token);
    const reject = (description: string) => {
      c.header("WWW-Authenticate", challenge(served, { code: "invalid_token", description }));
      return c.json({ error: "invalid_token", error_description: description }, 401);
    };
    if (!principal) return reject("The access token is invalid, expired or revoked.");
    if (principal.kind === "supabase") return reject("Use a Zenvi connector token or a personal access token, not a website session.");
    if (principal.kind === "embed") return reject("This token only opens the embedded editor for one project.");
    if (principal.kind === "oauth" && principal.resource !== served) {
      return reject(`This token was issued for ${principal.resource}, not ${served}.`);
    }

    if (c.req.method === "GET" || c.req.method === "DELETE") {
      // Stateless server: no standalone SSE stream and no sessions to end.
      c.header("Allow", "POST, OPTIONS");
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this server is stateless; use POST." }, id: null }, 405);
    }
    if (c.req.method !== "POST") {
      c.header("Allow", "POST, OPTIONS");
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405);
    }

    const mcpPrincipal = principal as McpPrincipal;
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(CALL_BUDGET_MS)]);
    const ctx = { services, principal: mcpPrincipal, connection: connectionKey(principal), origin, signal };
    const authInfo: AuthInfo = {
      token,
      clientId: mcpPrincipal.kind === "oauth" ? mcpPrincipal.clientId : `pat:${mcpPrincipal.tokenId}`,
      scopes: mcpPrincipal.scopes,
      ...(mcpPrincipal.kind === "oauth" && mcpPrincipal.expiresAt ? { expiresAt: Math.floor(Date.parse(mcpPrincipal.expiresAt) / 1000) } : {}),
      resource: new URL(served),
      extra: { userId: mcpPrincipal.userId },
    };
    const server = createMcpServer(tools, ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    transport.onerror = (error) => services.log.debug("mcp transport", { error: errorMessage(error) });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw, { authInfo });
      services.log.debug("mcp request", { user: mcpPrincipal.userId, status: response.status });
      return response;
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  return app;
}
