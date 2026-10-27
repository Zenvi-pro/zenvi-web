/**
 * The older colour tools through runTool with string arguments:
 * apply_color_tool, apply_look_tool, inspect_color_tool, list_looks_tool and
 * match_color_to_reference_tool. Ported from zenvi-core develop
 * tests/test_color_agent_tools.py; frames come from the engine's own
 * compositor (test-support/pixel-host.ts), so scopes, previews and the match
 * loop run for real.
 */

import { describe, expect, it } from "vitest";
import type { Effect, Keyframe } from "../model/types.js";
import { findColorGrade, scalarY } from "./color-agent.js";
import { runTool } from "./registry.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { fakeHost } from "./test-support/fake-host.js";
import { pixelFrameHost, solid } from "./test-support/pixel-host.js";

type Row = Record<string, unknown>;

const L2 = 2_000_000;

/** Media painted by file name: "dark" files grey 60, "bright" files grey 180, the rest grey 128. */
function painted(): EditHarness {
  const ed = new EditHarness({ playhead: 1 });
  // A small canvas keeps the many profile renders quick (solo renders follow the project's size).
  ed.doc.setUntracked(["width"], 320);
  ed.doc.setUntracked(["height"], 180);
  ed.host.frames = pixelFrameHost((path, w, h) => {
    const level = path.includes("dark") ? 60 : path.includes("bright") ? 180 : 128;
    return solid(w, h, [level, level, level, 255]);
  });
  return ed;
}

function grade(ed: EditHarness, clipId: string): Record<string, unknown> | null {
  return findColorGrade(ed.clip(clipId)!.effects) as Record<string, unknown> | null;
}

async function json(ed: EditHarness, name: string, args: Row): Promise<{ data: Row; images: number; summary: string }> {
  const result = await runTool({ doc: ed.doc, host: ed.host }, name, args);
  const receipt = result.data!;
  expect(receipt.summary, receipt.summary).not.toMatch(/^Error/);
  // The summary is the data as JSON, which writes -0 as 0 (a scope over random film grain can round to -0).
  expect(JSON.parse(receipt.summary)).toEqual(JSON.parse(JSON.stringify(receipt.data)));
  return { data: receipt.data as Row, images: result.images?.length ?? 0, summary: receipt.summary };
}

