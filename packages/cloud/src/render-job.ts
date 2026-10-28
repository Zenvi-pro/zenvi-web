/**
 * Render worker entry: one Azure Container Apps job execution, started because
 * the render queue has a message (`render/dispatch.ts`). It takes one message,
 * renders the job it names with this execution's CPUs and memory, and exits.
 * The renders table keeps every job, so the message goes as soon as it is
 * read: if this worker dies, the service re-queues the job when its heartbeat
 * stops and hands it to a worker again. Bundled to dist/render-job.mjs; runs
 * with the service's environment.
 *
 * `render-job.mjs --self-test <out.mp4>` renders a one-second generated clip
 * with no storage or queue: the image build and `bundle.test.ts` run
 * it, so a bundle that cannot render fails before it is deployed (W53 B1).
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClip, createProject, type ProjectFile } from "@zenvi/engine";
import { loadConfig } from "./config.js";
import { createLogger, errorMessage } from "./http/log.js";
import { parseTicket, renderQueue } from "./render/dispatch.js";
import { nodeAssetResolver, nodeProber, nodeRenderer } from "./render/node.js";
import { RenderService } from "./render/service.js";
import { MediaService } from "./services/media.js";
import { ProjectService } from "./services/projects.js";
import { AzureBlobStore, AzureTableStore } from "./storage/azure.js";
import { systemClock } from "./util/clock.js";

/** How long the message stays hidden while it is being taken; it is deleted right after. */
const RECEIVE_VISIBILITY_SECONDS = 60;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  if (config.storage.kind !== "azure" || !config.renderQueue) throw new Error("a render worker needs Azure storage and ZENVI_RENDER_QUEUE");

  const queue = renderQueue(config.storage.connectionString, config.renderQueue);
  const [message] = (await queue.receiveMessages({ numberOfMessages: 1, visibilityTimeout: RECEIVE_VISIBILITY_SECONDS })).receivedMessageItems;
  if (!message) {
    // Another execution took it first.
    log.info("render worker: queue empty");
    return;
  }
  await queue.deleteMessage(message.messageId, message.popReceipt);
  const ticket = parseTicket(message.messageText);
  if (!ticket) {
    log.warn("render worker: dropped a message that names no render job", { messageId: message.messageId });
    return;
  }

  const { renderer, reason } = await nodeRenderer();
  if (reason) throw new Error(`rendering unavailable: ${reason}`);
  const blobs = new AzureBlobStore(config.storage.connectionString, config.storage.container);
  const tables = new AzureTableStore(config.storage.connectionString);
  const renders = new RenderService({
    tables,
    blobs,
    projects: new ProjectService(blobs, systemClock, config.limits.maxProjectBytes),
    media: new MediaService(blobs, systemClock, config.limits),
    renderer,
    clock: systemClock,
    log,
    tmpDir: config.renderTmpDir,
    maxRenderMediaBytes: config.limits.maxRenderMediaBytes,
    resolveAsset: nodeAssetResolver(),
  });
  // The platform stops an execution with SIGTERM (replica timeout): leave the job for the service to re-queue.
  process.on("SIGTERM", () => void renders.stop());
  log.info("render worker: rendering", { renderId: ticket.renderId, version: config.version });
  await renders.runOne(ticket.userId, ticket.renderId);
}

async function selfTest(output: string): Promise<void> {
  const { renderer, reason } = await nodeRenderer();
  if (reason) throw new Error(`rendering unavailable: ${reason}`);
  const dir = await mkdtemp(path.join(tmpdir(), "zenvi-render-self-test-"));
  try {
    const source = path.join(dir, "source.mp4");
    await promisify(execFile)(process.env.ZENVI_FFMPEG ?? "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-shortest", source]);
    const project = createProject({ profile: "HD 720p 30 fps" });
    const file = { ...(await nodeProber.probe(source)), id: "SELFTEST01", path: source } as unknown as ProjectFile;
    project.files.push(file);
    project.clips.push(createClip({ id: "SELFTEST02", file, position: 0, layer: project.layers[0]!.number, fps: project.fps }));
    project.duration = 1;
    await renderer.render({
      project,
      resolveMedia: async (media) => media,
      output,
      options: { format: "mp4", width: 320, height: 180, fps: { num: 30, den: 1 }, loudness: { targetLufs: -14, truePeakDbtp: -1 } },
      signal: new AbortController().signal,
      onProgress: () => {},
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const selfTestAt = process.argv.indexOf("--self-test");
(selfTestAt >= 0 ? selfTest(process.argv[selfTestAt + 1] ?? "self-test.mp4") : main()).then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`render worker failed: ${errorMessage(error)}\n`);
    process.exit(1);
  },
);
