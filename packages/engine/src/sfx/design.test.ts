import { describe, expect, it } from "vitest";
import { measureLoudness } from "../mastering/loudness.js";
import { ROOM_TONE_LUFS, designSound, soloRecipe, type DesignInput } from "./design.js";
import { PALETTES } from "./palettes.js";
import { sfxRecipe } from "./recipes.js";
import { renderSfx } from "./render.js";
import type { HitPoint, HitKind, HitRole } from "./spot.js";

function pt(t: number, kind: HitKind, role: HitRole, extra: Partial<HitPoint> = {}): HitPoint {
  return { t, kind, role, weight: 0.6, x: 0, needsCue: true, speech: false, ids: [], label: `${kind} at ${t}`, ...extra };
}

function input(points: HitPoint[], over: Partial<DesignInput> = {}): DesignInput {
  return { points, palette: PALETTES.hype, intensity: "normal", duration: 12, climax: null, music: true, seed: 1, ...over };
}

describe("soloRecipe", () => {
  it("covers a motion block's event with its own sound, not an impact (master_audio_tool iterate)", () => {
    // Regression (sk2-product-brand): iterate's coverage fix put punches on every block click, swap and toggle.
    expect(soloRecipe(pt(1, "block", "ui", { event: "click" }))).toBe("mouse_click");
    expect(soloRecipe(pt(1, "block", "ui", { event: "swap" }))).toBe("keyboard_key");
    expect(soloRecipe(pt(1, "block", "ui", { event: "type" }))).toBe("typing_burst");
    expect(soloRecipe(pt(1, "block", "ui", { event: "tick" }))).toBe("ui_tap");
    expect(soloRecipe(pt(1, "block", "micro", { event: "glint" }))).toBe("sparkle");
    expect(soloRecipe(pt(1, "block", "move", { event: "whoosh" }))).toBe("whoosh_short");
    expect(soloRecipe(pt(1, "scene3d", "impact", { event: "land" }))).toBe("impact_thud");
    expect(soloRecipe(pt(1, "title", "transition"))).toBe("pop");
    expect(soloRecipe(pt(1, "transition", "transition"))).toBe("whoosh_short");
    expect(soloRecipe(pt(1, "cut", "hero"))).toBe("impact_punch");
  });
});

