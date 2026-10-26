/**
 * The web editor build, hosted here for the editor embedded in chats: the MCP
 * editor view (mcp/editor-widget.ts) frames `/editor/embed/:projectId`. It is
 * the same build as zenvi.pro/editor. Serving it from this origin keeps the
 * embed's API calls same-origin (its token is this service's) and lets chat
 * hosts frame it; zenvi.pro is never framed. Every other editor route
 * redirects to the deployment's editor (`ZENVI_EDITOR_URL`, zenvi.pro by
 * default), where the person signs in; when that editor is this service's own
 * `/editor` (a lab or self-hosted copy), the build answers them itself.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { AppEnv } from "./context.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/** Path prefix of the embed route (the only editor document chat hosts may frame). */
export const EMBED_PREFIX = "/editor/embed/";

/**
 * Who may frame the embed: the chat hosts' sandbox origins differ per app and
 * host (chatgpt.com → *.oaiusercontent.com, claude.ai → its own sandbox), so
 * any https ancestor, plus loopback for local hosts. The project-scoped token
 * in the fragment is what guards the content, not the framing origin.
 */
export const EMBED_FRAME_ANCESTORS = "frame-ancestors https: http://localhost:* http://127.0.0.1:*";

interface StaticFile {
  data: Buffer;
  type: string;
}

export function editorRoutes(dist: string | null, editorUrl: string, ownOrigins: readonly string[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const root = dist ? path.resolve(dist) : null;
  // Redirecting to ourselves would loop.
  const selfHosted = ownOrigins.some((origin) => editorUrl === `${origin}/editor`);

  async function read(relative: string): Promise<StaticFile | null> {
    if (!root) return null;
    const full = path.resolve(root, relative);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    try {
      if (!(await stat(full)).isFile()) return null;
      return { data: await readFile(full), type: TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  app.get("*", async (c) => {
    const urlPath = c.req.path;
    let relative = "";
    try {
      relative = decodeURIComponent(urlPath.replace(/^\/editor\/?/, ""));
    } catch {
      // A malformed escape names no file: send it on like any other route.
    }
    if (urlPath.startsWith(EMBED_PREFIX)) {
      const index = await read("index.html");
      if (!index) return c.text("The editor is not part of this Zenvi Cloud build.", 503);
      c.header("Content-Type", index.type);
      c.header("Cache-Control", "no-cache");
      c.header("Content-Security-Policy", EMBED_FRAME_ANCESTORS);
      return c.body(new Uint8Array(index.data));
    }
    const file = relative && relative !== "index.html" ? await read(relative) : null;
    if (file) {
      c.header("Content-Type", file.type);
      // Vite fingerprints everything under assets/; the rest may change in place.
      c.header("Cache-Control", relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300");
      return c.body(new Uint8Array(file.data));
    }
    if (selfHosted) {
      const index = await read("index.html");
      if (!index) return c.text("The editor is not part of this Zenvi Cloud build.", 503);
      c.header("Content-Type", index.type);
      c.header("Cache-Control", "no-cache");
      return c.body(new Uint8Array(index.data));
    }
    const rest = urlPath.replace(/^\/editor/, "");
    return c.redirect(`${editorUrl}${rest}`, 302);
  });

  return app;
}
