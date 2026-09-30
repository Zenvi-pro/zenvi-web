import { describe, expect, it } from "vitest";
import { type Harness, harness, USER_A } from "../testing/helpers.js";
import { randomSecret, sha256Base64Url } from "../util/crypto.js";
import { redirectUriMatches, redirectUriProblem } from "./redirect.js";

const RESOURCE = "https://cloud.test/mcp";

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomSecret(48);
  return { verifier, challenge: sha256Base64Url(verifier) };
}

async function register(h: Harness, redirectUris: string[] = ["https://client.test/callback"]): Promise<string> {
  const res = await h.request("POST", "/oauth/register", { json: { client_name: "Test Client", redirect_uris: redirectUris } });
  expect(res.status).toBe(201);
  return res.json.client_id as string;
}

function authorizeUrl(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  return `/oauth/authorize?${query.toString()}`;
}

/** authorize → consent → code. Returns the redirect back to the client. */
async function authorizeAndConsent(
  h: Harness,
  clientId: string,
  options: { redirectUri?: string; challenge: string; state?: string; resource?: string; scope?: string },
): Promise<URL> {
  const res = await h.request(
    "GET",
    authorizeUrl({
      response_type: "code",
      client_id: clientId,
      redirect_uri: options.redirectUri ?? "https://client.test/callback",
      state: options.state ?? "st4te",
      code_challenge: options.challenge,
      code_challenge_method: "S256",
      resource: options.resource ?? RESOURCE,
      scope: options.scope ?? "projects.read projects.write",
    }),
  );
  expect(res.status).toBe(302);
  const consentPage = new URL(res.headers.get("location") ?? "");
  expect(`${consentPage.origin}${consentPage.pathname}`).toBe("https://zenvi.test/editor/connect");
  const requestId = consentPage.searchParams.get("request") ?? "";
  const jwt = await h.userToken(USER_A, "a@example.com");
  const consent = await h.request("POST", "/oauth/consent", { token: jwt, json: { request: requestId, approve: true } });
  expect(consent.status).toBe(200);
  return new URL(consent.json.redirect as string);
}

async function exchange(h: Harness, clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) {
  return h.request("POST", "/oauth/token", {
    form: { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: "https://client.test/callback", code_verifier: verifier, resource: RESOURCE, ...extra },
  });
}

async function mcpInitialize(h: Harness, token: string, host = "cloud.test") {
  return h.request("POST", "/mcp", {
    token,
    headers: { accept: "application/json, text/event-stream", host },
    json: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
  });
}

describe("discovery documents", () => {
  it("serve RFC 8414 metadata with S256, CIMD and RFC 9207 iss support", async () => {
    const h = await harness();
    const res = await h.request("GET", "/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.json).toMatchObject({
      issuer: "https://cloud.test",
      authorization_endpoint: "https://cloud.test/oauth/authorize",
      token_endpoint: "https://cloud.test/oauth/token",
      registration_endpoint: "https://cloud.test/oauth/register",
      revocation_endpoint: "https://cloud.test/oauth/revoke",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(res.json.scopes_supported).toContain("offline_access");
  });

  it("serve RFC 9728 protected-resource metadata at the root and the /mcp path", async () => {
    const h = await harness();
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await h.request("GET", path);
      expect(res.json).toMatchObject({ resource: RESOURCE, authorization_servers: ["https://cloud.test"], bearer_methods_supported: ["header"] });
      expect(res.json.scopes_supported).not.toContain("offline_access");
    }
  });

  it("use the alias origin a request arrived on, and ignore unknown Host headers", async () => {
    const h = await harness({ config: { publicBaseUrlAliases: ["https://cloud.alias.test"] } });
    const alias = await h.request("GET", "/.well-known/oauth-protected-resource", { headers: { host: "cloud.alias.test" } });
    expect(alias.json.resource).toBe("https://cloud.alias.test/mcp");
    const evil = await h.request("GET", "/.well-known/oauth-protected-resource", { headers: { host: "evil.test" } });
    expect(evil.json.resource).toBe(RESOURCE);
  });
});

