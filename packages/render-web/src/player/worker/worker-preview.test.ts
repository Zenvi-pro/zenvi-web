import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@zenvi/engine";
import type { FramePlan, LayerPlan } from "@zenvi/engine/render";
import type { RenderEngine } from "../../engine.js";
import { MediaRegistry } from "../../media/registry.js";
import { FakeOffscreenCanvas, installFakeCanvas } from "../../test-support/fake-canvas.js";
import { PreviewPlayer, type PlayerErrorEvent } from "../preview-player.js";
import { servePreviewWorker } from "./host.js";
import type { WorkerEndpoint } from "./client.js";
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

type PageEnd = WorkerEndpoint & { emit(type: "error" | "messageerror", event: Event): void };

/**
 * Two ends of an asynchronous channel (like a Worker and its scope), without
 * cloning. `kill` makes it a dead worker: messages vanish, no event fires.
 */
function channel(): { page: PageEnd; worker: Endpoint<FromWorker, ToWorker>; sent: ToWorker[]; received: FromWorker[]; kill(): void } {
  type Listener = (event: Event) => void;
  const listeners = { page: new Map<string, Set<Listener>>(), worker: new Map<string, Set<Listener>>() };
  const sent: ToWorker[] = [];
  const received: FromWorker[] = [];
  let dead = false;
  const of = (side: Map<string, Set<Listener>>, type: string) => side.get(type) ?? side.set(type, new Set()).get(type)!;
  const end = (mine: Map<string, Set<Listener>>, theirs: Map<string, Set<Listener>>, log: unknown[]) => ({
    postMessage(message: unknown) {
      log.push(message);
      if (dead) return;
      queueMicrotask(() => {
        if (dead) return;
        for (const listener of [...of(theirs, "message")]) listener({ data: message } as MessageEvent);
      });
    },
    addEventListener: (type: string, listener: Listener) => void of(mine, type).add(listener),
    removeEventListener: (type: string, listener: Listener) => void of(mine, type).delete(listener),
    emit: (type: string, event: Event) => {
      for (const listener of [...of(mine, type)]) listener(event);
    },
  });
  return {
    page: end(listeners.page, listeners.worker, sent) as unknown as PageEnd,
    worker: end(listeners.worker, listeners.page, received) as unknown as Endpoint<FromWorker, ToWorker>,
    sent,
    received,
    kill: () => void (dead = true),
  };
}

/** A page `<canvas>` as far as the player needs one, in a document that can make stand-ins. */
function element(width = 320, height = 180) {
  const standIns: (FakeOffscreenCanvas & { attrs: Record<string, string>; removed: boolean })[] = [];
  const el = {
    width,
    height,
    attributes: [{ name: "class", value: "block h-full w-full" }, { name: "id", value: "preview" }],
    style: { display: "" },
    transferControlToOffscreen: vi.fn(() => new FakeOffscreenCanvas(width, height)),
    after: vi.fn(),
    standIns,
    ownerDocument: {
      createElement: () => {
        const standIn = Object.assign(new FakeOffscreenCanvas(width, height), {
          attrs: {} as Record<string, string>,
          removed: false,
          setAttribute(name: string, value: string) {
            standIn.attrs[name] = value;
          },
          remove() {
            standIn.removed = true;
          },
        });
        standIns.push(standIn);
        return standIn;
      },
    },
  };
  return el;
}

let uninstall: () => void;
beforeEach(() => {
  uninstall = installFakeCanvas();
});
afterEach(() => uninstall());

