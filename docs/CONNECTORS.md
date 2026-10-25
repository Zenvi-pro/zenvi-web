# Connect Zenvi to ChatGPT, Claude and coding agents

Zenvi Cloud runs a remote MCP server. Any MCP client that speaks Streamable
HTTP can use it to list, create and edit the person's cloud video projects,
import media, preview frames and start renders.

**Server URL:** `https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io/mcp`
(after the custom domain is set up, §7: `https://cloud.zenvi.pro/mcp`).

Sign-in is OAuth 2.1 through zenvi.pro: the client opens a Zenvi page, the
person signs in with their Zenvi account (the same one as the desktop app and
the website) and approves the app. Coding agents can instead send a personal
access token (`zvn_pat_…`) in a header (§5).

What a connection can do: only the signed-in person's Zenvi Cloud projects,
media and renders (scopes `projects.read` + `projects.write`). Access tokens
last one hour and refresh automatically; the person can disconnect an app at
any time (§6). API reference: [CLOUD_API.md](CLOUD_API.md).

## 1. ChatGPT

Custom connectors run in **developer mode** (Plus, Pro, Business, Enterprise,
Education on the web; workspace admins may have to allow it).

1. ChatGPT → **Settings → Security and login** → turn on **Developer mode**.
2. Open **https://chatgpt.com/plugins**, press **+**, and create a
   developer-mode app for a remote MCP server:
   - Name: `Zenvi`; Description: "Edit my Zenvi video projects."
   - MCP server URL: the server URL above.
   - Authentication: **OAuth**. Leave client ID/secret empty. If offered,
     choose the client ID metadata document (CIMD); dynamic registration
     works too.
3. ChatGPT sends you to zenvi.pro: sign in and **Allow**. The app appears
   under Drafts.
4. In a chat, enable the Zenvi app from the composer's tools menu and ask,
   e.g. "List my Zenvi projects", "Create a vertical 30 fps project called
   Launch teaser and import https://example.com/clip.mp4", "Render it".

Media: attach a video, audio or image file in the chat and ask Zenvi to use
it (ChatGPT hands the file to `import_attached_file`), give a direct https
link, or ask for an upload link to drop files in the web editor.

Search, stock footage, catalog, narration, and AI video run as the connected
Zenvi account and spend that account's credits (§8 explains how the server
reaches the Zenvi backend). Search and narration answer in the same turn. AI video does not: ChatGPT
calls `generate_video`, then `get_generation_status` until the clip is on
the timeline.

Notes: ChatGPT gives each tool call about a minute, so renders and AI video
run in the background — `render_project` then `get_render_status`, or
`generate_video` then `get_generation_status`. Write tools ask for
confirmation unless you allow them. Frame previews come back as a link (and
an image where the host shows images) and in the Zenvi preview panel.

These stay on the desktop app, because they need on-device speech, beat
tracking, or the desktop's ffmpeg splice: transcribe, remove words, detect
beats, diarize, local visual search, modify a clip with AI, and morph
transitions. Playback and timeline zoom stay in the web editor.

## 2. Claude (claude.ai, Claude Desktop, Claude mobile)

Custom connectors work on Free (one connector), Pro, Max, Team and
Enterprise. On Team/Enterprise an Owner adds the connector once; members then
connect it themselves.

1. claude.ai → **Customize → Connectors** → **Add custom connector**.
2. Name `Zenvi`, URL = the server URL above. Leave the OAuth fields empty
   (Claude uses its published client identity or registers automatically).
3. **Connect** → sign in to zenvi.pro → **Allow**.
4. In a chat, turn Zenvi on from the tools menu. Claude can see preview
   frames directly (image results).

The connector added on claude.ai is available in Claude Desktop and mobile too.

## 3. Claude Code

OAuth (recommended):

```bash
claude mcp add --transport http zenvi https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io/mcp
# then inside Claude Code: /mcp → zenvi → Authenticate (opens the browser)
```

With a personal token instead (headless machines, CI):