describe("dynamic client registration", () => {
  it("registers public clients only", async () => {
    const h = await harness();
    const res = await h.request("POST", "/oauth/register", {
      json: { client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"], token_endpoint_auth_method: "client_secret_post" },
    });
    expect(res.status).toBe(201);
    expect(res.json.client_id).toMatch(/^zc_[a-z0-9]{20}$/);
    expect(res.json.token_endpoint_auth_method).toBe("none");
    expect(res.json).not.toHaveProperty("client_secret");
  });

  it("refuses unsafe redirect URIs", async () => {
    const h = await harness();
    for (const uri of ["http://client.test/cb", "javascript:alert(1)", "https://client.test/cb#frag", "not a url"]) {
      const res = await h.request("POST", "/oauth/register", { json: { redirect_uris: [uri] } });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe("invalid_redirect_uri");
    }
    expect((await h.request("POST", "/oauth/register", { json: { client_name: "x" } })).json.error).toBe("invalid_redirect_uri");
  });
});

describe("authorization code flow", () => {
  it("issues audience-bound tokens that work on /mcp", async () => {
    const h = await harness();
    const clientId = await register(h);
    const { verifier, challenge } = pkce();
    const back = await authorizeAndConsent(h, clientId, { challenge, state: "abc" });
    expect(`${back.origin}${back.pathname}`).toBe("https://client.test/callback");
    expect(back.searchParams.get("state")).toBe("abc");
    expect(back.searchParams.get("iss")).toBe("https://cloud.test");
    const code = back.searchParams.get("code") ?? "";

    const tokens = await exchange(h, clientId, code, verifier);
    expect(tokens.status).toBe(200);
    expect(tokens.headers.get("cache-control")).toBe("no-store");
    expect(tokens.json).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "projects.read projects.write" });
    expect(tokens.json.access_token).toMatch(/^zvn_oat_/);
    expect(tokens.json.refresh_token).toMatch(/^zvn_ort_/);

    const init = await mcpInitialize(h, tokens.json.access_token);
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe("zenvi");

    // The account page lists the connection.
    const jwt = await h.userToken(USER_A);
    const listed = await h.request("GET", "/v1/tokens", { token: jwt });
    expect(listed.json.grants).toHaveLength(1);
    expect(listed.json.grants[0]).toMatchObject({ clientId, clientName: "Test Client" });
  });

  it("does not redirect for unknown clients or unregistered redirect URIs", async () => {
    const h = await harness();
    const clientId = await register(h);
    const { challenge } = pkce();
    const unknown = await h.request("GET", authorizeUrl({ response_type: "code", client_id: "zc_nope", redirect_uri: "https://client.test/callback", code_challenge: challenge, code_challenge_method: "S256" }));
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("location")).toBeNull();
    expect(unknown.text).toContain("not registered");

    const mismatch = await h.request("GET", authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: "https://attacker.test/callback", code_challenge: challenge, code_challenge_method: "S256" }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.headers.get("location")).toBeNull();
    expect(mismatch.text).toContain("redirect_uri");

    const suffix = await h.request("GET", authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: "https://client.test/callback/../evil", code_challenge: challenge, code_challenge_method: "S256" }));
    expect(suffix.status).toBe(400);
  });

  it("requires PKCE S256 and our resource, answering on the redirect with iss", async () => {
    const h = await harness();
    const clientId = await register(h);
    const { challenge } = pkce();
    const base = { response_type: "code", client_id: clientId, redirect_uri: "https://client.test/callback", state: "s1" };

    const noPkce = await h.request("GET", authorizeUrl(base));
    const noPkceUrl = new URL(noPkce.headers.get("location") ?? "");
    expect(noPkceUrl.searchParams.get("error")).toBe("invalid_request");
    expect(noPkceUrl.searchParams.get("state")).toBe("s1");
    expect(noPkceUrl.searchParams.get("iss")).toBe("https://cloud.test");

    const plain = await h.request("GET", authorizeUrl({ ...base, code_challenge: challenge, code_challenge_method: "plain" }));
    expect(new URL(plain.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_request");

    const otherResource = await h.request("GET", authorizeUrl({ ...base, code_challenge: challenge, code_challenge_method: "S256", resource: "https://other.test/mcp" }));
    expect(new URL(otherResource.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_target");

    const implicit = await h.request("GET", authorizeUrl({ ...base, response_type: "token", code_challenge: challenge, code_challenge_method: "S256" }));
    expect(new URL(implicit.headers.get("location") ?? "").searchParams.get("error")).toBe("unsupported_response_type");
  });

  it("rejects a wrong code_verifier, a wrong redirect_uri and a reused code (revoking what it issued)", async () => {
    const h = await harness();
    const clientId = await register(h);
    const { verifier, challenge } = pkce();
    const code = (await authorizeAndConsent(h, clientId, { challenge })).searchParams.get("code") ?? "";

    const badVerifier = await exchange(h, clientId, code, pkce().verifier);
    expect(badVerifier.status).toBe(400);
    expect(badVerifier.json.error).toBe("invalid_grant");
    const badRedirect = await exchange(h, clientId, code, verifier, { redirect_uri: "https://client.test/other" });
    expect(badRedirect.json.error).toBe("invalid_grant");

    const ok = await exchange(h, clientId, code, verifier);
    expect(ok.status).toBe(200);
    const replay = await exchange(h, clientId, code, verifier);
    expect(replay.json.error).toBe("invalid_grant");
    expect((await mcpInitialize(h, ok.json.access_token)).status).toBe(401);
  });

  it("expires codes and refuses other clients' codes", async () => {
    const h = await harness();
    const clientId = await register(h);
    const other = await register(h);
    const { verifier, challenge } = pkce();
    const code = (await authorizeAndConsent(h, clientId, { challenge })).searchParams.get("code") ?? "";
    expect((await exchange(h, other, code, verifier)).json.error).toBe("invalid_grant");

    const code2 = (await authorizeAndConsent(h, clientId, { challenge })).searchParams.get("code") ?? "";
    h.clock.advance(6 * 60_000);
    expect((await exchange(h, clientId, code2, verifier)).json.error).toBe("invalid_grant");
    expect((await exchange(h, "zc_unknown000000000000", code2, verifier)).status).toBe(401);
  });

  it("passes the decline back to the client", async () => {
    const h = await harness();
    const clientId = await register(h);
    const res = await h.request("GET", authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: "https://client.test/callback", state: "x", code_challenge: pkce().challenge, code_challenge_method: "S256" }));
    const requestId = new URL(res.headers.get("location") ?? "").searchParams.get("request") ?? "";
    const info = await h.request("GET", `/oauth/consent-info?request=${requestId}`);
    expect(info.json).toMatchObject({ client: { name: "Test Client", type: "registered", verifiedHost: null }, redirectHost: "client.test", resource: RESOURCE });
    expect(info.json.scopes.map((s: { name: string }) => s.name)).toEqual(["projects.read", "projects.write"]);

    expect((await h.request("POST", "/oauth/consent", { json: { request: requestId, approve: true } })).status).toBe(401);
    const jwt = await h.userToken(USER_A);
    const declined = await h.request("POST", "/oauth/consent", { token: jwt, json: { request: requestId, approve: false } });
    const back = new URL(declined.json.redirect);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("iss")).toBe("https://cloud.test");
    expect((await h.request("POST", "/oauth/consent", { token: jwt, json: { request: requestId, approve: true } })).status).toBe(409);
  });

  it("matches loopback redirect URIs on any port (Claude Code, Codex)", async () => {
    const h = await harness();
    const clientId = await register(h, ["http://localhost/callback", "http://127.0.0.1/callback"]);
    const { verifier, challenge } = pkce();
    const back = await authorizeAndConsent(h, clientId, { challenge, redirectUri: "http://localhost:53682/callback" });
    expect(back.host).toBe("localhost:53682");
    const tokens = await exchange(h, clientId, back.searchParams.get("code") ?? "", verifier, { redirect_uri: "http://localhost:53682/callback" });
    expect(tokens.status).toBe(200);
  });
});

