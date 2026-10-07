/**
 * Device login (RFC 8628) for the CLI and the desktop app.
 *
 *   POST /v1/device/code     {client_name}            → codes (no auth, rate limited)
 *   POST /v1/device/token    {device_code}            → token or RFC 8628 error (no auth)
 *   GET  /v1/device/info?user_code=                    (Supabase session)
 *   POST /v1/device/approve  {user_code, approve?}     (Supabase session)
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Services } from "../container.js";
import { requireAuth } from "../http/auth.js";
import { parseJson, readFormOrJson } from "../http/body.js";
import type { AppEnv } from "../http/context.js";
import { ApiError, rateLimited } from "../http/errors.js";
import { clientIp, RULES } from "../http/ratelimit.js";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export function deviceRoutes(services: Services): Hono<AppEnv> {
  const { devices, limiter } = services;
  const app = new Hono<AppEnv>();
  const ipOf = (header: string | undefined): string => clientIp(header);

  app.post("/code", async (c) => {
    const wait = limiter.hit(`device-code:${ipOf(c.req.header("x-forwarded-for"))}`, RULES.deviceCode);
    if (wait > 0) throw rateLimited(wait);
    const body = await readFormOrJson(c, 16 * 1024);
    const response = await devices.start(body.client_name);
    c.header("Cache-Control", "no-store");
    return c.json(response);
  });

  app.post("/token", async (c) => {
    const wait = limiter.hit(`device-token:${ipOf(c.req.header("x-forwarded-for"))}`, RULES.token);
    if (wait > 0) throw rateLimited(wait);
    const body = await readFormOrJson(c, 16 * 1024);
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    if (body.grant_type !== undefined && body.grant_type !== DEVICE_GRANT) {
      return c.json({ error: "unsupported_grant_type", error_description: `Use grant_type=${DEVICE_GRANT}.` }, 400);
    }
    if (!body.device_code) return c.json({ error: "invalid_request", error_description: "device_code is required." }, 400);
    const result = await devices.poll(body.device_code);
    if (!result.ok) return c.json({ error: result.error, error_description: result.description }, 400);
    return c.json({
      access_token: result.accessToken,
      token_type: "bearer",
      scope: result.scopes.join(" "),
      token_id: result.tokenId,
      user: { id: result.userId, email: result.email ?? null },
    });
  });

  const signedIn = requireAuth(services.auth, { allow: ["supabase"] });

  // User codes are short: after a few wrong ones (looked up or approved), stop answering for a while.
  const guarded = async <T>(userId: string, body: () => Promise<T>): Promise<T> => {
    const key = `device-approve:${userId}`;
    const blocked = limiter.blocked(key, RULES.approveFailures);
    if (blocked > 0) throw rateLimited(blocked);
    try {
      return await body();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) limiter.hit(key, RULES.approveFailures);
      throw error;
    }
  };

  app.get("/info", signedIn, async (c) => {
    const code = c.req.query("user_code") ?? c.req.query("code") ?? "";
    return c.json(await guarded(c.get("principal").userId, () => devices.info(code)));
  });

  app.post("/approve", signedIn, async (c) => {
    const principal = c.get("principal");
    const body = await parseJson(c, z.object({ user_code: z.string().min(1).max(32), approve: z.boolean().optional() }));
    const outcome = await guarded(principal.userId, () =>
      devices.decide(body.user_code, { userId: principal.userId, email: principal.email }, body.approve ?? true),
    );
    return c.json(outcome);
  });

  return app;
}
