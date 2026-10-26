import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addClip, addFile, createProject, findProfile, ProjectDocument } from "@zenvi/engine";
import { runTool, type ToolReceipt } from "@zenvi/engine/tools";
import { createNodeHost } from "../host/node-host.js";
import { renderFrameImage } from "../render/render-frame.js";
import { makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { existsSync } from "node:fs";
import { ensureModel, modelDir, RVM_MOBILENETV3, type ModelDescriptor } from "./model-cache.js";
import { onnxRuntimeAvailable, rvmDownsampleRatio, rvmModel, type MatteModel } from "./rvm.js";

let dir: string | undefined;
afterEach(async () => {
  await removeDir(dir);
  dir = undefined;
});

/** Keeps near-white pixels: the moving white disc of the fixture. */
const whiteKey: MatteModel = {
  name: "white_key",
  version: "1",
  license: "GPL-3.0",
  async open(width, height) {
    return {
      async matte(rgb) {
        const out = new Uint8Array(width * height);
        for (let i = 0; i < out.length; i += 1) out[i] = rgb[i * 3]! > 230 && rgb[i * 3 + 1]! > 230 && rgb[i * 3 + 2]! > 230 ? 255 : 0;
        return out;
      },
      async close() {},
    };
  },
};

/** A white disc (r = 30) moving right at 100 px/s from x = 60 over a dark noisy texture, 320x240, 30 fps, 2 s. */
const DISC =
  "color=c=0x203040:s=320x240:r=30:d=2,noise=alls=30:allf=t,format=rgb24," +
  "geq=r='if(lt(hypot(X-(60+100*T),Y-120),30),255,r(X,Y))':g='if(lt(hypot(X-(60+100*T),Y-120),30),255,g(X,Y))':b='if(lt(hypot(X-(60+100*T),Y-120),30),255,b(X,Y))'";

function rgbAt(image: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [...image.data.slice(i, i + 3)];
}

describe("subject mattes on Node", () => {
  it("mattes generated footage and the cut-out follows the subject on the timeline", async () => {
    dir = await makeTempDir("zenvi-matte-");
    const video = await makeVideo(dir, "disc.mp4", { width: 320, height: 240, duration: 2, source: DISC });
    const host = createNodeHost({ projectFile: path.join(dir, "disc.zvn"), mattes: whiteKey });
    const imported = await host.media!.importPath!(video);
    const profile = { ...findProfile("HD 720p 30 fps")!, width: 320, height: 240, display_ratio: { num: 4, den: 3 } };
    const doc = new ProjectDocument(createProject({ id: "DISCPROJ01", profile }));
    doc.transaction("fixture", (tx) => {
      addFile(tx, imported, { id: "DISCFILE01" });
      addClip(tx, { fileId: "DISCFILE01", position: 0, layer: 1_000_000, start: 0, end: 2, id: "DISCCLIP01" });
    });

    const result = await runTool({ doc, host }, "replace_background_tool", { clip_id: "DISCCLIP01", background: "color", color: "#ff0000" });
    const receipt = result.data as ToolReceipt;
    expect(receipt.status, result.text).toBe("applied");
    const data = receipt.data as { matte_file_id: string; matte: { model: string; frames: number } };
    expect(data.matte).toMatchObject({ model: "white_key", frames: 60 });
    const matte = doc.project.files.find((f) => f.id === data.matte_file_id)!;
    expect([matte.width, matte.height, matte.fps, Number(matte.video_length)]).toEqual([320, 240, { num: 30, den: 1 }, 60]);
    expect(host.resolveMedia(matte.path)).toBe(path.join(dir, "disc_assets", "mattes", "disc.person-matte.mp4"));

    // Each frame's matte frame, not the first one: the disc is white where it is, red background where it was.
    for (const [t, here, gone] of [
      [0.5, 110, 210],
      [1.5, 210, 110],
    ] as const) {
      const frame = await renderFrameImage(doc.project, t, { resolveMedia: host.resolveMedia });
      for (const c of rgbAt(frame, here, 120)) expect(c).toBeGreaterThan(220);
      const [r, g, b] = rgbAt(frame, gone, 120);
      expect(r).toBeGreaterThan(220);
      expect(Math.max(g!, b!)).toBeLessThan(40);
    }
  }, 60_000);

  it("has no matting capability without a model", () => {
    expect(createNodeHost({ mattes: false }).mattes).toBeUndefined();
    expect(createNodeHost({ mattes: whiteKey }).mattes?.subjects).toEqual(["person"]);
  });
});

describe("model cache", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const descriptor = (weights: string): ModelDescriptor => ({
    id: "test-model-1",
    name: "test",
    version: "1",
    license: "GPL-3.0",
    homepage: "https://example.invalid/model",
    weights: { file: "model.onnx", url: "https://example.invalid/model.onnx", sha256: sha(weights) },
    licenseText: { file: "LICENSE", url: "https://example.invalid/LICENSE", sha256: sha("GPL text") },
  });
  const server = (files: Record<string, string>, calls: string[]) =>
    (async (url: string | URL | Request) => {
      calls.push(String(url));
      const body = files[String(url)];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(bytes(body));
    }) as typeof fetch;

  it("downloads the weights and licence once, checked against their checksums", async () => {
    dir = await makeTempDir("zenvi-models-");
    const calls: string[] = [];
    const model = descriptor("weights v1");
    const fetch = server({ [model.weights.url]: "weights v1", [model.licenseText.url]: "GPL text" }, calls);
    const file = await ensureModel(model, { root: dir, fetch });
    expect(file).toBe(path.join(modelDir(model, { root: dir }), "model.onnx"));
    expect(await readFile(file, "utf8")).toBe("weights v1");
    expect(await readFile(path.join(dir, "models", "test-model-1", "LICENSE"), "utf8")).toBe("GPL text");
    expect(await readFile(path.join(dir, "models", "test-model-1", "SOURCE.txt"), "utf8")).toContain(model.weights.sha256);
    await ensureModel(model, { root: dir, fetch });
    expect(calls).toHaveLength(2);
  });

  it("refuses weights that do not match the pinned checksum and keeps nothing", async () => {
    dir = await makeTempDir("zenvi-models-");
    const model = descriptor("weights v1");
    const fetch = server({ [model.weights.url]: "tampered", [model.licenseText.url]: "GPL text" }, []);
    await expect(ensureModel(model, { root: dir, fetch })).rejects.toThrow(/pinned checksum/);
    await expect(readFile(path.join(modelDir(model, { root: dir }), "model.onnx"))).rejects.toThrow();
    // A damaged copy on disk is downloaded again.
    await writeFile(path.join(modelDir(model, { root: dir }), "model.onnx"), "damaged");
    const good = server({ [model.weights.url]: "weights v1", [model.licenseText.url]: "GPL text" }, []);
    expect(await readFile(await ensureModel(model, { root: dir, fetch: good }), "utf8")).toBe("weights v1");
  });
});

describe("Robust Video Matting", () => {
  it("runs the backbone near 512 px on the long side", () => {
    expect(rvmDownsampleRatio(1920, 1080)).toBeCloseTo(0.2667, 3);
    expect(rvmDownsampleRatio(1080, 1920)).toBeCloseTo(0.2667, 3);
    expect(rvmDownsampleRatio(320, 240)).toBe(1);
  });

  // Only where the weights are already cached (tests never download them).
  const cached = onnxRuntimeAvailable() && existsSync(path.join(modelDir(RVM_MOBILENETV3), RVM_MOBILENETV3.weights.file));
  it.skipIf(!cached)("mattes frames in order with its recurrent state", async () => {
    const session = await rvmModel().open(64, 48);
    try {
      const frame = new Uint8Array(64 * 48 * 3).map((_, i) => (i * 37) % 256);
      for (let i = 0; i < 3; i += 1) expect((await session.matte(frame)).length).toBe(64 * 48);
    } finally {
      await session.close();
    }
  });
});