// Real renders (previews) through the CPU compositor: a few seconds each under a full parallel run.
describe("apply_color_tool", { timeout: 30_000 }, () => {
  it("merges knobs onto one ColorGrade in one undo step, with an after preview", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"));
    ed.addEffect(c, "Blur");
    const { data, images } = await json(ed, "apply_color_tool", { clipIds: c, exposure: "0.2", temperature: "0.1" });
    expect(data).toMatchObject({ ok: true, undo: "one step", warnings: [], after_preview_jpeg: "attached image 1", nuke_risk: false });
    // Mid-grey brightened by +0.2 stops crosses the 0.55 average luma of an "outdoor bright" plate.
    expect((data.after_scopes as Row).avg_luma as number).toBeGreaterThan(0.55);
    expect(data.outdoor_bright).toBe(true);
    expect((data.clips as Row[])[0]).toMatchObject({ timeline_clip_id: c, status: "applied" });
    expect((data.after_scopes as Row).present).toBe(true);
    expect(images).toBe(1);
    expect(scalarY(grade(ed, c)!, "exposure")).toBeCloseTo(0.2);
    expect(scalarY(grade(ed, c)!, "temperature")).toBeCloseTo(0.1);
    expect(ed.clip(c)!.effects.map((e) => e.class_name)).toEqual(["Blur", "ColorGrade"]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.mark();
    await json(ed, "apply_color_tool", { clipId: c, temperature_delta: "0.08" });
    expect(scalarY(grade(ed, c)!, "temperature")).toBeCloseTo(0.18);
    expect(scalarY(grade(ed, c)!, "exposure")).toBeCloseTo(0.2);
    expect(ed.clip(c)!.effects.filter((e) => e.class_name === "ColorGrade")).toHaveLength(1);
    ed.doc.undo();
    expect(scalarY(grade(ed, c)!, "temperature")).toBeCloseTo(0.1);
  });

  it("refuses bad values and missing LUTs before anything changes", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"));
    ed.addEffect(c, "Blur");
    await ed.refused("apply_color_tool", { clipIds: c, exposure: "nope" }, "exposure must be a finite number");
    await ed.refused("apply_color_tool", { clipIds: c, saturation: "0.2" }, "saturation neutral is 1.0");
    await ed.refused("apply_color_tool", { clipIds: c, wheels: '{"skin": {"amount": 0.1}}' }, "Unknown wheel 'skin'");
    await ed.refused("apply_color_tool", { clipIds: c, lut_path: "nope/missing.cube" }, "LUT file not found");
    await ed.refused("apply_color_tool", { clipIds: c, lut: '{"path": "/no/such/file.cube"}' }, "LUT file not found");
    await ed.refused("apply_color_tool", { clipIds: c }, "apply_color needs reset=true or at least one colour field");
    expect(ed.clip(c)!.effects.map((e) => e.class_name)).toEqual(["Blur"]);
  });

  it("resolves LUT ids, relative paths and the alias to the bundled LUT", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"));
    for (const lut of ["teal_cinema", "cinematic_&_blockbuster/teal_cinema.cube", "@colors/cinematic_&_blockbuster/teal_cinema.cube"]) {
      await json(ed, "apply_color_tool", { clipIds: c, lut_path: lut });
      expect(grade(ed, c)!.lut_path, lut).toBe("@colors/cinematic_&_blockbuster/teal_cinema.cube");
    }
    await json(ed, "apply_color_tool", { clipIds: c, lut: '{"path": "warm_cinema", "strength": 0.4}' });
    expect(grade(ed, c)!.lut_path).toBe("@colors/cinematic_&_blockbuster/warm_cinema.cube");
    expect(scalarY(grade(ed, c)!, "lut_intensity")).toBeCloseTo(0.4);
  });

  it("reset removes the grade; a clip without one is a no-op with no undo step", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"));
    const { data } = await json(ed, "apply_color_tool", { clipIds: c, reset: "true" });
    expect((data.clips as Row[])[0]).toMatchObject({ status: "noop", color: { present: false } });
    expect(ed.stepsSinceMark()).toBe(0);
    await json(ed, "apply_color_tool", { clipIds: c, exposure: 0.3 });
    ed.mark();
    await json(ed, "apply_color_tool", { clipIds: c, reset: true });
    expect(grade(ed, c)).toBeNull();
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("targets every picture clip, the selection, then the clip under the playhead; locked tracks are skipped", async () => {
    const ed = painted();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { position: 0, end: 5 });
    const b = ed.addClip(f, { position: 5, end: 10 });
    const song = ed.addClip(ed.addFile("audio"), { layer: L2 });
    const all = await json(ed, "apply_color_tool", { clipIds: "all", exposure: "0.1" });
    expect((all.data.clips as Row[]).map((r) => r.timeline_clip_id)).toEqual([a, b]);
    expect(grade(ed, song)).toBeNull();
    ed.selectIds([b]);
    expect(((await json(ed, "apply_color_tool", { tint: "0.05" })).data.clips as Row[]).map((r) => r.timeline_clip_id)).toEqual([b]);
    ed.selectIds([]);
    expect(((await json(ed, "apply_color_tool", { tint: "0.02" })).data.clips as Row[]).map((r) => r.timeline_clip_id)).toEqual([a]);
    ed.lockTrack(1_000_000);
    ed.mark();
    await ed.refused("apply_color_tool", { clipIds: `${a},${b}`, exposure: "0.1" }, `clip ${a}: track locked — skipped`);
    const empty = new EditHarness();
    await empty.refused("apply_color_tool", { exposure: "0.1" }, "apply_color needs a target clip", "On timeline now: (none)");
  });

  it("says when the after preview cannot be rendered", async () => {
    const ed = new EditHarness();
    ed.host.frames = undefined;
    const c = ed.addClip(ed.addFile("video"));
    const { data, images } = await json(ed, "apply_color_tool", { clipIds: c, exposure: "0.1" });
    expect(data).toMatchObject({ after_preview_jpeg: "", nuke_risk: false });
    expect(data.warnings).toEqual(["after preview failed: this host does not render frames"]);
    expect(images).toBe(0);
  });
});

