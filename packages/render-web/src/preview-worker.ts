// Entry of the preview Worker: `new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" })`
// over a file that imports this one, then `new PreviewPlayer(canvas, { media, worker })`.
import { servePreviewWorker } from "./player/worker/host.js";
import type { Endpoint, FromWorker, ToWorker } from "./player/worker/protocol.js";

servePreviewWorker(globalThis as unknown as Endpoint<FromWorker, ToWorker>);
