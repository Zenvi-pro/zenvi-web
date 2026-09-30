import { createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { harness, SUPABASE_URL, supabaseToken, testKeys, USER_A } from "../testing/helpers.js";
import { sha256Hex } from "../util/crypto.js";
import { createSupabaseVerifier } from "./supabase.js";
import { bearerToken, generateToken, hashToken, tokenKind } from "./tokens.js";

async function verifier() {
  const keys = await testKeys();
  return createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, keys: createLocalJWKSet({ keys: [keys.jwk] }) });
}

describe("Supabase access tokens", () => {
  it("accepts a valid ES256 token and returns the user", async () => {
    const token = await supabaseToken({ sub: USER_A, email: "a@example.com" });
    expect(await (await verifier()).verify(token)).toMatchObject({ id: USER_A, email: "a@example.com" });
  });

  it("rejects expired, wrong-audience, wrong-issuer and anonymous tokens", async () => {
    const v = await verifier();
    expect(await v.verify(await supabaseToken({ sub: USER_A, expiresIn: -120 }))).toBeNull();
    expect(await v.verify(await supabaseToken({ sub: USER_A, aud: "anon" }))).toBeNull();
    expect(await v.verify(await supabaseToken({ sub: USER_A, iss: "https://evil.test/auth/v1" }))).toBeNull();
    expect(await v.verify(await supabaseToken({ sub: USER_A, isAnonymous: true }))).toBeNull();
  });

  it("rejects tokens signed by another key and non-JWT strings", async () => {
    const { generateKeyPair, SignJWT } = await import("jose");
    const other = await generateKeyPair("ES256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(USER_A)
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(other.privateKey);
    const v = await verifier();
    expect(await v.verify(forged)).toBeNull();
    expect(await v.verify("not-a-jwt")).toBeNull();
    // alg=none / HS256 tokens are refused outright.
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(`{"sub":"${USER_A}"}`).toString("base64url")}.`;
    expect(await v.verify(unsigned)).toBeNull();
  });
});

describe("Zenvi tokens", () => {
  it("have a kind prefix, 43 random characters, and are stored only as SHA-256", async () => {
    const { token, hash } = generateToken("pat");
    expect(token).toMatch(/^zvn_pat_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(sha256Hex(token));
    expect(hashToken(token)).toBe(hash);
    expect(tokenKind(token)).toBe("pat");
    expect(tokenKind("zvn_pat_short")).toBeNull();
    expect(tokenKind(generateToken("oauth_access").token)).toBe("oauth_access");
    expect(tokenKind(generateToken("oauth_refresh").token)).toBe("oauth_refresh");

    const h = await harness();
    const { token: pat } = await h.services.tokens.createPat({ userId: USER_A, name: "cli", scopes: ["projects.read"], ttlDays: 30 });
    // No stored row contains the token itself.
    const rows: unknown[] = [];
    for await (const row of h.tables.query("tokens", {})) rows.push(row);
    expect(JSON.stringify(rows)).not.toContain(pat);
    expect(JSON.stringify(rows)).toContain(hashToken(pat));
  });

  it("reads bearer tokens only from the Authorization header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it("stop working when revoked or expired", async () => {
    const h = await harness();
    const { token, info } = await h.services.tokens.createPat({ userId: USER_A, name: "cli", scopes: ["projects.read", "projects.write"], ttlDays: 1 });
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(200);
    h.clock.advance(2 * 86_400_000);
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(401);

    const second = await h.services.tokens.createPat({ userId: USER_A, name: "cli", scopes: ["projects.read", "projects.write"], ttlDays: 30 });
    expect((await h.request("GET", "/v1/me", { token: second.token })).status).toBe(200);
    expect(await h.services.tokens.revokePat(USER_A, second.info.id)).toBe(true);
    expect((await h.request("GET", "/v1/me", { token: second.token })).status).toBe(401);
    expect(info.id).toMatch(/^tok_/);
  });
});

describe("/v1 authentication", () => {
  it("requires a bearer token and says how to authenticate", async () => {
    const h = await harness();
    const res = await h.request("GET", "/v1/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect(res.json.error.code).toBe("unauthorized");
  });

  it("accepts Supabase sessions and personal tokens, refuses OAuth connector tokens", async () => {
    const h = await harness();
    const jwt = await h.userToken(USER_A, "a@example.com");
    const me = await h.request("GET", "/v1/me", { token: jwt });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ user: { id: USER_A, email: "a@example.com" }, auth: "supabase" });

    const pair = await h.services.tokens.issuePair({
      userId: USER_A,
      clientId: "zc_aaaaaaaaaaaaaaaaaaaa",
      clientName: "Test",
      scopes: ["projects.read", "projects.write"],
      resource: "https://cloud.test/mcp",
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 86400,
    });
    const refused = await h.request("GET", "/v1/me", { token: pair.accessToken });
    expect(refused.status).toBe(401);
    expect(refused.json.error.message).toContain("MCP");
    expect((await h.request("GET", "/v1/me", { token: pair.refreshToken })).status).toBe(401);
  });
});
