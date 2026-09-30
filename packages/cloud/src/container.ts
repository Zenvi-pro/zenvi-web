/**
 * Wires the service together from its dependencies. main.ts passes the real
 * ones (Azure storage, Supabase JWKS, render-node); tests pass memory storage,
 * a local JWKS and fakes.
 */

import { join } from "node:path";
import { Authenticator } from "./auth/principal.js";
import type { SupabaseVerifier } from "./auth/supabase.js";
import type { Config } from "./config.js";
import type { Logger } from "./http/log.js";
import { silentLogger } from "./http/log.js";
import { RateLimiter } from "./http/ratelimit.js";
import type { EngineRegistry } from "./mcp/engine.js";
import { SessionStore } from "./mcp/session.js";
import { fetchJson } from "./net/fetch.js";
import type { Resolver, UrlPolicy } from "./net/ssrf.js";
import { CIMD_FETCH_LIMIT, ClientRegistry, type JsonFetcher } from "./oauth/clients.js";
import { OAuthService } from "./oauth/service.js";
import { MediaCache } from "./render/cache.js";
import type { MediaProber, Renderer } from "./render/renderer.js";
import { unavailableProber, unavailableRenderer } from "./render/renderer.js";
import { RenderService } from "./render/service.js";
import { TokenRepo } from "./repos/tokens.js";
import { DeviceService } from "./services/device.js";
import { FrameService } from "./services/frames.js";
import { MediaImporter } from "./services/importer.js";
import { MediaService } from "./services/media.js";
import { ProjectService } from "./services/projects.js";
import type { BlobStore, TableStore } from "./storage/types.js";
import type { Clock } from "./util/clock.js";
import { systemClock } from "./util/clock.js";

export const DOCUMENTATION_URL = "https://github.com/Zenvi-pro/zenvi-web/blob/main/docs/CONNECTORS.md";

export interface Dependencies {
  config: Config;
  blobs: BlobStore;
  tables: TableStore;
  supabase: SupabaseVerifier;
  renderer?: Renderer;
  prober?: MediaProber;
  engine?: EngineRegistry | null;
  clock?: Clock;
  log?: Logger;
  /** Fetches OAuth client metadata documents; defaults to the SSRF-safe fetcher. */
  fetchClientDocument?: JsonFetcher;
  /** Network policy for server-side downloads (tests loosen it). */
  network?: { policy?: UrlPolicy; resolver?: Resolver };
}

export interface Services {
  config: Config;
  clock: Clock;
  log: Logger;
  blobs: BlobStore;
  tables: TableStore;
  auth: Authenticator;
  tokens: TokenRepo;
  projects: ProjectService;
  media: MediaService;
  renders: RenderService;
  devices: DeviceService;
  clients: ClientRegistry;
  oauth: OAuthService;
  sessions: SessionStore;
  importer: MediaImporter;
  frames: FrameService;
  limiter: RateLimiter;
  engine: EngineRegistry | null;
  startedAt: number;
}

export function createServices(deps: Dependencies): Services {
  const { config, blobs, tables } = deps;
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? silentLogger;
  const renderer = deps.renderer ?? unavailableRenderer;
  const prober = deps.prober ?? unavailableProber;
  const tokens = new TokenRepo(tables, clock, (message) => log.warn(message));
  const projects = new ProjectService(blobs, clock, config.limits.maxProjectBytes);
  const media = new MediaService(blobs, clock, config.limits);
  const fetchClientDocument: JsonFetcher =
    deps.fetchClientDocument ??
    ((url) =>
      fetchJson(url, {
        timeoutMs: 5_000,
        maxBytes: CIMD_FETCH_LIMIT,
        maxRedirects: 0,
        policy: deps.network?.policy,
        resolver: deps.network?.resolver,
      }));
  const clients = new ClientRegistry(tables, clock, fetchClientDocument);
  const cache = new MediaCache(join(config.renderTmpDir, "zenvi-media-cache"), 2 * 1024 ** 3, media);
  return {
    config,
    clock,
    log,
    blobs,
    tables,
    auth: new Authenticator(deps.supabase, tokens),
    tokens,
    projects,
    media,
    renders: new RenderService({
      tables,
      blobs,
      projects,
      media,
      renderer,
      clock,
      log,
      tmpDir: config.renderTmpDir,
      maxRenderMediaBytes: config.limits.maxRenderMediaBytes,
    }),
    devices: new DeviceService(tables, tokens, clock, config.editorUrl, config.tokens.devicePatDays),
    clients,
    oauth: new OAuthService({
      tables,
      clients,
      tokens,
      clock,
      editorUrl: config.editorUrl,
      accessTtlSeconds: config.tokens.accessTtlSeconds,
      refreshTtlSeconds: config.tokens.refreshTtlSeconds,
      documentationUrl: DOCUMENTATION_URL,
    }),
    sessions: new SessionStore(blobs, clock),
    importer: new MediaImporter({
      media,
      prober,
      tmpDir: config.renderTmpDir,
      maxBytes: Math.min(config.limits.importMaxBytes, config.limits.maxFileBytes),
      policy: deps.network?.policy,
      resolver: deps.network?.resolver,
    }),
    frames: new FrameService(renderer, cache, blobs, clock),
    limiter: new RateLimiter(clock),
    engine: deps.engine ?? null,
    startedAt: clock.now(),
  };
}