describe("designSound", () => {
  it("layers a hero: transient, body, sub with its phone harmonic, and a tail in the edit's space, attacks on one sample", () => {
    const design = designSound(input([pt(4, "cut", "hero", { weight: 0.9 })]));
    const layers = design.cues.filter((c) => c.point === 0);
    expect(layers.map((c) => c.layer).sort()).toEqual(["body", "sub", "tail", "transient"]);
    expect(new Set(layers.map((c) => c.at))).toEqual(new Set([4]));
    expect(layers.every((c) => c.role === "hero")).toBe(true);
    expect(layers.find((c) => c.layer === "tail")!.params.duration).toBeCloseTo(PALETTES.hype.rt60 + 0.3, 6);
    // Without a sub in the palette (SaaS: no heavy subs), three layers.
    expect(designSound(input([pt(4, "cut", "hero", { weight: 0.9 })], { palette: PALETTES.saas_ui })).cues.map((c) => c.layer).sort()).toEqual(["body", "tail", "transient"]);
  });

  it("puts a whoosh's peak on the cut, sized to the move and travelling, a transient on strong ones", () => {
    const design = designSound(input([pt(3, "transition", "transition", { lead: 0.3, weight: 0.6 }), pt(6, "move", "move", { lead: 0.25, x: -0.8 })]));
    const whoosh = design.cues.find((c) => c.point === 0 && c.layer === "whoosh")!;
    expect(sfxRecipe(whoosh.recipe)!.hit).toBe("peak");
    expect(whoosh.at).toBe(3);
    expect(whoosh.params.duration).toBeCloseTo(0.72, 6);
    expect(design.cues.some((c) => c.point === 0 && c.layer === "transient")).toBe(true);
    const move = design.cues.find((c) => c.point === 1)!;
    expect(move.params.pan).toBe(-0.6);
  });

  it("stops the riser a beat before the climax, sucks the bed out under that beat, and keeps it silent", () => {
    const points = [pt(7.9, "cut", "transition"), pt(8, "cut", "hero", { climax: true, weight: 1 }), pt(5, "cut", "hero", { weight: 0.9 })];
    const design = designSound(input(points, { climax: 8 }));
    const riser = design.cues.find((c) => c.layer === "riser")!;
    expect(riser.at).toBeCloseTo(8 - PALETTES.hype.suckOut, 6);
    expect(riser.params.duration).toBe(2);
    expect(design.dips).toContainEqual({ from: 8 - PALETTES.hype.suckOut, to: 8, db: -18, reason: "suck-out before the drop" });
    expect(design.dry).toContainEqual({ point: 0, why: "inside the suck-out before the drop" });
    // Hype ducks the bed before each hero and gives way under it; the climax keeps its suck-out only.
    expect(design.dips.filter((d) => d.reason.startsWith("pre-hit"))).toHaveLength(2);
    expect(design.dips.filter((d) => d.reason.startsWith("room under"))).toEqual([{ from: 5, to: 5.25, db: -4, reason: "room under cut at 5" }]);
    expect(design.climax).toBe(8);
    expect(design.riser).toBe(true);
  });

  it("lands an edit without music on its hero reveal", () => {
    const design = designSound(input([pt(9, "block", "hero", { event: "reveal", weight: 0.9 })], { palette: PALETTES.saas_ui, music: false }));
    expect(design.climax).toBe(9);
    expect(design.cues.find((c) => c.layer === "riser")!.recipe).toBe("reverse_swell");
    expect(design.dips).toEqual([]);
  });

  it("sounds every UI event of a block: toggles, typing runs, counter ticks capped and pitch-walking up", () => {
    const points = [pt(1, "block", "ui", { event: "toggle" }), pt(2, "block", "ui", { event: "type", until: 3.5, rate: 20 }), pt(5, "block", "ui", { event: "tick", until: 8, rate: 30 })];
    const design = designSound(input(points, { palette: PALETTES.saas_ui }));
    expect(design.cues.find((c) => c.point === 0)!.recipe).toBe("toggle");
    const typing = design.cues.find((c) => c.point === 1)!;
    expect([typing.recipe, typing.params.duration]).toEqual(["typing_burst", 1.5]);
    const ticks = design.cues.filter((c) => c.point === 2);
    expect(ticks).toHaveLength(16);
    expect(ticks[1]!.at - ticks[0]!.at).toBeCloseTo(0.1, 6);
    expect(ticks.every((c, i) => i === 0 || c.params.pitch! > ticks[i - 1]!.params.pitch!)).toBe(true);
    expect(ticks.every((c) => c.role === "micro")).toBe(true);
  });

  it("holds density to the genre's band: too dense loses its weakest, too sparse gets its dry moves back", () => {
    const dense = Array.from({ length: 80 }, (_, i) => pt(i * 0.12, "block", "ui", { event: "pop", weight: 0.2 + (i % 5) * 0.1 }));
    const capped = designSound(input(dense, { palette: PALETTES.saas_ui, duration: 10 }));
    // Normal intensity: the middle of the band.
    const [lo, hi] = PALETTES.saas_ui.density;
    expect(capped.sounded.length).toBe(Math.round(((lo + hi) / 2) * 10));
    expect(capped.dry.some((d) => /cues\/s/.test(d.why))).toBe(true);

    const sparse = [pt(1, "cut", "transition"), ...Array.from({ length: 12 }, (_, i) => pt(2 + i * 0.6, "move", "move", { needsCue: false, dry: "travels under a third of the frame", lead: 0.2 }))];
    const filled = designSound(input(sparse, { palette: PALETTES.saas_ui, duration: 10 }));
    // 13 points, under the band's floor of 20: every one sounds.
    expect(filled.sounded).toHaveLength(13);
  });

  it("keeps only micro cues under speech in voice-led genres: cloth on cuts and heroes, quiet thumps on emphasis words", () => {
    const points = [pt(1, "cut", "hero", { speech: true, weight: 0.9 }), pt(2, "cut", "transition", { speech: true, weight: 0.8 }), pt(3, "word", "slam", { speech: true })];
    const design = designSound(input(points, { palette: PALETTES.talking_head }));
    expect(design.cues.filter((c) => c.point === 0 || c.point === 1).map((c) => [c.recipe, c.role])).toEqual([
      ["cloth", "micro"],
      ["cloth", "micro"],
    ]);
    expect(design.cues.filter((c) => c.point === 2).map((c) => [c.layer, c.role])).toEqual([["body", "micro"]]);
    expect(design.dips).toEqual([]);
  });

  it("subtle keeps only the big moments", () => {
    const points = [pt(1, "cut", "transition", { weight: 0.4 }), pt(2, "cut", "hero", { weight: 0.9 }), pt(3, "block", "ui", { event: "click", weight: 0.3 })];
    const design = designSound(input(points, { intensity: "subtle" }));
    expect(design.sounded).toEqual([1]);
    expect(design.dry.filter((d) => d.why === "subtle: only the big moments").map((d) => d.point)).toEqual([0, 2]);
  });

  it("never plays the same recipe twice in a row in a lane", () => {
    const points = Array.from({ length: 30 }, (_, i) => pt(0.5 + i * 0.35, "cut", "transition", { lead: 0.3 }));
    const whooshes = designSound(input(points)).cues.filter((c) => c.layer === "whoosh");
    for (let i = 1; i < whooshes.length; i += 1) expect(whooshes[i]!.recipe).not.toBe(whooshes[i - 1]!.recipe);
  });

  it("is deterministic, and every gain is a clip volume libopenshot can play", () => {
    const points = [pt(1, "cut", "hero", { weight: 0.9 }), pt(2, "transition", "transition", { lead: 0.3 }), pt(3, "block", "micro", { event: "glint" })];
    expect(designSound(input(points))).toEqual(designSound(input(points)));
    for (const c of designSound(input(points, { intensity: "hype" })).cues) expect(c.gainDb).toBeLessThanOrEqual(0);
  });

  it("sets the ambience bed to the genre's level", () => {
    const design = designSound(input([pt(1, "cut", "transition")], { palette: PALETTES.documentary }));
    const bed = design.cues.find((c) => c.layer === "ambience")!;
    expect(bed.params.duration).toBe(12);
    expect(bed.gainDb).toBeCloseTo(PALETTES.documentary.ambienceLufs! - ROOM_TONE_LUFS, 6);
  });
});

describe("room_tone calibration", () => {
  it("measures ROOM_TONE_LUFS at 0 dB gain, so the bed lands where the palette asks", () => {
    const audio = renderSfx("room_tone", { duration: 8, seed: 3 });
    const lufs = measureLoudness([audio.left, audio.right], audio.sampleRate).integrated;
    expect(lufs).toBeGreaterThan(ROOM_TONE_LUFS - 1);
    expect(lufs).toBeLessThan(ROOM_TONE_LUFS + 1);
  });
});