function setup(fileId?: string, options: { serve?: boolean; media?: MediaRegistry } = {}) {
  const planned: { frame: number; width: number; height: number }[] = [];
  const onPage: { frame: number; width: number; height: number }[] = [];
  const { page, worker, sent, received, kill } = channel();
  const stop = options.serve === false ? () => undefined : servePreviewWorker(worker, { engine: engine(planned, fileId) });
  const media = options.media ?? new MediaRegistry();
  const canvas = element();
  const player = new PreviewPlayer(canvas as unknown as HTMLCanvasElement, { media, engine: engine(onPage, fileId), worker: page as unknown as Worker });
  const errors: PlayerErrorEvent[] = [];
  player.onError((e) => errors.push(e));
  player.setProject(project);
  return { player, planned, onPage, media, canvas, page, sent, received, errors, stop, kill };
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
    const { player, media, errors, received, stop } = setup();
    const lookups = () => received.filter((m) => m.type === "call" && m.method === "source").length;
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
    const before = lookups();
    media.unregister("F1");
    errors.length = 0;
    await player.seek(0.7);
    // The worker dropped its entry and asked the page again.
    expect(lookups()).toBe(before + 1);
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

describe("PreviewPlayer when the worker fails", () => {
  it("renders on the page when the worker fails to start, and so do later players on that worker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { player, onPage, canvas, page, sent, media } = setup("F1", { serve: false });
    const seeking = player.seek(2);
    page.emit("error", Object.assign(new Event("error"), { message: "Failed to fetch module" }));
    await seeking;
    expect(player.inWorker).toBe(false);
    expect(player.frame).toBe(61);
    expect(onPage.at(-1)).toEqual({ frame: 61, width: 320, height: 180 });
    // The transferred canvas cannot draw here: a stand-in takes its place.
    expect(canvas.after).toHaveBeenCalledWith(canvas.standIns[0]);
    expect(canvas.standIns[0]!.attrs).toEqual({ class: "block h-full w-full" });
    expect(canvas.style.display).toBe("none");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/failed to start: Failed to fetch module.*renders on the page/);
    player.dispose();
    expect(canvas.standIns[0]!.removed).toBe(true);
    expect(canvas.style.display).toBe("");

    // A remount on the dead worker goes straight to the page.
    const posted = sent.length;
    const again = new PreviewPlayer(canvas as unknown as HTMLCanvasElement, { media, engine: engine(onPage), worker: page as unknown as Worker });
    again.setProject(project);
    await again.seek(1);
    expect(again.inWorker).toBe(false);
    expect(again.frame).toBe(31);
    expect(sent).toHaveLength(posted);
    expect(canvas.transferControlToOffscreen).toHaveBeenCalledTimes(1);
    expect(canvas.standIns).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    again.dispose();
    warn.mockRestore();
  });

  it("gives up on a worker that never answers, and on one that dies mid-playback", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Never started (a module that hangs loading): the open times out.
      const silent = setup("F1", { serve: false });
      const seeking = silent.player.seek(1);
      await vi.advanceTimersByTimeAsync(14_000);
      expect(silent.player.inWorker).toBe(true);
      await vi.advanceTimersByTimeAsync(2_000);
      await seeking;
      expect(silent.player.inWorker).toBe(false);
      expect(silent.player.frame).toBe(31);
      expect(String(warn.mock.calls.at(-1)![0])).toMatch(/did not start within 15 s/);
      silent.player.dispose();

      // Started, then gone without a word (terminated, crashed) while playing.
      const { player, planned, onPage, sent, kill, stop } = setup();
      await player.seek(0);
      player.loop = true;
      player.play();
      await vi.advanceTimersByTimeAsync(500);
      expect(planned.length).toBeGreaterThan(5);
      expect(onPage).toEqual([]);
      kill();
      const pending = player.seek(1);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(3_000);
      // Asked whether it is there; not given up on yet.
      expect(sent.some((m) => m.type === "ping")).toBe(true);
      expect(player.inWorker).toBe(true);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(6_000);
      await pending;
      expect(player.inWorker).toBe(false);
      expect(String(warn.mock.calls.at(-1)![0])).toMatch(/stopped answering/);
      // Told to close its session there, in case it is only slow.
      expect(sent.filter((m) => m.type === "close")).toHaveLength(1);
      // Playback carries on, on the page.
      expect(player.isPlaying).toBe(true);
      const drawn = onPage.length;
      await vi.advanceTimersByTimeAsync(300);
      expect(onPage.length).toBeGreaterThan(drawn);
      expect(player.presentedFrames).toBeGreaterThan(0);
      player.dispose();
      stop();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reports an uncaught exception in a running worker and keeps rendering there", async () => {
    const { player, page, errors, stop } = setup();
    await player.seek(1);
    page.emit("error", Object.assign(new Event("error"), { message: "boom" }));
    expect(errors.at(-1)).toEqual({ kind: "render", error: new Error("Uncaught in the preview worker: boom") });
    await player.seek(2);
    expect(player.inWorker).toBe(true);
    expect(player.frame).toBe(61);
    player.dispose();
    stop();
  });
});

