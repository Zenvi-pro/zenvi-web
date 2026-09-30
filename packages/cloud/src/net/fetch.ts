/**
 * An HTTP GET client that enforces the SSRF policy (net/ssrf.ts) on every hop,
 * pins the connection to the checked addresses, caps time and bytes, and
 * hashes downloads as they stream.
 */

import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { checkUrl, PUBLIC_HTTPS, type ResolvedAddress, type Resolver, resolveChecked, SsrfError, type UrlPolicy } from "./ssrf.js";

export const systemResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

export interface SafeFetchOptions {
  policy?: UrlPolicy;
  resolver?: Resolver;
  /** Whole-exchange deadline (connect, headers and body), ms. */
  timeoutMs: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SafeResponse {
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
  /** Stop the deadline timer (call when done with `body`). */
  done(): void;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
      return;
    }
    const first = addresses.find((a) => options.family === undefined || options.family === 0 || a.family === options.family) ?? addresses[0];
    if (!first) {
      callback(new Error("no address"), "", 0);
      return;
    }
    callback(null, first.address, first.family);
  };
}

function requestOnce(url: URL, addresses: ResolvedAddress[], headers: Record<string, string>, signal: AbortSignal): Promise<IncomingMessage> {
  const impl = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = impl(url, { method: "GET", headers, lookup: pinnedLookup(addresses), agent: false, signal }, resolve);
    req.on("error", reject);
    req.end();
  });
}

/** GET `rawUrl`, following redirects (each re-checked). The caller must consume or destroy `body`. */
export async function safeGet(rawUrl: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const policy = options.policy ?? PUBLIC_HTTPS;
  const resolver = options.resolver ?? systemResolver;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new FetchError("The download took too long.")), options.timeoutMs);
  const onAbort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const done = (): void => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  };
  const headers = { "user-agent": "ZenviCloud/1.0 (+https://zenvi.pro)", accept: "*/*", ...(options.headers ?? {}) };
  try {
    let url = checkUrl(rawUrl, policy);
    for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop += 1) {
      const addresses = await resolveChecked(url.hostname, resolver, policy);
      const response = await requestOnce(url, addresses, headers, controller.signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (REDIRECTS.has(status) && typeof location === "string") {
        response.resume();
        url = checkUrl(new URL(location, url).toString(), policy);
        continue;
      }
      return { url: url.toString(), status, headers: response.headers, body: response, done };
    }
    throw new SsrfError("Too many redirects.");
  } catch (error) {
    done();
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw error;
  }
}

/** Read a small body (JSON documents) with a byte cap. */
export async function readLimited(response: SafeResponse, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.body.destroy();
    response.done();
    throw new FetchError("The response is too large.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) {
        response.body.destroy();
        throw new FetchError("The response is too large.");
      }
      chunks.push(chunk as Buffer);
    }
  } finally {
    response.done();
  }
  return Buffer.concat(chunks);
}

export async function fetchJson(rawUrl: string, options: SafeFetchOptions & { maxBytes: number }): Promise<unknown> {
  const response = await safeGet(rawUrl, { ...options, headers: { accept: "application/json", ...(options.headers ?? {}) } });
  if (response.status !== 200) {
    response.body.resume();
    response.done();
    throw new FetchError(`HTTP ${response.status}`, response.status);
  }
  const body = await readLimited(response, options.maxBytes);
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new FetchError("The response is not JSON.");
  }
}

/** Stream a successful response body to `filePath` with a byte cap, hashing as it goes. */
export async function downloadToFile(response: SafeResponse, filePath: string, maxBytes: number): Promise<{ size: number; sha256: string }> {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.body.destroy();
    response.done();
    throw new FetchError(`The file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`);
  }
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new FetchError(`The file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(response.body, meter, createWriteStream(filePath));
  } finally {
    response.done();
  }
  return { size, sha256: hash.digest("hex") };
}
