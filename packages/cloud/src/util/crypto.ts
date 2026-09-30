/**
 * Small crypto helpers. Everything secret is generated with the OS CSPRNG and
 * compared in constant time.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** `bytes` random bytes as base64url (no padding). 32 bytes → 43 chars. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Lowercase hex SHA-256 of a string (UTF-8) or bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** base64url SHA-256, as PKCE S256 uses it (RFC 7636 §4.2). */
export function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input, "ascii").digest("base64url");
}

/** Constant-time string equality (false for different lengths). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A random identifier: `prefix` + `length` characters from [a-z0-9]
 * (uniform, via `crypto.randomInt`). 16 characters ≈ 82 bits.
 */
export function randomId(prefix: string, length = 16): string {
  let out = prefix;
  for (let i = 0; i < length; i += 1) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return out;
}

/**
 * RFC 8628 §6.1 user-code alphabet: 20 consonants, no vowels (no accidental
 * words) and nothing easily confused (0/O, 1/I/L).
 */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** 8 characters from USER_CODE_ALPHABET (≈ 34.6 bits), without the dash. */
export function randomUserCode(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return out;
}
