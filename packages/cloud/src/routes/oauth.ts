/**
 * OAuth 2.1 authorization server + discovery documents for remote MCP.
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 (resource = <origin>/mcp)
 *   GET  /.well-known/oauth-authorization-server       RFC 8414
 *   POST /oauth/register                               RFC 7591 (public clients)
 *   GET  /oauth/authorize                              → 302 to the editor's consent page
 *   GET  /oauth/consent-info?request=                  public request details for that page
 *   POST /oauth/consent {request, approve}             Supabase session → {redirect}
 *   POST /oauth/token                                  authorization_code | refresh_token
 *   POST /oauth/revoke                                 RFC 7009
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Services } from "../container.js";
import { requireAuth } from "../http/auth.js";
import { parseJson, readFormOrJson, readJson } from "../http/body.js";
import type { AppEnv } from "../http/context.js";
import { rateLimited } from "../http/errors.js";
import { clientIp, RULES } from "../http/ratelimit.js";
import { ClientError } from "../oauth/clients.js";
import { OAuthError } from "../oauth/service.js";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

export function errorPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Zenvi sign-in problem</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#17171a}@media(prefers-color-scheme:dark){body{background:#17171a;color:#f4f4f6}}h1{font-size:1.25rem}</style>
</head><body><h1>Zenvi could not continue this sign-in</h1><p>${escapeHtml(message)}</p><p>Go back to the app you came from and try connecting again.</p></body></html>`;
}

/** client_id from HTTP Basic credentials (RFC 6749 §2.3.1); any secret is ignored (public clients). */
function basicClientId(header: string | undefined): string | undefined {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? "");
  if (!match?.[1]) return undefined;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  const raw = colon >= 0 ? decoded.slice(0, colon) : decoded;
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

export function wellKnownRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const prm = (origin: string) => services.oauth.protectedResourceMetadata(origin);
  app.get("/oauth-protected-resource", (c) => c.json(prm(c.get("origin"))));
  app.get("/oauth-protected-resource/mcp", (c) => c.json(prm(c.get("origin"))));
  app.get("/oauth-authorization-server", (c) => c.json(services.oauth.authorizationServerMetadata(c.get("origin"))));
  return app;
}

export function oauthRoutes(services: Services): Hono<AppEnv> {
  const { oauth, clients, limiter, log } = services;
  const app = new Hono<AppEnv>();
  const ip = (c: { req: { header(name: string): string | undefined } }): string => clientIp(c.req.header("x-forwarded-for"));

  app.post("/register", async (c) => {
    const wait = limiter.hit(`register:${ip(c)}`, RULES.register);
    if (wait > 0) throw rateLimited(wait);
    const body = await readJson(c, 64 * 1024);
    try {
      const registered = await clients.register(body);
      log.info("oauth client registered", { clientId: registered.client_id, name: registered.client_name });
      c.header("Cache-Control", "no-store");
      return c.json(registered, 201);
    } catch (error) {
      if (error instanceof ClientError) return c.json({ error: error.error, error_description: error.message }, 400);
      throw error;
    }
  });

  app.get("/authorize", async (c) => {
    const wait = limiter.hit(`authorize:${ip(c)}`, RULES.authorize);
    if (wait > 0) return c.html(errorPage("Too many sign-in attempts. Wait a minute and try again."), 429);
    const query = (name: string): string | undefined => c.req.query(name);
    const outcome = await oauth.authorize(
      {
        response_type: query("response_type"),
        client_id: query("client_id"),
        redirect_uri: query("redirect_uri"),
        state: query("state"),
        code_challenge: query("code_challenge"),
        code_challenge_method: query("code_challenge_method"),
        scope: query("scope"),
        resource: c.req.queries("resource") ?? [],
      },
      c.get("origin"),
    );
    c.header("Cache-Control", "no-store");
    if (outcome.kind === "error_page") {
      c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      return c.html(errorPage(outcome.message), 400);
    }
    return c.redirect(outcome.location, 302);
  });

  app.get("/consent-info", async (c) => c.json(await oauth.consentInfo(c.req.query("request") ?? "")));

  app.post("/consent", requireAuth(services.auth, { allow: ["supabase"] }), async (c) => {
    const body = await parseJson(c, z.object({ request: z.string().min(1).max(100), approve: z.boolean() }));
    const principal = c.get("principal");
    const result = await oauth.consent(body.request, { userId: principal.userId, email: principal.email }, body.approve);
    log.info("oauth consent", { user: principal.userId, approved: body.approve });
    return c.json(result);
  });

  app.post("/token", async (c) => {
    const wait = limiter.hit(`token:${ip(c)}`, RULES.token);
    if (wait > 0) throw rateLimited(wait);
    const params = await readFormOrJson(c);
    const basic = basicClientId(c.req.header("authorization"));
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    if (basic !== undefined) {
      if (params.client_id !== undefined && params.client_id !== basic) {
        return c.json({ error: "invalid_request", error_description: "client_id differs between Authorization and body." }, 400);
      }
      params.client_id = basic;
    }
    try {
      return c.json(await oauth.token(params, c.get("origin")));
    } catch (error) {
      if (error instanceof OAuthError) {
        if (error.status === 401) c.header("WWW-Authenticate", 'Basic realm="zenvi"');
        return c.json(error.body(), error.status);
      }
      throw error;
    }
  });

  app.post("/revoke", async (c) => {
    const wait = limiter.hit(`token:${ip(c)}`, RULES.token);
    if (wait > 0) throw rateLimited(wait);
    const params = await readFormOrJson(c);
    const basic = basicClientId(c.req.header("authorization"));
    if (basic !== undefined && params.client_id === undefined) params.client_id = basic;
    try {
      await oauth.revoke(params);
    } catch (error) {
      if (error instanceof OAuthError) return c.json(error.body(), error.status);
      throw error;
    }
    return c.json({});
  });

  return app;
}
