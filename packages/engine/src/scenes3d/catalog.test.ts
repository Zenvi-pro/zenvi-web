import { describe, expect, it } from "vitest";
import { parseScene3dParams, scene3dFiles } from "./catalog.js";

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

  it("fills the new scenes' defaults: logos and stacks two thirds or less, counters large", () => {
    const logo = parseScene3dParams("logo_extrude", {});
    const counter = parseScene3dParams("numerals_3d", { suffix: "kt" });
    const terrain = parseScene3dParams("terrain_glide", {});
    expect(logo).toMatchObject({ ok: true, params: { size: 0.6, style: "chrome", animation: "tumble" } });
    expect(counter).toMatchObject({ ok: true, params: { size: 0.8, values: [0, 100], decimals: 0, suffix: "kt" } });
    expect(terrain).toMatchObject({ ok: true, params: { background: "light", surface: "grass" } });
  });

  it("names the files a scene imports, by slot", () => {
    const model = parseScene3dParams("model_showcase", { model: "a/b/Engine.GLB" });
    if (!model.ok) throw new Error(model.error);
    expect(scene3dFiles("model_showcase", model.params)).toEqual({ model: "a/b/Engine.GLB" });
    const title = parseScene3dParams("title_3d", { text: "Hi" });
    if (!title.ok) throw new Error(title.error);
    expect(scene3dFiles("title_3d", title.params)).toEqual({});
    expect(parseScene3dParams("logo_extrude", { svg: "logo.png" })).toMatchObject({ ok: false, error: expect.stringContaining("svg: give a .svg file") });
  });
});