describe("apply_look_tool", { timeout: 30_000 }, () => {
  it("applies stylised looks as generated LUTs, written once and reused, any duotone pair or accent colour", async () => {
    const ed = painted();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { position: 0, end: 5 });
    const b = ed.addClip(f, { position: 5, end: 10 });
    const { data } = await json(ed, "apply_look_tool", { clipIds: `["${a}"]`, lookId: "solarize" });
    expect((data.clips as Row[])[0]).toMatchObject({ status: "lut", look: "solarize" });
    const lut = (findColorGrade(ed.clip(a)!.effects ?? []) as Effect).lut_path as string;
    expect(lut).toMatch(/look-solarize-[0-9a-f]{8}\.cube$/);
    await json(ed, "apply_look_tool", { clipIds: `["${b}"]`, lookId: "solarize" });
    expect((findColorGrade(ed.clip(b)!.effects ?? []) as Effect).lut_path).toBe(lut);
    expect(ed.host.calls.filter((c) => c.startsWith("writeGenerated look-solarize"))).toHaveLength(1);
    await json(ed, "apply_look_tool", { clipIds: `["${a}"]`, lookId: "duotone #1A1A40 #FFCC00" });
    expect((findColorGrade(ed.clip(a)!.effects ?? []) as Effect).lut_path).toMatch(/look-duotone-1a1a40-ffcc00-/);
    for (const lookId of ["chrome", "bleach_bypass", "duotone_navy_red", "accent_red", "accent #00aaff"]) await json(ed, "apply_look_tool", { clipIds: `["${a}"]`, lookId });
    const listed = (await json(ed, "list_looks_tool", { query: "solarized" })).data.looks as Row[];
    expect(listed.map((l) => l.id)).toContain("solarize");
  });

  it("applies a soft preset under one undo step and keeps the other effects", async () => {
    const ed = painted();
    const f = ed.addFile("video");
    const a = ed.addClip(f, { position: 0, end: 5 });
    const b = ed.addClip(f, { position: 5, end: 10 });
    ed.addEffect(a, "Blur");
    const { data } = await json(ed, "apply_look_tool", { clipIds: `["${a}","${b}"]`, lookId: "warm_up" });
    expect(data).toMatchObject({ ok: true, undo: "one step", vibe_goal: "warm_up" });
    expect(typeof data.look_distance_to_vibe).toBe("number");
    expect((data.clips as Row[]).map((r) => r.status)).toEqual(["preset", "preset"]);
    expect(scalarY(grade(ed, a)!, "temperature")).toBeCloseTo(0.18);
    expect(ed.clip(a)!.effects.some((e) => e.class_name === "Blur")).toBe(true);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("a LUT look merges onto the grade; mix is the LUT's strength", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"));
    await json(ed, "apply_color_tool", { clipIds: c, temperature: "0.08", exposure: "0.25" });
    const { data } = await json(ed, "apply_look_tool", { clipIds: c, lookId: "warm_cinema", mix: "0.45" });
    expect((data.clips as Row[])[0]).toMatchObject({ status: "lut", lut_path: "@colors/cinematic_&_blockbuster/warm_cinema.cube" });
    const g = grade(ed, c)!;
    expect(scalarY(g, "lut_intensity")).toBeCloseTo(0.45);
    expect(scalarY(g, "mix")).toBeCloseTo(1.0);
    expect(scalarY(g, "temperature")).toBeCloseTo(0.08);
    expect(scalarY(g, "exposure")).toBeCloseTo(0.25);
    await json(ed, "apply_look_tool", { clipIds: c, lookId: "teal_cinema", lutIntensity: "0.55" });
    expect(scalarY(grade(ed, c)!, "lut_intensity")).toBeCloseTo(0.55);
  });

  it("film grain looks, stacked grain, and grain:none without grain as a no-op", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"));
    const none = await json(ed, "apply_look_tool", { clipIds: c, lookId: "grain:none" });
    expect((none.data.clips as Row[])[0]!.status).toBe("noop");
    expect(ed.stepsSinceMark()).toBe(0);
    await json(ed, "apply_look_tool", { clipIds: c, lookId: "boost_color", stackGrain: "true" });
    const grain = ed.clip(c)!.effects.find((e) => e.class_name === "FilmGrain")!;
    expect((grain.amount as Keyframe).Points[0]!.co.Y).toBe(0.24);
    await json(ed, "apply_look_tool", { clipIds: c, lookId: "grain:super_8" });
    const grains = ed.clip(c)!.effects.filter((e) => e.class_name === "FilmGrain");
    expect(grains).toHaveLength(1);
    expect(grains[0]!.id).toBe(grain.id);
    await json(ed, "apply_look_tool", { clipIds: c, lookId: "reset", grainPreset: "none" });
    expect(ed.clip(c)!.effects).toEqual([]);
  });

  it("refuses bad looks and values before anything changes", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"));
    await ed.refused("apply_look_tool", { clipIds: c }, "apply_look requires lookId or lutPath");
    await ed.refused("apply_look_tool", { clipIds: c, lookId: "nope" }, "Unknown lookId 'nope'");
    await ed.refused("apply_look_tool", { clipIds: c, lutPath: "nope/missing.cube" }, "LUT file not found");
    await ed.refused("apply_look_tool", { clipIds: c, lookId: "teal_cinema", mix: "nan" }, "mix must be a finite number");
    await ed.refused("apply_look_tool", { clipIds: c, lookId: "warm_up", lutPath: "teal_cinema" }, "pass either lookId or lutPath");
  });
});