describe("WorkerPreview answering the worker", () => {
  it("re-reads a ref by its file id once the page registers it (it was read by path until then)", async () => {
    const media = new MediaRegistry({ resolvePath: (path) => (path === "F1.webm" ? { kind: "blob", blob: new Blob(["bundled"]), name: "F1.webm" } : undefined) });
    const { player, sent, stop } = setup("F1", { media });
    const answers = () => sent.flatMap((m) => (m.type === "reply" && m.value && typeof m.value === "object" && "key" in m.value ? [m.value.key] : []));
    await player.seek(0.5);
    expect(answers()).toEqual(["path:F1.webm"]);
    await player.seek(0.6);
    expect(answers()).toEqual(["path:F1.webm"]);
    media.register("F1", { kind: "blob", blob: new Blob(["registered"]), name: "F1.webm" });
    await player.seek(0.7);
    expect(answers()).toEqual(["path:F1.webm", "file:F1"]);
    player.dispose();
    stop();
  });

  it("runs the worker's fetches with their method, body, headers and abort, and answers opaque responses", async () => {
    const { page, worker, sent } = channel();
    const seen: { url: string; init: RequestInit }[] = [];
    const media = new MediaRegistry();
    media.register("U", {
      kind: "url",
      url: "https://cdn.test/u.webm",
      fetch: (input, init = {}) => {
        seen.push({ url: String(input), init });
        if (String(input).endsWith("/opaque")) return Promise.resolve(Response.error());
        if (String(input).endsWith("/hang")) return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
        return Promise.resolve(new Response("partial", { status: 206, headers: { "content-range": "bytes 0-6/100" } }));
      },
    });
    const player = new PreviewPlayer(element() as unknown as HTMLCanvasElement, { media, worker: page as unknown as Worker });
    const id = sent[0]!.id;
    worker.postMessage({ type: "opened", id }, []);
    const ask = (call: number, url: string, init: Extract<ToWorker, { type: "reply" }>["value"]) =>
      worker.postMessage({ type: "call", id, call, method: "fetch", key: "file:U", url, init } as FromWorker, []);
    const reply = async (call: number) => {
      await vi.waitFor(() => expect(sent.some((m) => m.type === "reply" && m.call === call)).toBe(true));
      return sent.find((m): m is Extract<ToWorker, { type: "reply" }> => m.type === "reply" && m.call === call)!;
    };

    ask(1, "https://cdn.test/u.webm", { method: "POST", headers: [["range", "bytes=0-6"]], body: new TextEncoder().encode("hi").buffer });
    const ok = (await reply(1)).value as { status: number; headers: [string, string][]; body: ArrayBuffer };
    expect(seen[0]!.init.method).toBe("POST");
    expect(new TextDecoder().decode(seen[0]!.init.body as ArrayBuffer)).toBe("hi");
    expect(seen[0]!.init.headers).toEqual([["range", "bytes=0-6"]]);
    expect(seen[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(ok.status).toBe(206);
    expect(ok.headers).toContainEqual(["content-range", "bytes 0-6/100"]);
    expect(new TextDecoder().decode(ok.body)).toBe("partial");

    ask(2, "https://cdn.test/opaque", {});
    expect((await reply(2)).value).toEqual({ status: 0, statusText: "", headers: [], body: null });

    ask(3, "https://cdn.test/hang", {});
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    worker.postMessage({ type: "abort", id, call: 3 }, []);
    expect(String((await reply(3)).error)).toMatch(/abort/i);
    expect(seen[2]!.init.signal!.aborted).toBe(true);
    player.dispose();
  });
});
