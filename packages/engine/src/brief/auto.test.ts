import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import { finishGaps } from "../review/finish.js";
import { autoBrief, ensureBrief, matchStyle, nearestAspect } from "./auto.js";
import { readBrief } from "./brief.js";
import { checkBrief } from "./check.js";

describe("the auto brief", () => {
  it("matches a style from the request's words, the index's summaries breaking ties, a default otherwise", () => {
    expect(matchStyle("a promo for our AI app launch dashboard")).toBe("saas-ui-promo");
    expect(matchStyle("talking head podcast with captions")).toBe("kinetic-captions");
    expect(matchStyle("hello")).toBe("hype-reel");
    expect(matchStyle("bakery morning", [{ id: "food-recipe", summary: "A recipe or bakery video with steam and pours" }])).toBe("food-recipe");
  });

  it("takes the frame and the timeline's length, one beat, auto", () => {
    const project = createProject({ id: "AUTOBRIEF1" });
    project.width = 1080;
    project.height = 1350;
    expect(nearestAspect(project)).toBe("4:5");
    expect(autoBrief(project)).toMatchObject({ aspect: "4:5", length_seconds: 15, beats: [{ start: 0, end: 15, name: "whole piece" }], auto: true });
  });

  it("is saved outside the undo history, once, and only advises the finish", () => {
    const doc = new ProjectDocument(createProject({ id: "AUTOBRIEF2" }));
    expect(ensureBrief(doc, "sports hype")?.style).toBe("hype-reel");
    expect(ensureBrief(doc)).toBeNull();
    expect(doc.undoLabels).toEqual([]);
    const brief = readBrief(doc.project)!;
    // A 15 s guess against an empty timeline would be a length miss: an auto brief's misses are never hard.
    expect(checkBrief(doc.project, brief).misses.every((m) => !m.hard)).toBe(true);
    expect(finishGaps(doc.project).some((g) => g.kind === "brief")).toBe(false);
  });
});
