import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EffectInstance, FramePlan, KernelContext, LayerPlan, MaskInstance, RgbaImage } from "@zenvi/engine/render";
import { Compositor, type LayerResources } from "./compositor.js";
import type { RenderEngine } from "../engine.js";
import { FakeContext, FakeImage, installFakeCanvas } from "../test-support/fake-canvas.js";

let uninstall: () => void;
beforeAll(() => {
  uninstall = installFakeCanvas();
});
afterAll(() => uninstall());

function layer(overrides: Partial<LayerPlan> = {}): LayerPlan {
  return {
    clipId: "C1",
    layer: 1000000,
    source: { kind: "video", fileId: "F1", path: "a.webm", time: 0, frame: 1 },
    sourceWidth: 320,
    sourceHeight: 180,
    drawWidth: 160,
    drawHeight: 90,
    transform: [2, 0, 0, 2, 10, 20],
    opacity: 1,
    effects: [],
    masks: [],
    ...overrides,
  };
}

function plan(layers: LayerPlan[]): FramePlan {
  return { frame: 1, time: 0, width: 320, height: 180, background: [10, 20, 30, 0], layers };
}

interface KernelCall {
  type: string;
  w: number;
  h: number;
  frame: number;
  images: string[];
  texts: string[];
  state: Map<string, unknown> | undefined;
  context: KernelContext;
}

interface Harness {
  compositor: Compositor;
  resources: LayerResources;
  kernelCalls: KernelCall[];
  maskCalls: { transitionId: string; w: number; h: number; after: number }[];
  released: string[];
  imageRequests: { path: string; w: number; h: number; time: number | undefined; lane: string }[];
}

/** `kernels` maps an effect type to the size it resizes to (or null to keep the size), or "throw". */
function harness(kernels: Record<string, [number, number] | null | "throw"> = {}): Harness {
  const kernelCalls: KernelCall[] = [];
  const maskCalls: Harness["maskCalls"] = [];
  const released: string[] = [];
  const imageRequests: Harness["imageRequests"] = [];
  const engine: RenderEngine = {
    planFrame: () => {
      throw new Error("unused");
    },
    planAudio: () => {
      throw new Error("unused");
    },
    supportsVideoEffect: (type) => type in kernels,
    applyVideoEffect: (image: RgbaImage, effect: EffectInstance, ctx: KernelContext) => {
      const behaviour = kernels[effect.type];
      kernelCalls.push({ type: effect.type, w: image.width, h: image.height, frame: ctx.frame, images: [...ctx.images.keys()], texts: [...(ctx.texts?.keys() ?? [])], state: ctx.state, context: ctx });
      if (behaviour === "throw") throw new Error(`${effect.type} exploded`);
      if (behaviour) return { width: behaviour[0], height: behaviour[1], data: new Uint8ClampedArray(behaviour[0] * behaviour[1] * 4) };
      return image;
    },
    getAudioKernel: () => undefined,
    applyMask: (image: RgbaImage, _mask: RgbaImage, instance: MaskInstance) => {
      maskCalls.push({ transitionId: instance.transitionId, w: image.width, h: image.height, after: kernelCalls.length });
    },
    frameAt: () => 1,
    frameTime: () => 0,
    lastFrame: () => 1,
  };
  const resources: LayerResources = {
    async picture(l) {
      if (l.source.kind === "color") return null;
      if (l.source.kind === "video" && l.source.fileId === "missing") throw new Error("decode failed");
      const image = new FakeImage(l.drawWidth, l.drawHeight, `pic:${l.clipId}`);
      return { image: image as unknown as ImageBitmap, width: image.width, height: image.height, release: () => released.push(l.clipId) };
    },
    async image(path, width, height, time, _mode, lane) {
      imageRequests.push({ path, w: width, h: height, time, lane });
      // The first byte tells which frame of a video this is.
      const data = new Uint8ClampedArray(width * height * 4);
      data[0] = Math.round((time ?? 0) * 10);
      return { width, height, data };
    },
    async text(path) {
      return `text:${path}`;
    },
    async audio(request) {
      return { sampleRate: request.sampleRate, channels: [new Float32Array(request.samples)] };
    },
  };
  return { compositor: new Compositor({ engine, text: null }), resources, kernelCalls, maskCalls, released, imageRequests };
}

