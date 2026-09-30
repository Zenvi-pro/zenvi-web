/**
 * Request body helpers: bounded reads, JSON parsing and zod validation with
 * 400/413 errors that say what is wrong.
 */

import type { Context } from "hono";
import type { z } from "zod";
import { ApiError, badRequest } from "./errors.js";

/** Read the raw body with a byte cap (checks Content-Length first, then the actual bytes). */
export async function readBody(c: Context, maxBytes: number): Promise<Buffer> {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig(maxBytes);
  const body = c.req.raw.body;
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooBig(maxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function tooBig(maxBytes: number): ApiError {
  const mb = maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / 1024 / 1024)} MB` : `${Math.round(maxBytes / 1024)} KB`;
  return new ApiError(413, "too_large", `The request body is larger than ${mb}.`);
}

export async function readJson(c: Context, maxBytes = 1024 * 1024): Promise<unknown> {
  const raw = await readBody(c, maxBytes);
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S, maxBytes = 1024 * 1024): Promise<z.infer<S>> {
  return parseWith(schema, await readJson(c, maxBytes));
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw badRequest(`${where}${issue?.message ?? "invalid request"}`);
  }
  return result.data;
}

/** OAuth endpoints take form bodies (RFC 6749) but some clients send JSON: accept both. */
export async function readFormOrJson(c: Context, maxBytes = 64 * 1024): Promise<Record<string, string | undefined>> {
  const raw = await readBody(c, maxBytes);
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  const out: Record<string, string | undefined> = {};
  if (type.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      throw badRequest("The request body is not valid JSON.");
    }
    if (typeof parsed === "object" && parsed !== null) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string") out[key] = value;
        else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
      }
    }
    return out;
  }
  const params = new URLSearchParams(raw.toString("utf8"));
  for (const [key, value] of params) {
    // A repeated parameter is an error in OAuth (RFC 6749 §3.1); keep the first and let validation catch it.
    if (!(key in out)) out[key] = value;
  }
  return out;
}