describe("client ID metadata documents", () => {
  const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";

  it("authorize a client by its metadata URL without registration", async () => {
    const fetched: string[] = [];
    const h = await harness({
      fetchClientDocument: async (url) => {
        fetched.push(url);
        return { client_id: CLAUDE_CODE, client_name: "Claude Code", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"], token_endpoint_auth_method: "none" };
      },
    });
    const { verifier, challenge } = pkce();
    const back = await authorizeAndConsent(h, CLAUDE_CODE, { challenge, redirectUri: "http://127.0.0.1:4455/callback" });
    const tokens = await exchange(h, CLAUDE_CODE, back.searchParams.get("code") ?? "", verifier, { redirect_uri: "http://127.0.0.1:4455/callback" });
    expect(tokens.status).toBe(200);
    expect(fetched[0]).toBe(CLAUDE_CODE);
  });

  it("accept ChatGPT's document (prefers private_key_jwt, supports none)", async () => {
    const CHATGPT = "https://chatgpt.com/oauth/client.json";
    const h = await harness({
      fetchClientDocument: async () => ({
        client_id: CHATGPT,
        client_name: "ChatGPT",
        redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    const { challenge } = pkce();
    const res = await h.request("GET", authorizeUrl({ response_type: "code", client_id: CHATGPT, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE }));
    expect(res.status).toBe(302);
    const requestId = new URL(res.headers.get("location") ?? "").searchParams.get("request") ?? "";
    const info = await h.request("GET", `/oauth/consent-info?request=${requestId}`);
    expect(info.json.client).toMatchObject({ name: "ChatGPT", type: "metadata_document", verifiedHost: "chatgpt.com" });
  });

  it("refuse documents whose client_id does not match, or that need client secrets", async () => {
    const docs: Record<string, unknown> = {
      "https://a.test/client.json": { client_id: "https://b.test/client.json", redirect_uris: ["https://a.test/cb"] },
      "https://c.test/client.json": { client_id: "https://c.test/client.json", redirect_uris: ["https://c.test/cb"], token_endpoint_auth_method: "private_key_jwt" },
    };
    const h = await harness({ fetchClientDocument: async (url) => docs[url] });
    for (const [clientId, redirect] of [["https://a.test/client.json", "https://a.test/cb"], ["https://c.test/client.json", "https://c.test/cb"]] as const) {
      const res = await h.request("GET", authorizeUrl({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: pkce().challenge, code_challenge_method: "S256" }));
      expect(res.status).toBe(400);
    }
  });
});

describe("refresh tokens", () => {
  async function connected(h: Harness) {
    const clientId = await register(h);
    const { verifier, challenge } = pkce();
    const code = (await authorizeAndConsent(h, clientId, { challenge })).searchParams.get("code") ?? "";
    const tokens = (await exchange(h, clientId, code, verifier)).json;
    return { clientId, access: tokens.access_token as string, refresh: tokens.refresh_token as string };
  }
  const refresh = (h: Harness, clientId: string, token: string) =>
    h.request("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: token, client_id: clientId } });

  it("rotate on every use; a reused one ends the whole grant", async () => {
    const h = await harness();
    const { clientId, refresh: first } = await connected(h);
    const next = await refresh(h, clientId, first);
    expect(next.status).toBe(200);
    expect(next.json.refresh_token).not.toBe(first);
    expect((await mcpInitialize(h, next.json.access_token)).status).toBe(200);

    // A retry moments later (lost response) is tolerated…
    h.clock.advance(10_000);
    const retry = await refresh(h, clientId, first);
    expect(retry.status).toBe(200);
    // …but a replay later is treated as theft: everything in the family dies.
    h.clock.advance(120_000);
    const replay = await refresh(h, clientId, first);
    expect(replay.json.error).toBe("invalid_grant");
    expect((await mcpInitialize(h, next.json.access_token)).status).toBe(401);
    expect((await refresh(h, clientId, next.json.refresh_token)).json.error).toBe("invalid_grant");
  });

  it("belong to one client and cannot widen scope", async () => {
    const h = await harness();
    const { clientId, refresh: token } = await connected(h);
    const other = await register(h);
    expect((await refresh(h, other, token)).json.error).toBe("invalid_grant");
    const narrowed = await h.request("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: token, client_id: clientId, scope: "projects.read" } });
    expect(narrowed.json.scope).toBe("projects.read");
    const widened = await h.request("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: narrowed.json.refresh_token, client_id: clientId, scope: "projects.read projects.write" } });
    expect(widened.json.error).toBe("invalid_scope");
  });

  it("revoke the grant through /oauth/revoke and through the account page", async () => {
    const h = await harness();
    const { clientId, access, refresh: token } = await connected(h);
    expect((await h.request("POST", "/oauth/revoke", { form: { token, client_id: clientId } })).status).toBe(200);
    expect((await mcpInitialize(h, access)).status).toBe(401);
    expect((await refresh(h, clientId, token)).json.error).toBe("invalid_grant");

    const second = await connected(h);
    const jwt = await h.userToken(USER_A);
    const grants = (await h.request("GET", "/v1/tokens", { token: jwt })).json.grants;
    const active = grants.find((g: { clientId: string }) => g.clientId === second.clientId);
    expect((await h.request("DELETE", `/v1/tokens/${active.id}`, { token: jwt })).status).toBe(204);
    expect((await mcpInitialize(h, second.access)).status).toBe(401);
  });
});

describe("redirect URI rules", () => {
  it("allow https, loopback http and private-use schemes", () => {
    expect(redirectUriProblem("https://chatgpt.com/connector_platform_oauth_redirect")).toBeNull();
    expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:33418/")).toBeNull();
    expect(redirectUriProblem("http://[::1]/cb")).toBeNull();
    expect(redirectUriProblem("vscode://vscode.github-authentication/did-authenticate")).toBeNull();
    expect(redirectUriProblem("http://example.com/cb")).not.toBeNull();
    expect(redirectUriProblem("data:text/html,hi")).not.toBeNull();
  });

  it("match exactly except the loopback port", () => {
    expect(redirectUriMatches(["https://a.test/cb"], "https://a.test/cb")).toBe(true);
    expect(redirectUriMatches(["https://a.test/cb"], "https://a.test/cb/")).toBe(false);
    expect(redirectUriMatches(["https://a.test/cb"], "https://a.test:8443/cb")).toBe(false);
    expect(redirectUriMatches(["http://localhost/callback"], "http://localhost:1234/callback")).toBe(true);
    expect(redirectUriMatches(["http://localhost/callback"], "http://localhost:1234/other")).toBe(false);
    expect(redirectUriMatches(["http://localhost/callback"], "http://127.0.0.1:1234/callback")).toBe(false);
  });
});
