import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probe } from "@zenvi/render-node";
import { findChrome } from "./chrome.js";
import { designSize, encodeArgs, fingerprintRender, MotionBlockError, renderBlock, sampleTimes } from "./render.js";

let cache: string;
let env: NodeJS.ProcessEnv;
let chrome: string | undefined;

beforeAll(async () => {
  cache = await mkdtemp(path.join(tmpdir(), "zenvi-motion-test-"));
  chrome = process.env.ZENVI_CHROME ?? (await findChrome());
  env = { ...process.env, ZENVI_CACHE_DIR: cache, ...(chrome ? { ZENVI_CHROME: chrome } : {}) };
});

afterAll(async () => {
  await rm(cache, { recursive: true, force: true });
});

describe("render planning", () => {
  it("lays out at a 1080 design size and scales the capture", () => {
    expect(designSize(1080, 1920)).toEqual({ width: 1080, height: 1920, scale: 1 });
    expect(designSize(3840, 2160)).toEqual({ width: 1920, height: 1080, scale: 2 });
    expect(designSize(720, 1280).scale).toBeCloseTo(2 / 3);
  });

  it("samples sub-frames over a 180° shutter for motion blur", () => {
    expect(sampleTimes(2, 10, 1)).toEqual([0, 0.1]);
    const t = sampleTimes(1, 10, 4).concat(sampleTimes(2, 10, 4).slice(4));
    expect(t.slice(4).map((x) => Math.round(x * 1000) / 1000)).toEqual([0.075, 0.088, 0.1, 0.113]);
  });

  it("encodes ProRes 4444 with alpha, H.264 without", () => {
    const base = { fps: { num: 30, den: 1 }, samples: 1, width: 1080, height: 1920, captured: { width: 1080, height: 1920 }, draft: false, output: "o" };
    const alpha = encodeArgs({ ...base, alpha: true }).join(" ");
    expect(alpha).toContain("-c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le");
    const opaque = encodeArgs({ ...base, alpha: false }).join(" ");
    expect(opaque).toContain("libx264");
    expect(opaque).toContain("-color_primaries bt709");
    expect(encodeArgs({ ...base, alpha: true, samples: 4 }).join(" ")).toContain("premultiply=inplace=1,tmix=frames=4");
  });

  it("fingerprints everything that changes pixels, and nothing else", async () => {
    const opts = { width: 540, height: 960, fps: 30, env };
    const a = await fingerprintRender("counter", { values: ["0", "58"] }, opts);
    expect((await fingerprintRender("counter", { values: "0|58" }, opts)).fingerprint).toBe(a.fingerprint);
    expect((await fingerprintRender("counter", { values: ["0", "59"] }, opts)).fingerprint).not.toBe(a.fingerprint);
    expect((await fingerprintRender("counter", { values: ["0", "58"] }, { ...opts, width: 1080 })).fingerprint).not.toBe(a.fingerprint);
    expect((await fingerprintRender("counter", { values: ["0", "58"] }, { ...opts, alpha: false })).fingerprint).not.toBe(a.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses bad requests in words", async () => {
    const opts = { width: 540, height: 960, fps: 30, env };
    await expect(fingerprintRender("nope", {}, opts)).rejects.toThrow("unknown motion block nope");
    await expect(fingerprintRender("counter", { decimals: 7 }, opts)).rejects.toThrow(MotionBlockError);
    await expect(fingerprintRender("counter", {}, { ...opts, seconds: 60 })).rejects.toThrow("counter runs 1.5-12 s");
    await expect(fingerprintRender("hud_callouts", { background: "F1" }, opts)).rejects.toThrow("background needs its media file");
  });
});

describe("render smoke (headless Chrome)", () => {
  // Skipped where no headless Chrome is installed (`zenvi motion setup`).
  it("renders 3 frames with alpha and caches the result", async (t) => {
    if (!chrome) t.skip();
    const out = path.join(cache, "out.mov");
    const first = await renderBlock("kinetic_headline", { text: "Hi *there*" }, { width: 192, height: 342, fps: 1, seconds: 3, alpha: true, output: out, env, workers: 2 });
    expect(first).toMatchObject({ codec: "prores4444", frames: 3, cached: false, width: 192, height: 342 });
    const info = await probe(out);
    expect(info.width).toBe(192);
    expect(info.height).toBe(342);
    expect(Number(info.video_length)).toBe(3);
    expect(String(info.vcodec)).toBe("prores");
    const again = await renderBlock("kinetic_headline", { text: "Hi *there*" }, { width: 192, height: 342, fps: 1, seconds: 3, alpha: true, env });
    expect(again.cached).toBe(true);
    expect(again.fingerprint).toBe(first.fingerprint);
  });
});
