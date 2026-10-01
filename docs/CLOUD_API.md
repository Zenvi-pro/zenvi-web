# Zenvi Cloud API

Zenvi Cloud (`packages/cloud`) stores projects and media for every Zenvi
surface (web editor, desktop, `zenvi` CLI), runs renders, logs in the CLI and
desktop with a device code, and serves the remote MCP endpoint that ChatGPT
and Claude connect to (see [CONNECTORS.md](CONNECTORS.md)).

| | |
| --- | --- |
| Base URL | `https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io` (later `https://cloud.zenvi.pro`, see CONNECTORS.md) |
| REST | `/v1/…` — JSON, camelCase fields |
| Device login | `/v1/device/…` — RFC 8628 field names (snake_case) |
| OAuth | `/oauth/…`, `/.well-known/…` — RFC field names |
| MCP | `POST /mcp` — Streamable HTTP, stateless |
| Source | `packages/cloud/src/routes/*.ts` |

## 1. Conventions

**Authentication.** Every `/v1` route needs `Authorization: Bearer <token>`:

| Token | Who has it | Accepted on |
| --- | --- | --- |
| Supabase access token (ES256 JWT, `aud=authenticated`) | web editor, website, desktop (existing Supabase session) | `/v1/*`, `/oauth/consent` (not `/mcp`) |
| `zvn_pat_…` personal access token | CLI and desktop after device login, account page | `/v1/*` except `/v1/tokens`, and `/mcp` |
| `zvn_oat_…` OAuth access token (1 h) | MCP connectors | `/mcp` only (audience-bound, RFC 8707) |

Tokens are never accepted in query strings. Zenvi tokens are 32 random bytes
behind a prefix; only their SHA-256 is stored. Personal tokens carry the scopes
`projects.read projects.write`.

A missing or bad token gets `401` with `WWW-Authenticate: Bearer …`. A valid
token that may not use an endpoint gets `403`.

**Errors.** REST errors are
`{ "error": { "code": "not_found", "message": "Project not found" }, …extra }`:

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid_request` | bad JSON, failed validation (message names the field) |
| 401 | `unauthorized` | no/invalid token |
| 403 | `forbidden`, `insufficient_scope`, `project_limit` | credential not allowed here |
| 404 | `not_found` | missing — or not yours (other users' objects are indistinguishable from missing) |
| 409 | `revision_conflict` (+ `revision`), `code_used`, `request_used`, `media_missing` | state changed |
| 413 | `too_large`, `file_too_large`, `quota_exceeded` (+ `usedBytes`, `quotaBytes`) | limits |
| 415 | `unsupported_media_type` | content type not allowed |
| 422 | `invalid_project` (+ `issues`), `hash_mismatch`, `size_mismatch` | content rejected |
| 428 | `precondition_required` | `PUT` without `If-Match` |
| 429 | `rate_limited` (+ `Retry-After` header) | too many requests |
| 503 | `unavailable`, `busy` | feature not in this build / retry |

**Ids.** Projects `c_` + 16 `[a-z0-9]` (the editor route `/editor/p/c_…`),
renders `r_…`, personal tokens `tok_…`, OAuth grants `grant_…`, OAuth clients
`zc_…`. Media are addressed by lowercase hex SHA-256. Times are ISO 8601 UTC.

**CORS.** `/v1` and `/oauth/consent*` allow `https://zenvi.pro`,
`https://www.zenvi.pro`, `https://*.vercel.app`, `http://localhost:*`,
`http://127.0.0.1:*` (env `CORS_ORIGINS`) and expose `ETag`, `Retry-After`,
`WWW-Authenticate`. Discovery, registration, token and revocation endpoints
allow any origin (no cookies are used anywhere).

## 2. Health and account

`GET /health` (no auth):

```json
{ "status": "ok", "service": "zenvi-cloud", "version": "83a7eb8…", "uptimeSeconds": 12,
  "storage": "azure", "renderer": true, "frames": true, "imports": true, "engineTools": 0 }
```

