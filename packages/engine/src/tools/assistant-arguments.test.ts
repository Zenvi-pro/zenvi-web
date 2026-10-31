import { describe, expect, it } from "vitest";
import { assistantArguments } from "./assistant-arguments.js";
import { runTool } from "./registry.js";
import { fakeHost } from "./test-support/fake-host.js";
import { fixtureDoc, IDS } from "./test-support/fixture.js";

describe("assistantArguments", () => {
  it("reads inspect_timeline_tool's snake_case names as the contract's, silently", () => {
    const args = { start_frame: 0, end_frame: 60, max_frames: 3, timeline_clip_id: "A", overview: false };
    expect(assistantArguments("inspect_timeline_tool", args)).toEqual({
      args: { startFrame: 0, endFrame: 60, maxFrames: 3, clipId: "A", overview: false },
      notes: [],
    });
    expect(args).toHaveProperty("start_frame");
  });

  it("keeps the contract's name when a call passes both", () => {
    expect(assistantArguments("inspect_timeline_tool", { maxFrames: 2, max_frames: 9 }).args).toEqual({ maxFrames: 2, max_frames: 9 });
  });

  it("leaves other tools alone", () => {
    const args = { start_frame: 1 };
    expect(assistantArguments("inspect_media_tool", args)).toEqual({ args, notes: [] });
  });

  it("reads a desktop caption look as the closest preset and says so", () => {
    const r = assistantArguments("add_captions_tool", { style: "pill-karaoke" });
    expect(r.args).toEqual({ style: "boxed" });
    expect(r.notes).toEqual(["style 'pill-karaoke' is a desktop caption look this surface does not have; used 'boxed', the closest."]);
    expect(assistantArguments("add_captions_tool", { style: "kinetic-slam" }).args).toEqual({ style: "reels" });
    expect(assistantArguments("add_captions_tool", { style: "reels" })).toEqual({ args: { style: "reels" }, notes: [] });
  });

  it("drops whole_project: no clip named already captions every clip with speech", () => {
    expect(assistantArguments("add_captions_tool", { whole_project: "true", style: "classic" })).toEqual({ args: { style: "classic" }, notes: [] });
    expect(assistantArguments("add_captions_tool", { whole_project: true, timeline_clip_id: "A" })).toEqual({
      args: { timeline_clip_id: "A" },
      notes: ["whole_project was ignored: the clip named was captioned."],
    });
  });
});

describe("the Assistant's calls through runTool (live zenvi.pro, 2026-10-31)", () => {
  it("inspect_timeline_tool runs the Assistant's first call instead of refusing it", async () => {
    const doc = fixtureDoc();
    // What the backend's Assistant sent first: refused as "Additional properties are not allowed".
    const r = await runTool({ doc, host: fakeHost() }, "inspect_timeline_tool", { timeline_clip_id: IDS.clipA, max_frames: 3 });
    expect(r.ok, r.text).toBe(true);
    expect(r.images).toHaveLength(3);
    const ranged = await runTool({ doc, host: fakeHost() }, "inspect_timeline_tool", { start_frame: 0, end_frame: 60, max_frames: 2 });
    expect(ranged.ok, ranged.text).toBe(true);
    expect(ranged.images).toHaveLength(2);
  });

  it("inspect_timeline_tool with no range spreads frames over the whole timeline (the Assistant's next first call)", async () => {
    const doc = fixtureDoc();
    const r = await runTool({ doc, host: fakeHost() }, "inspect_timeline_tool", { max_frames: 4 });
    expect(r.ok, r.text).toBe(true);
    expect(r.images).toHaveLength(4);
    expect(r.text).toContain("No range given: frames spread over the whole timeline.");
  });

  it("add_captions_tool takes the desktop's default look and whole_project", async () => {
    const doc = fixtureDoc();
    const r = await runTool({ doc, host: fakeHost() }, "add_captions_tool", { style: "pill-karaoke", whole_project: true });
    expect(r.ok, r.text).toBe(true);
    expect(r.text).toContain("used 'boxed', the closest");
    expect(doc.undoLabels).toHaveLength(1);
  });
});