describe("inspect_color_tool", { timeout: 30_000 }, () => {
  it("measures the clip alone at the playhead, with a preview, and compares a reference", async () => {
    const ed = painted();
    const subject = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), { position: 0, end: 5 });
    const reference = ed.addClip(ed.addFile("video", { name: "bright.mp4" }), { position: 5, end: 10 });
    await json(ed, "apply_color_tool", { clipIds: reference, temperature: "0.2" });
    const { data, images } = await json(ed, "inspect_color_tool", { clipId: subject, reference });
    expect(data).toMatchObject({ ok: true, timeline_clip_id: subject, atFrame: 31, preview_jpeg: "attached image 1", reference_preview_jpeg: "attached image 2" });
    expect((data.scopes as Row).avg_luma as number).toBeCloseTo(60 / 255, 2);
    expect((data.scopes as Row)).toMatchObject({ present: true, isolated: true, local_frame: 31, clipped_shadows: 0, clipped_highlights: 0 });
    expect((data.color as Row).present).toBe(false);
    expect(((data.reference as Row).color as Row).present).toBe(true);
    expect(data.grades_differ).toBe(true);
    expect(data.grain_differ).toBe(false);
    expect((data.hints as Row[]).some((h) => "exposure" in h)).toBe(true);
    expect(images).toBe(2);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("skips the preview on request, reports a missing reference, refuses a bad frame number", async () => {
    const ed = painted();
    const c = ed.addClip(ed.addFile("video"), { position: 10, end: 5 });
    const { data, images } = await json(ed, "inspect_color_tool", { timeline_clip_id: c, include_preview: "false", referenceClipId: "GONE", atFrame: "301.7" });
    expect(data).toMatchObject({ atFrame: 301, preview_jpeg: "", warnings: ["reference clip GONE not found"] });
    expect(images).toBe(0);
    await ed.refused("inspect_color_tool", { clipId: c, atFrame: "abc" }, "atFrame must be an integer frame number");
    const r = await runTool({ doc: ed.doc, host: fakeHost({ without: ["frames"] }) }, "inspect_color_tool", { clipId: c });
    expect(r.data!.summary).toMatch(/is not available in this Zenvi surface/);
  });
});

describe("list_looks_tool", () => {
  it("lists presets, LUTs and grains, filtered by query and vibe", async () => {
    const ed = new EditHarness();
    const all = await json(ed, "list_looks_tool", {});
    expect(all.data).toMatchObject({ ok: true, query: "" });
    // 7 presets, 50 LUTs, 16 stylised looks (3 + 6 duotones + 7 accents), 7 grains.
    expect(all.data.count).toBe(7 + 50 + 16 + 7);
    const sunny = await json(ed, "list_looks_tool", { query: "sunny" });
    expect((sunny.data.looks as Row[]).map((e) => e.id)).toContain("sunny");
    const both = await json(ed, "list_looks_tool", { query: "teal", vibe: "horror" });
    expect(both.data.query).toBe("teal horror");
    expect((both.data.looks as Row[]).map((e) => e.id)).toContain("teal_horror");
  });
});

