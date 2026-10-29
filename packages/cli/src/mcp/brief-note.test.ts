import { createProject, ProjectDocument, readBrief } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { autoBriefFor } from "./brief-note.js";

const doc = (width = 1080, height = 1920): ProjectDocument => {
  const project = createProject({ id: "AUTOBRIEFX" });
  project.width = width;
  project.height = height;
  return new ProjectDocument(project);
};

describe("the auto brief", () => {
  it("is saved by the first call that starts a video, outside the undo history, and says so once", () => {
    const d = doc();
    expect(autoBriefFor("search_pexels_videos_tool", d, "{}")).toBeUndefined();
    expect(readBrief(d.project)).toBeNull();
    const note = autoBriefFor("gather_stock_footage_tool", d, JSON.stringify({ queries: ["sprinter on a track", "sports car drift"] }));
    expect(note).toMatch(/^Saved a minimal brief for this project \(auto: style hype-reel matched from the styles index, 9:16, 15 s, one beat\)/);
    expect(readBrief(d.project)).toMatchObject({ auto: true, style: "hype-reel", aspect: "9:16", length_seconds: 15 });
    expect(d.undoLabels).toEqual([]);
    expect(autoBriefFor("add_clip_to_timeline_tool", d, "{}")).toBeUndefined();
  });

  it("matches the style from the call's words and the bin's names", () => {
    const d = doc(1920, 1080);
    autoBriefFor("import_files_tool", d, JSON.stringify({ paths: ["/clips/app_dashboard_demo.mov"] }) + " saas launch");
    expect(readBrief(d.project)).toMatchObject({ style: "saas-ui-promo", aspect: "16:9", platform: "YouTube / web" });
  });

  it("keeps an auto brief's frame in step with the project, and never touches a brief the agent saved", () => {
    const d = doc(1920, 1080);
    autoBriefFor("import_files_tool", d, "{}");
    d.setUntracked(["width"], 1080);
    d.setUntracked(["height"], 1920);
    autoBriefFor("add_clip_to_timeline_tool", d, "{}");
    expect(readBrief(d.project)?.aspect).toBe("9:16");
    const own = { goal: "g", platform: "p", aspect: "1:1", length_seconds: 8, style: "tutorial", hook: "h", beats: [{ start: 0, end: 8, name: "all" }] };
    d.setUntracked(["settings"], { zenvi_brief: own });
    expect(autoBriefFor("import_files_tool", d, "{}")).toBeUndefined();
    expect(readBrief(d.project)).toMatchObject({ aspect: "1:1", style: "tutorial" });
    expect(readBrief(d.project)?.auto).toBeUndefined();
  });
});
