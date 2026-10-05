import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { aeHarness } from "../testing/ae-harness.js";

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("ae_capture_frame", () => {
  test("waits for After Effects to finish writing, downsamples a 1080p comp to fit 1280 and restores its resolution", () => {
    const h = aeHarness({ frameWriteDelay: 3 });
    const comp = h.mock.addComp({ name: "Promo" });
    comp.resolutionFactor = [1, 1];

    const receipt = h.callValidated("ae_capture_frame", { time: 1.5 });
    expect(receipt.status).toBe("ok");
    expect(receipt.data).toMatchObject({ width: 960, height: 540, time: 1.5, frame: 45, comp_id: comp.id, comp_name: "Promo", resolution_factor: 2 });
    const image = receipt.data.image_path as string;
    // Only in Zenvi Link's temp folder (ZenviLink.tempFile), the one the server deletes captures from.
    expect(path.dirname(image)).toBe(path.join(h.dir, "zenvi-link"));
    expect(path.basename(image)).toMatch(new RegExp(`^capture-${comp.id}-45-\\d+-\\d+\\.png$`));
    expect(pngSize(image)).toEqual({ width: 960, height: 540 });
    expect(h.mock.state.savedFrames).toEqual([expect.objectContaining({ comp: comp.id, time: 1.5, resolutionFactor: [2, 2] })]);
    expect(h.mock.es.state.sleptMs).toBeGreaterThan(0);
    expect(comp.resolutionFactor).toEqual([1, 1]);
    // The temporary resolution change and its restore share one (empty) undo group.
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Capture comp frame"]);
    expect(h.mock.state.undoDepth).toBe(0);
  });

  test("full resolution when the comp fits; the current time by default; a viewer at half resolution is rendered full and restored", () => {
    const h = aeHarness({ frameWriteDelay: 0 });
    const comp = h.mock.addComp({ width: 1080, height: 1920 });
    comp.time = 2;
    comp.resolutionFactor = [2, 2];
    const receipt = h.callValidated("ae_capture_frame");
    expect(receipt.data).toMatchObject({ width: 1080, height: 1920, time: 2, resolution_factor: 1 });
    expect(comp.resolutionFactor).toEqual([2, 2]);
    comp.resolutionFactor = [1, 1];
    h.callValidated("ae_capture_frame");
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Capture comp frame"]);
  });

  test("snaps to the frame grid and clamps the comp's end to its last frame", () => {
    const h = aeHarness({ frameWriteDelay: 0 });
    h.mock.addComp({ duration: 2, frameRate: 25 });
    const snapped = h.callValidated("ae_capture_frame", { time: 0.51 });
    expect(snapped.data).toMatchObject({ time: 0.52, frame: 13 });
    expect(snapped.warnings[0]).toContain("Snapped time 0.51 s");
    const end = h.callValidated("ae_capture_frame", { time: 2 });
    expect(end.data).toMatchObject({ time: 1.96, frame: 49 });
    expect(end.warnings.join(" ")).toContain("last frame");
  });

  test("refuses a time after the comp, and times out when the frame never arrives", () => {
    const h = aeHarness({ frameWriteDelay: 1_000_000 });
    h.mock.addComp({ duration: 5 });
    expect(h.callValidated("ae_capture_frame", { time: 9 })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    const timeout = h.callValidated("ae_capture_frame", { time: 1 });
    expect(timeout).toMatchObject({ status: "error", error: { code: "TIMEOUT" } });
    expect(timeout.summary).toContain("did not finish writing the frame within 20 s");
  });
});
