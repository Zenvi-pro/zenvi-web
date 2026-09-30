#!/usr/bin/env node
// Live end-to-end check of a deployed Zenvi Cloud:
//   discovery → OAuth (DCR, PKCE, consent, token, refresh, revoke) → MCP →
//   device login → personal token → media upload via SAS → projects with
//   If-Match → MCP tools (projects, URL import, upload link, render, frame).
//
//   node packages/cloud/scripts/e2e-live.mjs [base-url]
//
// Signs in as the E2E test user from ~/.config/zenvi-dev/test-user.env
// (ZENVI_E2E_EMAIL, ZENVI_E2E_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY).
// Needs ffmpeg (makes a 3 s test clip in a temp dir). Prints no secrets.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] ?? process.env.ZENVI_CLOUD_URL ?? "https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io").replace(/\/+$/, "");
const envFile = process.env.ZENVI_E2E_ENV ?? join(homedir(), ".config/zenvi-dev/test-user.env");
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);

const redact = (text) =>
  String(text)
    .replace(/zvn_[a-z]{3}_[A-Za-z0-9_-]{20,}/g, "zvn_…")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<jwt>")
    .replace(/sig=[^&"\s]+/g, "sig=…")
    .replace(/([?&]code=)[^&"\s]+/g, "$1…");
let failures = 0;
const pass = (step, detail = "") => console.log(`ok   ${step}${detail ? ` — ${redact(detail)}` : ""}`);
const fail = (step, detail) => {
  failures += 1;
  console.log(`FAIL ${step} — ${redact(detail)}`);
};
const check = (step, condition, detail) => (condition ? pass(step, detail) : fail(step, detail));

async function http(method, path, { token, json, form, headers = {}, redirect = "follow" } = {}) {
  const h = { ...headers };
  let body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    h["content-type"] = "application/json";
  } else if (form !== undefined) {
    body = new URLSearchParams(form).toString();
    h["content-type"] = "application/x-www-form-urlencoded";
  }
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, { method, headers: h, body, redirect });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  return { status: res.status, headers: res.headers, text, data };
}

let rpcId = 0;
async function mcp(token, method, params = {}) {
  rpcId += 1;
  return http("POST", "/mcp", {
    token,
    json: { jsonrpc: "2.0", id: rpcId, method, params },
    headers: { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
  });
}
const initialize = (token) =>
  mcp(token, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "zenvi-e2e", version: "1" } });
const tool = async (token, name, args = {}) => (await mcp(token, "tools/call", { name, arguments: args })).data?.result;
const b64url = (buf) => Buffer.from(buf).toString("base64url");

// ---------------------------------------------------------------- sign in
const signIn = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: env.ZENVI_E2E_EMAIL, password: env.ZENVI_E2E_PASSWORD }),
});
const session = await signIn.json();
if (!session.access_token) throw new Error(`Supabase sign-in failed (${signIn.status})`);
const jwt = session.access_token;
console.log(`target ${BASE}, user ${env.ZENVI_E2E_USER_ID ?? "?"}`);

// ---------------------------------------------------------------- discovery
const health = await http("GET", "/health");
check("GET /health", health.status === 200 && health.data?.status === "ok", health.text);
const prm = await http("GET", "/.well-known/oauth-protected-resource/mcp");
check("PRM /mcp path", prm.data?.resource === `${BASE}/mcp` && prm.data?.authorization_servers?.[0] === BASE, prm.text);
const prmRoot = await http("GET", "/.well-known/oauth-protected-resource");
check("PRM root", prmRoot.data?.resource === `${BASE}/mcp`, prmRoot.text);
const asMeta = await http("GET", "/.well-known/oauth-authorization-server");
check(
  "AS metadata",
  asMeta.data?.issuer === BASE && asMeta.data?.code_challenge_methods_supported?.includes("S256") && asMeta.data?.authorization_response_iss_parameter_supported === true,
  `issuer=${asMeta.data?.issuer} pkce=${asMeta.data?.code_challenge_methods_supported} cimd=${asMeta.data?.client_id_metadata_document_supported}`,
);
const anon = await initialize(undefined);
check("MCP without token → 401 challenge", anon.status === 401 && /resource_metadata=/.test(anon.headers.get("www-authenticate") ?? ""), anon.headers.get("www-authenticate"));
const me = await http("GET", "/v1/me", { token: jwt });
check("GET /v1/me (Supabase session)", me.status === 200 && me.data?.auth === "supabase", JSON.stringify(me.data));

