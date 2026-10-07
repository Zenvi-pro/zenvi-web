import { describe, expect, it } from "vitest";
import { harness, USER_A, USER_B } from "../testing/helpers.js";

describe("/v1/tokens (account page)", () => {
  it("creates a personal token once, lists it without the secret, and deletes it", async () => {
    const h = await harness();
    const jwt = await h.userToken(USER_A, "a@example.com");
    const created = await h.request("POST", "/v1/tokens", { token: jwt, json: { name: "CI", expiresInDays: 7 } });
    expect(created.status).toBe(201);
    expect(created.json.token).toMatch(/^zvn_pat_/);
    expect(created.json).toMatchObject({ name: "CI", scopes: ["projects.read", "projects.write"] });
    expect(Date.parse(created.json.expiresAt) - h.clock.now()).toBeCloseTo(7 * 86_400_000, -3);

    const me = await h.request("GET", "/v1/me", { token: created.json.token });
    expect(me.json).toMatchObject({ auth: "pat", user: { id: USER_A, email: "a@example.com" } });

    const listed = await h.request("GET", "/v1/tokens", { token: jwt });
    expect(listed.json.tokens).toHaveLength(1);
    expect(JSON.stringify(listed.json)).not.toContain(created.json.token);

    expect((await h.request("DELETE", `/v1/tokens/${created.json.id}`, { token: jwt })).status).toBe(204);
    expect((await h.request("GET", "/v1/me", { token: created.json.token })).status).toBe(401);
    expect((await h.request("GET", "/v1/tokens", { token: jwt })).json.tokens).toEqual([]);
  });

  it("is only for zenvi.pro sessions, and only for your own tokens", async () => {
    const h = await harness();
    const a = await h.userToken(USER_A);
    const b = await h.userToken(USER_B);
    const created = await h.request("POST", "/v1/tokens", { token: a, json: { name: "mine" } });
    expect((await h.request("GET", "/v1/tokens", { token: created.json.token })).status).toBe(403);
    expect((await h.request("POST", "/v1/tokens", { token: created.json.token, json: { name: "escalate" } })).status).toBe(403);
    expect((await h.request("DELETE", `/v1/tokens/${created.json.id}`, { token: b })).status).toBe(404);
    expect((await h.request("GET", "/v1/me", { token: created.json.token })).status).toBe(200);
  });

  it("sweeps expired rows", async () => {
    const h = await harness();
    await h.services.tokens.createPat({ userId: USER_A, name: "short", scopes: ["projects.read"], ttlDays: 1 });
    h.clock.advance(3 * 86_400_000);
    expect(await h.services.tokens.sweepExpired()).toBe(2);
  });
});
