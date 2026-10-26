import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@zenvi/engine";
import type { FramePlan, LayerPlan } from "@zenvi/engine/render";
import type { RenderEngine } from "../../engine.js";
import { MediaRegistry } from "../../media/registry.js";
import { FakeOffscreenCanvas, installFakeCanvas } from "../../test-support/fake-canvas.js";
import { PreviewPlayer, type PlayerErrorEvent } from "../preview-player.js";
import { servePreviewWorker } from "./host.js";
import type { Endpoint, FromWorker, ToWorker } from "./protocol.js";

const FPS = 30;

/** 3 s long; frames 1–30 show a video layer of file `fileId`, the rest are empty. */
function engine(planned: { frame: number; width: number; height: number }[], fileId = "F1"): RenderEngine {
  const layer: LayerPlan = {
    clipId: "C1",
    layer: 1000000,
    source: { kind: "video", fileId, path: `${fileId}.webm`, time: 0, frame: 1 },
    sourceWidth: 160,
    sourceHeight: 90,
    drawWidth: 160,
    drawHeight: 90,
    transform: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    effects: [],
    masks: [],
  };
  return {
    planFrame(_project, frame, size): FramePlan {
      planned.push({ frame, width: size.width, height: size.height });
      return { frame, time: (frame - 1) / FPS, width: 160, height: 90, background: [0, 0, 0, 255], layers: frame <= 30 ? [layer] : [] };
    },
    planAudio: (_project, range) => ({ sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments: [] }),
    applyVideoEffect: (image) => image,
    supportsVideoEffect: () => false,
    getAudioKernel: () => undefined,
    applyMask: () => undefined,
    frameAt: (_project, seconds) => Math.floor(seconds * FPS + 1e-9) + 1,
    frameTime: (_project, frame) => (frame - 1) / FPS,
    lastFrame: () => 3 * FPS,
  };
}

const project = { width: 160, height: 90, fps: { num: FPS, den: 1 }, duration: 300 } as unknown as Project;

/** Two ends of an asynchronous channel (like a Worker and its scope), without cloning. */
function channel(): { page: Endpoint<ToWorker, FromWorker>; worker: Endpoint<FromWorker, ToWorker>; sent: ToWorker[] } {
  type Listener = (event: MessageEvent) => void;
  const ends = { page: new Set<Listener>(), worker: new Set<Listener>() };
  const sent: ToWorker[] = [];
  const end = <Out, In>(mine: Set<Listener>, theirs: Set<Listener>, log?: Out[]): Endpoint<Out, In> => ({
    postMessage(message) {
      log?.push(message);
      queueMicrotask(() => {
        for (const listener of [...theirs]) listener({ data: message } as MessageEvent);
      });
    },
    addEventListener: (_type, listener) => mine.add(listener as Listener),
    removeEventListener: (_type, listener) => mine.delete(listener as Listener),
  });
  return { page: end<ToWorker, FromWorker>(ends.page, ends.worker, sent), worker: end<FromWorker, ToWorker>(ends.worker, ends.page), sent };
}

/** A page `<canvas>` as far as the player needs one. */
function element(width = 320, height = 180) {
  return { width, height, transferControlToOffscreen: vi.fn(() => new FakeOffscreenCanvas(width, height)) };
}

let uninstall: () => void;
beforeEach(() => {
  uninstall = installFakeCanvas();
});
afterEach(() => uninstall());

function setup(fileId?: string) {
  const planned: { frame: number; width: number; height: number }[] = [];
  const { page, worker, sent } = channel();
  const stop = servePreviewWorker(worker, { engine: engine(planned, fileId) });
  const media = new MediaRegistry();
  const canvas = element();
  const player = new PreviewPlayer(canvas as unknown as HTMLCanvasElement, { media, engine: engine([], fileId), worker: page as unknown as Worker });
  const errors: PlayerErrorEvent[] = [];
  player.onError((e) => errors.push(e));
  player.setProject(project);
  return { player, planned, media, canvas, page, sent, errors, stop };
}

describe("PreviewPlayer with a worker", () => {
  it("plans and draws in the worker at the canvas's size", async () => {
    const { player, planned, canvas, stop } = setup();
    await player.seek(2);
    expect(canvas.transferControlToOffscreen).toHaveBeenCalledTimes(1);
    expect(planned.at(-1)).toEqual({ frame: 61, width: 320, height: 180 });
    expect(player.frame).toBe(61);
    expect(player.presentedFrames).toBeGreaterThan(0);
    expect(player.inWorker).toBe(true);
    expect(player.state.waiting).toBe(false);
    player.dispose();
    stop();
  });

  it("coalesces rapid seeks: only the latest waiting request renders", async () => {
    const { player, planned, stop } = setup();
    await player.seek(2);
    planned.length = 0;
    await Promise.all([1.1, 1.5, 2.0, 2.5, 2.9].map((t) => player.seek(t)));
    // The first starts rendering at once; the ones in between are replaced by the last.
    expect(planned.map((p) => p.frame)).toEqual([34, 88]);
    expect(player.frame).toBe(88);
    player.dispose();
    stop();
  });

  it("reads media the page registers, and forgets it when the page does", async () => {
    const { player, media, errors, stop } = setup();
    // Not on the page: the worker's read fails the way the page's would.
    await player.seek(0.5);
    expect(errors.at(-1)?.kind).toBe("layer");
    // (Crossing postMessage, errors keep their message, not their class.)
    expect(String((errors.at(-1) as { error: unknown }).error)).toMatch(/No media registered for F1/);

    // Registered (with bytes no demuxer reads): found, then fails to open.
    media.register("F1", { kind: "blob", blob: new Blob(["not a video"]), name: "F1.webm" });
    errors.length = 0;
    await player.seek(0.6);
    expect(errors).toHaveLength(1);
    expect(String((errors[0] as { error: unknown }).error)).not.toMatch(/No media registered/);

    // Unregistered on the page: unknown in the worker again.
    media.unregister("F1");
    errors.length = 0;
    await player.seek(0.7);
    // The same MediaUnavailableError as the first seek is reported only once; nothing else is.
    expect(errors).toEqual([]);
    player.dispose();
    stop();
  });

  it("a second player on the same canvas reuses the transferred surface", async () => {
    const { player, page, canvas, media, stop } = setup();
    await player.seek(2);
    player.dispose();
    const planned: { frame: number; width: number; height: number }[] = [];
    const again = new PreviewPlayer(canvas as unknown as HTMLCanvasElement, { media, engine: engine(planned), worker: page as unknown as Worker });
    again.setProject(project);
    await again.seek(1);
    expect(canvas.transferControlToOffscreen).toHaveBeenCalledTimes(1);
    expect(again.frame).toBe(31);
    again.dispose();
    stop();
  });
});
