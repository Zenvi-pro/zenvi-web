import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { runTool } from "../tools/registry.js";
import { fakeHost } from "../tools/test-support/fake-host.js";
import { repeatedCut } from "../tools/test-support/repeated-cut.js";
import { L1, L2 } from "../tools/test-support/fixture.js";
import { addClip, fadeClip } from "../ops/clips.js";
import { freeInPoint, swapSuggestions } from "./swaps.js";
import { reviewTimeline } from "./timeline.js";

describe("swap suggestions", () => {
  it("finds the first free stretch of a source, a third of the way in, clear of what is shown", () => {
    expect(freeInPoint(10, [], 2)).toBe(2.4);
    // 1-3 shown: the free stretch 3.25-10 (0-0.75 is too short) gives 3.25 + 0.3 × 4.75.
    expect(freeInPoint(10, [[1, 3]], 2)).toBe(4.675);
    expect(freeInPoint(4, [[0, 2], [2, 4]], 1)).toBeNull();
  });

  it("swaps a repeat for an unused bin clip first, then for an unused part of its own file", () => {
    const one = repeatedCut(["video"]);
    const review = reviewTimeline(one);
    const repeat = review.shots.findIndex((s) => s.clipId === "CLIPA00002");
    expect(swapSuggestions(one, review, [repeat])).toEqual([
      { clip_id: "CLIPA00002", at: 4, file_id: "FILEAAAAAA", name: "FILEAAAAAA.mp4", to_file_id: "FILEXTRA00", to_name: "FILEXTRA00.mp4", start_seconds: 1.2, why: "unused clip" },
    ]);
    // Nothing unused in the bin: the part of A no shot shows (A plays 1-3 twice).
    const none = repeatedCut([]);
    const [swap] = swapSuggestions(none, reviewTimeline(none), [repeat]);
    expect(swap).toMatchObject({ to_file_id: "FILEAAAAAA", why: "unused part of the same clip", start_seconds: 4.075 });
    // A still in the bin is used from 0.
    const still = repeatedCut(["still"]);
    expect(swapSuggestions(still, reviewTimeline(still), [repeat])[0]).toMatchObject({ to_file_id: "FILEXTRA00", start_seconds: 0 });
  });

  it("offers one swap for a clip seen in two shots around an overlay", () => {
    const doc = new ProjectDocument(repeatedCut(["video", "video"]));
    // B's still on top of A's repeat at 4.5-5 s splits it into two shots of CLIPA00002.
    doc.transaction("overlay", (tx) => addClip(tx, { fileId: "FILEBBBBBB", position: 4.5, layer: L2, start: 0, end: 0.5, id: "CLIPOVER01" }));
    const review = reviewTimeline(doc.project);
    const repeats = review.shots.filter((s) => s.clipId === "CLIPA00002").map((s) => s.index);
    expect(repeats).toHaveLength(2);
    expect(swapSuggestions(doc.project, review, repeats).map((s) => s.clip_id)).toEqual(["CLIPA00002"]);
  });

  it("the suggested call fixes the repeat in one undo step, keeping the cut", async () => {
    const doc = new ProjectDocument(repeatedCut(["video"]));
    const [swap] = swapSuggestions(doc.project, reviewTimeline(doc.project), [2]);
    const r = await runTool({ doc, host: fakeHost() }, "swap_shot_tool", { clip_id: swap!.clip_id, file_id: swap!.to_file_id, start_seconds: swap!.start_seconds });
    expect(r.ok, r.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Swap shot CLIPA00002"]);
    expect(doc.project.clips.find((c) => c.id === "CLIPA00002")).toMatchObject({ file_id: "FILEXTRA00", position: 4, start: 1.2, end: 3.2 });
    const files = reviewTimeline(doc.project).shots.map((s) => s.fileId);
    expect(new Set(files).size).toBe(files.length);
    const late = await runTool({ doc, host: fakeHost() }, "swap_shot_tool", { clip_id: "CLIPA00001", file_id: "FILEXTRA00", start_seconds: 5 });
    expect(late.data!.summary).toMatch(/^Error: FILEXTRA00\.mp4 is 6\.00 s long; a 2\.00 s shot from 5\.00 s runs past its end/);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("moves the clip's curves with the new in-point, so a fade stays on the same timeline frames", async () => {
    const doc = new ProjectDocument(repeatedCut(["video"]));
    doc.transaction("fade", (tx) => fadeClip(tx, "CLIPA00002", { fadeIn: 0.5 }));
    const xs = (id: string) => doc.project.clips.find((c) => c.id === id)!.alpha.Points.map((p) => p.co.X);
    const before = xs("CLIPA00002");
    const fps = doc.project.fps.num / doc.project.fps.den;
    const r = await runTool({ doc, host: fakeHost() }, "swap_shot_tool", { clip_id: "CLIPA00002", file_id: "FILEXTRA00", start_seconds: 1.2 });
    expect(r.ok, r.text).toBe(true);
    expect(xs("CLIPA00002")).toEqual(before.map((x) => x + Math.round(1.2 * fps) - Math.round(1 * fps)));
    expect(doc.undoLabels).toEqual(["fade", "Swap shot CLIPA00002"]);
  });

  it("review_edit_tool lists the swaps for repeated and returning clips, each unused clip offered once", async () => {
    const doc = new ProjectDocument(repeatedCut(["video", "video"]));
    // A B A B A C: three returns within 3 s.
    doc.transaction("more", (tx) => {
      addClip(tx, { fileId: "FILEBBBBBB", position: 6, layer: L1, start: 0, end: 2, id: "CLIPB00002" });
      addClip(tx, { fileId: "FILEAAAAAA", position: 8, layer: L1, start: 1, end: 3, id: "CLIPA00003" });
      tx.update(["clips", { id: "CLIPC00001" }], { position: 10 });
    });
    const r = await runTool({ doc, host: fakeHost() }, "review_edit_tool", { image: false, audio: false, pace: "fast" });
    expect(r.ok, r.text).toBe(true);
    const problems = (r.data!.data as { problems: { code: string; swaps?: { clip_id: string; to_file_id: string; why: string }[] }[] }).problems;
    expect(problems.find((p) => p.code === "clip-back-soon")!.swaps!.length).toBeGreaterThan(0);
    // A also repeats the same part (repeated-footage): its swaps go there, none twice.
    const swaps = problems.flatMap((p) => p.swaps ?? []).sort((a, b) => a.clip_id.localeCompare(b.clip_id));
    expect(swaps.map((s) => [s.clip_id, s.to_file_id])).toEqual([
      ["CLIPA00002", "FILEXTRA00"],
      ["CLIPA00003", "FILEAAAAAA"],
      ["CLIPB00002", "FILEXTRA01"],
    ]);
    expect(r.data!.summary).toContain('swap_shot_tool {"clip_id":"CLIPA00002","file_id":"FILEXTRA00"');
  });
});
