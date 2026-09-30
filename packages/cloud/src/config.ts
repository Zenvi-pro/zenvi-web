/**
 * Service configuration from the environment. Every value has a safe default
 * for local development except the storage connection string, which is only
 * required when STORAGE=azure (the default in production).
 */

import { tmpdir } from "node:os";
import { z } from "zod";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export interface Limits {
  /** Largest project JSON accepted, bytes. */
  maxProjectBytes: number;
  /** Largest single media file, bytes. */
  maxFileBytes: number;
  /** Per-user storage quota (media + projects + renders), bytes. */
  maxUserBytes: number;
  /** Largest file `import_media_from_url` downloads, bytes. */
  importMaxBytes: number;
  /** Uploads up to this size are hashed server-side on /complete. */
  verifyHashMaxBytes: number;
  /** Total media a single render may download, bytes. */
  maxRenderMediaBytes: number;
}

export interface Config {
  port: number;
  /** Canonical public origin, e.g. https://zenvi-cloud.….azurecontainerapps.io (no trailing slash). */
  publicBaseUrl: string;
  /** Other origins that route to this service (custom domains). Requests on them use their own issuer/resource. */
  publicBaseUrlAliases: string[];
  /** Web editor base, e.g. https://zenvi.pro/editor (no trailing slash). */
  editorUrl: string;
  supabaseUrl: string;
  storage: { kind: "azure"; connectionString: string; container: string } | { kind: "memory" };
  /** Origins allowed for browser CORS on /v1 (patterns with `*`). */
  corsOrigins: string[];
  /** Origins allowed to call /mcp from a browser; requests with other Origin headers get 403. */
  mcpAllowedOrigins: string[];
  limits: Limits;
  tokens: {
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    patDefaultDays: number;
    devicePatDays: number;
  };
  renderTmpDir: string;
  version: string;
  /** Log verbosity. */
  logLevel: "debug" | "info" | "warn" | "error";
}

const DEFAULT_CORS = [
  "https://zenvi.pro",
  "https://www.zenvi.pro",
  "https://*.vercel.app",
  "http://localhost:*",
  "http://127.0.0.1:*",
];

const origin = z
  .string()
  .url()
  .transform((value) => value.replace(/\/+$/, ""));

function list(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === "") return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function bytes(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid byte limit: ${value}`);
  return Math.floor(parsed);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid PORT: ${env.PORT}`);

  const publicBaseUrl = origin.parse(env.PUBLIC_BASE_URL ?? `http://localhost:${port}`);
  const aliases = list(env.PUBLIC_BASE_URL_ALIASES, []).map((value) => origin.parse(value));
  const editorUrl = origin.parse(env.ZENVI_EDITOR_URL ?? "https://zenvi.pro/editor");
  const supabaseUrl = origin.parse(env.SUPABASE_URL ?? "https://xktarhzbrdnxkaovtdxj.supabase.co");

  const storageKind = (env.STORAGE ?? "azure").toLowerCase();
  let storage: Config["storage"];
  if (storageKind === "memory") {
    storage = { kind: "memory" };
  } else if (storageKind === "azure") {
    const connectionString = env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING is required (or set STORAGE=memory)");
    storage = { kind: "azure", connectionString, container: env.AZURE_BLOB_CONTAINER ?? "zenvi" };
  } else {
    throw new Error(`invalid STORAGE: ${env.STORAGE}`);
  }

  const corsOrigins = list(env.CORS_ORIGINS, DEFAULT_CORS);
  const mcpAllowedOrigins = [
    ...new Set([
      ...corsOrigins,
      ...list(env.MCP_ALLOWED_ORIGINS, ["https://claude.ai", "https://chatgpt.com"]),
      publicBaseUrl,
      ...aliases,
    ]),
  ];

  const logLevel = (env.LOG_LEVEL ?? "info") as Config["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new Error(`invalid LOG_LEVEL: ${env.LOG_LEVEL}`);

  return {
    port,
    publicBaseUrl,
    publicBaseUrlAliases: aliases,
    editorUrl,
    supabaseUrl,
    storage,
    corsOrigins,
    mcpAllowedOrigins,
    limits: {
      maxProjectBytes: bytes(env.MAX_PROJECT_BYTES, 20 * MiB),
      maxFileBytes: bytes(env.MAX_FILE_BYTES, 4 * GiB),
      maxUserBytes: bytes(env.MAX_USER_BYTES, 20 * GiB),
      importMaxBytes: bytes(env.IMPORT_MAX_BYTES, 512 * MiB),
      verifyHashMaxBytes: bytes(env.VERIFY_HASH_MAX_BYTES, 64 * MiB),
      maxRenderMediaBytes: bytes(env.MAX_RENDER_MEDIA_BYTES, 3 * GiB),
    },
    tokens: {
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 30 * 24 * 3600,
      patDefaultDays: 90,
      devicePatDays: 365,
    },
    renderTmpDir: env.RENDER_TMP_DIR ?? tmpdir(),
    version: env.ZENVI_CLOUD_VERSION ?? "dev",
    logLevel,
  };
}

export type ConfigOverrides = Partial<Omit<Config, "limits">> & { limits?: Partial<Limits> };

/** A config for tests: memory storage, fixed URLs. */
export function testConfig(overrides: ConfigOverrides = {}): Config {
  const base = loadConfig({
    STORAGE: "memory",
    PUBLIC_BASE_URL: "https://cloud.test",
    ZENVI_EDITOR_URL: "https://zenvi.test/editor",
    SUPABASE_URL: "https://supabase.test",
  });
  return { ...base, ...overrides, limits: { ...base.limits, ...(overrides.limits ?? {}) } };
}
