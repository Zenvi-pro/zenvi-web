import { describe, expect, it } from "vitest";
import { getBlock } from "../../catalog.js";
import { checkParams } from "../../params.js";
import { planGeoMap } from "./plan.js";

const manifest = getBlock("geo_map")!;

describe("geo_map params", () => {
  it("refuses an unknown place when the block is placed, with a suggestion", () => {
    const checked = checkParams(manifest, { markers: ["Lisbon", "Madird"] });
    expect(checked).toEqual({ ok: false, error: expect.stringContaining('no place called "Madird" (did you mean "Madrid"') });
    expect(checkParams(manifest, { focus: "Atlantis" })).toMatchObject({ ok: false });
  });

  it("refuses cities where countries are needed, and malformed values", () => {
    expect(checkParams(manifest, { highlight: ["Paris"] })).toMatchObject({ ok: false, error: expect.stringContaining("is a point") });
    expect(checkParams(manifest, { values: ["France 31"] })).toMatchObject({ ok: false, error: expect.stringContaining("Place=number") });
  });

  it("resolves markers, labels, highlights and values", () => {
    const checked = checkParams(manifest, { markers: ["Lisbon", "38.7, -9.1", "Japan"], labels: ["", "Office", "-"], highlight: ["Western Europe"], values: ["France=1,200", "Brazil: 3.5%"] });
    if (!checked.ok) throw new Error(checked.error);
    const plan = planGeoMap(checked.params);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.markers.map((m) => m.label)).toEqual(["Lisbon", "Office", ""]);
    expect(plan.highlight.length).toBeGreaterThan(5);
    expect([...plan.values.values()].sort((a, b) => a - b)).toEqual([3.5, 1200]);
  });
});