const mainContext = () => new FakeContext({ width: 400, height: 300 });
const asContext = (ctx: FakeContext) => ctx as unknown as OffscreenCanvasRenderingContext2D;

describe("Compositor", () => {
  it("fills the opaque background, clips to the frame and draws layers bottom to top through the viewport", async () => {
    const { compositor, resources, released } = harness();
    const ctx = mainContext();
    const p = plan([layer({ clipId: "A" }), layer({ clipId: "B", opacity: 0.5, composite: 14, transform: [1, 0, 0, 1, 5, 6] })]);
    const errors = await compositor.render(p, asContext(ctx), resources, { viewport: { x: 40, y: 30, scale: 0.5 } });
    expect(errors).toEqual([]);
    const fill = ctx.calls.find((c) => c.op === "fillRect")!;
    expect(fill.state.fill).toBe("rgb(10, 20, 30)");
    expect(fill.state.transform).toEqual([0.5, 0, 0, 0.5, 40, 30]);
    expect(fill.args).toEqual([0, 0, 320, 180]);
    const draws = ctx.calls.filter((c) => c.op === "drawImage");
    expect(draws.map((d) => d.args[0])).toEqual(["pic:A", "pic:B"]);
    // viewport ∘ layer transform
    expect(draws[0]!.state.transform).toEqual([1, 0, 0, 1, 45, 40]);
    expect(draws[0]!.args.slice(1)).toEqual([0, 0, 160, 90]);
    expect(draws[1]!.state).toMatchObject({ alpha: 0.5, composite: "screen", transform: [0.5, 0, 0, 0.5, 42.5, 33] });
    expect(ctx.ops()).toContain("clip");
    expect(released.sort()).toEqual(["A", "B"]);
    // The fast path never reads pixels back.
    expect(ctx.ops()).not.toContain("getImageData");
  });

  it("fills color layers and skips layers whose media failed, reporting the error", async () => {
    const { compositor, resources } = harness();
    const ctx = mainContext();
    const p = plan([
      layer({ clipId: "bad", source: { kind: "video", fileId: "missing", path: "x", time: 0, frame: 1 } }),
      layer({ clipId: "col", source: { kind: "color", color: [255, 0, 0, 255] } }),
    ]);
    const errors = await compositor.render(p, asContext(ctx), resources);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ clipId: "bad", stage: "decode" });
    const fills = ctx.calls.filter((c) => c.op === "fillRect");
    expect(fills).toHaveLength(2);
    expect(fills[1]!.state.fill).toBe("rgba(255, 0, 0, 1)");
    expect(ctx.calls.filter((c) => c.op === "drawImage")).toHaveLength(0);
  });

  it("runs source-stage kernels in order, then transition masks, at draw size, with preloaded resources", async () => {
    const { compositor, resources, kernelCalls, maskCalls } = harness({ Brightness: null, Blur: null });
    const ctx = mainContext();
    const p = plan([
      layer({
        effects: [
          { id: "E1", type: "Brightness", frame: 7, params: {}, images: ["m.png"], texts: ["l.cube"] },
          { id: "E2", type: "Unsupported", frame: 7, params: {} },
          { id: "E3", type: "Blur", frame: 8, params: {} },
        ],
        masks: [{ transitionId: "T1", maskPath: "@transitions/common/fade.svg", brightness: 0, contrast: 3, replaceImage: false }],
      }),
    ]);
    const errors = await compositor.render(p, asContext(ctx), resources);
    expect(errors).toEqual([]);
    expect(kernelCalls.map((k) => [k.type, k.w, k.h, k.frame])).toEqual([
      ["Brightness", 160, 90, 7],
      ["Blur", 160, 90, 8],
    ]);
    expect(kernelCalls[0]!.images).toEqual(["m.png"]);
    expect(kernelCalls[0]!.texts).toEqual(["l.cube"]);
    expect(maskCalls).toEqual([{ transitionId: "T1", w: 160, h: 90, after: 2 }]);
    // The processed scratch canvas is drawn with the layer transform.
    const draw = ctx.calls.filter((c) => c.op === "drawImage").at(-1)!;
    expect(String(draw.args[0])).toMatch(/^scratch/);
    expect(draw.state.transform).toEqual([2, 0, 0, 2, 10, 20]);
    expect(draw.args.slice(1)).toEqual([0, 0, 160, 90]);
  });

  it("draws a resized kernel result into the draw rect; masks then see the new size", async () => {
    const { compositor, resources, maskCalls } = harness({ Crop: [80, 45] });
    const ctx = mainContext();
    const p = plan([
      layer({
        effects: [{ id: "E1", type: "Crop", frame: 1, params: {} }],
        masks: [{ transitionId: "T1", maskPath: "mask.png", brightness: 0, contrast: 0, replaceImage: false }],
      }),
    ]);
    await compositor.render(p, asContext(ctx), resources);
    expect(maskCalls).toEqual([{ transitionId: "T1", w: 80, h: 45, after: 1 }]);
    const draw = ctx.calls.filter((c) => c.op === "drawImage").at(-1)!;
    expect(draw.args.slice(1)).toEqual([0, 0, 160, 90]);
  });

  it("runs canvas-stage effects then canvas-stage masks on the layer drawn with its opacity", async () => {
    const { compositor, resources, kernelCalls, maskCalls, imageRequests } = harness({ Shadow: null });
    const ctx = mainContext();
    const p = plan([
      layer({
        opacity: 0.8,
        composite: 13,
        effects: [{ id: "S", type: "Shadow", frame: 3, params: {}, applyBeforeClip: false, images: ["glow.png"] }],
        masks: [{ transitionId: "T", maskPath: "wipe.png", brightness: 0, contrast: 0, replaceImage: false, applyBeforeClip: false }],
      }),
    ]);
    await compositor.render(p, asContext(ctx), resources, { viewport: { x: 4, y: 2, scale: 1 } });
    expect(kernelCalls.map((k) => [k.type, k.w, k.h, k.frame, k.images])).toEqual([["Shadow", 320, 180, 3, ["glow.png"]]]);
    expect(maskCalls).toEqual([{ transitionId: "T", w: 320, h: 180, after: 1 }]);
    // Canvas-stage resources are loaded at canvas size.
    expect(imageRequests.map((r) => [r.path, r.w, r.h])).toEqual([
      ["wipe.png", 320, 180],
      ["glow.png", 320, 180],
    ]);
    // Opacity went into the layer before its effects; the finished layer composites at full alpha.
    const draw = ctx.calls.filter((c) => c.op === "drawImage").at(-1)!;
    expect(draw.state).toMatchObject({ alpha: 1, composite: "multiply", transform: [1, 0, 0, 1, 4, 2] });
    expect(draw.args.slice(1)).toEqual([0, 0, 320, 180]);
    const { FakeOffscreenCanvas } = await import("../test-support/fake-canvas.js");
    const layerDraw = FakeOffscreenCanvas.created.flatMap((c) => c.__ctx.calls).filter((c) => c.op === "drawImage" && c.args[0] === "pic:C1").at(-1)!;
    expect(layerDraw.state).toMatchObject({ alpha: 0.8, transform: [2, 0, 0, 2, 10, 20] });
  });

  it("clips to the corner radius in draw space", async () => {
    const { compositor, resources } = harness();
    const ctx = mainContext();
    await compositor.render(plan([layer({ cornerRadius: 12 })]), asContext(ctx), resources);
    const round = ctx.calls.find((c) => c.op === "roundRect")!;
    expect(round.args).toEqual([0, 0, 160, 90, 12]);
    expect(round.state.transform).toEqual([2, 0, 0, 2, 10, 20]);
    // A radius larger than half the rect is capped (a circle at most).
    const ctx2 = mainContext();
    await compositor.render(plan([layer({ cornerRadius: 500 })]), asContext(ctx2), resources);
    expect(ctx2.calls.find((c) => c.op === "roundRect")!.args[4]).toBe(45);
  });

  it("keeps per-effect state across a sequential render and forgets it on reset", async () => {
    const { compositor, resources, kernelCalls } = harness({ BeatSync: null });
    const ctx = mainContext();
    const p = plan([layer({ effects: [{ id: "B", type: "BeatSync", frame: 1, params: {} }] })]);
    await compositor.render(p, asContext(ctx), resources);
    kernelCalls[0]!.state!.set("envelope", 0.5);
    await compositor.render(p, asContext(ctx), resources);
    expect(kernelCalls[1]!.state!.get("envelope")).toBe(0.5);
    compositor.resetEffectState();
    await compositor.render(p, asContext(ctx), resources);
    expect(kernelCalls[2]!.state!.has("envelope")).toBe(false);
  });

  it("gives kernels the plan's timeline format, the clip timing and the layer's audio", async () => {
    const { compositor, resources, kernelCalls, imageRequests } = harness({ AudioVisualization: null });
    const ctx = mainContext();
    const p: FramePlan = {
      ...plan([
        layer({
          clip: { mappedFrame: 9, readerFps: 25, duration: 4 },
          audio: { fileId: "F1", path: "a.webm", sourceStart: 1, samples: 1600, sampleRate: 48000, channels: 2 },
          effects: [{ id: "V", type: "AudioVisualization", frame: 9, params: {}, images: ["map.webm"], imageFrames: { "map.webm": { frame: 5, time: 0.16 } } }],
        }),
      ]),
      fps: { num: 30, den: 1 },
      timelineWidth: 1920,
      timelineHeight: 1080,
    };
    await compositor.render(p, asContext(ctx), resources);
    const context = kernelCalls[0]!.context;
    expect(context).toMatchObject({ frame: 9, effectId: "V", fps: { num: 30, den: 1 }, timelineWidth: 1920, timelineHeight: 1080, clip: { mappedFrame: 9, readerFps: 25, duration: 4 } });
    expect(context.audio?.channels[0]).toHaveLength(1600);
    expect(imageRequests).toEqual([{ path: "map.webm", w: 160, h: 90, time: 0.16, lane: "C1" }]);
  });

  it("gives each clip its own frame of a video matte two clips read at once, each on its own lane", async () => {
    const { compositor, resources, kernelCalls, imageRequests } = harness({ Mask: null });
    const ctx = mainContext();
    const mask = (time: number): EffectInstance => ({ id: `M${time}`, type: "Mask", frame: 1, params: {}, images: ["matte.mp4"], imageFrames: { "matte.mp4": { frame: time * 30 + 1, time } } });
    const p = plan([layer({ clipId: "A", effects: [mask(0.5)] }), layer({ clipId: "B", effects: [mask(1.5)] })]);
    expect(await compositor.render(p, asContext(ctx), resources)).toEqual([]);
    expect(kernelCalls.map((k) => k.context.images.get("matte.mp4")!.data[0])).toEqual([5, 15]);
    expect(imageRequests.map((r) => [r.time, r.lane])).toEqual([
      [0.5, "A"],
      [1.5, "B"],
    ]);
  });

  it("isolates a failing kernel: the layer still draws and the error is reported", async () => {
    const { compositor, resources, kernelCalls } = harness({ Bad: "throw", Blur: null });
    const ctx = mainContext();
    const p = plan([layer({ effects: [{ id: "B", type: "Bad", frame: 1, params: {} }, { id: "U", type: "Blur", frame: 1, params: {} }] })]);
    const errors = await compositor.render(p, asContext(ctx), resources);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ clipId: "C1", stage: "effect" });
    expect(kernelCalls.map((k) => k.type)).toEqual(["Bad", "Blur"]);
    expect(ctx.calls.filter((c) => c.op === "drawImage")).toHaveLength(1);
  });

  it("handles QPainter Clear and Destination modes", async () => {
    const { compositor, resources } = harness();
    const ctx = mainContext();
    await compositor.render(plan([layer({ clipId: "clear", composite: 2 }), layer({ clipId: "dest", composite: 4 })]), asContext(ctx), resources);
    expect(ctx.ops()).toContain("clearRect");
    expect(ctx.calls.filter((c) => c.op === "drawImage")).toHaveLength(0);
  });

  it("abandons a prepared frame when aborted and gives its pictures back", async () => {
    const { compositor, resources, released } = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(compositor.prepare(plan([layer({ clipId: "A" })]), resources, { signal: controller.signal })).rejects.toBeDefined();
    expect(released).toEqual(["A"]);
  });
});