`renderer` / `frames` / `imports` say whether renders, frame previews and URL
imports work in this build; `engineTools` counts engine editing tools on `/mcp`.

`GET /v1/me`:

```json
{ "user": { "id": "0b8d…", "email": "a@example.com" }, "auth": "supabase",
  "usage": { "bytes": 1048576, "quotaBytes": 21474836480, "maxFileBytes": 4294967296 } }
```

## 3. Projects

A cloud project is the desktop project JSON (`.zvn`) stored as a blob; its
ETag is the project's **revision**. Unknown keys are preserved.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/v1/projects` | | `{ projects: Summary[] }`, most recently updated first |
| POST | `/v1/projects` | `{ name?, project? }` | `201 Summary` + `ETag`. No `project` = empty desktop default project (HD 720p 30 fps) |
| GET | `/v1/projects/:id` | | `Summary & { project, media, missingMedia }` + `ETag` |
| PUT | `/v1/projects/:id` | project JSON, header `If-Match: <revision>` | `{ id, revision, updatedAt, stats }` + `ETag` |
| PATCH | `/v1/projects/:id` | `{ name }` | `Summary` |
| DELETE | `/v1/projects/:id` | | `204`; deletes the project, its renders and frames (media stays: it is shared by hash) |

```jsonc
// Summary
{ "id": "c_4k2m9q0x7v1b3n5d", "name": "Holiday cut", "createdAt": "…", "updatedAt": "…",
  "revision": "0x8DCE1F…",             // opaque; send it back in If-Match (quotes optional)
  "stats": { "clips": 12, "files": 5, "duration": 94.5, "width": 1920, "height": 1080, "fps": 30 },
  "editorUrl": "https://zenvi.pro/editor/p/c_4k2m9q0x7v1b3n5d" }
```

`GET /v1/projects/:id` also returns, for every `project.files[]` entry whose
bytes are in the cloud (matched by `file.cloud.sha256`, else
`file.fingerprint.sha256`):

```jsonc
"media": [{ "fileId": "F1A2B3C4D5", "sha256": "…", "name": "beach.mp4", "contentType": "video/mp4",
            "size": 10485760, "url": "https://zenvicloud.blob.core.windows.net/…&sig=…", "expiresAt": "…" }],
"missingMedia": [{ "fileId": "F9…", "name": "local.mov", "reason": "not_in_cloud" },      // no hash
                 { "fileId": "F7…", "name": "b.mp4", "sha256": "…", "reason": "not_uploaded" }]
```

Read URLs are SAS URLs for one blob, valid 1 h, served with the declared
content type and `Content-Disposition: attachment`; they support HTTP range
requests, so the editor can decode without downloading whole files.

**Saving.** `PUT` requires `If-Match`. Send the revision you loaded; `*`
overwrites whatever is there. On a stale revision you get
`409 { "error": { "code": "revision_conflict", … }, "revision": "<current>" }`:
reload, reapply, save again. Bodies are validated (`422 invalid_project`) and
capped at 20 MB (`MAX_PROJECT_BYTES`).

## 4. Media

Media are content-addressed per user: `u/{userId}/media/{sha256}`. The same
bytes are stored once and shared by all of that user's projects. Clients put
the hash into the project file entry as
`file.cloud = { sha256, size, content_type, name }` (keep
`fingerprint.sha256` too, as the desktop does).

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/media/check` | `{ sha256: string[] }` (≤ 1000) | `{ existing: [], missing: [] }` |
| POST | `/v1/media` | `{ sha256, size, name, contentType }` | `201 UploadTicket` (or `200 { exists: true }`) |
| PUT | `uploadUrl` (Azure) | the bytes | see below |
| POST | `/v1/media/:sha256/complete` | | `MediaInfo` |
| GET | `/v1/media/:sha256/url` | | `{ url, expiresAt }` (1 h read SAS) |

```jsonc
// UploadTicket
{ "sha256": "…", "blobPath": "u/0b8d…/media/…", "exists": false,
  "uploadUrl": "https://zenvicloud.blob.core.windows.net/zenvi/u/…?sv=…&sp=cw&sig=…",
  "uploadExpiresAt": "…",                                      // 1 h
  "uploadHeaders": { "x-ms-blob-type": "BlockBlob", "Content-Type": "video/mp4" } }
