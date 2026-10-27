import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type ZenviConfig } from "../config.js";
import { deviceLogin, DEVICE_GRANT } from "./device.js";
import { Auth, PAT_BACKEND_MESSAGE } from "./session.js";
import { authFile, readAuth } from "./store.js";
import { browserLogin } from "./supabase.js";

type Handler = (req: IncomingMessage, body: Record<string, unknown>, res: ServerResponse) => void;

let dir: string;
let server: Server;
let base: string;
let handler: Handler = (_req, _body, res) => res.end();
const calls: Array<{ url: string; body: Record<string, unknown>; headers: IncomingMessage["headers"] }> = [];

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "ES256", typ: "JWT" })}.${b64(payload)}.sig`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function config(): ZenviConfig {
  return loadConfig({ HOME: dir, ZENVI_CONFIG_DIR: `${dir}/config`, ZENVI_SUPABASE_URL: base, ZENVI_CLOUD_URL: base, ZENVI_WEBSITE: "https://zenvi.test", ZENVI_SUPABASE_ANON_KEY: "anon-key" });
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-auth-");
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      calls.push({ url: req.url ?? "", body, headers: req.headers });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await removeDir(dir);
});

describe("browser login (desktop handoff)", () => {
  it("opens <website>/login?state= and polls poll_desktop_auth_session until authenticated", async () => {
    let polls = 0;
    const access = jwt({ sub: "user-1", email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 3600 });
    handler = (req, body, res) => {
      if (req.url === "/rest/v1/rpc/poll_desktop_auth_session") {
        expect(req.headers.apikey).toBe("anon-key");
        expect(body.session_state).toBe("state-123");
        polls += 1;
        return json(res, 200, polls < 3 ? [] : [{ authenticated: true, access_token: access, refresh_token: "r1", expires_at: 1, user_id: "user-1", user_email: "a@b.c" }]);
      }
      json(res, 404, {});
    };
    const opened: string[] = [];
    const session = await browserLogin(config(), { state: "state-123", intervalMs: 10, openUrl: (u) => (opened.push(u), true) });
    expect(opened).toEqual(["https://zenvi.test/login?state=state-123"]);
    expect(polls).toBe(3);
    expect(session).toMatchObject({ kind: "supabase", access_token: access, refresh_token: "r1", user_email: "a@b.c" });
    const auth = new Auth(config());
    await auth.save(session);
    expect((await stat(authFile(config()))).mode & 0o777).toBe(0o600);
    expect(await readAuth(config())).toMatchObject({ kind: "supabase", user_id: "user-1" });
  });

  it("stops at once when the RPC does not exist, and times out otherwise", async () => {
    handler = (_req, _body, res) => json(res, 404, { message: "not found" });
    await expect(browserLogin(config(), { intervalMs: 10 })).rejects.toThrow(/not available/);
    handler = (_req, _body, res) => json(res, 200, []);
    await expect(browserLogin(config(), { intervalMs: 5, timeoutMs: 40 })).rejects.toThrow(/Timed out/);
  });
});

describe("session refresh", () => {
  it("refreshes an expiring Supabase session and keeps it on disk", async () => {
    const cfg = config();
    const auth = new Auth(cfg);
    await auth.save({ kind: "supabase", access_token: jwt({ sub: "u", exp: Math.floor(Date.now() / 1000) + 10 }), refresh_token: "old", saved_at: "x", user_email: "a@b.c" });
    const fresh = jwt({ sub: "u", exp: Math.floor(Date.now() / 1000) + 3600 });
    handler = (req, body, res) => {
      if (req.url === "/auth/v1/token?grant_type=refresh_token") {
        expect(body.refresh_token).toBe("old");
        return json(res, 200, { access_token: fresh, refresh_token: "new", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u", email: "a@b.c" } });
      }
      json(res, 404, {});
    };
    expect(await new Auth(cfg).backendToken()).toBe(fresh);
    expect(await readAuth(cfg)).toMatchObject({ refresh_token: "new" });
  });

  it("reports an expired session when the refresh token is rejected", async () => {
    const cfg = config();
    await new Auth(cfg).save({ kind: "supabase", access_token: jwt({ exp: 1 }), refresh_token: "bad", saved_at: "x" });
    handler = (_req, _body, res) => json(res, 400, { error: "invalid_grant" });
    const who = await new Auth(cfg).whoami();
    expect(who).toMatchObject({ loggedIn: false, expired: true, kind: "supabase" });
  });

  it("uses personal tokens for the cloud but not the backend", async () => {
    const cfg = config();
    await new Auth(cfg).save({ kind: "pat", token: "zvn_pat_abc", saved_at: "x", user_email: "p@q.r" });
    const auth = new Auth(cfg);
    expect(await auth.cloudToken()).toBe("zvn_pat_abc");
    expect(await auth.backendToken()).toBeUndefined();
    expect(await auth.whoami()).toMatchObject({ loggedIn: true, kind: "pat", email: "p@q.r" });
    expect(await auth.logout()).toBe(true);
    expect(await auth.whoami()).toEqual({ loggedIn: false });
  });
});

describe("what the sign-in enables", () => {
  const enabled = (features: Array<{ name: string; enabled: boolean }>) => features.filter((f) => f.enabled).map((f) => f.name);

  it("refuses the backend up front for a personal token, and turns off the AI features", async () => {
    const cfg = config();
    const auth = new Auth(cfg);
    await auth.save({ kind: "pat", token: "zvn_pat_abc", saved_at: "x" });
    expect(await auth.backendUnavailable()).toBe(PAT_BACKEND_MESSAGE);
    const features = await auth.features();
    expect(enabled(features)).toEqual(["Local editing and rendering", "Zenvi Cloud (push, pull, share links)"]);
    expect(features.find((f) => f.name === "AI voice (text to speech)")?.fix).toMatch(/zenvi login/);
  });

  it("refuses the backend for a stored session whose token is not a JWT", async () => {
    const auth = new Auth(config());
    await auth.save({ kind: "supabase", access_token: "zvn_pat_abc", refresh_token: "r", expires_at: 4_000_000_000, saved_at: "x" });
    expect(await auth.backendUnavailable()).toMatch(/not a session token/);
  });

  it("enables everything for a Supabase session", async () => {
    const auth = new Auth(config());
    await auth.save({ kind: "supabase", access_token: jwt({ exp: 4_000_000_000 }), refresh_token: "r", saved_at: "x" });
    expect(await auth.backendUnavailable()).toBeUndefined();
    expect((await auth.features()).every((f) => f.enabled)).toBe(true);
  });

  it("signed out: only local editing is on, and the fix is to log in; the backend is left to answer", async () => {
    const cfg = config();
    await new Auth(cfg).logout();
    const auth = new Auth(cfg);
    expect(await auth.backendUnavailable()).toBeUndefined();
    expect(enabled(await auth.features())).toEqual(["Local editing and rendering"]);
  });
});

describe("device login", () => {
  it("shows the code, handles pending and slow_down, and stores the personal token", async () => {
    let polls = 0;
    handler = (req, body, res) => {
      if (req.url === "/v1/device/code") return json(res, 200, { device_code: "dev-1", user_code: "ABCD-EFGH", verification_uri: "https://zenvi.test/device", verification_uri_complete: "https://zenvi.test/device?code=ABCD-EFGH", interval: 0, expires_in: 60 });
      if (req.url === "/v1/device/token") {
        expect(body).toEqual({ grant_type: DEVICE_GRANT, device_code: "dev-1" });
        polls += 1;
        if (polls === 1) return json(res, 400, { error: "authorization_pending" });
        if (polls === 2) return json(res, 400, { error: "slow_down" });
        return json(res, 200, { access_token: "zvn_pat_xyz", token_type: "bearer", token_id: "tok_1", user: { id: "u9", email: "d@e.f" } });
      }
      json(res, 404, {});
    };
    const shown: string[] = [];
    const auth = await deviceLogin(config(), { onCode: (c) => shown.push(c.user_code), minIntervalMs: 5 });
    expect(shown).toEqual(["ABCD-EFGH"]);
    expect(auth).toMatchObject({ kind: "pat", token: "zvn_pat_xyz", token_id: "tok_1", user_email: "d@e.f" });
    expect(polls).toBe(3);
  }, 30_000);

  it("fails clearly when the code expires or is denied", async () => {
    handler = (req, _body, res) => {
      if (req.url === "/v1/device/code") return json(res, 200, { device_code: "d", user_code: "X", verification_uri: "u", interval: 0, expires_in: 60 });
      json(res, 400, { error: "access_denied" });
    };
    await expect(deviceLogin(config(), { minIntervalMs: 1 })).rejects.toThrow(/denied/);
    handler = (req, _body, res) => {
      if (req.url === "/v1/device/code") return json(res, 200, { device_code: "d", user_code: "X", verification_uri: "u", interval: 0, expires_in: 60 });
      json(res, 400, { error: "expired_token" });
    };
    await expect(deviceLogin(config(), { minIntervalMs: 1 })).rejects.toThrow(/expired/);
  });
});
