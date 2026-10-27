import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../../history/document.js";
import { addClip } from "../../ops/clips.js";
import { makeDoc } from "../../ops/testkit.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";

type Data = Record<string, unknown>;
const dataOf = (result: { data?: unknown }): Data => (result.data as { data: Data }).data;
const summaryOf = (result: { data?: unknown }): string => (result.data as { summary: string }).summary;

/** Four 2 s clips back to back on track 1, and a fifth after a gap. */
function editDoc(): ProjectDocument {
  const doc = makeDoc();
  doc.transaction("clips", (tx) => {
    for (let i = 0; i < 4; i += 1) addClip(tx, { fileId: "VIDEO00001", position: 2 * i, layer: 1, start: 2 * i, end: 2 * i + 2, id: `CLIP${i}` });
    addClip(tx, { fileId: "VIDEO00001", position: 9, layer: 1, start: 0, end: 2, id: "LATE" });
  });
  doc.clearHistory();
  return doc;
}

const call = (doc: ProjectDocument, name: string, args: Record<string, unknown>) => runTool({ doc, host: fakeHost() }, name, args);

describe("motion transition tools", () => {
  it("lists presets with lengths at the project frame rate", async () => {
    const doc = editDoc();
    const result = await call(doc, "list_motion_transitions_tool", {});
    expect(result.ok, result.text).toBe(true);
    const data = dataOf(result) as { presets: { preset: string; default_frames: number }[]; styles: Record<string, string[]>; on_timeline: unknown[] };
    expect(data.presets.find((p) => p.preset === "whip")?.default_frames).toBe(8);
    expect(Object.keys(data.styles)).toEqual(["hype", "cinematic"]);
    expect(data.on_timeline).toEqual([]);
    expect(doc.undoLabels).toEqual([]);
  });

  it("applies one transition with string arguments, as one undo step with sfx cues", async () => {
    const doc = editDoc();
    const result = await call(doc, "apply_motion_transition_tool", { preset: "zoom_in", clip1_id: "CLIP0", duration: "0.3", intensity: "1.2" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toEqual(["Motion transition zoom_in"]);
    const data = dataOf(result) as { transition_id: string; frames: number; clips: { clip_id: string; effect_ids: string[] }[]; sfx_cues: { kind: string; time: number }[] };
    expect(data.frames).toBe(10);
    expect(data.clips.map((c) => c.clip_id)).toEqual(["CLIP0", "CLIP1"]);
    expect(data.clips[0]!.effect_ids.length).toBe(1);
    expect(data.sfx_cues.map((c) => c.kind)).toEqual(["whoosh", "hit"]);
    expect(data.sfx_cues[1]!.time).toBe(2);
    const listed = dataOf(await call(doc, "list_motion_transitions_tool", {})) as { on_timeline: { transition_id: string }[] };
    expect(listed.on_timeline.map((t) => t.transition_id)).toEqual([data.transition_id]);
  });

  it("names the clips in its summary as people know them (the ids stay in data)", async () => {
    const doc = editDoc();
    doc.transaction("titles", (tx) => {
      tx.project.clips.find((c) => c.id === "CLIP0")!.title = "beach.mp4";
    });
    const result = await call(doc, "apply_motion_transition_tool", { preset: "whip", clip1_id: "CLIP0" });
    expect(summaryOf(result)).toMatch(/between beach\.mp4 and \S+\.$/);
    expect(summaryOf(result)).not.toContain("CLIP");
  });

  it("finds the cut from a track and a time", async () => {
    const doc = editDoc();
    const result = await call(doc, "apply_motion_transition_tool", { preset: "whip", track: "1", time: "4.1", direction: "up" });
    expect(result.ok, result.text).toBe(true);
    expect((dataOf(result) as { clips: { clip_id: string }[] }).clips.map((c) => c.clip_id)).toEqual(["CLIP1", "CLIP2"]);
  });

  it("refuses bad cuts without an undo step", async () => {
    const doc = editDoc();
    for (const args of [
      { preset: "whip", clip1_id: "CLIP3", clip2_id: "LATE" },
      { preset: "whip", clip1_id: "LATE" },
      { preset: "whip", track: "1", time: "8.5" },
      { preset: "spin", clip1_id: "CLIP0", direction: "left" },
      { preset: "whip", clip1_id: "NOPE" },
      { preset: "whip" },
    ]) {
      const result = await call(doc, "apply_motion_transition_tool", args);
      expect(result.ok, JSON.stringify(args)).toBe(false);
      expect(summaryOf(result)).toMatch(/^Error/);
    }
    expect(doc.undoLabels).toEqual([]);
  });

  it("transitions every cut on a track with a style mix, and removes them all", async () => {
    const doc = editDoc();
    const before = JSON.stringify(doc.project.clips);
    const result = await call(doc, "apply_motion_transitions_tool", { track: "1", style: "hype" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(1);
    const data = dataOf(result) as { transitions: { preset: string; cut: number }[]; sfx_cues: unknown[] };
    expect(data.transitions.map((t) => [t.preset, t.cut])).toEqual([
      ["whip", 2],
      ["whip", 4],
      ["zoom_out", 6],
    ]);
    expect(data.sfx_cues.length).toBe(4);
    const again = await call(doc, "apply_motion_transitions_tool", { track: "1", preset: "glitch" });
    expect((dataOf(again) as { transitions: { replaced?: string }[] }).transitions.every((t) => t.replaced)).toBe(true);
    const removed = await call(doc, "remove_motion_transition_tool", { track: "1" });
    expect(removed.ok, removed.text).toBe(true);
    expect(JSON.stringify(doc.project.clips)).toBe(before);
    expect(doc.undoLabels).toHaveLength(3);
    const nothing = await call(doc, "remove_motion_transition_tool", { clip_id: "CLIP1" });
    expect(summaryOf(nothing)).toMatch(/nothing to remove/);
    expect(doc.undoLabels).toHaveLength(3);
  });

  it("says which track has the cuts when the named one has none", async () => {
    // Agents pass track 1 after build_reel_tool, which puts the music there and the shots on track 2.
    const doc = editDoc();
    const result = await call(doc, "apply_motion_transitions_tool", { track: "2", style: "hype" });
    expect(summaryOf(result)).toMatch(/^No cuts on .*: no clips play back to back there\. Cuts are on track 1 \(3 cuts\): pass track="1"\.$/);
    // One cut by track and time, on a track of lone clips (a montage's flash frames): the same pointer.
    const one = await call(doc, "apply_motion_transition_tool", { preset: "flash_invert", track: "2", time: 2 });
    expect(summaryOf(one)).toMatch(/^Error: no cuts on .*: no clips play back to back there\. Cuts are on track 1 \(3 cuts\): pass track="1"\.$/);
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("removes one transition by id and refuses unknown ids", async () => {
    const doc = editDoc();
    const before = JSON.stringify(doc.project.clips);
    const r = dataOf(await call(doc, "apply_motion_transition_tool", { preset: "flash_white", clip1_id: "CLIP2" })) as { transition_id: string };
    const removed = await call(doc, "remove_motion_transition_tool", { transition_id: r.transition_id });
    expect(removed.ok, removed.text).toBe(true);
    expect(JSON.stringify(doc.project.clips)).toBe(before);
    const unknown = await call(doc, "remove_motion_transition_tool", { transition_id: r.transition_id });
    expect(summaryOf(unknown)).toMatch(/^Error: no motion transition/);
    expect(doc.undoLabels).toHaveLength(2);
  });
});
