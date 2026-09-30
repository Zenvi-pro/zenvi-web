/**
 * Upload a local file to a signed Azure Blob URL (SAS). Azure needs a
 * Content-Length (no chunked bodies), so uploads use node:http(s) directly:
 * one Put Blob up to 256 MiB, Put Block + Put Block List beyond that
 * (8 MiB blocks, retried).
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

const SINGLE_SHOT_MAX = 256 * 1024 * 1024;
const BLOCK_SIZE = 8 * 1024 * 1024;

function put(url: string, headers: Record<string, string>, body: NodeJS.ReadableStream | Buffer, length: number): Promise<{ status: number; text: string }> {
  const target = new URL(url);
  const client = target.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = client.request(target, { method: "PUT", headers: { ...headers, "Content-Length": String(length) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.setTimeout(10 * 60_000, () => req.destroy(new Error("upload timed out")));
    req.on("error", reject);
    if (Buffer.isBuffer(body)) req.end(body);
    else {
      body.on("error", (e) => req.destroy(e as Error));
      body.pipe(req);
    }
  });
}

function withQuery(url: string, extra: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

export interface UploadOptions {
  headers?: Record<string, string>;
  onProgress?: (sent: number, total: number) => void;
}

export async function uploadFile(file: string, url: string, options: UploadOptions = {}): Promise<void> {
  const size = (await stat(file)).size;
  const headers = options.headers ?? { "x-ms-blob-type": "BlockBlob" };
  if (size <= SINGLE_SHOT_MAX) {
    let sent = 0;
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", (c: string | Buffer) => {
      sent += c.length;
      options.onProgress?.(sent, size);
    });
    const res = await put(url, headers, stream, size);
    if (res.status < 200 || res.status >= 300) throw new Error(`Upload failed: HTTP ${res.status} ${res.text.slice(0, 300)}`);
    return;
  }
  const ids: string[] = [];
  const { "x-ms-blob-type": _type, "Content-Type": contentType, ...blockHeaders } = headers;
  for (let offset = 0, n = 0; offset < size; offset += BLOCK_SIZE, n += 1) {
    const length = Math.min(BLOCK_SIZE, size - offset);
    const id = Buffer.from(`zenvi-${String(n).padStart(8, "0")}`).toString("base64");
    ids.push(id);
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const chunk = createReadStream(file, { start: offset, end: offset + length - 1 });
        const res = await put(withQuery(url, { comp: "block", blockid: id }), blockHeaders, chunk, length);
        if (res.status >= 200 && res.status < 300) {
          lastError = undefined;
          break;
        }
        lastError = new Error(`HTTP ${res.status} ${res.text.slice(0, 200)}`);
      } catch (error) {
        lastError = error as Error;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    if (lastError) throw new Error(`Upload failed at byte ${offset}: ${lastError.message}`);
    options.onProgress?.(offset + length, size);
  }
  const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${ids.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`;
  const listHeaders: Record<string, string> = { ...blockHeaders, "Content-Type": "application/xml" };
  if (contentType) listHeaders["x-ms-blob-content-type"] = contentType;
  const res = await put(withQuery(url, { comp: "blocklist" }), listHeaders, Buffer.from(xml), Buffer.byteLength(xml));
  if (res.status < 200 || res.status >= 300) throw new Error(`Upload failed committing blocks: HTTP ${res.status} ${res.text.slice(0, 300)}`);
}
