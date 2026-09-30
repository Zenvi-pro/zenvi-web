import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { FramePlan, Project } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRgba } from "../image/rgba.js";
import { decodeRgba, makeTempDir, removeDir } from "../test-support/fixtures.js";
import type { RenderEngine } from "./engine.js";
import { frameCaption, overlaySvg } from "./overlay.js";
import { renderFrame, renderFrameImage } from "./render-frame.js";

let dir: string;
const project = { width: 320, height: 180, fps: { num: 30, den: 1 }, files: [] } as unknown as Project;

/** Engine drawing a solid color layer; records the frame it was asked for. */
function engine(asked: number[]): RenderEngine {
  return {
    planFrame(_p, frame, size): FramePlan {
      asked.push(frame);
      return {
        frame,
        time: (frame - 1) / 30,
        width: size.width,
        height: size.height,
        background: [0, 0, 0, 255],
        layers: [
          {
            clipId: "C",
            layer: 1,
            source: { kind: "color", color: [20, 120, 220, 255] },
            sourceWidth: size.width,
            sourceHeight: size.height,
            drawWidth: size.width,
            drawHeight: size.height,
            transform: [1, 0, 0, 1, 0, 0],
            opacity: 1,
            effects: [],
            masks: [],
          },
        ],
      };
    },
    planAudio: () => ({ sampleRate: 48000, channels: 2, start: 0, end: 0, segments: [] }),
    composite(plan, prepared) {
      const out = createRgba(plan.width, plan.height);
      out.data.set(prepared.layers[0]!.data);
      return out;
    },
  };
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-frame-");
});
afterAll(() => removeDir(dir));

describe("renderFrame", () => {
  it("renders the frame containing the time at the requested width", async () => {
    const asked: number[] = [];
    const img = await renderFrameImage(project, 1.99, { resolveMedia: (p) => p, width: 160, engine: engine(asked) });
    expect(asked).toEqual([60]);
    expect([img.width, img.height]).toEqual([160, 90]);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([20, 120, 220, 255]);
  });

  it("encodes PNG and JPEG that ffmpeg can read back", async () => {
    const png = await renderFrame(project, 0, { resolveMedia: (p) => p, width: 64, engine: engine([]) });
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    await writeFile(path.join(dir, "f.png"), png);
    const back = await decodeRgba(path.join(dir, "f.png"), { width: 64, height: 36 });
    expect(Array.from(back.subarray(0, 4))).toEqual([20, 120, 220, 255]);
    const jpeg = await renderFrame(project, 0, { resolveMedia: (p) => p, width: 64, format: "jpeg", engine: engine([]) });
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
  });

  it("draws the 0-1 grid and caption overlay", async () => {
    const plain = await renderFrameImage(project, 0, { resolveMedia: (p) => p, width: 320, engine: engine([]) });
    const grid = await renderFrameImage(project, 0, { resolveMedia: (p) => p, width: 320, engine: engine([]), overlay: { grid: true, caption: frameCaption(1, 0) } });
    let changed = 0;
    for (let i = 0; i < plain.data.length; i += 4) if (plain.data[i] !== grid.data[i]) changed += 1;
    // Lines every 0.05 plus labels touch a visible share of the frame, but not all of it.
    expect(changed).toBeGreaterThan(320 * 180 * 0.05);
    expect(changed).toBeLessThan(320 * 180 * 0.6);
    // Midline (x = 0.5) is a major line: near-white.
    const mid = (90 * 320 + 160) * 4;
    expect(grid.data[mid]!).toBeGreaterThan(200);
  });

  it("formats captions like inspect_overlay.py", () => {
    expect(frameCaption(120, 4)).toBe("f120  00:04.00");
    expect(frameCaption(7, 61.999)).toBe("f7  01:02.00");
    expect(overlaySvg(100, 50, { caption: "a<b" })).toContain("a&lt;b");
  });
});
