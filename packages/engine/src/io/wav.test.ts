import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav.js";

describe("encodeWav", () => {
  it("writes interleaved 16-bit PCM with a RIFF header", () => {
    const bytes = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, -0.5, 2])], 48000);
    const view = new DataView(bytes.buffer);
    const text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(36 + 12);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(48000 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(text(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(12);
    const samples = [0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true));
    // Clamped to ±1; negative full scale is -32768.
    expect(samples).toEqual([0, 16383, 32767, -16384, -32768, 32767]);
  });

  it("refuses channels of different lengths", () => {
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 48000)).toThrow(/same length/);
    expect(() => encodeWav([], 48000)).toThrow();
  });
});
