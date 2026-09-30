/**
 * API errors. Route handlers throw `ApiError`; the app's error handler turns it
 * into `{ "error": { "code", "message" }, ...extra }` with the given status.
 * OAuth and device endpoints use their RFC error shapes instead (oauth/errors.ts).
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    /** Extra top-level body fields, e.g. `{ revision }` on a 409. */
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  body(): Record<string, unknown> {
    return { error: { code: this.code, message: this.message }, ...this.extra };
  }
}

export const badRequest = (message: string, code = "invalid_request"): ApiError => new ApiError(400, code, message);
export const forbidden = (message: string, code = "forbidden"): ApiError => new ApiError(403, code, message);
export const notFound = (what: string): ApiError => new ApiError(404, "not_found", `${what} not found`);
export const conflict = (message: string, code = "conflict", extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, code, message, extra);
export const tooLarge = (message: string, code = "too_large"): ApiError => new ApiError(413, code, message);
export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(429, "rate_limited", "Too many requests; slow down.", {}, { "Retry-After": String(retryAfterSeconds) });

/** Storage-level failures the services translate into API errors. */
export class PreconditionFailedError extends Error {
  constructor(message = "precondition failed") {
    super(message);
    this.name = "PreconditionFailedError";
  }
}

export class AlreadyExistsError extends Error {
  constructor(message = "already exists") {
    super(message);
    this.name = "AlreadyExistsError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
