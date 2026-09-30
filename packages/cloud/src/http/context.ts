import type { Principal } from "../auth/principal.js";

/** Hono environment: per-request variables set by middleware. */
export interface AppEnv {
  Variables: {
    requestId: string;
    /** Set by `requireAuth`. */
    principal: Principal;
    /** Public origin this request arrived on (canonical or an alias). */
    origin: string;
  };
}
