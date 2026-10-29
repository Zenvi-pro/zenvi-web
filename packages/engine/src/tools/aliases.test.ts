import { describe, expect, it } from "vitest";
import { aliasArguments, matchOption } from "./aliases.js";
import { runTool } from "./registry.js";
import { fakeHost } from "./test-support/fake-host.js";
import { fixtureDoc, IDS } from "./test-support/fixture.js";

const schema = (...names: string[]) => ({ properties: Object.fromEntries(names.map((n) => [n, {}])) });

describe("aliasArguments", () => {
  it("renames clip_id to the tool's timeline_clip_id and says so", () => {
    const r = aliasArguments(schema("timeline_clip_id", "text"), { clip_id: "A", text: "x" });
    expect(r.args).toEqual({ timeline_clip_id: "A", text: "x" });
    expect(r.notes).toEqual(["'clip_id' is not an argument of this tool; used it as 'timeline_clip_id'. Pass 'timeline_clip_id' next time."]);
  });

  it("leaves a tool that really takes clip_id alone", () => {
    const args = { clip_id: "A" };
    expect(aliasArguments(schema("clip_id"), args)).toEqual({ args, notes: [] });
  });

  it("leaves a call that already names the real argument, or a tool with no such argument", () => {
    const both = { clip_id: "A", timeline_clip_id: "B" };
    expect(aliasArguments(schema("timeline_clip_id"), both).args).toBe(both);
    const other = { clip_id: "A" };
    expect(aliasArguments(schema("file_id"), other).args).toBe(other);
  });

  it("does not touch the caller's object", () => {
    const args = { clip_id: "A" };
    aliasArguments(schema("timeline_clip_id"), args);
    expect(args).toEqual({ clip_id: "A" });
  });

  it("ignores arguments that are not an object", () => {
    expect(aliasArguments(schema("timeline_clip_id"), "x").notes).toEqual([]);
    expect(aliasArguments(undefined, { clip_id: "A" }).notes).toEqual([]);
  });
});

describe("aliasArguments on items and enum values", () => {
  const easing = { type: "string", enum: ["", "ease_in", "ease_out"] };
  const interpolation = { type: "string", enum: ["", "bezier", "linear", "constant"] };

  it("moves an enum value to the argument next to it that has it, at the top and inside items", () => {
    const keyframes = { properties: { ease: easing, interpolation, points: { type: "array", items: { properties: { value: {}, ease: easing, interpolation } } } } };
    const r = aliasArguments(keyframes, { ease: "linear", points: [{ value: 1, ease: "linear" }, { value: 2, ease: "ease_in" }] });
    expect(r.args).toEqual({ interpolation: "linear", points: [{ value: 1, interpolation: "linear" }, { value: 2, ease: "ease_in" }] });
    expect(r.notes).toEqual([
      "'linear' is not a value of ease; used it as interpolation='linear'. Pass interpolation next time.",
      "'linear' is not a value of points[0].ease; used it as points[0].interpolation='linear'. Pass interpolation next time.",
    ]);
    // Both given: the call means something we cannot guess.
    const both = { ease: "linear", interpolation: "constant" };
    expect(aliasArguments(keyframes, both).args).toBe(both);
  });

  it("renames an item's id to effect (list_fx_tool's key, apply_fx_tool's name)", () => {
    const fx = { properties: { clip_id: {}, effects: { type: "array", items: { properties: { effect: {}, amount: {} } } } } };
    const r = aliasArguments(fx, { timeline_clip_id: "A", effects: [{ id: "bloom" }] });
    expect(r.args).toEqual({ clip_id: "A", effects: [{ effect: "bloom" }] });
    expect(r.notes).toHaveLength(2);
  });

  it("reads one id as the list of one where the tool takes only the list", () => {
    expect(aliasArguments(schema("timeline_clip_ids", "x"), { timeline_clip_id: "A" }).args).toEqual({ timeline_clip_ids: "A" });
    expect(aliasArguments(schema("clip_id", "timeline_clip_ids"), { timeline_clip_id: "A" }).args).toEqual({ clip_id: "A" });
  });

  it("joins a list of ids where the tool takes them comma-separated, and leaves array arguments alone", () => {
    // sk3-creator-social: duck_under_speech_tool and apply_look_tool refused arrays.
    const desktop = { properties: { bed_clip_ids: { type: "string" }, clip_ids: { type: ["string", "array"] } } };
    expect(aliasArguments(desktop, { bed_clip_ids: ["A", "B"], clip_ids: ["C"] }).args).toEqual({ bed_clip_ids: "A,B", clip_ids: ["C"] });
  });

  it("reads an old genre spelling, but only where the schema has the new one", () => {
    const genre = (options: string[]) => ({ properties: { genre: { anyOf: [{ type: "string", enum: options }, { type: "null" }] } } });
    expect(aliasArguments(genre(["hype", "product_3d"]), { genre: "3d_product" }).args).toEqual({ genre: "product_3d" });
    expect(aliasArguments(genre(["hype"]), { genre: "3d_product" }).args).toEqual({ genre: "3d_product" });
  });
});

