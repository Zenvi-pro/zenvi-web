import { describe, expect, it } from "vitest";
import { FX_IDS, FX_INFO, fxStretch, parseFxEffect, parseFxStack, slowmoSpeed, type FxEffect } from "./catalog.js";
import { atempoChain, buildFxGraph, moshFrameCount, mulberry32, type FxGraphInput } from "./graph.js";
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

  it("stay inside ffmpeg's option ranges at extreme amounts and thresholds", () => {
    // curves refuses repeated or unordered points; colorchannelmixer gains top out at 2.
    for (const [effect, params] of [["bloom", { threshold: 0 }], ["bloom", { threshold: 1 }], ["pixel_sort", { threshold: 0 }], ["pixel_sort", { threshold: 1 }]] as const) {
      for (const amount of [0, 1]) {
        const graph = buildFxGraph(stack([{ effect, amount, params }]), HD).filterComplex;
        for (const [, points] of graph.matchAll(/curves=all='([^']+)'/g)) {
          const xs = points!.split(" ").map((p) => Number(p.split("/")[0]));
          expect(xs.every((x, i) => i === 0 || x > xs[i - 1]!), `${effect} ${amount}: ${points}`).toBe(true);
        }
        for (const [, gain] of graph.matchAll(/colorchannelmixer=rr=([\d.]+)/g)) expect(Number(gain)).toBeLessThanOrEqual(2);
      }
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

describe("CRT, print ink and datamosh graphs", () => {
  const graph = (raw: unknown, input: FxGraphInput = HD) => buildFxGraph(stack([raw]), input).filterComplex;

  it("bend the CRT picture with the glass, and only when curved", () => {
    expect(graph({ effect: "crt" })).toContain("lenscorrection=k1=0.18:k2=0.09");
    expect(graph({ effect: "crt", params: { curvature: 0 } })).not.toContain("lenscorrection");
    expect(graph({ effect: "crt", params: { curvature: 1 } })).toContain("lenscorrection=k1=0.4:k2=0.2");
  });

  it("scale scanline pitch with the frame and keep it two pixels or more", () => {
    const pitch = (input: FxGraphInput) => /cos\(2\*PI\*\(Y\+0\.5\)\/(\d+)\)/.exec(graph({ effect: "crt" }, input))?.[1];
    expect(pitch(HD)).toBe("3");
    expect(pitch({ ...HD, width: 3840, height: 2160 })).toBe("6");
    expect(pitch({ ...HD, width: 480, height: 270 })).toBe("2");
  });

  it("crop a 4:3 window for the tv bezel and pad it back into the frame", () => {
    const tv = graph({ effect: "crt", params: { bezel: "tv" } });
    expect(tv).toContain("scale=1266:950:force_original_aspect_ratio=increase");
    expect(tv).toMatch(/pad=1920:1080:327:65:color=black/);
    expect(graph({ effect: "crt", params: { bezel: "rounded" } })).not.toContain("pad=");
    expect(graph({ effect: "crt", params: { bezel: "none" } })).toContain("st(3,1)");
  });

  it("draw the CRT dimming per frame (hum bar and flicker) and keep every value in range", () => {
    const text = graph({ effect: "crt", amount: 1 });
    expect(text).toMatch(/clip\(255\*\(1-\(0\.035\*/);
    expect(graph({ effect: "crt", params: { roll: false } })).not.toContain("exp(-pow(ld(0)/0.09,2))");
  });

  it("print ink: Sobel lines, two off-register line plates and a seeded noise still", () => {
    const text = graph({ effect: "print_ink", amount: 1 });
    expect(text).toContain("sobel");
    expect(text.match(/maskedmerge/g)).toHaveLength(2);
    expect(text).toContain("all_seed=7");
    expect(graph({ effect: "print_ink", amount: 1, params: { seed: 9 } })).toContain("all_seed=9");
    expect(graph({ effect: "print_ink", amount: 1, params: { levels: 3 } })).toContain("trunc(val*3/256)*231/2");
    // Registered plates need no padding to slide them.
    expect(graph({ effect: "print_ink", amount: 1, params: { misregister: 0 } })).not.toContain("pad=");
  });

  it("weigh the effect by amount: the effect comes first in the normal-mode blend", () => {
    // blend=normal gives its first input the opacity, so amount 0.3 must be 30% effect, not 30% source.
    const text = graph({ effect: "halftone", amount: 0.3 });
    expect(text).toMatch(/\[v\d+\]\[s\d+\]blend=all_mode=normal:all_opacity=0\.3:shortest=1/);
    const effectLabel = /\[(v\d+)\]\[s\d+\]blend=all_mode=normal/.exec(text)![1]!;
    expect(text).toMatch(new RegExp(`maskedmerge\\[${effectLabel}\\]`));
  });

  it("datamosh: head frames displaced and blended with the ghost, the rest untouched", () => {
    const text = graph({ effect: "datamosh_carry", params: { length: 0.5 } });
    expect(text).toContain("trim=end_frame=15,setpts=PTS-STARTPTS");
    expect(text).toContain("trim=start_frame=15,setpts=PTS-STARTPTS");
    expect(text.match(/displace=edge=smear/g)).toHaveLength(2);
    expect(text).toContain("[3:v]scale=1920:1080");
    expect(text).toContain("blend=all_expr='A*(1-(0.5*pow(1-N/15,2)))+B*(0.5*pow(1-N/15,2))'");
    expect(text).toMatch(/concat=n=2:v=1:a=0/);
  });

  it("datamosh without a ghost never reads the previous clip's last frame", () => {
    const text = graph({ effect: "datamosh_carry", params: { ghost: 0 } });
    expect(text).not.toContain("[3:v]");
    expect(text.match(/nullsink/g)).toHaveLength(2);
    expect(text.match(/displace/g)).toHaveLength(1);
  });

  it("count moshed frames: the length, never the whole clip", () => {
    const fps = { num: 30, den: 1 };
    expect(moshFrameCount(0.6, fps, 4)).toBe(18);
    expect(moshFrameCount(2, fps, 1)).toBe(29);
    expect(moshFrameCount(0.5, fps, 1 / 30)).toBe(0);
    expect(moshFrameCount(0.5, { num: 30000, den: 1001 }, 4)).toBe(15);
  });

  it("leave a one-frame clip alone", () => {
    const text = buildFxGraph(stack([{ effect: "datamosh_carry" }], 1 / 30), { ...HD, duration: 1 / 30 }).filterComplex;
    expect(text).not.toContain("displace");
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
