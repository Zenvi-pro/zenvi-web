import { describe, expect, it } from "vitest";
import { briefSchema } from "../brief/brief.js";
import { methodProblems } from "../brief/method.js";
import { compileBrief, nearestAspect } from "./brief.js";
import { readRequest } from "./request.js";
import { routeRequest, type BinFacts } from "./route.js";

const FOOTAGE: BinFacts = { pictures: 8, speakers: [], voices: [], music: [] };

describe("routeRequest", () => {
  it.each([
    ["A 15 second full-circle match cut montage: shots of circles", "match-cut-montage", "match_cut_montage_tool"],
    ["The evolution of the car, a new image every 3-6 frames with white flashes", "flash-montage", "match_cut_montage_tool"],
    ["A 40 s movie trailer called 'The Long Way'", "movie-game-trailer", "build_trailer_tool"],
    ["A hype reel of the season's best goals", "hype-reel", "build_reel_tool"],
    ["A cinematic travel film of Lisbon", "travel-cinematic-montage", "build_reel_tool"],
    ["make something nice", "hype-reel", "build_reel_tool"],
  ])("%s -> %s", (request, style, tool) => {
    const route = routeRequest({ request, bin: FOOTAGE, product: readRequest(request).name ?? undefined });
    expect(route.rule.id).toBe(style);
    expect(route.builder.tool).toBe(tool);
  });

  it("reads a SaaS launch and falls back to the motion reel without its features", () => {
    const request = "A 20 second product-launch promo for a fictional enterprise AI platform called 'Island Control', 16:9. Landscape plates behind glass UI cards.";
    const without = routeRequest({ request, bin: FOOTAGE, product: "Island Control" });
    expect(without.rule.id).toBe("saas-ui-promo");
    expect(without.builder).toEqual({ tool: "build_reel_tool", style: "ui_promo" });
    expect(without.fallback?.why).toMatch(/no features/);
    const withFeatures = routeRequest({ request, bin: FOOTAGE, product: "Island Control", features: 3 });
    expect(withFeatures.builder.tool).toBe("build_product_launch_tool");
  });

  it("lets the bin decide between a talking head and a voice-led explainer", () => {
    const request = "A 30 second video with captions and a voice-over";
    expect(routeRequest({ request, bin: { ...FOOTAGE, speakers: ["SPEAKER001"] } }).builder.tool).toBe("build_talking_head_tool");
    expect(routeRequest({ request, bin: { ...FOOTAGE, voices: ["VOICE00001"] } }).builder.tool).toBe("build_explainer_tool");
    const none = routeRequest({ request: "A documentary about the sea", bin: FOOTAGE });
    expect(none.builder).toEqual({ tool: "build_reel_tool", style: "cinematic" });
    expect(none.fallback?.wanted).toBe("build_explainer_tool");
    expect(routeRequest({ request: "A documentary about the sea", bin: FOOTAGE, script: true }).builder.tool).toBe("build_explainer_tool");
  });

  it("keeps a style the caller chose", () => {
    const route = routeRequest({ request: "a hype reel", style: "editorial-type", bin: FOOTAGE });
    expect(route.rule.id).toBe("editorial-type");
    expect(route.why).toBe("style editorial-type as asked");
  });
});

describe("readRequest", () => {
  it("reads the bench's brief format", () => {
    const facts = readRequest(
      "A 20 second product-launch promo for a fictional enterprise AI platform called\n'Island Control', 16:9, light, calm and premium. Headline\n'The Control Plane for the Agentic Enterprise'. A URL end card island.ai.\n" +
        "Suggested searches: 'green rolling hills lake landscape'; 'misty valley pine forest aerial'.\nMusic: freesound search: 'corporate minimal tech 120 bpm' (min 25 s).",
    );
    expect(facts).toMatchObject({ seconds: 20, aspect: "16:9", bpm: 120, name: "Island Control", headline: "The Control Plane for the Agentic Enterprise", url: "island.ai", musicQuery: "corporate minimal tech" });
    expect(facts.searches).toEqual(["green rolling hills lake landscape", "misty valley pine forest aerial"]);
  });

  it("reads minutes, vertical frames and sizes", () => {
    expect(readRequest("a 1 minute vertical recap for TikTok")).toMatchObject({ seconds: 60, aspect: "9:16", platform: "TikTok" });
    expect(readRequest("4:3 (1440x1080), about 20 seconds").size).toEqual({ width: 1440, height: 1080 });
  });
});

describe("compileBrief", () => {
  it("saves a valid minimal brief with beats inside the length and what is missing", () => {
    const request = "A 12 second hype reel of the season. Fast cuts.";
    const facts = readRequest(request);
    const route = routeRequest({ request, bin: FOOTAGE });
    const brief = compileBrief({ request, facts, route, aspect: "9:16", seconds: 12, missing: ["the team's name"] });
    expect(briefSchema.safeParse(brief).success).toBe(true);
    expect(brief).toMatchObject({ style: "hype-reel", aspect: "9:16", length_seconds: 12, goal: "A 12 second hype reel of the season.", missing: ["the team's name"] });
    for (const beat of brief.beats) expect(beat.end).toBeLessThanOrEqual(12);
    // Not a motif plan, and it says so: save_brief_tool's full method stays for agents that want it.
    expect(methodProblems(brief).length).toBeGreaterThan(0);
    expect(brief.critique).toMatch(/minimal brief; save_brief_tool replaces it/);
  });

  it("finds the nearest brief aspect of a frame", () => {
    expect(nearestAspect(1920, 1080)).toBe("16:9");
    expect(nearestAspect(1080, 1920)).toBe("9:16");
    expect(nearestAspect(1080, 1080)).toBe("1:1");
  });
});
