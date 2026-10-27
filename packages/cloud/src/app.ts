/**
 * The Hono application: middleware, CORS policies per surface, routes and
 * error mapping. `createApp(services)` is what main.ts serves and what tests
 * call with `app.request()`.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Services } from "./container.js";
import { DOCUMENTATION_URL } from "./container.js";
import type { AppEnv } from "./http/context.js";
import { EMBED_PREFIX, editorRoutes } from "./http/editor.js";
import { ApiError } from "./http/errors.js";
import { errorMessage } from "./http/log.js";
import { originMatcher, requestOrigin } from "./http/origins.js";
import { cloudCapabilities } from "./mcp/host.js";
import { buildToolList } from "./mcp/server.js";
import { OAuthError } from "./oauth/service.js";
import { deviceRoutes } from "./routes/device.js";
import { mcpRoutes } from "./routes/mcp.js";
import { oauthRoutes, wellKnownRoutes } from "./routes/oauth.js";
import { v1Routes } from "./routes/v1.js";

export function createApp(services: Services): Hono<AppEnv> {
  const { config, log } = services;
  const app = new Hono<AppEnv>();
  const corsAllowed = originMatcher(config.corsOrigins);
  const mcpAllowed = originMatcher(config.mcpAllowedOrigins);
  const tools = buildToolList(services);

  app.use("*", async (c, next) => {
    const requestId = randomUUID();
    const started = Date.now();
    c.set("requestId", requestId);
    c.set("origin", requestOrigin(config.publicBaseUrl, config.publicBaseUrlAliases, c.req.header("host"), c.req.header("x-forwarded-proto")));
    await next();
    c.header("X-Request-Id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    // Only the embedded editor's page may be framed (by chat hosts; it sends frame-ancestors itself).
    if (!c.req.path.startsWith(EMBED_PREFIX)) c.header("X-Frame-Options", "DENY");
    if (c.get("origin").startsWith("https://")) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
    const path = c.req.path;
    const fields = { id: requestId, method: c.req.method, path, status: c.res.status, ms: Date.now() - started };
    if (path === "/health") log.debug("request", fields);
    else log.info("request", fields);
  });

  const apiCors = cors({
    origin: (origin) => (corsAllowed(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "If-Match"],
    exposeHeaders: ["ETag", "Retry-After", "WWW-Authenticate", "X-Request-Id"],
    maxAge: 600,
  });
  // Discovery, registration, token and revocation carry no cookies: any origin (browser-based MCP clients).
  const publicCors = cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type"], maxAge: 600 });
  const mcpCors = cors({
    origin: (origin) => (mcpAllowed(origin) ? origin : null),
    allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept", "Mcp-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"],
    exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id", "Mcp-Protocol-Version", "X-Request-Id"],
    maxAge: 600,
  });
  app.use("/v1/*", apiCors);
  app.use("/oauth/consent", apiCors);
  app.use("/oauth/consent-info", apiCors);
  app.use("/.well-known/*", publicCors);
  app.use("/oauth/register", publicCors);
  app.use("/oauth/token", publicCors);
  app.use("/oauth/revoke", publicCors);
  app.use("/mcp", mcpCors);
  for (const alias of config.mcpUrlAliases) app.use(new URL(alias).pathname, mcpCors);

  app.get("/", (c) =>
    c.json({
      service: "zenvi-cloud",
      docs: DOCUMENTATION_URL,
      mcp: `${c.get("origin")}/mcp`,
      api: `${c.get("origin")}/v1`,
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "zenvi-cloud",
      version: config.version,
      uptimeSeconds: Math.round((services.clock.now() - services.startedAt) / 1000),
      storage: services.blobs.kind,
      renderer: services.renders.rendererAvailable,
      frames: services.frames.available,
      imports: services.importer.available,
      engineTools: services.engine?.tools.length ?? 0,
      mcpTools: tools.length,
      hostCapabilities: [...cloudCapabilities(services)].sort(),
    }),
  );

  app.route("/.well-known", wellKnownRoutes(services));
  app.route("/oauth", oauthRoutes(services));
  // Device routes first: they are partly unauthenticated, and must answer before /v1's auth middleware.
  app.route("/v1/device", deviceRoutes(services));
  app.route("/v1", v1Routes(services));
  app.route("/mcp", mcpRoutes(services, tools, mcpAllowed));
  // Same server behind a proxy's public URL (MCP_URL_ALIASES), e.g. https://zenvi.pro/plugin → /plugin here.
  for (const alias of config.mcpUrlAliases) app.route(new URL(alias).pathname, mcpRoutes(services, tools, mcpAllowed, alias));
  app.route("/editor", editorRoutes(config.editorDist, config.editorUrl, [config.publicBaseUrl, ...config.publicBaseUrlAliases]));

  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404));

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      for (const [name, value] of Object.entries(error.headers)) c.header(name, value);
      return c.json(error.body(), error.status);
    }
    if (error instanceof OAuthError) return c.json(error.body(), error.status);
    if (error instanceof HTTPException) return error.getResponse();
    log.error("unhandled error", { id: c.get("requestId"), path: c.req.path, error: errorMessage(error), stack: error instanceof Error ? error.stack : undefined });
    return c.json({ error: { code: "internal", message: "Something went wrong on our side. Try again." } }, 500);
  });

  return app;
}
