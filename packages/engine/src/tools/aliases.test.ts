import { describe, expect, it } from "vitest";
import { aliasArguments, matchOption } from "./aliases.js";

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
