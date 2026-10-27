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
  /** How long create_reel waits for downloads before cutting with what arrived, ms. */
  reelFetchDeadlineMs: number;
  /** On-disk cache of media for frame previews, bytes. */
  mediaCacheBytes: number;
}

export type BackendAuth =
  | { kind: "assertion"; secret: string }
  | { kind: "session"; serviceRoleKey: string; anonKey: string }
  | { kind: "off" };

export interface Config {
  port: number;
  /** Canonical public origin, e.g. https://zenvi-cloud.….azurecontainerapps.io (no trailing slash). */
  publicBaseUrl: string;
  /** Other origins that route to this service (custom domains). Requests on them use their own issuer/resource. */
  publicBaseUrlAliases: string[];
  /**
   * Extra public MCP URLs that a proxy forwards here with the path unchanged (`https://zenvi.pro/plugin`). Each is
   * served at its path, is its own OAuth resource, and names this service as its authorization server.
   */
  mcpUrlAliases: string[];
  /** Web editor base, e.g. https://zenvi.pro/editor (no trailing slash). */
  editorUrl: string;
  supabaseUrl: string;
  /** Zenvi backend (`https://api.zenvi.pro`). Empty disables search, stock, TTS and AI video. */
  backendUrl: string;
  /** How connector calls reach the backend as the person (auth/backend-session.ts). */
  backendAuth: BackendAuth;
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
  /**
   * Azure Storage queue that hands renders to render workers in their own containers (`render/dispatch.ts`), or null
   * to render in this process. Needs Azure storage.
   */
  renderQueue: string | null;
  /** The web editor build this service hosts for the editor embedded in chats (`/editor/embed/…`), or null. */
  editorDist: string | null;
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

/** Paths the service already routes; an MCP alias must not shadow them. */
const RESERVED_SEGMENTS = new Set(["mcp", "v1", "oauth", "editor", "health"]);

function mcpUrlAlias(value: string): string {
  const url = new URL(value);
  const segment = url.pathname.replace(/\/+$/, "").slice(1);
  if (url.protocol !== "https:" || url.search || url.hash || !/^[a-z0-9-]+$/.test(segment) || RESERVED_SEGMENTS.has(segment)) {
    throw new Error(`invalid MCP_URL_ALIASES entry: ${value} (want https://host/<one path segment>)`);
  }
  return `${url.origin}/${segment}`;
}

function bytes(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid byte limit: ${value}`);
  return Math.floor(parsed);
}

/**
 * The backend's shared secret wins: it needs no Supabase credentials here.
 * The service-role key is the fallback for a backend that does not accept
 * assertions yet.
 */
function loadBackendAuth(env: NodeJS.ProcessEnv): BackendAuth {
  const secret = env.ZENVI_BACKEND_SERVICE_SECRET?.trim() ?? "";
  if (secret) {
    if (secret.length < 32) throw new Error("ZENVI_BACKEND_SERVICE_SECRET must be at least 32 characters");
    return { kind: "assertion", secret };
  }
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (serviceRoleKey) {
    // The publishable key is the same public client value the CLI ships.
    return { kind: "session", serviceRoleKey, anonKey: (env.SUPABASE_ANON_KEY ?? "sb_publishable_2-FCBkJ96Ss35jqL9krVEQ_otR5iGmA").trim() };
  }
  return { kind: "off" };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid PORT: ${env.PORT}`);

  const publicBaseUrl = origin.parse(env.PUBLIC_BASE_URL ?? `http://localhost:${port}`);
  const aliases = list(env.PUBLIC_BASE_URL_ALIASES, []).map((value) => origin.parse(value));
  const mcpUrlAliases = list(env.MCP_URL_ALIASES, []).map(mcpUrlAlias);
  const editorUrl = origin.parse(env.ZENVI_EDITOR_URL ?? "https://zenvi.pro/editor");
  const supabaseUrl = origin.parse(env.SUPABASE_URL ?? "https://xktarhzbrdnxkaovtdxj.supabase.co");
  const backendUrl = env.ZENVI_BACKEND_URL === "" ? "" : origin.parse(env.ZENVI_BACKEND_URL ?? "https://api.zenvi.pro");
  const backendAuth = loadBackendAuth(env);

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

  const renderQueue = env.ZENVI_RENDER_QUEUE?.trim() || null;
  // Azure queue names: 3-63 lowercase letters, digits and single dashes.
  if (renderQueue && !/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$/.test(renderQueue)) throw new Error(`invalid ZENVI_RENDER_QUEUE: ${renderQueue}`);
  if (renderQueue && storage.kind !== "azure") throw new Error("ZENVI_RENDER_QUEUE needs Azure storage");
  const logLevel = (env.LOG_LEVEL ?? "info") as Config["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new Error(`invalid LOG_LEVEL: ${env.LOG_LEVEL}`);

  return {
    port,
    publicBaseUrl,
    publicBaseUrlAliases: aliases,
    mcpUrlAliases,
    editorUrl,
    supabaseUrl,
    backendUrl,
    backendAuth,
    storage,
    corsOrigins,
    mcpAllowedOrigins,
    limits: {
      maxProjectBytes: bytes(env.MAX_PROJECT_BYTES, 20 * MiB),
      maxFileBytes: bytes(env.MAX_FILE_BYTES, 4 * GiB),
      maxUserBytes: bytes(env.MAX_USER_BYTES, 20 * GiB),
      importMaxBytes: bytes(env.IMPORT_MAX_BYTES, 512 * MiB),
      verifyHashMaxBytes: bytes(env.VERIFY_HASH_MAX_BYTES, 64 * MiB),
      // The container has 4 GiB of ephemeral disk: renders + cache + imports must fit.
      maxRenderMediaBytes: bytes(env.MAX_RENDER_MEDIA_BYTES, 2 * GiB),
      // A chat gives a tool call about a minute; the rest of create_reel needs ~10 s.
      reelFetchDeadlineMs: Math.min(45_000, Math.max(5_000, Number(env.REEL_FETCH_DEADLINE_MS) || 32_000)),
      mediaCacheBytes: bytes(env.MEDIA_CACHE_BYTES, 512 * MiB),
    },
    tokens: {
      accessTtlSeconds: 3600,
      refreshTtlSeconds: 30 * 24 * 3600,
      patDefaultDays: 90,
      devicePatDays: 365,
    },
    renderTmpDir: env.RENDER_TMP_DIR ?? tmpdir(),
    renderQueue,
    editorDist: env.ZENVI_EDITOR_DIST?.trim() || null,
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
