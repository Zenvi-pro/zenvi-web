/**
 * Device login (RFC 8628) against Zenvi Cloud, for machines without a
 * browser: show a short code, the person approves it on zenvi.pro from any
 * device, and the CLI receives a personal token (`zvn_pat_…`).
 * Endpoints: packages/cloud/src/routes/device.ts.
 */

import { hostname } from "node:os";
import type { ZenviConfig } from "../config.js";
import { CliError } from "../output.js";
import type { PatAuth } from "./store.js";

export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
}

export interface DeviceLoginOptions {
  onCode?: (code: DeviceCode) => void;
  openUrl?: (url: string) => Promise<boolean> | boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  clientName?: string;
  /** Test hook: minimum poll interval in ms (default: the server's interval). */
  minIntervalMs?: number;
}

async function post(doFetch: typeof fetch, url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new CliError(`Cannot reach Zenvi Cloud at ${new URL(url).origin}: ${(error as Error).message}`);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON error page.
  }
  return { status: response.status, data };
}

export async function deviceLogin(config: ZenviConfig, options: DeviceLoginOptions = {}): Promise<PatAuth> {
  const doFetch = options.fetchImpl ?? fetch;
  const start = await post(doFetch, `${config.cloudUrl}/v1/device/code`, { client_name: options.clientName ?? `Zenvi CLI on ${hostname()}` });
  if (start.status !== 200 || typeof start.data.device_code !== "string") {
    throw new CliError(`Device login could not start (HTTP ${start.status}${start.data.error_description ? `: ${String(start.data.error_description)}` : ""}).`);
  }
  const code = start.data as unknown as DeviceCode;
  options.onCode?.(code);
  if (code.verification_uri_complete) await Promise.resolve(options.openUrl?.(code.verification_uri_complete)).catch(() => false);

  let intervalMs = Math.max(options.minIntervalMs ?? 0, (code.interval ?? 5) * 1000);
  const deadline = Date.now() + (code.expires_in ?? 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new CliError("Sign-in cancelled."));
      }, { once: true });
    });
    const poll = await post(doFetch, `${config.cloudUrl}/v1/device/token`, { grant_type: DEVICE_GRANT, device_code: code.device_code });
    if (poll.status === 200 && typeof poll.data.access_token === "string") {
      const user = (poll.data.user ?? {}) as Record<string, unknown>;
      return {
        kind: "pat",
        token: poll.data.access_token,
        token_id: typeof poll.data.token_id === "string" ? poll.data.token_id : undefined,
        user_id: typeof user.id === "string" ? user.id : undefined,
        user_email: typeof user.email === "string" ? user.email : undefined,
        saved_at: new Date().toISOString(),
      };
    }
    const error = String(poll.data.error ?? "");
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (error === "expired_token") throw new CliError("The sign-in code expired before it was approved.", 1, "Run `zenvi login --device` again.");
    if (error === "access_denied") throw new CliError("Sign-in was denied on zenvi.pro.");
    throw new CliError(`Device login failed (HTTP ${poll.status}${error ? `: ${error}` : ""}).`);
  }
  throw new CliError("The sign-in code expired before it was approved.", 1, "Run `zenvi login --device` again.");
}
