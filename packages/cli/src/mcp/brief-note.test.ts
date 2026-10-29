import { createProject, readBrief } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { autoBrief, autoBriefNote, BRIEF_NOTE, briefNote } from "./brief-note.js";

describe("the brief note on receipts", () => {
  it("points the calls that start a video at produce_video_tool, until a brief is saved or the cut is under way", () => {
    const project = createProject({ id: "BRIEFNOTEX" });
    expect(briefNote("gather_stock_footage_tool", project)).toBe(BRIEF_NOTE);
    expect(BRIEF_NOTE).toMatch(/produce_video_tool/);
    expect(briefNote("trim_clip_tool", project)).toBeUndefined();
    project.settings = { zenvi_brief: { goal: "g", platform: "p", aspect: "9:16", length_seconds: 10, style: "hype-reel", hook: "h", beats: [{ start: 0, end: 10, name: "all" }] } };
    expect(briefNote("gather_stock_footage_tool", project)).toBeUndefined();
    const busy = createProject({ id: "BRIEFNOTEY" });
    busy.clips = [{}, {}, {}] as never;
    expect(briefNote("add_clip_to_timeline_tool", busy)).toBeUndefined();
  });

  it("owes a minimal brief to the cuts made before one, never to a search, the person's import or the frame setting", () => {
    const project = createProject({ id: "BRIEFGATEX" });
    const brief = autoBrief("build_reel_tool", project, { style: "cinematic", hook: "Lisbon at dawn", duration_seconds: 18 });
    expect(brief).toMatchObject({ style: "travel-cinematic-montage", length_seconds: 18, aspect: "16:9" });
    expect(autoBriefNote(brief!)).toMatch(/^No brief was saved, so a minimal one was \(travel-cinematic-montage, 16:9 18s; one undo step\)\. produce_video_tool/);
    expect(autoBrief("gather_stock_footage_tool", project, { queries: ["match cut circles", "moon"] })?.style).toBe("match-cut-montage");
    for (const tool of ["search_pexels_videos_tool", "import_files_tool", "set_project_setting_tool", "save_brief_tool", "trim_clip_tool"]) expect(autoBrief(tool, project, {}), tool).toBeNull();
    project.settings = { zenvi_brief: brief };
    expect(readBrief(project)).not.toBeNull();
    expect(autoBrief("build_reel_tool", project, {})).toBeNull();
  });
});
