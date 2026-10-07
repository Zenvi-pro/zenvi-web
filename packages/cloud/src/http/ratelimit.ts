/**
 * Fixed-window rate limits kept in memory (the service runs one replica).
 * Used for unauthenticated endpoints that create state (client registration,
 * device codes) and for brute-force-sensitive ones (user-code approval, token).
 */

import type { Clock } from "../util/clock.js";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly clock: Clock) {}

  /** Count one hit for `key`. Returns seconds to wait when over the limit, else 0. */
  hit(key: string, rule: RateLimitRule): number {
    const now = this.clock.now();
    const current = this.windows.get(key);
    if (!current || now - current.start >= rule.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      this.prune(now, rule.windowMs);
      return 0;
    }
    current.count += 1;
    if (current.count <= rule.limit) return 0;
    return Math.max(1, Math.ceil((current.start + rule.windowMs - now) / 1000));
  }

  /** Seconds to wait if `key` already used up its budget (does not count a hit). */
  blocked(key: string, rule: RateLimitRule): number {
    const now = this.clock.now();
    const current = this.windows.get(key);
    if (!current || now - current.start >= rule.windowMs || current.count < rule.limit) return 0;
    return Math.max(1, Math.ceil((current.start + rule.windowMs - now) / 1000));
  }

  private prune(now: number, windowMs: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, entry] of this.windows) if (now - entry.start >= windowMs) this.windows.delete(key);
  }
}

export const RULES = {
  register: { limit: 30, windowMs: 3_600_000 },
  deviceCode: { limit: 30, windowMs: 3_600_000 },
  token: { limit: 120, windowMs: 60_000 },
  approveFailures: { limit: 10, windowMs: 600_000 },
  authorize: { limit: 60, windowMs: 60_000 },
  importUrl: { limit: 30, windowMs: 3_600_000 },
} satisfies Record<string, RateLimitRule>;

/**
 * Client IP for rate limiting. Azure Container Apps' ingress appends the peer
 * address to X-Forwarded-For, so the right-most entry is the one it saw;
 * anything to its left is client-supplied.
 */
export function clientIp(forwardedFor: string | undefined, fallback = "unknown"): string {
  if (!forwardedFor) return fallback;
  const parts = forwardedFor
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return parts[parts.length - 1] ?? fallback;
}
