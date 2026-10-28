import { createProject } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { BRIEF_NOTE, briefGate, briefNote } from "./brief-note.js";

describe("the brief note on receipts", () => {
  it("asks for the brief on the calls that start a video, until one is saved or the cut is under way", () => {
    const project = createProject({ id: "BRIEFNOTEX" });
    expect(briefNote("gather_stock_footage_tool", project)).toBe(BRIEF_NOTE);
    expect(briefNote("trim_clip_tool", project)).toBeUndefined();
    project.settings = { zenvi_brief: { goal: "g", platform: "p", aspect: "9:16", length_seconds: 10, style: "hype-reel", hook: "h", beats: [{ start: 0, end: 10, name: "all" }] } };
    expect(briefNote("gather_stock_footage_tool", project)).toBeUndefined();
    const busy = createProject({ id: "BRIEFNOTEY" });
    busy.clips = [{}, {}, {}] as never;
    expect(briefNote("add_clip_to_timeline_tool", busy)).toBeUndefined();
  });

  it("gates the cuts made before a brief, never a search, the person's import or the frame setting", () => {
    const project = createProject({ id: "BRIEFGATEX" });
    expect(briefGate("match_cut_montage_tool", project)).toBe(true);
    expect(briefGate("gather_stock_footage_tool", project)).toBe(true);
    for (const tool of ["search_pexels_videos_tool", "import_files_tool", "set_project_setting_tool", "save_brief_tool", "trim_clip_tool"]) expect(briefGate(tool, project), tool).toBe(false);
  });
});