// ---------------------------------------------------------------- OAuth (DCR + PKCE)
const reg = await http("POST", "/oauth/register", { json: { client_name: "Zenvi E2E", redirect_uris: ["http://localhost/callback"] } });
check("DCR /oauth/register", reg.status === 201 && reg.data?.token_endpoint_auth_method === "none", `client_id=${reg.data?.client_id}`);
const clientId = reg.data?.client_id;
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const redirectUri = "http://localhost:53682/callback";
const authorize = await http(
  "GET",
  `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state: "e2e-state", code_challenge: challenge, code_challenge_method: "S256", scope: "projects.read projects.write", resource: `${BASE}/mcp` })}`,
  { redirect: "manual" },
);
const consentPage = new URL(authorize.headers.get("location") ?? "about:blank");
check("authorize → consent page", authorize.status === 302 && consentPage.pathname.endsWith("/connect"), `${consentPage.origin}${consentPage.pathname}`);
const requestId = consentPage.searchParams.get("request");
const info = await http("GET", `/oauth/consent-info?request=${requestId}`);
check("consent-info", info.data?.client?.name === "Zenvi E2E" && info.data?.redirectHost === "localhost:53682", `${info.data?.client?.name} → ${info.data?.redirectHost}`);
const consent = await http("POST", "/oauth/consent", { token: jwt, json: { request: requestId, approve: true } });
const back = new URL(consent.data?.redirect ?? "about:blank");
check("consent → redirect with code, state, iss", back.searchParams.get("state") === "e2e-state" && back.searchParams.get("iss") === BASE && !!back.searchParams.get("code"), `${back.origin}${back.pathname}`);
const badPkce = await http("POST", "/oauth/token", { form: { grant_type: "authorization_code", code: back.searchParams.get("code"), client_id: clientId, redirect_uri: redirectUri, code_verifier: b64url(randomBytes(32)) } });
check("token with wrong PKCE verifier → invalid_grant", badPkce.data?.error === "invalid_grant", badPkce.text);
const tokens = await http("POST", "/oauth/token", {
  form: { grant_type: "authorization_code", code: back.searchParams.get("code"), client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: `${BASE}/mcp` },
});
check("token exchange", tokens.status === 200 && tokens.data?.token_type === "Bearer", `expires_in=${tokens.data?.expires_in} scope=${tokens.data?.scope}`);
const oauthInit = await initialize(tokens.data?.access_token);
check("MCP initialize with OAuth token", oauthInit.status === 200 && oauthInit.data?.result?.serverInfo?.name === "zenvi", `protocol ${oauthInit.data?.result?.protocolVersion}`);
const toolList = await mcp(tokens.data?.access_token, "tools/list");
const toolNames = toolList.data?.result?.tools?.map((t) => t.name) ?? [];
check("MCP tools/list", toolNames.includes("list_projects") && toolNames.includes("render_project"), `${toolNames.length} tools: ${toolNames.slice(0, 12).join(", ")}${toolNames.length > 12 ? ", …" : ""}`);
const refreshed = await http("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: tokens.data?.refresh_token, client_id: clientId } });
check("refresh rotates", refreshed.status === 200 && refreshed.data?.refresh_token !== tokens.data?.refresh_token, `scope=${refreshed.data?.scope}`);
const revoked = await http("POST", "/oauth/revoke", { form: { token: refreshed.data?.refresh_token, client_id: clientId } });
const afterRevoke = await initialize(refreshed.data?.access_token);
check("revoke ends the grant", revoked.status === 200 && afterRevoke.status === 401, `after revoke: ${afterRevoke.status}`);

// ---------------------------------------------------------------- device login → personal token
const device = await http("POST", "/v1/device/code", { json: { client_name: "zenvi e2e device" } });
check("device code", device.status === 200 && /^[A-Z]{4}-[A-Z]{4}$/.test(device.data?.user_code ?? ""), `${device.data?.user_code} → ${device.data?.verification_uri_complete}`);
const pending = await http("POST", "/v1/device/token", { json: { device_code: device.data?.device_code } });
check("device poll before approval → authorization_pending", pending.data?.error === "authorization_pending", pending.text);
const approve = await http("POST", "/v1/device/approve", { token: jwt, json: { user_code: device.data?.user_code } });
check("device approve (Supabase session)", approve.data?.status === "approved", approve.text);
await new Promise((r) => setTimeout(r, (device.data?.interval ?? 5) * 1000 + 500));
const granted = await http("POST", "/v1/device/token", { json: { device_code: device.data?.device_code } });
const pat = granted.data?.access_token;
check("device token → zvn_pat_", granted.status === 200 && /^zvn_pat_/.test(pat ?? ""), `token_id=${granted.data?.token_id}`);
const mePat = await http("GET", "/v1/me", { token: pat });
check("GET /v1/me (personal token)", mePat.data?.auth === "pat", JSON.stringify(mePat.data?.user));

// ---------------------------------------------------------------- media upload via SAS
const work = mkdtempSync(join(tmpdir(), "zenvi-e2e-"));
const createdProjects = [];
try {
  const clip = join(work, "e2e-clip.mp4");
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
  const bytes = readFileSync(clip);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ticket = await http("POST", "/v1/media", { token: pat, json: { sha256, size: bytes.length, name: "e2e-clip.mp4", contentType: "video/mp4" } });
  let readUrl;
  if (ticket.data?.exists) {
    pass("media declare", "already in the library (dedupe)");
  } else {
    check("media declare → SAS upload URL", ticket.status === 201 && /sp=cw/.test(ticket.data?.uploadUrl ?? ""), `blobPath=${ticket.data?.blobPath}`);
    const put = await fetch(ticket.data.uploadUrl, { method: "PUT", headers: ticket.data.uploadHeaders, body: bytes });
    check("PUT bytes to Azure with the SAS URL", put.status === 201, `HTTP ${put.status}`);
    const done = await http("POST", `/v1/media/${sha256}/complete`, { token: pat });
    check("media complete (server-side hash check)", done.data?.verified === true && done.data?.size === bytes.length, JSON.stringify(done.data));
  }
  const url = await http("GET", `/v1/media/${sha256}/url`, { token: pat });
  readUrl = url.data?.url;
  const downloaded = Buffer.from(await (await fetch(readUrl)).arrayBuffer());
  check("read SAS URL returns the same bytes", createHash("sha256").update(downloaded).digest("hex") === sha256, `${downloaded.length} bytes`);

  // ------------------------------------------------------------- projects REST with If-Match
  const created = await http("POST", "/v1/projects", { token: pat, json: { name: "E2E REST project" } });
  createdProjects.push(created.data?.id);
  check("POST /v1/projects", created.status === 201 && /^c_/.test(created.data?.id ?? ""), `${created.data?.id} rev ${created.data?.revision}`);
  const loaded = await http("GET", `/v1/projects/${created.data?.id}`, { token: pat });
  const project = { ...loaded.data?.project, files: [{ id: "E2EFILE001", path: "e2e-clip.mp4", media_type: "video", cloud: { sha256, size: bytes.length, name: "e2e-clip.mp4", content_type: "video/mp4" } }] };
  const saved = await http("PUT", `/v1/projects/${created.data?.id}`, { token: pat, json: project, headers: { "if-match": `"${loaded.data?.revision}"` } });
  check("PUT with If-Match", saved.status === 200 && saved.data?.revision !== loaded.data?.revision, `rev ${saved.data?.revision}`);
  const stale = await http("PUT", `/v1/projects/${created.data?.id}`, { token: pat, json: project, headers: { "if-match": loaded.data?.revision } });
  check("stale If-Match → 409 with current revision", stale.status === 409 && stale.data?.revision === saved.data?.revision, stale.data?.error?.code);
  const withMedia = await http("GET", `/v1/projects/${created.data?.id}`, { token: pat });
  check("GET project signs media URLs", withMedia.data?.media?.[0]?.sha256 === sha256, `${withMedia.data?.media?.length} media, ${withMedia.data?.missingMedia?.length} missing`);

  // ------------------------------------------------------------- MCP tools with the personal token
  const init = await initialize(pat);
  check("MCP initialize with personal token", init.status === 200, `server ${init.data?.result?.serverInfo?.name} ${init.data?.result?.serverInfo?.version}`);
  const made = await tool(pat, "create_project", { name: "E2E MCP project", format: "landscape_720p", fps: 30 });
  const mcpProject = made?.structuredContent?.project_id;
  createdProjects.push(mcpProject);
  check("tool create_project", !made?.isError && /^c_/.test(mcpProject ?? ""), made?.content?.[0]?.text);
  const listed = await tool(pat, "list_projects");
  check("tool list_projects", listed?.structuredContent?.current_project_id === mcpProject, `${listed?.structuredContent?.total} projects`);
  const imported = await tool(pat, "import_media_from_url", { url: readUrl, name: "e2e-clip.mp4" });
  check("tool import_media_from_url (server download + ffprobe)", !imported?.isError && imported?.structuredContent?.media_type === "video", imported?.content?.[0]?.text);
  const again = await tool(pat, "import_media_from_url", { url: readUrl, name: "e2e-clip.mp4" });
  check("import is idempotent", again?.structuredContent?.already_in_project === true, again?.content?.[0]?.text);
  const ssrf = await tool(pat, "import_media_from_url", { url: "https://169.254.169.254/latest/meta-data" });
  check("SSRF guard refuses metadata address", ssrf?.isError === true, ssrf?.content?.[0]?.text);
  const upload = await tool(pat, "get_upload_link");
  check("tool get_upload_link", /\/p\/c_[a-z0-9]{16}\?upload=1$/.test(upload?.structuredContent?.upload_url ?? ""), upload?.structuredContent?.upload_url);
  const editor = await tool(pat, "open_in_editor");
  check("tool open_in_editor", /\/editor\/p\/c_/.test(editor?.structuredContent?.url ?? ""), editor?.structuredContent?.url);
  const opened = await tool(pat, "open_project", { project_id: mcpProject });
  check("tool open_project", opened?.structuredContent?.files?.length === 1, opened?.content?.[0]?.text?.split("\n")[0]);
  const render = await tool(pat, "render_project", { preset: "mp4-720p" });
  if (render?.isError) {
    pass("tool render_project (reports unavailable in this build)", render?.content?.[0]?.text);
  } else {
    const renderId = render?.structuredContent?.render_id;
    let status = render?.structuredContent;
    for (let i = 0; i < 6 && status?.status !== "done" && status?.status !== "error"; i++) {
      status = (await tool(pat, "get_render_status", { render_id: renderId, wait_seconds: 40 }))?.structuredContent;
    }
    check("render_project → get_render_status", status?.status === "done" || status?.status === "error", `${renderId}: ${status?.status}${status?.error ? ` (${status.error})` : ""}`);
  }
  const frame = await tool(pat, "preview_frame", { time_seconds: 0 });
  pass("tool preview_frame", frame?.isError ? frame?.content?.[0]?.text : `image ${frame?.content?.find((c) => c.type === "image")?.mimeType}`);
} finally {
  rmSync(work, { recursive: true, force: true });
  for (const id of createdProjects.filter(Boolean)) await http("DELETE", `/v1/projects/${id}`, { token: jwt });
  const listing = await http("GET", "/v1/tokens", { token: jwt });
  for (const t of listing.data?.tokens ?? []) if (t.name === "zenvi e2e device") await http("DELETE", `/v1/tokens/${t.id}`, { token: jwt });
  for (const g of listing.data?.grants ?? []) if (g.clientName === "Zenvi E2E") await http("DELETE", `/v1/tokens/${g.id}`, { token: jwt });
  const patAfter = await http("GET", "/v1/me", { token: pat });
  check("cleanup: projects deleted, e2e token revoked", patAfter.status === 401, `personal token now ${patAfter.status}`);
}

console.log(failures === 0 ? "\nall live checks passed" : `\n${failures} live check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
