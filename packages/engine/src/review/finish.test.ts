import { describe, expect, it } from "vitest";
import { EditHarness } from "../tools/test-support/edit-harness.js";
import { L1 } from "../tools/test-support/fixture.js";
import { finishGaps, finishLines, markMastered } from "./finish.js";

const kinds = (ed: EditHarness) => finishGaps(ed.doc.project).map((g) => g.kind);

/** Three shots from two camera files, back to back, and a music bed. */
function cut(): { ed: EditHarness; shots: string[]; music: string } {
  const ed = new EditHarness();
  const a = ed.addFile("video");
  const b = ed.addFile("video");
  const shots = [ed.addClip(a, { position: 0, end: 2 }), ed.addClip(b, { position: 2, end: 2 }), ed.addClip(a, { position: 4, start: 3, end: 5 })];
  const music = ed.addClip(ed.addFile("audio"), { position: 0, end: 6, layer: 1 });
  return { ed, shots, music };
}

describe("finishGaps", () => {
  it("lists the missing grade, transitions, sound design and master in the director's order, each with its next calls", () => {
    const { ed } = cut();
    const gaps = finishGaps(ed.doc.project);
    expect(gaps.map((g) => g.kind)).toEqual(["grade", "transitions", "sound", "master"]);
    expect(gaps.map((g) => g.next.map((c) => c.tool))).toEqual([["unify_grade_tool"], ["apply_motion_transitions_tool"], ["spot_sound_tool", "auto_sound_design_tool"], ["master_audio_tool"]]);
    expect(finishLines(gaps)[3]).toContain('master_audio_tool {"preset":"social","iterate":true}');
  });

  it("clears each gap when its step is done, and reads a master as stale after an audio edit", async () => {
    const { ed, shots, music } = cut();
    ed.addEffect(shots[1]!, "ColorGrade");
    expect(kinds(ed)).not.toContain("grade");
    await ed.receipt("apply_motion_transitions_tool", { track: "2", preset: "whip" });
    expect(kinds(ed)).not.toContain("transitions");
    const sfx = ed.addClip(ed.addFile("audio", { duration: 1, name: "whoosh.wav" }), { position: 1.8, end: 0.4, layer: 3 });
    ed.setClip(sfx, { zenvi_role: "sfx" });
    expect(kinds(ed)).toEqual(["master"]);
    markMastered(ed.doc, "social", -14);
    expect(kinds(ed)).toEqual([]);
    // A picture edit leaves the master standing; a level change does not.
    ed.setClip(shots[0]!, { alpha: { Points: [{ co: { X: 1, Y: 0.5 }, interpolation: 1 }] } });
    expect(kinds(ed)).toEqual([]);
    ed.setClip(music, { volume: { Points: [{ co: { X: 1, Y: 0.5 }, interpolation: 1 }] } });
    expect(kinds(ed)).toEqual(["master"]);
    expect(finishGaps(ed.doc.project)[0]!.message).toContain("changed after master_audio_tool");
  });

  it("owes no grade to one camera source or to rendered layers, and no transition to a single shot", () => {
    const ed = new EditHarness();
    const camera = ed.addFile("video");
    ed.addClip(camera, { position: 0, end: 4 });
    const block = ed.addFile("video", { name: "glass_cards-1.mp4" });
    const file = ed.doc.project.files.find((f) => f.id === block)!;
    ed.doc.setUntracked(["files", { id: block }], { ...file, zenvi_link: { engine: "zenvi-motion" } });
    ed.addClip(block, { position: 0, end: 4, layer: 2 });
    // Silent picture: master_audio_tool would refuse it, so no master is owed; one still shot has no hit point to design.
    expect(kinds(ed)).toEqual([]);
    // A second shot makes a cut, which wants a sound.
    ed.addClip(camera, { position: 4, start: 5, end: 7 });
    expect(kinds(ed)).toContain("sound");
  });

  it("counts a libopenshot transition only where it lies on a cut", () => {
    const { ed } = cut();
    const fade = ed.addTransition(L1, 0, 1);
    expect(kinds(ed)).toContain("transitions");
    ed.doc.transaction("move", (tx) => tx.update(["effects", { id: fade }], { position: 1.5 }));
    expect(kinds(ed)).not.toContain("transitions");
  });

  it("reads a master as stale when an audio clip is relinked to other media", () => {
    const { ed, music } = cut();
    markMastered(ed.doc, "social", -14);
    expect(kinds(ed)).not.toContain("master");
    const reader = ed.clip(music)!.reader;
    ed.setClip(music, { reader: { ...reader, path: "/media/other-take.mp3" } });
    expect(kinds(ed)).toContain("master");
  });
});