```

Upload with the SAS URL (it is valid for exactly that blob, create+write):

- up to a few hundred MB: one `PUT uploadUrl` with `uploadHeaders`;
- larger files: Azure blocks — `PUT uploadUrl&comp=block&blockid=<base64 id>`
  per chunk (≤ 100 MB each, 8 MB is a good size), then
  `PUT uploadUrl&comp=blocklist` with
  `<BlockList><Latest>id</Latest>…</BlockList>` and header
  `x-ms-blob-content-type`. Blob CORS allows browser uploads.

Then call `complete`. It checks the size against the declaration and, for
files up to 64 MB, the SHA-256 (`422 size_mismatch` / `hash_mismatch` delete
the blob; upload again). Only completed media count as existing.
`MediaInfo = { sha256, size, name, contentType, verified, uploadedAt }`
(`verified` = hash checked server-side).

**Limits.** 4 GB per file, 20 GB per user (media + projects + renders)
(`MAX_FILE_BYTES`, `MAX_USER_BYTES`). Allowed types: `video/*`, `audio/*`,
`image/*` (SVG included), `application/ogg`, `application/mp4`,
`application/mxf`, `application/x-subrip`, `text/vtt`,
`application/octet-stream`. Anything else is `415`.

**Push from the desktop / CLI.** Hash each file → `media/check` → for each
missing hash: `POST /v1/media`, upload, `complete` → set `file.cloud` in the
project → `POST /v1/projects {name, project}` (or `PUT` with `If-Match`) →
open `editorUrl`.

## 5. Renders

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/v1/projects/:id/renders` | `{ preset?, options? }` | `202 Render` |
| GET | `/v1/projects/:id/renders` | | `{ renders: Render[] }` (latest 50) |
| GET | `/v1/projects/:id/renders/:renderId` | | `Render` (+ `url` when done) |

Presets: `mp4` (project size, default), `mp4-2160p`, `mp4-1080p`, `mp4-720p`,
`webm`, `gif` (360p), `mp3`, `wav`. `options` (all optional) override the
preset: `format` (`mp4 webm mov mkv gif mp3 wav`), `width`, `height` (the
other follows the project aspect), `fps {num,den}`, `quality`
(`low medium high lossless`), `videoBitrate`, `audioBitrate`, `sampleRate`,
`channels`, `range {start,end}` (seconds).

```jsonc
// Render
{ "renderId": "r_…", "projectId": "c_…", "status": "queued" | "running" | "done" | "error",
  "progress": 0.42, "format": "mp4", "options": { "format": "mp4", "width": 1280, "height": 720, "fps": { "num": 30, "den": 1 }, "quality": "medium" },
  "revision": "0x8D…", "createdAt": "…", "startedAt": "…", "finishedAt": null, "bytes": null, "error": null,
  "url": "https://…sig=…", "urlExpiresAt": "…" }   // url only when done (1 h; GET again for a fresh one)
```

A render snapshots the project revision it was asked for; later edits do not
change it. Asking again for the same revision and options returns the
existing job (queued, running, or done within 24 h). Jobs run one at a time in
the service; a restart re-queues interrupted jobs. Every clip's media must be
in the cloud (`409`-style job error `"…" is not in Zenvi Cloud yet`). Output:
`u/{user}/p/{project}/renders/{renderId}.{ext}`, downloaded as
`<project name>.<ext>`.

## 6. Device login (CLI, desktop)

RFC 8628. The device shows a code; the person approves it on the web editor;
the device receives a personal access token.

1. `POST /v1/device/code` `{ "client_name": "zenvi CLI on my-laptop" }` (JSON or form, no auth):

   ```json
   { "device_code": "BCDFGHJK.ZXj…", "user_code": "BCDF-GHJK",
     "verification_uri": "https://zenvi.pro/editor/device",
     "verification_uri_complete": "https://zenvi.pro/editor/device?code=BCDF-GHJK",
     "interval": 5, "expires_in": 900 }
   ```

2. Show `user_code`, open `verification_uri_complete`.
3. Poll `POST /v1/device/token` `{ "device_code": "…" }` (optionally
   `grant_type=urn:ietf:params:oauth:grant-type:device_code`) every
   `interval` seconds. Until approved: `400 { "error": "authorization_pending" }`;
   polling faster: `slow_down` (add 5 s to the interval); declined:
   `access_denied`; after 15 min: `expired_token`; unknown/used code:
   `invalid_grant`. On approval (once):

   ```json
   { "access_token": "zvn_pat_…", "token_type": "bearer", "scope": "projects.read projects.write",
     "token_id": "tok_…", "user": { "id": "0b8d…", "email": "a@example.com" } }
   ```

   Device tokens last 365 days; revoke them on the account page.

**Editor page `/editor/device`** (signed in with Supabase):
`GET /v1/device/info?user_code=BCDF-GHJK` →
`{ userCode, clientName, status: "pending"|"approved"|"denied"|"consumed", expiresAt }`,
then `POST /v1/device/approve { "user_code": "BCDF-GHJK", "approve": true }`
(`approve: false` declines) → `{ status, clientName }`. Codes are accepted with
or without the dash, any case. After 10 wrong codes in 10 minutes the person
gets `429`.

## 7. Personal tokens and connected apps (account page)

Supabase session only (a personal token cannot mint or list tokens).

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/v1/tokens` | | `{ tokens: Pat[], grants: Grant[] }` |
| POST | `/v1/tokens` | `{ name, expiresInDays? }` (1–365, default 90; `null` = no expiry) | `201 Pat & { token }` — the only time the secret is shown |
| DELETE | `/v1/tokens/:id` | | `204`; `tok_…` revokes a token, `grant_…` disconnects an app (all its tokens) |

`Pat = { id, name, scopes, createdAt, lastUsedAt?, expiresAt? }`,
`Grant = { id, clientId, clientName, scopes, resource, createdAt, lastUsedAt? }`.

## 8. OAuth 2.1 (MCP connectors)

Implements the MCP authorization spec (2025-06-18 / 2025-11-25) for public
clients. Details and host requirements: [CONNECTORS.md](CONNECTORS.md).

| Endpoint | Notes |
| --- | --- |
| `GET /.well-known/oauth-protected-resource` and `…/oauth-protected-resource/mcp` | RFC 9728: `resource` = `<origin>/mcp`, one authorization server (`<origin>`), scopes `projects.read projects.write` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`, `scopes_supported` adds `offline_access` |
| `POST /oauth/register` | RFC 7591, JSON. Public clients only (`token_endpoint_auth_method` is always `none`). Redirect URIs: https, http on `localhost`/`127.0.0.1`/`[::1]`, or private-use schemes (`cursor://…`); no fragments. 30/hour/IP |
| `GET /oauth/authorize` | `response_type=code`, `client_id` (registered `zc_…` or an https client metadata document URL), `redirect_uri` (exact match; loopback ignores the port), `code_challenge` + `code_challenge_method=S256` (required), `state`, `scope`, `resource` (must be `<origin>/mcp`; defaults to it). Unknown client or redirect → HTML error page, no redirect. Other errors → redirect with `error`, `state`, `iss`. Success → `302 ${ZENVI_EDITOR_URL}/connect?request=<id>` |
| `GET /oauth/consent-info?request=<id>` | for the consent page; see below |
| `POST /oauth/consent` | Supabase session; `{ request, approve }` → `{ redirect }` |
| `POST /oauth/token` | form (or JSON). `grant_type=authorization_code` (`code`, `client_id`, `code_verifier`, `redirect_uri` if it was sent, `resource`?) or `refresh_token` (`refresh_token`, `client_id`, `scope`? to narrow). → `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope }` |
| `POST /oauth/revoke` | RFC 7009; `token`, `client_id`. Revoking a refresh token disconnects the grant. Always `200 {}` |

Codes live 5 minutes and work once; a replayed code revokes what it issued.
Refresh tokens (30 days) rotate on every use; the old one is accepted again
only within 60 s (a lost response); reuse after that revokes the whole grant.
Every authorization response carries `iss` (RFC 9207).

**Consent page `/editor/connect?request=<id>`** (web editor). Load
`GET /oauth/consent-info?request=<id>` (no auth):

```json
{ "request": "<id>",
  "client": { "id": "https://chatgpt.com/oauth/client.json", "name": "ChatGPT", "type": "metadata_document",
              "verifiedHost": "chatgpt.com", "uri": "https://chatgpt.com/", "logoUri": null },
  "redirectUri": "https://chatgpt.com/connector_platform_oauth_redirect", "redirectHost": "chatgpt.com",
  "scopes": [{ "name": "projects.read", "description": "See your Zenvi Cloud projects, media and renders" },
             { "name": "projects.write", "description": "Edit your projects, import media and start renders" }],
  "resource": "https://…/mcp", "expiresAt": "…" }
```

Show the client name, **the redirect host** (where the approval code goes) and
the scopes. `type: "registered"` means the name is self-described (dynamic
registration) — say so. Sign the person in (Supabase) if needed, then
`POST /oauth/consent { request, approve }` with their access token and set
`window.location = response.redirect`. `404` = expired (10 min), `409` =
already answered. Serve the page with `frame-ancestors 'none'`.

## 9. Remote MCP (`POST /mcp`)

Streamable HTTP, **stateless**: every POST is answered on its own (JSON
responses, no `Mcp-Session-Id`, `GET`/`DELETE` → `405`). Protocol versions
of `@modelcontextprotocol/sdk` 1.31 (up to 2025-11-25).

- Auth on every request, including `initialize`: an OAuth access token issued
  for exactly this `<origin>/mcp`, or a personal access token. Otherwise
  `401` with
  `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp", scope="projects.read projects.write"`
  (plus `error="invalid_token"` for bad tokens).
- A browser `Origin` not in `CORS_ORIGINS` + `https://claude.ai`,
  `https://chatgpt.com` (env `MCP_ALLOWED_ORIGINS`) → `403`.
- Each call has a 55 s budget (ChatGPT's limit is about 60 s): long work
  (renders) runs in the background.

Tools (all with `title`, explicit `readOnlyHint`/`destructiveHint`/
`idempotentHint`/`openWorldHint`, an `outputSchema`, `structuredContent` plus
the same JSON as text, ChatGPT status strings):

| Tool | Does |
| --- | --- |
| `list_projects` | the person's projects and the open one |
| `create_project {name, format?, fps?}` | new empty project (formats: `landscape_1080p` default, `landscape_720p`, `landscape_4k`, `vertical_1080p`, `square_1080p`; fps 24/25/30/50/60), opens it |
| `open_project {project_id}` | makes it the open project for this connection; overview with files |
| `import_media_from_url {url, name?}` | server-side download (https, public addresses only, pinned DNS, redirects re-checked, 512 MB, media types only), content-addressed, added to the bin; idempotent |
| `import_attached_file {file}` | a file attached in ChatGPT (`openai/fileParams`: `{download_url, file_id, mime_type?, file_name?}`), imported like a URL |
| `get_upload_link` | `${editor}/p/<id>?upload=1` for files on the person's device |
| `open_in_editor` | `${editor}/p/<id>` |
| `render_project {preset?, format?, height?, quality?, start_seconds?, end_seconds?}` | starts a render, returns `render_id` at once; idempotent |
| `get_render_status {render_id, wait_seconds?}` | status/progress; download link when done (waits up to 45 s) |
| `preview_frame {time_seconds, width?}` | PNG of one frame as image content + a 1 h link |
| engine tools | the editing catalog of `@zenvi/engine/tools` for surface `mcp` (when the registry is in the build), each with an extra optional `project_id` |

Every project tool takes an optional `project_id`; without it the tool uses
the open project of this connection (the OAuth grant or personal token),
falling back to the person's last opened project. Mutating calls load the
project, apply the change as one undo step (saved into the project history
in desktop format, so undo works across calls and on the desktop) and save
with `If-Match`, replaying the change if someone else saved in between.
`preview_frame` and `get_render_status` link an MCP Apps view
(`ui://zenvi/preview-v1.html`, `text/html;profile=mcp-app`).

## 10. Operations

| Env var | Default | |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | canonical origin: issuer, MCP resource, links |
| `PUBLIC_BASE_URL_ALIASES` | | other origins that route here (custom domains); requests on them use their own issuer/resource |
| `ZENVI_EDITOR_URL` | `https://zenvi.pro/editor` | consent, device and editor links |
| `SUPABASE_URL` | the zenvi.pro project | JWKS `…/auth/v1/.well-known/jwks.json`, issuer `…/auth/v1` |
| `STORAGE` | `azure` | `memory` for local development |
| `AZURE_STORAGE_CONNECTION_STRING` | | secret; container app secret `azure-storage-connection-string` |
| `AZURE_BLOB_CONTAINER` | `zenvi` | |
| `CORS_ORIGINS`, `MCP_ALLOWED_ORIGINS` | see §1, §9 | comma-separated, `*` wildcards |
| `MAX_PROJECT_BYTES`, `MAX_FILE_BYTES`, `MAX_USER_BYTES`, `IMPORT_MAX_BYTES`, `VERIFY_HASH_MAX_BYTES`, `MAX_RENDER_MEDIA_BYTES` | 20 MB, 4 GB, 20 GB, 512 MB, 64 MB, 3 GB | |
| `RENDER_TMP_DIR` | OS temp | render scratch + frame media cache (2 GB) |
| `ZENVI_CLOUD_VERSION` | `dev` | set to the image tag by deploy.sh |

Storage (account `zenvicloud`): blob container `zenvi` —
`u/{userId}/p/{projectId}/{project.json,meta.json,renders/…,frames/…}`,
`u/{userId}/media/{sha256}`, `u/{userId}/uploads/{sha256}.json` (pending
declarations), `u/{userId}/mcp/{connection}.json` (open project). Tables —
`tokens` (lookup rows `t:<hash prefix>/<sha256>` + per-user index
`u:<userId>/pat:<id>|grant:<id>`), `oauthclients` (`c/<client id>`),
`oauthcodes` (`req/<id>`, `code/<sha256>`), `devicecodes` (`d/<user code>`),
`renders` (`<userId>/<renderId>`). Expired rows are swept every 6 h.

Deploy: `scripts/azure/deploy.sh` (ACR build of the committed tree, roll the
app, wait for `/health`); configuration: `scripts/azure/provision.sh`.
Logs: `az containerapp logs show -g zenvi-rg -n zenvi-cloud --tail 100`
(JSON lines; tokens, codes, query strings and signed URLs are never logged).
Local run: `STORAGE=memory PUBLIC_BASE_URL=http://localhost:8080 npm run dev -w @zenvi/cloud`.

Known limits of this release: one replica (in-process render queue and rate
limits; render jobs are claimed with ETags and heartbeat, so an overlapping
instance during a deploy never renders a job twice); renders need every
clip's media in the cloud; projects are listed by scanning the user's blob
prefix; orphaned media (no project uses them) and unused dynamically
registered OAuth clients are not garbage-collected yet.
