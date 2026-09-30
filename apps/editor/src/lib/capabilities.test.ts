// @vitest-environment node
import { describe, expect, it } from "vitest";
import { detectSupport } from "./capabilities";

const fn = () => undefined;
const nav = (opfs: boolean) => ({ storage: opfs ? { getDirectory: fn } : {} }) as unknown as Navigator;

describe("detectSupport", () => {
  it("passes a modern browser", () => {
    const s = detectSupport({ VideoDecoder: fn, AudioDecoder: fn, VideoEncoder: fn, AudioEncoder: fn, indexedDB: {} }, nav(true));
    expect(s.missingEssentials).toEqual([]);
    expect(s.canExport).toBe(true);
  });

  it("blocks the editor without WebCodecs decoding", () => {
    const s = detectSupport({ VideoEncoder: fn, indexedDB: {} }, nav(true));
    expect(s.missingEssentials).toHaveLength(2);
  });

  it("degrades to cloud export when only encoding is missing", () => {
    const s = detectSupport({ VideoDecoder: fn, AudioDecoder: fn, indexedDB: {} }, nav(false));
    expect(s.missingEssentials).toEqual([]);
    expect(s.canExport).toBe(false);
    expect(s.opfs).toBe(false);
  });

  it("needs some local storage", () => {
    const s = detectSupport({ VideoDecoder: fn, AudioDecoder: fn }, nav(false));
    expect(s.missingEssentials).toEqual(["local storage (IndexedDB or the origin private file system)"]);
  });
});
