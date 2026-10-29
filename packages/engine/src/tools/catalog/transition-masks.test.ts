import { describe, expect, it } from "vitest";
import { EditHarness } from "../test-support/edit-harness.js";

describe("make_transition_mask_tool", () => {
  it("adds a project-size tile mask to the bin in one undo step, ready for update_transition_tool", async () => {
    const ed = new EditHarness();
    ed.mark();
    const data = (await ed.receipt("make_transition_mask_tool", { order: "diagonal", count: 8 })) as Record<string, unknown>;
    expect(ed.stepsSinceMark()).toBe(1);
    expect(data).toMatchObject({ pattern: "tiles", order: "diagonal", count: 8, width: 1280, height: 720 });
    const file = ed.doc.project.files.find((f) => f.id === data.file_id)!;
    expect(file.media_type).toBe("image");
    expect(String(file.path)).toMatch(/mask-tiles-diagonal-8-[0-9a-f]{8}\.svg$/);
    const bars = (await ed.receipt("make_transition_mask_tool", { pattern: "bars", horizontal: true })) as Record<string, unknown>;
    expect(bars).toMatchObject({ pattern: "bars", count: 8, steps: 8 });
    expect(bars.order).toBeUndefined();
  });
});
