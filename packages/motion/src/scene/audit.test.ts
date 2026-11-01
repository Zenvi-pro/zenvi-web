import { describe, expect, it } from "vitest";
import { auditLayout } from "./audit.js";
import type { TextBox } from "./contract.js";

const size = { width: 1920, height: 1080, safe: { top: 108, right: 192, bottom: 108, left: 192 } };
const box = (o: Partial<TextBox>): TextBox => ({ id: "a", text: "Hello", x: 400, y: 400, w: 400, h: 80, px: 64, opacity: 1, ui: false, ...o });

describe("scene layout audit", () => {
  it("passes text inside the safe zone", () => {
    expect(auditLayout([{ frame: 0, boxes: [box({})] }], size)).toEqual([]);
  });

  it("finds text outside the safe zone, small text, overlaps and too many words, one finding per stretch", () => {
    const frames = [0, 1, 2, 3, 5].map((frame) => ({ frame, boxes: frame === 3 ? [] : [box({ x: 20 }), box({ id: "b", x: 30, px: 18 })] }));
    const found = auditLayout(frames, size);
    expect(found.map((p) => `${p.code} ${p.frames!.from}-${p.frames!.to}`).sort()).toEqual(["overlap 0-2", "overlap 5-5", "safe-area 0-2", "safe-area 0-2", "safe-area 5-5", "safe-area 5-5", "small-text 0-2", "small-text 5-5"]);
    const words = auditLayout([{ frame: 3, boxes: [box({ text: "one two three four five" }), box({ id: "b", y: 600, text: "six seven eight nine" })] }], size);
    expect(words).toEqual([expect.objectContaining({ code: "words", severity: "warning" })]);
  });

  it("ignores text that is not readable yet, and counts product strings apart", () => {
    expect(auditLayout([{ frame: 0, boxes: [box({ x: 0, opacity: 0.3 })] }], size)).toEqual([]);
    const ui = auditLayout([{ frame: 0, boxes: [box({ text: "one two three four five six seven", ui: true }), box({ id: "b", y: 600, text: "eight nine" })] }], size);
    expect(ui).toEqual([]);
  });

  it("holds a 9:16 frame to 32 px text", () => {
    const tall = { width: 1080, height: 1920, safe: { top: 230, right: 108, bottom: 384, left: 108 } };
    expect(auditLayout([{ frame: 0, boxes: [box({ x: 200, y: 600, w: 300, px: 28 })] }], tall).map((p) => p.code)).toEqual(["small-text"]);
  });
});