// Each look profile renders 16 frames through the CPU compositor.
describe("match_color_to_reference_tool", { timeout: 60_000 }, () => {
  it("dry run proposes a brighter grade and changes nothing", async () => {
    const ed = painted();
    const subject = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), { position: 0, end: 4 });
    const reference = ed.addClip(ed.addFile("video", { name: "bright.mp4" }), { position: 4, end: 8 });
    const { data, images } = await json(ed, "match_color_to_reference_tool", { clipId: subject, referenceClipId: reference, dry_run: "true" });
    expect(data).toMatchObject({ applied: false, match_mode: "look_profile", reference_kind: "clip", grain_mode: "noop", samples_used: { subject: 16, reference: 16 } });
    expect((data.proposed_patch as Row).exposure as number).toBeGreaterThan(0);
    expect(images).toBe(2);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("grades the subject toward the reference in one undo step, iterating on a working copy", async () => {
    const ed = painted();
    const subject = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), { position: 0, end: 4 });
    const reference = ed.addClip(ed.addFile("video", { name: "bright.mp4" }), { position: 4, end: 8 });
    const { data, images } = await json(ed, "match_color_to_reference_tool", { clipId: subject, reference, max_iterations: "2" });
    expect(data.applied).toBe(true);
    expect(data.iteration_count as number).toBeGreaterThanOrEqual(1);
    expect(data.iteration_count as number).toBeLessThanOrEqual(2);
    expect(data.look_distance_after as number).toBeLessThan(data.look_distance_before as number);
    expect(data.after_preview_jpeg).toBe("attached image 3");
    expect(images).toBe(3);
    expect(scalarY(grade(ed, subject)!, "exposure")!).toBeGreaterThan(0);
    expect(grade(ed, reference)).toBeNull();
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(grade(ed, subject)).toBeNull();
  });

  it("writes nothing over an edit that lands while it renders", async () => {
    const ed = painted();
    const subject = ed.addClip(ed.addFile("video", { name: "dark.mp4" }), { position: 0, end: 4 });
    const reference = ed.addClip(ed.addFile("video", { name: "bright.mp4" }), { position: 4, end: 8 });
    let paints = 0;
    ed.host.frames = pixelFrameHost((path, w, h) => {
      // The person adds an effect to the subject while the match is measuring.
      if ((paints += 1) === 20) ed.addEffect(subject, "Negate");
      const level = path.includes("dark") ? 60 : path.includes("bright") ? 180 : 128;
      return solid(w, h, [level, level, level, 255]);
    });
    await ed.refused(
      "match_color_to_reference_tool",
      { clipId: subject, reference },
      `clip ${subject} was edited while match_color_to_reference_tool rendered frames (effects); nothing changed, call it again`,
    );
    expect(ed.clip(subject)!.effects.map((e: Effect) => e.class_name)).toEqual(["Negate"]);
  });

  it("removes Film Grain the reference does not have", async () => {
    const ed = painted();
    const f = ed.addFile("video");
    const subject = ed.addClip(f, { position: 0, end: 2 });
    const reference = ed.addClip(f, { position: 2, end: 4 });
    await json(ed, "apply_look_tool", { clipIds: subject, lookId: "grain:35mm_classic" });
    ed.mark();
    const { data } = await json(ed, "match_color_to_reference_tool", { clipId: subject, reference });
    expect(data.grain_mode).toBe("reset");
    expect(ed.clip(subject)!.effects.some((e: Effect) => e.class_name === "FilmGrain")).toBe(false);
    expect(ed.stepsSinceMark()).toBe(1);
  });

  it("matches a media-bin file, and refuses what it cannot measure or reach", async () => {
    const ed = painted();
    const subject = ed.addClip(ed.addFile("video", { name: "dark.mp4" }));
    const binFile = ed.addFile("video", { name: "bright-ref.mp4" });
    const { data } = await json(ed, "match_color_to_reference_tool", { clipId: subject, referenceFileId: binFile, dryRun: "yes" });
    expect(data).toMatchObject({ reference_kind: "file", reference: binFile });
    expect(((data.reference_profile as Row).avg_luma as number)).toBeCloseTo(180 / 255, 2);
    const still = await json(ed, "match_color_to_reference_tool", { clipId: subject, referenceImagePath: "/refs/bright-still.png", dryRun: "true" });
    expect(still.data).toMatchObject({ reference_kind: "path", reference: "/refs/bright-still.png", samples_used: { reference: 1 } });
    expect(((still.data.reference_profile as Row).avg_luma as number)).toBeCloseTo(180 / 255, 2);
    expect(ed.host.calls).not.toContain("importPath /refs/bright-still.png");
    ed.mark();
    await ed.refused("match_color_to_reference_tool", { clipId: subject }, "requires referenceClipId, referenceFileId, or referenceImagePath");
    await ed.refused("match_color_to_reference_tool", { clipId: subject, reference: subject }, "subject and reference are the same clip");
    await ed.refused("match_color_to_reference_tool", { clipId: subject, reference: "TYPO" }, "reference clip TYPO not found");
    await ed.refused("match_color_to_reference_tool", { clipId: subject, referenceFileId: "NOFILE" }, "media-bin file NOFILE not found");
    const noLocal = await runTool(
      { doc: ed.doc, host: { ...ed.host, media: { ...ed.host.media!, importPath: undefined } } },
      "match_color_to_reference_tool",
      { clipId: subject, referenceImagePath: "/Users/me/still.png" },
    );
    expect(noLocal.data!.summary).toMatch(/not available in this Zenvi surface: referenceImagePath needs local file access/);
    expect(ed.stepsSinceMark()).toBe(0);
  });
});
