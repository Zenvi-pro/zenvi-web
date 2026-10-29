/**
 * The older colour tools' rules (tools/color-agent.ts): replayed against
 * zenvi-core's own color_agent.py on the same inputs
 * (scripts/parity/color_agent_golden.py), plus the cases of zenvi-core develop
 * tests/test_color_agent_tools.py.
 */

import { describe, expect, it } from "vitest";
import golden from "./__fixtures__/desktop-color-agent.json";
import {
  applySoftColorPreset,
  assessGradeOutcome,
  blankColorGrade,
  buildLookProfile,
  capColorPatch,
  findColorGrade,
  gradesMeaningfullyDiffer,
  hintsToColorPatch,
  isColorGradeEffect,
  listLooksCatalog,
  lookProfileDistance,
  matchGradeAction,
  matchGrainAction,
  mergeColorGrade,
  parseClipIds,
  referenceGapHints,
  resolveLookId,
  resolveRelativeDeltas,
  sampleCountForDuration,
  scalarY,
  scopeFromRawVideo,
  scopeLookDistance,
  solveGradeFromProfiles,
  summarizeColorGrade,
  summarizeFilmGrain,
  summarizeScopeVideo,
  targetProfileForLook,
  validateColorPatch,
  type RawScopeVideo,
} from "./color-agent.js";
import { applyFilmGrainPreset } from "../ops/look.js";
import type { Effect } from "../model/types.js";

type Json = Record<string, unknown>;

describe("color_agent.py, replayed", () => {
  it("scope summaries, LookProfiles, the solver and outcome match the desktop", () => {
    const sums = golden.scopes.map((s) => scopeFromRawVideo(s.video as RawScopeVideo));
    sums.forEach((s, i) => expect(s).toEqual(golden.scopes[i]!.summary));
    const profile = buildLookProfile(sums);
    const reference = buildLookProfile(sums.slice(0, 3));
    expect(profile).toEqual(golden.profile);
    expect(reference).toEqual(golden.reference);
    expect(lookProfileDistance(profile, reference)).toBe(golden.distance);
    expect(solveGradeFromProfiles(profile, reference, 1.0)).toEqual(golden.solve);
    expect(solveGradeFromProfiles(profile, reference, 0.49)).toEqual(golden.solve_half);
    expect(assessGradeOutcome(profile, reference, targetProfileForLook("sunny")!, true)).toEqual(golden.assess);
    expect(referenceGapHints(golden.scopes[0]!.summary as Json, golden.scopes[1]!.summary as Json)).toEqual(golden.hints);
  });

  it("the looks catalog, a merge, sample counts and a soft preset match the desktop", () => {
    expect(listLooksCatalog("teal orange")).toEqual(golden.looks_teal_orange);
    expect((listLooksCatalog("sunny").looks as Json[]).map((e) => e.id)).toEqual(golden.looks_sunny_ids);
    // The web's stylised looks (looks/stylized.ts) come on top of the desktop's catalog.
    expect((listLooksCatalog().looks as Json[]).filter((e) => e.kind !== "generated")).toHaveLength(golden.looks_count);
    const merged = mergeColorGrade(blankColorGrade("e1"), {
      temperature_delta: 0.08,
      exposure: "0.2",
      wheels: { shadows: { color: "224466", amount: 0.3 } },
      masterCurve: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]],
      lut: { path: "x/y.cube", strength: 0.6 },
    });
    expect(merged).toEqual(golden.merge);
    expect([0, 0.01, 5, 30, 60, 212.5, 237.5, 600, 3600].map(sampleCountForDuration)).toEqual(golden.sample_counts);
    expect(applySoftColorPreset(blankColorGrade("e"), "warm_up")).toEqual(golden.soft_warm_up);
  });
});

