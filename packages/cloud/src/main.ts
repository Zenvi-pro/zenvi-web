/**
 * Process entry: configuration, storage, auth, renderer, HTTP server,
 * background housekeeping and graceful shutdown. Bundled to dist/server.mjs.
 */

import { isAbsolute } from "node:path";
import { serve } from "@hono/node-server";
import { resolveBinary, whichSync } from "@zenvi/render-node";
import { createApp } from "./app.js";
import { createSupabaseVerifier } from "./auth/supabase.js";
import { loadConfig } from "./config.js";
import { createServices } from "./container.js";
import { createLogger, errorMessage } from "./http/log.js";
import { loadEngineRegistry } from "./mcp/engine.js";
import { nodeAnalyzeAudio, nodeAssetResolver, nodeAssetSource, nodeProber, nodeRenderer } from "./render/node.js";
import { unavailableProber } from "./render/renderer.js";
import { AzureBlobStore, AzureTableStore } from "./storage/azure.js";
import { MemoryBlobStore, MemoryTableStore } from "./storage/memory.js";
import type { BlobStore, TableStore } from "./storage/types.js";

const HOUSEKEEPING_MS = 6 * 3_600_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  let blobs: BlobStore;
  let tables: TableStore;
  if (config.storage.kind === "azure") {
    blobs = new AzureBlobStore(config.storage.connectionString, config.storage.container);
    const azureTables = new AzureTableStore(config.storage.connectionString);
    await azureTables.ensure();
    tables = azureTables;
  } else {
    log.warn("using in-memory storage: data is lost on restart");
    blobs = new MemoryBlobStore();
    tables = new MemoryTableStore();
  }

  const engine = await loadEngineRegistry().catch((error: unknown) => {
    log.error("engine tool registry failed to load", { error: errorMessage(error) });
    return null;
  });

  const found = (name: "ffmpeg" | "ffprobe"): boolean => {
    const binary = resolveBinary(name);
    return isAbsolute(binary) || whichSync(binary) !== undefined;
  };
  const haveFfprobe = found("ffprobe");
  const haveFfmpeg = found("ffmpeg");
  if (!haveFfprobe) log.warn("ffprobe not found: URL imports and generated media are disabled");
  if (!haveFfmpeg) log.warn("ffmpeg not found: audio analysis is disabled");
  const assets = nodeAssetSource();
  if (!assets) log.warn("engine assets not found: title tools are disabled");
  const { renderer, reason } = await nodeRenderer();
  if (reason) log.warn("rendering unavailable", { reason });

  const services = createServices({
    config,
    blobs,
    tables,
    log,
    engine,
    renderer,
    prober: haveFfprobe ? nodeProber : unavailableProber,
    resolveAsset: nodeAssetResolver(),
    assets,
    analyzeAudio: haveFfmpeg ? nodeAnalyzeAudio : undefined,
    supabase: createSupabaseVerifier({ supabaseUrl: config.supabaseUrl, log: (message) => log.warn(message) }),
  });
  const app = createApp(services);

  const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    log.info("listening", {
      port: info.port,
      publicBaseUrl: config.publicBaseUrl,
      storage: blobs.kind,
      renderer: services.renders.rendererAvailable,
      engineTools: engine?.tools.length ?? 0,
      version: config.version,
    });
  });

  // Pick up queued jobs and jobs whose worker died (restart, deploy), now and every minute.
  const recoverJobs = (): void => {
    services.renders
      .recover()
      .then((count) => count > 0 && log.info("picked up render jobs", { count }))
      .catch((error: unknown) => log.error("render job recovery failed", { error: errorMessage(error) }));
    services.generations
      .recover()
      .then((count) => count > 0 && log.info("picked up generation jobs", { count }))
      .catch((error: unknown) => log.error("generation job recovery failed", { error: errorMessage(error) }));
  };
  recoverJobs();
  services.verifier
    .resume()
    .then((count) => count > 0 && log.info("resumed upload hash checks", { count }))
    .catch((error: unknown) => log.error("resuming upload hash checks failed", { error: errorMessage(error) }));
  const recovery = setInterval(recoverJobs, 60_000);
  recovery.unref();

  const housekeeping = setInterval(() => {
    void Promise.allSettled([services.tokens.sweepExpired(), services.devices.sweepExpired(), services.oauth.sweepExpired()]).then((results) => {
      const removed = results.map((r) => (r.status === "fulfilled" ? r.value : 0));
      const failed = results.filter((r) => r.status === "rejected").map((r) => errorMessage((r as PromiseRejectedResult).reason));
      log.info("housekeeping", { tokens: removed[0], devices: removed[1], oauth: removed[2], ...(failed.length ? { failed } : {}) });
    });
  }, HOUSEKEEPING_MS);
  housekeeping.unref();

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    clearInterval(housekeeping);
    clearInterval(recovery);
    server.close();
    void Promise.all([services.renders.stop(), services.generations.stop()]).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 20_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  process.stderr.write(`zenvi-cloud failed to start: ${errorMessage(error)}\n`);
  process.exit(1);
});