```bash
claude mcp add --transport http zenvi https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io/mcp \
  --header "Authorization: Bearer $ZENVI_TOKEN"
```

For local projects on your own disk, the Zenvi Claude Code plugin (`zenvi
mcp`, stdio) is the better fit; this remote server edits cloud projects.

## 4. Codex, Cursor, VS Code and other MCP clients

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.zenvi]
url = "https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io/mcp"
# either sign in with OAuth:  codex mcp login zenvi
# or use a personal token from the environment:
bearer_token_env_var = "ZENVI_TOKEN"
```

(`codex mcp add zenvi --url <server URL>` writes the same entry.)

**Cursor** (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "zenvi": { "url": "https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io/mcp" }
  }
}
```

Cursor shows "Needs login" → click it to sign in. With a token, add
`"headers": { "Authorization": "Bearer zvn_pat_…" }` to the entry.

**VS Code** (`.vscode/mcp.json`):

```json
{ "servers": { "zenvi": { "type": "http", "url": "https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io/mcp" } } }
```

**MCP Inspector** (debugging): `npx @modelcontextprotocol/inspector`, transport
"Streamable HTTP", the server URL, then either the OAuth flow or an
`Authorization: Bearer zvn_pat_…` header.

## 5. Personal access tokens

A `zvn_pat_…` token works as a bearer token on `/mcp` and on the REST API.
Get one:

- `zenvi login` in the CLI (device login; the CLI keeps the token), or
- by hand with the device flow:

  ```bash
  BASE=https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io
  curl -s -X POST $BASE/v1/device/code -H 'content-type: application/json' -d '{"client_name":"My laptop"}'
  # open verification_uri_complete, sign in, approve; then, every 5 s until it answers:
  curl -s -X POST $BASE/v1/device/token -H 'content-type: application/json' -d '{"device_code":"<device_code>"}'
  ```

- or, signed in on zenvi.pro, `POST /v1/tokens {"name":"CI","expiresInDays":90}`
  (what the future account page calls).

Tokens from device login last 365 days. Treat them like passwords.

## 6. Disconnecting

The account page lists personal tokens and connected apps
(`GET /v1/tokens`) and removes them (`DELETE /v1/tokens/<tok_… | grant_…>`):
removing a connected app ends all of its tokens at once. Removing the
connector inside ChatGPT or Claude stops that client, but only revoking here
ends the grant on the Zenvi side.

## 7. Custom domain (`cloud.zenvi.pro`) — needs Jashan (DNS)

The container app answers on its Azure name today. To serve it as
`cloud.zenvi.pro`:

1. **Cloudflare DNS** (zone `zenvi.pro`), both records **DNS only** (grey
   cloud; Azure validates the CNAME and issues the certificate itself):

   | Type | Name | Content |
   | --- | --- | --- |
   | CNAME | `cloud` | `zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io` |
   | TXT | `asuid.cloud` | `C30B8888FE969101E6E5DA02FA8B738A0DF2222714F188479C5B171605AC3274` |

   (The TXT value is the environment's domain verification id:
   `az containerapp env show -g zenvi-rg -n zenvi-env --query properties.customDomainConfiguration.customDomainVerificationId -o tsv`.)

2. **Bind the hostname** with a free managed certificate (a few minutes):

   ```bash
   az containerapp hostname add  -g zenvi-rg -n zenvi-cloud --hostname cloud.zenvi.pro
   az containerapp hostname bind -g zenvi-rg -n zenvi-cloud --hostname cloud.zenvi.pro \
     --environment zenvi-env --validation-method CNAME
   curl -s https://cloud.zenvi.pro/health
   ```

3. **Make it canonical, keep the old name working:**

   ```bash
   PUBLIC_BASE_URL=https://cloud.zenvi.pro \
   PUBLIC_BASE_URL_ALIASES=https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io \
   scripts/azure/provision.sh
   ```

   Each host serves its own OAuth issuer and MCP resource, so connectors added
   with the old URL keep working; add new ones with
   `https://cloud.zenvi.pro/mcp`. Also point the editor's
   `VITE_ZENVI_CLOUD_URL` and the CLI's default at the new URL.

