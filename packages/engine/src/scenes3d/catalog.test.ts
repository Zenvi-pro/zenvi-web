import { describe, expect, it } from "vitest";
import { parseScene3dParams } from "./catalog.js";

describe("parseScene3dParams", () => {
  it("defaults the hero scenes to about two thirds of the safe width", () => {
    const title = parseScene3dParams("title_3d", { text: "ZENVI" });
    const device = parseScene3dParams("device_mockup", {});
    const glass = parseScene3dParams("glass_hero", {});
    expect([title, device, glass].map((r) => r.ok && (r.params as { size: number }).size)).toEqual([0.66, 0.65, 0.66]);
  });

  it("bounds size and names the bad key", () => {
    expect(parseScene3dParams("title_3d", { text: "Hi", size: 1.4 })).toMatchObject({ ok: false, error: expect.stringContaining("size:") });
    expect(parseScene3dParams("title_3d", { text: "Hi", width: 0.5 })).toMatchObject({ ok: false });
  });
});
