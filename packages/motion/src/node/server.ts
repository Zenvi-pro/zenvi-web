/**
 * The loopback HTTP server a render's pages load from: the page, its
 * script, the bundled fonts and the render's media, nothing else. It
 * listens on 127.0.0.1 on a free port and lives as long as the render.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { FONT_FACES } from "../tokens.js";

const TYPES: Readonly<Record<string, string>> = {
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

export interface PageServer {
  url: string;
  close(): Promise<void>;
}

export interface PageServerFiles {
  html: string;
  script: string;
  fontsDir: string;
  /** URL prefix (`/media/<name>/`) to the folder it serves. */
  mediaDirs: ReadonlyMap<string, string>;
}

const FONT_FILES = new Set<string>(FONT_FACES.map((f) => f.file));

export async function startPageServer(files: PageServerFiles): Promise<PageServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const send = (status: number, type: string, body: string): void => {
        res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
        res.end(body);
      };
      if (url.pathname === "/") return send(200, "text/html; charset=utf-8", files.html);
      if (url.pathname === "/block.js") return send(200, "text/javascript; charset=utf-8", files.script);
      let file: string | undefined;
      const font = /^\/fonts\/([^/]+)$/.exec(url.pathname);
      if (font && FONT_FILES.has(font[1]!)) file = path.join(files.fontsDir, font[1]!);
      const media = /^\/media\/([a-z0-9_-]+)\/([A-Za-z0-9_.-]+)$/.exec(url.pathname);
      if (media) {
        const dir = files.mediaDirs.get(media[1]!);
        if (dir) file = path.join(dir, media[2]!);
      }
      const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
      if (!file || !type || !(await stat(file).then((s) => s.isFile(), () => false))) return send(404, "text/plain", "not found");
      res.writeHead(200, { "content-type": type, "cache-control": "max-age=3600" });
      createReadStream(file).pipe(res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
