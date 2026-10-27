import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { applyProjectState } from "./master-loop.js";

describe("applyProjectState", () => {
  it("lands every key the scratch run changed, not only the collections, in one undo step", () => {
    const doc = new ProjectDocument(createProject());
    const target = structuredClone(doc.project) as ReturnType<typeof createProject> & Record<string, unknown>;
    target.settings = { ...(target.settings as object), zenvi_probe: 1 };
    const undo = doc.undoLabels.length;
    doc.transaction("apply", (tx) => applyProjectState(tx, target));
    expect(doc.project).toEqual(target);
    expect(doc.undoLabels.length).toBe(undo + 1);
    doc.undo();
    expect((doc.project.settings as Record<string, unknown>).zenvi_probe).toBeUndefined();
  });
});
