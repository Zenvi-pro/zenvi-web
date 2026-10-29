import { describe, expect, it } from "vitest";
import { getBlock } from "../../catalog.js";
import { checkParams } from "../../params.js";
import { layoutIcons, planPictogram, type Group } from "./layout.js";

const groups: Group[] = [
  { label: "A", value: 46, icons: 46 },
  { label: "B", value: 31, icons: 31 },
  { label: "C", value: 23, icons: 23 },
];
const region = { x: 100, y: 200, w: 1720, h: 700 };

describe("layoutIcons", () => {
  for (const kind of ["grid", "groups", "bars", "collapse"] as const) {
    for (const portrait of [false, true]) {
      it(`${kind} (${portrait ? "portrait" : "landscape"}) gives every icon a slot inside the region, none overlapping`, () => {
        const r = portrait ? { x: 100, y: 300, w: 880, h: 1300 } : region;
        const { slots } = layoutIcons(kind, groups, r, portrait);
        expect(slots).toHaveLength(100);
        for (const s of slots) {
          expect(s.x - s.s / 2).toBeGreaterThanOrEqual(r.x - 0.01);
          expect(s.x + s.s / 2).toBeLessThanOrEqual(r.x + r.w + 0.01);
          expect(s.y - s.s / 2).toBeGreaterThanOrEqual(r.y - 0.01);
          expect(s.y + s.s / 2).toBeLessThanOrEqual(r.y + r.h + 0.01);
        }
        const keys = new Set(slots.map((s) => `${Math.round(s.x)},${Math.round(s.y)}`));
        expect(keys.size).toBe(100);
      });
    }
  }

  it("stacks bars from one baseline, tallest group tallest", () => {
    const { slots, labels } = layoutIcons("bars", groups, region, false);
    const bottom = (from: number, n: number): number => Math.max(...slots.slice(from, from + n).map((s) => s.y));
    const top = (from: number, n: number): number => Math.min(...slots.slice(from, from + n).map((s) => s.y));
    expect(bottom(0, 46)).toBeCloseTo(bottom(46, 31));
    expect(top(0, 46)).toBeLessThan(top(46, 31));
    expect(labels.filter((l) => l.kind === "name").map((l) => l.group)).toEqual([0, 1, 2]);
  });

  it("lines the side-by-side clusters' labels up", () => {
    const { labels } = layoutIcons("groups", groups, region, false);
    const names = labels.filter((l) => l.kind === "name").map((l) => l.y);
    expect(new Set(names.map(Math.round)).size).toBe(1);
  });
});

describe("planPictogram", () => {
  it("divides values by the unit and refuses more than 400 icons", () => {
    const plan = planPictogram({ groups: ["Lost=60", "Back=1,340"], unit: 10, layouts: ["grid", "hold"] });
    expect(plan).toMatchObject({ groups: [{ icons: 6 }, { icons: 134 }], layouts: ["grid", "hold"] });
    const manifest = getBlock("pictogram_morph")!;
    expect(checkParams(manifest, { groups: ["A=500"] })).toEqual({ ok: false, error: expect.stringContaining("set unit to 2") });
    expect(checkParams(manifest, { layouts: ["hold"] })).toMatchObject({ ok: false });
    expect(checkParams(manifest, { layouts: ["grid", "hold", "hold"] })).toMatchObject({ ok: false, error: expect.stringContaining("hold cannot follow hold") });
    expect(checkParams(manifest, { layouts: ["grid", "spiral"] })).toMatchObject({ ok: false, error: expect.stringContaining("spiral") });
    expect(checkParams(manifest, { groups: ["A 5"] })).toMatchObject({ ok: false });
  });
});