describe("aliases through runTool (sk2-product-brand regressions)", () => {
  it("set_keyframes_tool takes ease 'linear' as interpolation, and trim_clip_tool takes timeline_clip_id", async () => {
    const doc = fixtureDoc();
    const keyed = await runTool({ doc, host: fakeHost() }, "set_keyframes_tool", {
      timeline_clip_id: IDS.clipA,
      property: "alpha",
      ease: "linear",
      points: [{ seconds: 0, value: 0 }, { seconds: 1, value: 1, ease: "linear" }],
    });
    expect(keyed.ok, keyed.text).toBe(true);
    const alpha = doc.project.clips.find((c) => c.id === IDS.clipA)!.alpha.Points;
    expect(alpha.map((p) => p.interpolation)).toEqual([1, 1]);
    expect(keyed.text).toMatch(/Pass interpolation next time/);

    const trimmed = await runTool({ doc, host: fakeHost() }, "trim_clip_tool", { timeline_clip_id: IDS.clipB, end_seconds: 4 });
    expect(trimmed.ok, trimmed.text).toBe(true);
    expect(doc.project.clips.find((c) => c.id === IDS.clipB)!.end).toBe(4);
  });

  it("apply_fx_tool takes list_fx_tool's id, and master/analyze take product_3d or 3d_product", async () => {
    const doc = fixtureDoc();
    const fx = await runTool({ doc, host: fakeHost() }, "apply_fx_tool", { clip_id: IDS.clipB, effects: [{ id: "not_an_fx" }] });
    // The id reached the effect check: refused for the name, not for an unknown key.
    expect(fx.text).toMatch(/'not_an_fx' is not one of .* \(at effects\.0\.effect\)/);
    for (const genre of ["product_3d", "3d_product"]) {
      const scored = await runTool({ doc, host: fakeHost() }, "analyze_mix_tool", { genre });
      expect(scored.text).not.toMatch(/Invalid arguments/);
      const mastered = await runTool({ doc, host: fakeHost() }, "master_audio_tool", { genre, iterate: true });
      expect(mastered.text).not.toMatch(/Invalid arguments/);
    }
    const ducked = await runTool({ doc, host: fakeHost() }, "duck_under_speech_tool", { speech_clip_ids: [IDS.clipA], bed_clip_ids: [IDS.clipMusic] });
    expect(ducked.text).not.toMatch(/Invalid arguments/);
    const music = await runTool({ doc, host: fakeHost() }, "search_freesound_music_tool", { query: "lo-fi", max_results: 3 });
    expect(music.text).not.toMatch(/Invalid arguments/);
    expect(music.text).toMatch(/used it as 'count'/);
  });
});

describe("matchOption", () => {
  const style = ["rise", "blur", "pop", "wipe"];

  it("reads spelling, case and separators as the option itself", () => {
    expect(matchOption(" POP ", style)).toEqual({ option: "pop", how: "exact" });
    expect(matchOption("over-video", ["over_video", "full_frame"])).toEqual({ option: "over_video", how: "exact" });
    expect(matchOption("Full Frame", ["over_video", "full_frame"])).toEqual({ option: "full_frame", how: "exact" });
  });

  it("honours a block's alias table", () => {
    expect(matchOption("streak", ["sparks", "lines"], { streak: "sparks" })).toEqual({ option: "sparks", how: "alias" });
    expect(matchOption("streak", ["sparks", "lines"], { streak: "gone" })).toBeUndefined();
  });

  it("takes the one option a phrase contains", () => {
    expect(matchOption("scale pop", style)).toEqual({ option: "pop", how: "near" });
    expect(matchOption("pop-in", style)).toEqual({ option: "pop", how: "near" });
    expect(matchOption("over the video", ["over_video", "full_frame"])).toEqual({ option: "over_video", how: "near" });
  });

  it("prefers the longer option over its own part", () => {
    expect(matchOption("drop shadow here", ["shadow", "drop_shadow"])).toEqual({ option: "drop_shadow", how: "near" });
  });

  it("takes a plural or one typo", () => {
    expect(matchOption("wipes", style)).toEqual({ option: "wipe", how: "near" });
    expect(matchOption("dot", ["dots", "lines"])).toEqual({ option: "dots", how: "near" });
    expect(matchOption("rsie", style)).toBeUndefined();
    expect(matchOption("wippe", style)).toEqual({ option: "wipe", how: "near" });
    expect(matchOption("bluur", style)).toEqual({ option: "blur", how: "near" });
  });

  it("refuses what has two readings, none, or says the opposite", () => {
    expect(matchOption("blur rise", style)).toBeUndefined();
    expect(matchOption("zoom", style)).toBeUndefined();
    expect(matchOption("not pop", style)).toBeUndefined();
    expect(matchOption("", style)).toBeUndefined();
    // a short word one letter off is another word, not a typo
    expect(matchOption("pip", style)).toBeUndefined();
  });
});
