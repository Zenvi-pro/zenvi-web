/** PKCE (RFC 7636), S256 only (OAuth 2.1 §4.1.1; `plain` is refused). */

import { safeEqual, sha256Base64Url } from "../util/crypto.js";

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isValidChallenge(challenge: string): boolean {
  return CHALLENGE.test(challenge);
}

export function verifyPkce(verifier: string | undefined, challenge: string): boolean {
  if (typeof verifier !== "string" || !VERIFIER.test(verifier)) return false;
  return safeEqual(sha256Base64Url(verifier), challenge);
}
