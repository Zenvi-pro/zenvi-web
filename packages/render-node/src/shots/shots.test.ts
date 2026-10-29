import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cosine, normalize } from "@zenvi/engine";
import { onnxRuntimeAvailable } from "../matte/rvm.js";
import { ensureModel, modelDir, modelDownloadMb, modelPresent, type ModelDescriptor } from "../matte/model-cache.js";
import { makeImage, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { createNodeShotHost, type ShotModel } from "./host.js";
import { SIGLIP_BASE, Siglip } from "./siglip.js";

let dir: string | undefined;
afterEach(async () => {
  await removeDir(dir);
  dir = undefined;
});

/** Embeds a frame as its mean colour, so frames of one colour are identical and testsrc2 frames differ. */
function colourModel(calls: number[]): ShotModel {
  return {
    info: { name: "colour", version: "1", license: "MIT", dims: 3, logitScale: 1, logitBias: 0 },
    async embedImages(frames) {
      calls.push(frames.length);
      return frames.map((rgb) => {
        const sum = [1, 1, 1];
        for (let i = 0; i < rgb.length; i += 3) for (let c = 0; c < 3; c += 1) sum[c]! += rgb[i + c]!;
        return normalize(sum);
      });
    },
    async embedText(texts) {
      return texts.map(() => normalize([1, 0, 0]));
    },
  };
}

describe("node shot host", () => {
  it("embeds a keyframe every interval (a short clip still gets one) and reads the cache the second time", async () => {
    dir = await makeTempDir("zenvi-shots-");
    const clip = await makeVideo(dir, "clip.mp4", { duration: 2.2 });
    const short = await makeVideo(dir, "short.mp4", { duration: 0.2 });
    const still = await makeImage(dir, "red.png", { color: "red" });
    const calls: number[] = [];
    const host = createNodeShotHost({ root: dir, model: colourModel(calls) });
    const first = await host.embedFile(clip, { interval: 0.5 });
    expect(first).toMatchObject({ cached: false, times: [0, 0.5, 1, 1.5, 2] });
    const again = await host.embedFile(clip, { interval: 0.5 });
    expect(again!.cached).toBe(true);
    expect(again!.vectors.map((v, i) => cosine(v, first!.vectors[i]!))).toEqual(first!.vectors.map(() => expect.closeTo(1, 5)));
    expect(calls).toEqual([5]);
    expect((await host.embedFile(short, { interval: 0.5 }))!.times).toEqual([0]);
    const red = await host.embedFile(still, { interval: 0.5 });
    expect(red!.times).toEqual([0]);
    expect(cosine(red!.vectors[0]!, normalize([255, 0, 0]))).toBeGreaterThan(0.99);
    // cachedOnly never computes.
    expect(await host.embedFile(await makeVideo(dir, "new.mp4", { duration: 1 }), { interval: 0.5, cachedOnly: true })).toBeNull();
    expect((await host.embedFrames(clip, [0.25, 1.75])).length).toBe(2);
  });

  it("asks before downloading the model: not ready, nothing fetched, and the files it would fetch", async () => {
    dir = await makeTempDir("zenvi-shots-");
    const host = createNodeShotHost({ root: dir, fetch: (async () => { throw new Error("no network in tests"); }) as typeof fetch });
    const status = await host.status();
    if (!onnxRuntimeAvailable()) return expect(status.ready).toBe(false);
    expect(status).toMatchObject({ ready: false, downloadMb: 213 });
    expect(status.detail).toMatch(/one-time 213 MB download.*Ask the person first.*download=true/);
    await expect(host.embedText(["a cat"])).rejects.toThrow(/not downloaded/);
    const clip = await makeVideo(dir, "clip.mp4", { duration: 1 });
    await expect(host.embedFile(clip, { interval: 0.5 })).rejects.toThrow(/not downloaded/);
    expect(await readdir(dir)).not.toContain("models");
    expect(modelDownloadMb(SIGLIP_BASE)).toBe(213);
  });
});

describe("model cache with several files", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const model: ModelDescriptor = {
    id: "two-towers-1",
    name: "two",
    version: "1",
    license: "Apache-2.0",
    homepage: "https://example.invalid/model",
    weights: { file: "vision.onnx", url: "https://example.invalid/vision.onnx", sha256: sha("vision"), bytes: 6 },
    licenseText: { file: "LICENSE", url: "https://example.invalid/LICENSE", sha256: sha("Apache text") },
    extra: [{ file: "text.onnx", url: "https://example.invalid/text.onnx", sha256: sha("text"), bytes: 4 }],
  };
  const server = (files: Record<string, string>) =>
    (async (url: string | URL | Request) => {
      const body = files[String(url)];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(new TextEncoder().encode(body));
    }) as typeof fetch;

  it("downloads the extra files next to the weights and reports presence without downloading", async () => {
    dir = await makeTempDir("zenvi-models-");
    expect(await modelPresent(model, { root: dir })).toBe(false);
    await ensureModel(model, { root: dir, fetch: server({ [model.weights.url]: "vision", [model.licenseText.url]: "Apache text", [model.extra![0]!.url]: "text" }) });
    expect(existsSync(path.join(modelDir(model, { root: dir }), "text.onnx"))).toBe(true);
    expect(await modelPresent(model, { root: dir })).toBe(true);
  });

  it("refuses a file larger than its pinned size", async () => {
    dir = await makeTempDir("zenvi-models-");
    const big = server({ [model.weights.url]: "vision but longer", [model.licenseText.url]: "Apache text", [model.extra![0]!.url]: "text" });
    await expect(ensureModel(model, { root: dir, fetch: big })).rejects.toThrow(/larger than expected/);
  });
});

describe("SigLIP", () => {
  // Only where the weights are already cached (tests never download them).
  const cached = onnxRuntimeAvailable() && existsSync(path.join(modelDir(SIGLIP_BASE), SIGLIP_BASE.weights.file)) && existsSync(path.join(modelDir(SIGLIP_BASE), "text_model_quantized.onnx"));
  it.skipIf(!cached)("puts a red frame nearer 'a red image' than 'a photo of a dog'", async () => {
    const model = new Siglip();
    try {
      const red = new Uint8Array(224 * 224 * 3).map((_, i) => (i % 3 === 0 ? 220 : 20));
      const [image] = await model.embedImages([red]);
      const [isRed, dog] = await model.embedText(["a red image", "a photo of a dog"]);
      expect(cosine(image!, isRed!)).toBeGreaterThan(cosine(image!, dog!));
    } finally {
      await model.close();
    }
  });
});
