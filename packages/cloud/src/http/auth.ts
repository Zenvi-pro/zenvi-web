/**
 * Bearer authentication middleware for the REST API.
 *
 * /v1 accepts Supabase access tokens and personal access tokens. OAuth access
 * tokens are audience-bound to the MCP endpoint (RFC 8707) and are refused
 * here; /mcp has its own middleware (routes/mcp.ts).
 */

import type { MiddlewareHandler } from "hono";
import type { Authenticator, PrincipalKind } from "../auth/principal.js";
import { bearerToken } from "../auth/tokens.js";
import { ApiError } from "./errors.js";
import type { AppEnv } from "./context.js";

export interface RequireAuthOptions {
  allow: PrincipalKind[];
}

function unauthorized(message: string, error = "invalid_token"): ApiError {
  return new ApiError(401, "unauthorized", message, {}, { "WWW-Authenticate": `Bearer realm="zenvi", error="${error}"` });
}

export function requireAuth(auth: Authenticator, options: RequireAuthOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    const token = bearerToken(header);
    if (!token) {
      throw new ApiError(401, "unauthorized", "Sign in: send Authorization: Bearer <token>.", {}, { "WWW-Authenticate": 'Bearer realm="zenvi"' });
    }
    const principal = await auth.authenticate(token);
    if (!principal) throw unauthorized("The access token is invalid, expired or revoked.");
    if (!options.allow.includes(principal.kind)) {
      if (principal.kind === "oauth") throw unauthorized("This token is only valid for the MCP endpoint.");
      if (options.allow.length === 1 && options.allow[0] === "supabase") {
        throw new ApiError(403, "forbidden", "This endpoint needs a zenvi.pro sign-in (Supabase session), not a personal token.");
      }
      throw new ApiError(403, "forbidden", "This credential cannot use this endpoint.");
    }
    c.set("principal", principal);
    await next();
  };
}
