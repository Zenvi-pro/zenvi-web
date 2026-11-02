import { describe, expect, it } from "vitest";
import { STYLE_FILES } from "../styles/library.gen.js";
import { SCENE_STARTERS, starterModule, starterParams } from "./scenes.js";

const markdown = (id: string): string => STYLE_FILES.find((f) => f.id === id)!.markdown;

describe("scene starters", () => {
  it("are worked examples of the styles library with a scene module each", () => {
    for (const id of SCENE_STARTERS) {
      const module = starterModule(markdown(id), 20);
      expect(module?.code, id).toMatch(/^export const fps = 60;$/m);
      expect(module?.code, id).toMatch(/export function draw\(ctx/);
    }
  });

  it("cut a starter with a SECONDS line to the asked length, within its bounds; the others keep their own", () => {
    const teaser = markdown("scenes-launch-teaser");
    expect(starterModule(teaser, 25)).toMatchObject({ seconds: 25 });
    expect(starterModule(teaser, 25)!.code).toMatch(/^const SECONDS = 25;$/m);
    expect(starterModule(teaser, 6)!.seconds).toBe(12);
    expect(starterModule(teaser, 90)!.seconds).toBe(45);
    expect(starterModule(markdown("scenes-logo-sting"), 20)).toMatchObject({ seconds: null });
    expect(starterModule("# no code here", 20)).toBeNull();
  });

  it("put the request's name and copy in, and empty the example's copy about another product", () => {
    const teaser = starterParams("scenes-launch-teaser", { name: "Kiln", hook: null, features: ["Cached builds", "Remote runners"] });
    expect(teaser).toMatchObject({ name: "Kiln", app: "Kiln", tagline: "", hook: [], proof: ["Cached builds", "Remote runners"], items: ["Cached builds", "Remote runners"], unit: "", view: "" });
    expect(starterParams("scenes-logo-sting", { name: "Halden", hook: "Notes, calmly.", features: [] })).toEqual({ name: "Halden", tagline: "Notes, calmly." });
    expect(starterParams("scenes-feature-loop", { name: null, hook: null, features: [] })).toEqual({});
  });
});
