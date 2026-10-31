/**
 * Wires the service together from its dependencies. main.ts passes the real
 * ones (Azure storage, Supabase JWKS, render-node); tests pass memory storage,
 * a local JWKS and fakes.
 */

import { join } from "node:path";
import type { StockHost } from "@zenvi/engine";
import { BackendSessions } from "./auth/backend-session.js";
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
import { GenerationService } from "./generation/service.js";
import { MediaCache } from "./render/cache.js";
import type { RenderDispatch } from "./render/dispatch.js";
import type {
  AssetSource,
  AudioAnalyzer,
  FontLister,
  MatteHostFactory,
  MediaProber,
  MixRenderer,
  MotionHostFactory,
  PcmDecoder,
  Renderer,
  SpeechTranscriber,
  WatchProxyMaker,
} from "./render/renderer.js";
import { unavailableProber, unavailableRenderer } from "./render/renderer.js";
import { RenderService } from "./render/service.js";
import { TokenRepo } from "./repos/tokens.js";
import { DeviceService } from "./services/device.js";
import { FrameService } from "./services/frames.js";
import { MediaImporter } from "./services/importer.js";
import { directStock } from "./services/stock.js";
import { MediaService } from "./services/media.js";
import { MediaVerifier } from "./services/verifier.js";
import { ProjectService } from "./services/projects.js";
import { RecentTranscripts } from "./services/transcripts.js";
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
  /** Built-in renderer assets (`@transitions/…`) on disk. */
  resolveAsset?: (projectPath: string) => string | undefined;
  /** The engine's bundled assets (title templates) for catalog tools. */
  assets?: AssetSource;
  /** Audio loudness analysis for catalog tools (remove_silence_tool). */
  analyzeAudio?: AudioAnalyzer;
  /** Decodes audio to PCM for beat tracking (detect_beats_tool, build_reel_tool); absent = beats from a fixed tempo. */
  decodePcm?: PcmDecoder;
  /** Renders the timeline mix for master_audio_tool; absent = the tool is unavailable. */
  mixPcm?: MixRenderer;
  /** Extracts speech audio and transcribes it through the backend (the speech tools); absent = index transcripts only. */
  transcribeMedia?: SpeechTranscriber;
  /** Makes the proxy watch_render_tool sends to the backend; absent = no watching. */
  watchProxy?: WatchProxyMaker;
  /** The fonts titles render with (add_title_tool / edit_title_tool check a font against them); absent = any font is taken as given. */
  fontFamilies?: FontLister;
  /** Hands renders to render workers (`render/dispatch.ts`); absent = renders run in this process. */
  renderDispatch?: RenderDispatch;
  /** Renders Zenvi Motion blocks (headless Chrome); absent = the motion block tools are not listed. */
  motion?: MotionHostFactory;
  /** Stock search with this deployment's own keys (default: `config.stockKeys`). */
  stock?: StockHost | null;
  /** Makes subject mattes (onnxruntime-node); absent = composites reuse mattes already in the bin. */
  mattes?: MatteHostFactory;
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
  verifier: MediaVerifier;
  renders: RenderService;
  devices: DeviceService;
  clients: ClientRegistry;
  oauth: OAuthService;
  backendSessions: BackendSessions;
  /** Stock search with this deployment's own keys, used when the backend is off; null without keys. */
  stock: StockHost | null;
  generations: GenerationService;
  sessions: SessionStore;
  importer: MediaImporter;
  frames: FrameService;
  prober: MediaProber;
  mediaCache: MediaCache;
  assets: AssetSource | null;
  analyzeAudio: AudioAnalyzer | null;
  decodePcm: PcmDecoder | null;
  mixPcm: MixRenderer | null;
  /** Built-in renderer assets on disk (what a mix of a project with bundled sounds reads). */
  resolveAsset: ((projectPath: string) => string | undefined) | null;
  transcribeMedia: SpeechTranscriber | null;
  watchProxy: WatchProxyMaker | null;
  fontFamilies: FontLister | null;
  motion: MotionHostFactory | null;
  mattes: MatteHostFactory | null;
  transcripts: RecentTranscripts;
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
  const verifier = new MediaVerifier(media, log);
  media.onVerify = (userId, sha256) => verifier.enqueue(userId, sha256);
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
  const cache = new MediaCache(join(config.renderTmpDir, "zenvi-media-cache"), config.limits.mediaCacheBytes, media);
  const backendSessions = new BackendSessions(tables, clock, {
    supabaseUrl: config.supabaseUrl,
    backendUrl: config.backendUrl,
    auth: config.backendAuth,
  });
  tokens.onGrantRevoked = async (userId) => {
    const { grants } = await tokens.listForUser(userId);
    if (grants.length === 0) await backendSessions.delete(userId);
  };
  const importer = new MediaImporter({
    media,
    prober,
    tmpDir: config.renderTmpDir,
    maxBytes: Math.min(config.limits.importMaxBytes, config.limits.maxFileBytes),
    policy: deps.network?.policy,
    resolver: deps.network?.resolver,
  });
  const generations = new GenerationService({ tables, projects, importer, sessions: backendSessions, clock, log });
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
    verifier,
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
      resolveAsset: deps.resolveAsset,
      dispatch: deps.renderDispatch,
    }),
    devices: new DeviceService(tables, tokens, clock, config.editorUrl, config.tokens.devicePatDays),
    clients,
    backendSessions,
    stock: deps.stock !== undefined ? deps.stock : directStock(config.stockKeys),
    generations,
    oauth: new OAuthService({
      tables,
      clients,
      tokens,
      clock,
      editorUrl: config.editorUrl,
      accessTtlSeconds: config.tokens.accessTtlSeconds,
      refreshTtlSeconds: config.tokens.refreshTtlSeconds,
      documentationUrl: DOCUMENTATION_URL,
      mcpUrlAliases: config.mcpUrlAliases,
    }),
    sessions: new SessionStore(blobs, clock),
    importer,
    frames: new FrameService(renderer, cache, blobs, clock, deps.resolveAsset),
    prober,
    mediaCache: cache,
    assets: deps.assets ?? null,
    analyzeAudio: deps.analyzeAudio ?? null,
    decodePcm: deps.decodePcm ?? null,
    mixPcm: deps.mixPcm ?? null,
    resolveAsset: deps.resolveAsset ?? null,
    transcribeMedia: deps.transcribeMedia ?? null,
    watchProxy: deps.watchProxy ?? null,
    fontFamilies: deps.fontFamilies ?? null,
    motion: deps.motion ?? null,
    mattes: deps.mattes ?? null,
    transcripts: new RecentTranscripts(clock),
    limiter: new RateLimiter(clock),
    engine: deps.engine ?? null,
    startedAt: clock.now(),
  };
}