Keep Cloudflare's proxy off for `cloud`: certificate renewal validates the
CNAME, and hosts must reach the server without a WAF in between (ChatGPT
egress: `openai.com/chatgpt-connectors.json`; Claude: `160.79.104.0/21`).

## 8. How the sign-in works (for client developers)

- `POST /mcp` without a token → `401` +
  `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp", scope="projects.read projects.write"`.
- Protected-resource metadata (also at the root path) names one
  authorization server: the same origin. Its RFC 8414 metadata advertises
  PKCE `S256`, `token_endpoint_auth_methods_supported: ["none"]`, client ID
  metadata documents, dynamic registration and RFC 9207 `iss`.
- `/oauth/authorize` needs PKCE S256 and an exactly registered redirect URI
  (loopback redirects match on any port) and sends the browser to
  `https://zenvi.pro/editor/connect`, where the person signs in and approves.
  The redirect back carries `code`, `state` and `iss`.
- Tokens are bound to the `resource` (`<origin>/mcp`) and checked on every
  request. Refresh tokens rotate; reusing an old one disconnects the app.
- Calling the Zenvi backend (search, stock, catalog, narration, AI video)
  happens server to server; ChatGPT and Claude never see a Zenvi token, and
  the web editor's own sign-in is never shared with the server. Set one of:
  - `ZENVI_BACKEND_SERVICE_SECRET` (preferred; at least 32 characters, the
    same value as the backend's `CLOUD_SERVICE_SECRET`): each call carries a
    five-minute HS256 JWT with `iss` `zenvi-cloud`, `aud` `zenvi-backend`,
    `sub` = the person's user id. Only set it once a backend that accepts
    these is deployed.
  - `SUPABASE_SERVICE_ROLE_KEY`: the server mints its own Supabase session per
    person (admin recovery link, no email sent) and is the only one that
    refreshes it. Disconnecting the person's last app deletes it.
  - neither: the backend tools are not offered.
- Redirect URIs known to work: `https://chatgpt.com/connector_platform_oauth_redirect`,
  `https://chatgpt.com/connector/oauth/{id}`, `https://claude.ai/api/mcp/auth_callback`,
  `http://localhost/callback` and `http://127.0.0.1/callback` on any port.

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Sign-in page says "not registered" or "redirect_uri does not match" | The client's registration changed. Remove the connector and add it again. |
| The consent page does not load | `https://zenvi.pro/editor/connect` must be deployed (web editor). |
| 401 right after connecting on a new domain | Tokens are bound to the URL they were issued for; reconnect with the URL you now use. |
| 403 `forbidden_origin` | A browser-based client from an origin not in `MCP_ALLOWED_ORIGINS`; add it and re-run provision. |
| Tools say rendering or previews are not available | That Zenvi Cloud build has no renderer yet; `GET /health` shows `renderer` / `frames`. |
| Search, stock, narration or AI video says "Zenvi sign-in refused the server's request" or the backend returned 401 | The server's backend credential is wrong or missing on one side (§8, "Calling the Zenvi backend"). |
| "… is not in Zenvi Cloud" when rendering | A clip's media was never uploaded; use `get_upload_link` or `import_media_from_url`. |
| `import_media_from_url` refuses a link | Only direct https links to public hosts, up to 512 MB, video/audio/image types. |
| 429 | Rate limits (registration 30/h/IP, device codes 30/h/IP, token 120/min/IP, imports 30/h/user). |

## 10. Before listing in the ChatGPT or Claude directories

Not needed for developer mode or custom connectors; needed to publish:

- the custom domain (§7) — the server origin cannot change after publishing;
- ChatGPT: domain verification at `/.well-known/openai-apps-challenge`, a
  dedicated `ui.domain` for the preview panel, CSP review;
- Claude: a public documentation page and review;
- both: a demo account without MFA for reviewers, and privacy/terms links.
