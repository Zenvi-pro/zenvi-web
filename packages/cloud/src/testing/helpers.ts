/**
 * Test harness: memory storage, a manual clock, a local ES256 key pair whose
 * JWKS stands in for Supabase's, and a small request helper around
 * `app.request()`. Nothing here touches Azure or the network.
 */

import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { createApp } from "../app.js";
import { createSupabaseVerifier } from "../auth/supabase.js";
import { testConfig, type Config, type ConfigOverrides } from "../config.js";
import { createServices, type Dependencies, type Services } from "../container.js";
import { MemoryBlobStore, MemoryTableStore } from "../storage/memory.js";
import { ManualClock } from "../util/clock.js";

export const SUPABASE_URL = "https://supabase.test";
export const ORIGIN = "https://cloud.test";

export interface TestKeys {
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  jwk: JWK;
}

let cachedKeys: Promise<TestKeys> | null = null;

export function testKeys(): Promise<TestKeys> {
  cachedKeys ??= (async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
    return { privateKey, jwk };
  })();
  return cachedKeys;
}

export interface TokenClaims {
  sub: string;
  email?: string;
  /** Seconds from now until expiry (negative = already expired). */
  expiresIn?: number;
  aud?: string;
  iss?: string;
  isAnonymous?: boolean;
  /** Signing clock, ms (defaults to the harness clock's now). */
  now?: number;
}

export async function supabaseToken(claims: TokenClaims, keys?: TestKeys): Promise<string> {
  const { privateKey } = keys ?? (await testKeys());
  const now = Math.floor((claims.now ?? Date.now()) / 1000);
  const jwt = new SignJWT({
    email: claims.email ?? `${claims.sub}@example.com`,
    role: "authenticated",
    ...(claims.isAnonymous ? { is_anonymous: true } : {}),
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(claims.iss ?? `${SUPABASE_URL}/auth/v1`)
    .setAudience(claims.aud ?? "authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + (claims.expiresIn ?? 3600));
  return jwt.sign(privateKey);
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  services: Services;
  blobs: MemoryBlobStore;
  tables: MemoryTableStore;
  clock: ManualClock;
  config: Config;
  /** A valid Supabase access token for `userId`. */
  userToken(userId: string, email?: string): Promise<string>;
  request(method: string, path: string, options?: RequestOptions): Promise<TestResponse>;
}

export interface RequestOptions {
  token?: string;
  json?: unknown;
  form?: Record<string, string>;
  body?: string;
  headers?: Record<string, string>;
}

export interface TestResponse {
  status: number;
  headers: Headers;
  text: string;
  // Tests read arbitrary JSON; `any` keeps assertions terse.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export async function harness(
  overrides: Partial<Omit<Dependencies, "config" | "blobs" | "tables" | "supabase" | "clock">> & { config?: ConfigOverrides } = {},
): Promise<Harness> {
  const keys = await testKeys();
  const clock = new ManualClock(Date.now());
  const blobs = new MemoryBlobStore(() => clock.now());
  const tables = new MemoryTableStore();
  const config = testConfig(overrides.config ?? {});
  const { config: _config, ...rest } = overrides;
  const services = createServices({
    config,
    blobs,
    tables,
    clock,
    supabase: createSupabaseVerifier({ supabaseUrl: SUPABASE_URL, keys: createLocalJWKSet({ keys: [keys.jwk] }) }),
    ...rest,
  });
  const app = createApp(services);
  const request = async (method: string, path: string, options: RequestOptions = {}): Promise<TestResponse> => {
    const headers: Record<string, string> = { host: "cloud.test", "x-forwarded-proto": "https", ...(options.headers ?? {}) };
    let body: string | undefined = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers["content-type"] ??= "application/json";
    } else if (options.form !== undefined) {
      body = new URLSearchParams(options.form).toString();
      headers["content-type"] ??= "application/x-www-form-urlencoded";
    }
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await app.request(`${ORIGIN}${path}`, { method, headers, body });
    const text = await response.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, text, json };
  };
  return {
    app,
    services,
    blobs,
    tables,
    clock,
    config,
    userToken: (userId, email) => supabaseToken({ sub: userId, email, now: clock.now() }, keys),
    request,
  };
}

/** A minimal valid project JSON (desktop shape). */
export function sampleProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "T0",
    fps: { num: 30, den: 1 },
    display_ratio: { num: 16, den: 9 },
    pixel_ratio: { num: 1, den: 1 },
    width: 1280,
    height: 720,
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    settings: {},
    clips: [],
    effects: [],
    files: [],
    duration: 300,
    scale: 15,
    tick_pixels: 100,
    playhead_position: 0,
    profile: "HD 720p 30 fps",
    export_settings: null,
    export_overrides: {},
    layers: [{ id: "L1", label: "", number: 1000000, y: 0, lock: false }],
    markers: [],
    progress: [],
    history: { undo: [], redo: [] },
    version: { "openshot-qt": "0.0.0", libopenshot: "0.0.0" },
    ...overrides,
  };
}

export const USER_A = "0b8d7f1e-1111-4a4a-9a9a-aaaaaaaaaaaa";
export const USER_B = "0b8d7f1e-2222-4b4b-9b9b-bbbbbbbbbbbb";
