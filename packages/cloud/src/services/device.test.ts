import { describe, expect, it } from "vitest";
import { harness, USER_A } from "../testing/helpers.js";
import { normalizeUserCode } from "./device.js";

describe("device login (RFC 8628)", () => {
  it("issues a readable user code and a verification link on the editor", async () => {
    const h = await harness();
    const res = await h.request("POST", "/v1/device/code", { json: { client_name: "zenvi CLI on laptop" } });
    expect(res.status).toBe(200);
    expect(res.json.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(res.json.verification_uri).toBe("https://zenvi.test/editor/device");
    expect(res.json.verification_uri_complete).toBe(`https://zenvi.test/editor/device?code=${res.json.user_code}`);
    expect(res.json).toMatchObject({ interval: 5, expires_in: 900 });
    expect(res.json.device_code).toMatch(/^[B-Z]{8}\.[A-Za-z0-9_-]{43}$/);
  });

  it("runs the full flow: pending → slow_down → approved → token, single use", async () => {
    const h = await harness();
    const start = (await h.request("POST", "/v1/device/code", { form: { client_name: "zenvi CLI" } })).json;
    const poll = () => h.request("POST", "/v1/device/token", { form: { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code } });

    const pending = await poll();
    expect(pending.status).toBe(400);
    expect(pending.json.error).toBe("authorization_pending");
    const tooFast = await poll();
    expect(tooFast.json.error).toBe("slow_down");

    const jwt = await h.userToken(USER_A, "a@example.com");
    const info = await h.request("GET", `/v1/device/info?user_code=${start.user_code.toLowerCase()}`, { token: jwt });
    expect(info.json).toMatchObject({ clientName: "zenvi CLI", status: "pending", userCode: start.user_code });
    const approved = await h.request("POST", "/v1/device/approve", { token: jwt, json: { user_code: start.user_code.replace("-", "") } });
    expect(approved.json).toEqual({ status: "approved", clientName: "zenvi CLI" });

    h.clock.advance(11_000);
    const granted = await poll();
    expect(granted.status).toBe(200);
    expect(granted.json.access_token).toMatch(/^zvn_pat_/);
    expect(granted.json).toMatchObject({ token_type: "bearer", user: { id: USER_A, email: "a@example.com" } });
    expect(granted.headers.get("cache-control")).toBe("no-store");

    const me = await h.request("GET", "/v1/me", { token: granted.json.access_token });
    expect(me.json).toMatchObject({ user: { id: USER_A }, auth: "pat" });
    // The device code cannot be redeemed twice.
    expect((await poll()).json.error).toBe("invalid_grant");
    // Nor approved again.
    expect((await h.request("POST", "/v1/device/approve", { token: jwt, json: { user_code: start.user_code } })).status).toBe(409);
  });

  it("reports access_denied and expired_token", async () => {
    const h = await harness();
    const jwt = await h.userToken(USER_A);
    const denied = (await h.request("POST", "/v1/device/code", { json: {} })).json;
    await h.request("POST", "/v1/device/approve", { token: jwt, json: { user_code: denied.user_code, approve: false } });
    expect((await h.request("POST", "/v1/device/token", { json: { device_code: denied.device_code } })).json.error).toBe("access_denied");

    const late = (await h.request("POST", "/v1/device/code", { json: {} })).json;
    h.clock.advance(901_000);
    expect((await h.request("POST", "/v1/device/token", { json: { device_code: late.device_code } })).json.error).toBe("expired_token");
    expect((await h.request("POST", "/v1/device/approve", { token: jwt, json: { user_code: late.user_code } })).status).toBe(404);
  });

  it("rejects forged device codes and needs a zenvi.pro session to approve", async () => {
    const h = await harness();
    const start = (await h.request("POST", "/v1/device/code", { json: {} })).json;
    const forged = `${start.device_code.slice(0, 9)}${"A".repeat(43)}`;
    expect((await h.request("POST", "/v1/device/token", { json: { device_code: forged } })).json.error).toBe("invalid_grant");
    expect((await h.request("POST", "/v1/device/token", { json: { device_code: "nonsense" } })).json.error).toBe("invalid_grant");

    expect((await h.request("POST", "/v1/device/approve", { json: { user_code: start.user_code } })).status).toBe(401);
    const { token: pat } = await h.services.tokens.createPat({ userId: USER_A, name: "x", scopes: ["projects.read", "projects.write"], ttlDays: 1 });
    expect((await h.request("POST", "/v1/device/approve", { token: pat, json: { user_code: start.user_code } })).status).toBe(403);
  });

  it("stops answering after repeated wrong codes", async () => {
    const h = await harness();
    const jwt = await h.userToken(USER_A);
    for (let i = 0; i < 10; i += 1) {
      expect((await h.request("POST", "/v1/device/approve", { token: jwt, json: { user_code: "BBBB-BBBB" } })).status).toBe(404);
    }
    const limited = await h.request("POST", "/v1/device/approve", { token: jwt, json: { user_code: "BBBB-BBBB" } });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("normalizes typed user codes", () => {
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK");
    expect(normalizeUserCode(" BCDF GHJK ")).toBe("BCDFGHJK");
    expect(normalizeUserCode("AEIO-UUUU")).toBeNull();
    expect(normalizeUserCode("BCD")).toBeNull();
  });
});
