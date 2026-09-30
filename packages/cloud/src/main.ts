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
import { nodeAssetResolver, nodeProber, nodeRenderer } from "./render/node.js";
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
    tables = new AzureTableStore(config.storage.connectionString);
  } else {
    log.warn("using in-memory storage: data is lost on restart");
    blobs = new MemoryBlobStore();
    tables = new MemoryTableStore();
  }

  const engine = await loadEngineRegistry().catch((error: unknown) => {
    log.error("engine tool registry failed to load", { error: errorMessage(error) });
    return null;
  });

  const ffprobe = resolveBinary("ffprobe");
  const haveFfprobe = isAbsolute(ffprobe) || whichSync(ffprobe) !== undefined;
  if (!haveFfprobe) log.warn("ffprobe not found: URL imports are disabled");
  const renderer = nodeRenderer();

  const services = createServices({
    config,
    blobs,
    tables,
    log,
    engine,
    renderer,
    prober: haveFfprobe ? nodeProber : unavailableProber,
    resolveAsset: nodeAssetResolver(),
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

  services.renders
    .resume()
    .then((count) => count > 0 && log.info("resumed render jobs", { count }))
    .catch((error: unknown) => log.error("resuming render jobs failed", { error: errorMessage(error) }));

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
    server.close();
    void services.renders.stop().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 20_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  process.stderr.write(`zenvi-cloud failed to start: ${errorMessage(error)}\n`);
  process.exit(1);
});
