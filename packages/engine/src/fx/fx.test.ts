import { describe, expect, it } from "vitest";
import { FX_IDS, FX_INFO, fxStretch, parseFxEffect, parseFxStack, slowmoSpeed, type FxEffect } from "./catalog.js";
import { atempoChain, buildFxGraph, mulberry32, type FxGraphInput } from "./graph.js";
import { fxLink, readFxLink } from "./link.js";

const HD: FxGraphInput = { width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration: 4, alpha: false, audio: true };

function stack(raw: unknown[], duration = 4): FxEffect[] {
  const parsed = parseFxStack(raw, duration);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.effects;
}

describe("FX stacks", () => {
  it("fill each effect's defaults", () => {
    const [bloom] = stack([{ effect: "bloom" }]);
    expect(bloom).toEqual({ effect: "bloom", amount: FX_INFO.bloom.defaultAmount, params: { threshold: 0.68, radius: 0.5 } });
    const [halftone] = stack([{ effect: "halftone", params: { ink: "#ff0000" } }]);
    expect(halftone?.params).toEqual({ cell: 12, ink: "#FF0000", paper: "#F4EFE6" });
  });

  it("name the bad param", () => {
    expect(parseFxEffect({ effect: "glitch", params: { rate: 100 } }, 4)).toMatchObject({ ok: false, error: expect.stringMatching(/^glitch params: rate: /) });
    expect(parseFxEffect({ effect: "mirror", params: { nope: 1 } }, 4)).toMatchObject({ ok: false, error: expect.stringMatching(/^mirror params: /) });
    expect(parseFxStack([{ effect: "sparkle" }], 4)).toMatchObject({ ok: false, error: expect.stringMatching(/^effects\[0\]: effect: /) });
  });

  it("keep windows inside the clip and drop one that covers it all", () => {
    expect(stack([{ effect: "glitch", start: 1, end: 1.5 }])[0]).toMatchObject({ start: 1, end: 1.5 });
    expect(stack([{ effect: "glitch", start: 3, end: 9 }])[0]).toMatchObject({ start: 3, end: 4 });
    const whole = stack([{ effect: "glitch", start: 0, end: 4 }])[0]!;
    expect("start" in whole || "end" in whole).toBe(false);
    expect(parseFxEffect({ effect: "glitch", start: 5 }, 4)).toMatchObject({ ok: false, error: expect.stringMatching(/after the clip's end/) });
    expect(parseFxEffect({ effect: "glitch", start: 2, end: 2 }, 4)).toMatchObject({ ok: false, error: expect.stringMatching(/is empty/) });
  });

  it("run slow motion last, once, over the whole clip", () => {
    expect(stack([{ effect: "optical_flow_slowmo" }, { effect: "bloom" }]).map((e) => e.effect)).toEqual(["bloom", "optical_flow_slowmo"]);
    expect(parseFxStack([{ effect: "optical_flow_slowmo" }, { effect: "optical_flow_slowmo" }], 4)).toMatchObject({ ok: false });
    expect(parseFxEffect({ effect: "optical_flow_slowmo", start: 1 }, 4)).toMatchObject({ ok: false, error: expect.stringMatching(/whole clip/) });
  });

  it("slow down by the speed param, else from the amount", () => {
    const [byAmount] = stack([{ effect: "optical_flow_slowmo", amount: 1 }]) as FxEffect<"optical_flow_slowmo">[];
    expect(slowmoSpeed(byAmount!)).toBe(0.25);
    const [bySpeed] = stack([{ effect: "optical_flow_slowmo", params: { speed: 0.5 } }]);
    expect(fxStretch([bySpeed!])).toBe(2);
    expect(fxStretch(stack([{ effect: "bloom" }]))).toBe(1);
  });

  it("take at most eight effects", () => {
    expect(parseFxStack(Array.from({ length: 9 }, () => ({ effect: "vignette" })), 4)).toMatchObject({ ok: false, error: expect.stringMatching(/at most 8/) });
    expect(parseFxStack([], 4)).toMatchObject({ ok: false });
  });
});

describe("FX filtergraphs", () => {
  it("build every effect into one graph that ends in [vout]", () => {
    for (const id of FX_IDS) {
      const graph = buildFxGraph(stack([{ effect: id }]), HD);
      expect(graph.filterComplex, id).toMatch(/^\[0:v\]setpts=PTS-STARTPTS,format=gbrp,setsar=1\[v0\];/);
      expect(graph.filterComplex, id).toMatch(/format=yuv422p10le,setsar=1\[vout\](;\[0:a\]|$)/);
      expect(graph.filterComplex, id).not.toMatch(/NaN|undefined|Infinity|e[+-]\d/);
      // Every label is produced once and consumed once (ffmpeg refuses dangling or reused pads).
      const produced = [...graph.filterComplex.matchAll(/\[([a-z]+\d+[a-z]?)\](?=;|$)/g)].map((m) => m[1]);
      expect(new Set(produced).size, id).toBe(produced.length);
    }
  });

  it("are deterministic: the same stack builds the same text", () => {
    const effects = stack([{ effect: "glitch", params: { seed: 11 } }, { effect: "light_leak" }]);
    expect(buildFxGraph(effects, HD).filterComplex).toBe(buildFxGraph(structuredClone(effects), HD).filterComplex);
    const other = stack([{ effect: "glitch", params: { seed: 12 } }, { effect: "light_leak" }]);
    expect(buildFxGraph(other, HD).filterComplex).not.toBe(buildFxGraph(effects, HD).filterComplex);
  });

  it("cut a windowed effect back in with trim + concat", () => {
    const graph = buildFxGraph(stack([{ effect: "radial_blur", start: 1, end: 1.5 }]), HD);
    expect(graph.filterComplex).toContain("trim=end=1,setpts=PTS-STARTPTS");
    expect(graph.filterComplex).toContain("trim=start=1:end=1.5");
    expect(graph.filterComplex).toContain("trim=start=1.5,setpts=PTS-STARTPTS");
    expect(graph.filterComplex).toMatch(/concat=n=3:v=1:a=0/);
    const head = buildFxGraph(stack([{ effect: "radial_blur", end: 1 }]), HD);
    expect(head.filterComplex).toMatch(/concat=n=2:v=1:a=0/);
  });

  it("start echo windows early so the window opens on a full trail", () => {
    const graph = buildFxGraph(stack([{ effect: "echo", start: 2, end: 3 }]), HD);
    expect(graph.filterComplex).toContain(`trim=start=${2 - FX_INFO.echo.lookbackSeconds}:end=3`);
  });

  it("keep alpha through the graph and into ProRes 4444", () => {
    const graph = buildFxGraph(stack([{ effect: "bloom" }, { effect: "chromatic_aberration" }]), { ...HD, alpha: true });
    expect(graph.pixelFormat).toBe("yuva444p10le");
    expect(graph.filterComplex).toContain("format=gbrap");
    expect(graph.filterComplex).toContain("c3_mode=normal:c3_opacity=0");
    expect(graph.filterComplex).toContain("mergeplanes=0x00112213:gbrap");
  });

  it("stretch the audio with slow motion and nothing else", () => {
    const slow = buildFxGraph(stack([{ effect: "optical_flow_slowmo", params: { speed: 0.25 } }]), HD);
    expect(slow.audioLabel).toBe("aout");
    expect(slow.duration).toBe(16);
    expect(slow.filterComplex).toContain("[0:a]asetpts=PTS-STARTPTS,atempo=0.5,atempo=0.5[aout]");
    expect(slow.filterComplex).toContain("setpts=PTS/0.25,format=yuv444p,minterpolate=fps=30/1");
    expect(buildFxGraph(stack([{ effect: "bloom" }]), HD).audioLabel).toBeNull();
    expect(atempoChain(0.4)).toBe("atempo=0.5,atempo=0.8");
  });

  it("scale pixel sizes with the frame's short side", () => {
    const blur = (input: FxGraphInput) => buildFxGraph(stack([{ effect: "directional_blur", amount: 1 }]), input).filterComplex;
    expect(blur(HD)).toContain("radius=73");
    expect(blur({ ...HD, width: 1080, height: 1920 })).toContain("radius=73");
    expect(blur({ ...HD, width: 3840, height: 2160 })).toContain("radius=146");
  });

  it("seed glitches with a portable PRNG", () => {
    const a = mulberry32(7);
    expect([a(), a(), a()].map((v) => v.toFixed(6))).toEqual(
      (() => {
        const b = mulberry32(7);
        return [b(), b(), b()].map((v) => v.toFixed(6));
      })(),
    );
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });
});

describe("zenvi-fx links", () => {
  const render = { path: "/cache/fx/a.mov", codec: "prores422" as const, width: 1920, height: 1080, fps: { num: 30, den: 1 }, frames: 90, duration: 3, fingerprint: "f".repeat(64), cached: false, seconds: 2, renderedAt: "2026-10-26T00:00:00Z", ffmpeg: "9.0.2" };

  it("round-trip the original file, range and stack and avoid path-like keys", () => {
    const effects = stack([{ effect: "bloom" }]);
    const link = fxLink({ file_id: "FILE000001", start: 2, end: 5 }, effects, render, 1);
    const json = JSON.stringify(link);
    for (const key of ["path", "image", "resource", "protobuf_data_path", "lut_path"]) expect(json).not.toContain(`"${key}"`);
    const read = readFxLink({ id: "X", media_type: "video", zenvi_link: link } as never);
    expect(read?.source).toEqual({ file_id: "FILE000001", start: 2, end: 5 });
    expect(read?.effects).toEqual(effects);
    expect(link).toMatchObject({ kind: "zenvi-fx", version: 1, state: "fresh", render: { codec: "prores422", duration_frames: 90, output: "/cache/fx/a.mov" } });
  });

  it("ignore other link kinds and broken records", () => {
    expect(readFxLink({ zenvi_link: { kind: "blender" } } as never)).toBeNull();
    expect(readFxLink({ zenvi_link: { kind: "zenvi-fx", source: { file_id: "A", start: 3, end: 2 } } } as never)).toBeNull();
    expect(readFxLink(undefined)).toBeNull();
  });
});