describe("tests/test_color_agent_tools.py", () => {
  it("parse_clip_ids dedupes and accepts JSON lists", () => {
    expect(parseClipIds(undefined, '["a","b"]', "b")).toEqual(["a", "b"]);
    expect(parseClipIds("x, y", undefined, undefined, "z")).toEqual(["x", "y", "z"]);
  });

  it("merge keeps unset scalars, merges LUT and wheels, builds curves from points", () => {
    const setTemp = mergeColorGrade(blankColorGrade("eff1"), { temperature: 0.2 });
    expect(scalarY(setTemp, "temperature")).toBeCloseTo(0.2);
    expect(scalarY(setTemp, "saturation")).toBeCloseTo(1.0);
    const nudged = mergeColorGrade(setTemp, { exposure: 0.15 });
    expect(scalarY(nudged, "temperature")).toBeCloseTo(0.2);
    expect(scalarY(nudged, "exposure")).toBeCloseTo(0.15);
    const lut = mergeColorGrade(blankColorGrade("eff1"), {
      lut: { path: "cinematic_&_blockbuster/teal_cinema.cube", strength: 0.6 },
      wheels: { shadows: { color: "#224466", amount: 0.3, luma: 0.05 } },
    });
    expect(String(lut.lut_path)).toMatch(/teal_cinema\.cube$/);
    expect(scalarY(lut, "lut_intensity")).toBeCloseTo(0.6);
    expect((lut.wheels as Json).shadows).toMatchObject({ color: "#224466", amount: 0.3 });
    expect(((lut.wheels as Json).global as Json).amount).toBe(0);
    const curve = mergeColorGrade(blankColorGrade("eff1"), { masterCurve: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] });
    const nodes = (curve.curve_all as Json).nodes as Json[];
    expect(nodes).toHaveLength(4);
    expect(((nodes[1]!.x as Json).Points as Json[])[0]).toMatchObject({ co: { X: 1, Y: 0.25 } });
    expect(new Set(nodes.map((n) => n.interpolation))).toEqual(new Set([1]));
  });

  it("validates before merging and never mutates the input", () => {
    expect(() => validateColorPatch({ wheels: { skin: { amount: 0.1 } } })).toThrow("Unknown wheel");
    expect(() => validateColorPatch({ exposure: "nope" })).toThrow("finite");
    expect(() => validateColorPatch({ saturation: 0.2 })).toThrow("saturation neutral is 1.0");
    const base = blankColorGrade("eff1");
    expect(() => mergeColorGrade(base, { exposure: Number.NaN })).toThrow();
    expect(() => mergeColorGrade(base, { exposure: Number.POSITIVE_INFINITY })).toThrow();
    expect(scalarY(base, "exposure")).toBe(0);
  });

  it("a colour paste keeps the effect id", () => {
    const paste = mergeColorGrade(blankColorGrade("other"), { exposure: 0.4 });
    const merged = mergeColorGrade(blankColorGrade("keep-me"), { color: paste });
    expect(merged.id).toBe("keep-me");
    expect(scalarY(merged, "exposure")).toBeCloseTo(0.4);
  });

  it("a hand-written paste of plain numbers grades (tool truth: apply_color_tool color)", () => {
    const merged = mergeColorGrade(blankColorGrade("keep-me"), { color: { exposure: 1, saturation: "1.5" } });
    expect(scalarY(merged, "exposure")).toBeCloseTo(1);
    expect(scalarY(merged, "saturation")).toBeCloseTo(1.5);
  });

  it("summaries, reference hints and the warm-gap distance", () => {
    const summary = summarizeColorGrade(mergeColorGrade(blankColorGrade("e"), { temperature: 0.1 }));
    expect(summary.present).toBe(true);
    expect(summary.temperature).toBeCloseTo(0.1);
    expect(summarizeColorGrade(null)).toEqual({ present: false });
    const subject = summarizeScopeVideo({
      present: true,
      summary: { avg_luma: 0.4, clipped_shadows: 0, clipped_highlights: 0 },
      histogram: {
        luma: [...new Array(64).fill(0), ...new Array(64).fill(10), ...new Array(128).fill(0)],
        red: [...new Array(100).fill(10), ...new Array(156).fill(0)],
        green: [...new Array(80).fill(0), ...new Array(100).fill(10), ...new Array(76).fill(0)],
        blue: [...new Array(120).fill(0), ...new Array(100).fill(10), ...new Array(36).fill(0)],
      },
    });
    const reference = summarizeScopeVideo({
      present: true,
      summary: { avg_luma: 0.55, clipped_shadows: 0, clipped_highlights: 0 },
      histogram: {
        luma: [...new Array(40).fill(0), ...new Array(80).fill(10), ...new Array(136).fill(0)],
        red: [...new Array(40).fill(0), ...new Array(100).fill(10), ...new Array(116).fill(0)],
        green: [...new Array(80).fill(0), ...new Array(100).fill(10), ...new Array(76).fill(0)],
        blue: [...new Array(100).fill(10), ...new Array(156).fill(0)],
      },
    });
    for (const key of ["avg_luma", "clipped_shadows", "clipped_highlights", "channel_means"]) expect(subject).toHaveProperty(key);
    expect(referenceGapHints(subject, reference).hints.some((h) => "exposure" in h)).toBe(true);
    const cool = { present: true, avg_luma: 0.45, warm_cool: -0.08, green_magenta: 0.0, channel_means: { red: 0.4, green: 0.45, blue: 0.5 } };
    const warm = { present: true, avg_luma: 0.46, warm_cool: 0.12, green_magenta: 0.01, channel_means: { red: 0.55, green: 0.45, blue: 0.35 } };
    const dist = scopeLookDistance(cool, warm)!;
    expect(dist).toBeGreaterThanOrEqual(0.03);
    expect(referenceGapHints(cool, warm).gap.look_distance).toBe(dist);
  });

  it("finds grades, resolves looks and turns hints into a patch", () => {
    const effects = [{ class_name: "Blur", id: "b1" }, blankColorGrade("cg1"), { class_name: "Glow", id: "g1" }] as unknown as Effect[];
    expect(findColorGrade(effects)!.id).toBe("cg1");
    expect(effects.filter((e) => !isColorGradeEffect(e)).map((e) => e.id)).toEqual(["b1", "g1"]);
    expect(listLooksCatalog("warm tungsten").looks).toContainEqual(expect.objectContaining({ id: "warm_up" }));
    expect((listLooksCatalog("teal orange").looks as Json[]).some((e) => e.kind === "lut")).toBe(true);
    expect(resolveLookId("warm_up").kind).toBe("color_preset");
    expect(resolveLookId("teal_cinema")).toMatchObject({ kind: "lut", lut_path: "cinematic_&_blockbuster/teal_cinema.cube" });
    expect(resolveLookId("grain:35mm_classic")).toMatchObject({ kind: "film_grain", grain_id: "35mm_classic" });
    expect(() => resolveLookId("not_a_real_look")).toThrow("Unknown lookId 'not_a_real_look'. Call list_looks_tool");
    expect(hintsToColorPatch([{ exposure: 0.1, reason: "x" }, { temperature: 0.05, reason: "y" }])).toEqual({ exposure: 0.1, temperature: 0.05 });
  });

  it("deltas nudge from the current grade, clamped; saturation may go above one", () => {
    const base = mergeColorGrade(blankColorGrade("e"), { temperature: 0.1 });
    const warmer = mergeColorGrade(base, { temperature_delta: 0.08 });
    expect(scalarY(warmer, "temperature")).toBeCloseTo(0.18);
    expect(scalarY(mergeColorGrade(warmer, { temperature_delta: -0.08 }), "temperature")).toBeCloseTo(0.1);
    expect(resolveRelativeDeltas(blankColorGrade("e"), { saturation_delta: 0.2 }).saturation).toBeCloseTo(1.2);
    expect(resolveRelativeDeltas(mergeColorGrade(blankColorGrade("e"), { temperature: 0.9 }), { temperature_delta: 0.5 }).temperature).toBe(1.0);
    expect(() => resolveRelativeDeltas(blankColorGrade("e"), { temperature: 0.1, temperature_delta: 0.1 })).toThrow("pass temperature or temperature_delta, not both");
  });

  it("soft presets are the Look menu's (warm_up, sunny, boost_color)", () => {
    const warm = applySoftColorPreset(blankColorGrade("e"), "warm_up");
    expect(scalarY(warm, "temperature")).toBeCloseTo(0.18);
    expect(scalarY(warm, "vibrance")).toBeCloseTo(0.1);
    const sunny = applySoftColorPreset(blankColorGrade("e"), "sunny");
    expect(scalarY(sunny, "exposure")).toBeCloseTo(0.05);
    expect(scalarY(sunny, "saturation")).toBeCloseTo(1.08);
    expect(((applySoftColorPreset(blankColorGrade("e"), "boost_color").curve_all as Json).nodes as Json[]).length).toBe(4);
  });

  it("grade and grain match actions", () => {
    const warm = mergeColorGrade(blankColorGrade("a"), { temperature: 0.25 }) as unknown as Effect;
    expect(gradesMeaningfullyDiffer(summarizeColorGrade(warm), summarizeColorGrade(null))).toBe(true);
    expect(matchGradeAction(warm, null).mode).toBe("reset");
    const paste = matchGradeAction(null, mergeColorGrade(blankColorGrade("b"), { temperature: 0.2 }) as unknown as Effect);
    expect(paste.mode).toBe("paste");
    expect((paste.color as Json).class_name).toBe("ColorGrade");
    expect((paste.color as Json).id).toBeUndefined();
    const a = blankColorGrade("a");
    const b = mergeColorGrade(blankColorGrade("b"), { wheels: { shadows: { amount: 0.2 } } });
    expect(gradesMeaningfullyDiffer(summarizeColorGrade(a), summarizeColorGrade(b))).toBe(true);
    const grain = applyFilmGrainPreset({ class_name: "FilmGrain", id: "g1" }, "35mm_classic") as unknown as Effect;
    expect(summarizeFilmGrain(grain).present).toBe(true);
    expect(matchGrainAction(grain, null).mode).toBe("reset");
    expect(matchGrainAction(null, grain).mode).toBe("paste");
    expect(matchGrainAction(null, null).mode).toBe("noop");
  });

  it("profiles, distances, the solver, nuke recovery and caps", () => {
    const warm = { present: true, avg_luma: 0.62, warm_cool: 0.1, green_magenta: 0.0, sat_proxy: 0.3, contrast_span: 0.5, clipped_shadows: 0.0, clipped_highlights: 0.2, channel_means: { red: 0.6, green: 0.5, blue: 0.45 } };
    const profile = buildLookProfile([warm, { ...warm, avg_luma: 0.6 }, { ...warm, avg_luma: 0.58 }]);
    expect(profile).toMatchObject({ present: true, samples: 3 });
    const dark = { ...profile, avg_luma: 0.3, warm_cool: -0.05, clipped_highlights: 0.0 };
    expect(lookProfileDistance(dark, profile)!).toBeGreaterThan(0.05);
    const patch = solveGradeFromProfiles(dark, profile);
    expect("temperature" in patch || "exposure" in patch).toBe(true);
    expect(Math.abs(Number(patch.temperature ?? 0))).toBeLessThanOrEqual(0.35);
    const outcome = assessGradeOutcome(dark, profile, profile);
    expect(outcome.nuke_risk).toBe(true);
    expect(outcome.suggested_recovery_patch).not.toEqual({});
    expect(targetProfileForLook("horror")!.avg_luma as number).toBeLessThan(targetProfileForLook("sunny")!.avg_luma as number);
    const capped = capColorPatch({ exposure: 2, temperature: -2 });
    expect(capped.exposure).toBeLessThanOrEqual(0.35);
    expect(capped.temperature).toBeGreaterThanOrEqual(-0.35);
  });
});
