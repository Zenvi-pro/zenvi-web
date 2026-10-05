import { describe, expect, test } from "vitest";
import { TASTE } from "../taste.js";
import { loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";

describe("premiere_apply_effect", () => {
  test("adds a video effect through QE (matched by start time past a gap) and sets its parameters", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.v.a.remove(false, true);
    const receipt = fx.call("premiere_apply_effect", {
      clip: edit.v.c.nodeId,
      effect: "Gaussian Blur",
      params: [
        { name: "blurriness", value: 25 },
        { name: "Repeat Edge Pixels", value: true },
        { name: "Glow", value: 1 },
      ],
    });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Applied Gaussian Blur to "c.mov" (Blurriness 25, Repeat Edge Pixels true)');
    expect(fx.mock.state.qeCalls).toContain("item.addVideoEffect(Gaussian Blur)");
    const blur = edit.v.c.componentList[2];
    expect(blur?.matchName).toBe("AE.ADBE Gaussian Blur 2");
    expect(blur?.param("Blurriness").value).toBe(25);
    expect(receipt.data).toMatchObject({ effect: { index: 2, name: "Gaussian Blur", match_name: "AE.ADBE Gaussian Blur 2" }, missing: ["Glow"] });
    expect(receipt.warnings).toEqual(['"Gaussian Blur" has no parameter Glow; it has: Blurriness, Blur Dimensions, Repeat Edge Pixels']);
    expect(edit.v.b.componentList).toHaveLength(2);
  });

  test("audio effects go on audio clips", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_apply_effect", { clip: edit.audio.music.nodeId, effect: "DeNoise" }).status).toBe("applied");
    expect(edit.audio.music.componentList.at(-1)?.displayName).toBe("DeNoise");
  });

  test("unknown effects are refused with close names, before any change", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_apply_effect", { clip: edit.v.a.nodeId, effect: "Blur" });
    expect(receipt.error?.code).toBe("NOT_FOUND");
    expect(receipt.summary).toContain("(did you mean Gaussian Blur?)");
    expect(edit.v.a.componentList).toHaveLength(2);
    expect(fx.call("premiere_apply_effect", { clip: edit.v.a.nodeId, effect: "Gaussian Blur", params: [{ name: "x", value: "big" }] }).error?.code).toBe("INVALID_ARGUMENT");
  });
});

describe("premiere_add_transition", () => {
  test("default: a 0.5 s Cross Dissolve centred on the cut after the clip", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_add_transition", { clip: edit.v.a.nodeId });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Added 1 transition (Cross Dissolve, 0.5 s) at the end of "a.mov"');
    expect(fx.mock.state.qeCalls).toContain("item.addTransition(Cross Dissolve, false, 00:00:00:15, 0, 0.5, false, true)");
    expect(receipt.data.transitions).toEqual([{ name: "Cross Dissolve", start: 3.75, end: 4.25, duration: 0.5 }]);
    expect(TASTE.timing.crossDissolve.default).toBe(0.5);
  });

  test("both ends of the last clip; a one-sided tail sits inside the clip", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_add_transition", { clip: edit.v.c.nodeId, at: "both", transition: "Dip to Black", duration: 1 });
    expect(receipt.data.transitions).toEqual([
      { name: "Dip to Black", start: 8.5, end: 9.5, duration: 1 },
      { name: "Dip to Black", start: 11, end: 12, duration: 1 },
    ]);
    expect(receipt.undoSteps).toBe(2);
  });

  test("audio clips default to Constant Power; durations snap to frames", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_add_transition", { clip: edit.audio.b.nodeId, at: "start", duration: 0.51 });
    expect(receipt.data).toMatchObject({ transition: "Constant Power", requested_duration: 0.5 });
    expect(receipt.warnings[0]).toBe("Snapped the duration 0.51 s to 15 frames (0.5 s)");
  });

  test("older QE signatures fall back and say so", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.state.qeTransitionArgs = 3;
    const receipt = fx.call("premiere_add_transition", { clip: edit.v.a.nodeId });
    expect(receipt.status).toBe("applied");
    expect(receipt.warnings).toEqual(["QE addTransition took 3 arguments on this Premiere build"]);
  });

  test("refusals: unknown transition, longer than the clip", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_add_transition", { clip: edit.v.a.nodeId, transition: "Star Wipe" }).error?.code).toBe("NOT_FOUND");
    expect(fx.call("premiere_add_transition", { clip: edit.v.c.nodeId, at: "both", duration: 2 }).summary).toContain("longer than clip");
    expect(edit.sequence.videoTrackList[0]?.transitionList).toEqual([]);
  });
});

describe("premiere_apply_look", () => {
  test("warm-film at the default 60 % adds Lumetri and sets the scaled values", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_apply_look", { look: "warm-film", clips: [edit.v.a.nodeId] });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe("Applied the warm-film look at 60% to 1 clip");
    const lumetri = edit.v.a.componentList[2];
    expect(lumetri?.displayName).toBe("Lumetri Color");
    expect(lumetri?.param("Temperature").value).toBeCloseTo(4.8, 6);
    expect(lumetri?.param("Tint").value).toBeCloseTo(1.2, 6);
    expect(lumetri?.param("Faded Film").value).toBeCloseTo(4.8, 6);
    // Basic Correction's Saturation, not the Creative one further down.
    const saturations = lumetri?.params.filter((param) => param.displayName === "Saturation");
    expect(saturations?.map((param) => param.value)).toEqual([96.4, 100, 100]);
    expect(receipt.data.clips).toEqual([expect.objectContaining({ added_lumetri: true })]);
  });

  test("moody sets the vignette amount in the Vignette section; an existing Lumetri is reused", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.call("premiere_apply_effect", { clip: edit.v.b.nodeId, effect: "Lumetri Color" });
    const receipt = fx.call("premiere_apply_look", { look: "moody", strength: 1, clips: [edit.v.b.nodeId] });
    expect(edit.v.b.componentList).toHaveLength(3);
    const lumetri = edit.v.b.componentList[2];
    const amounts = lumetri?.params.filter((param) => param.displayName === "Amount");
    expect(amounts?.map((param) => param.value)).toEqual([0, -0.8]);
    expect(lumetri?.param("Exposure").value).toBe(-0.3);
    expect(receipt.data.clips).toEqual([expect.objectContaining({ added_lumetri: false })]);
  });

  test("teal-orange moves the tint wheels toward teal and orange; every clip of a track", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_apply_look", { look: "teal-orange", track: { kind: "video", index: 0 }, strength: 1 });
    expect(receipt.summary).toBe("Applied the teal-orange look at 100% to 3 clips");
    const lumetri = edit.v.c.componentList[2];
    expect(lumetri?.param("Shadow Tint").color).toEqual([255, 83, 128, 128]);
    expect(lumetri?.param("Highlight Tint").color).toEqual([255, 172, 132, 83]);
  });

  test("defaults to the selected video clips; refuses when nothing is selected or the track is audio", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_apply_look", { look: "clean" }).summary).toContain("No video clips are selected");
    edit.v.b.selected = true;
    edit.audio.b.selected = true;
    const receipt = fx.call("premiere_apply_look", { look: "bw-contrast" });
    expect(receipt.data.clips).toEqual([expect.objectContaining({ node_id: edit.v.b.nodeId })]);
    expect(edit.v.b.componentList[2]?.param("Saturation").value).toBe(40);
    expect(fx.call("premiere_apply_look", { look: "clean", track: { kind: "audio", index: 0 } }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_apply_look", { look: "clean", clips: [edit.audio.a.nodeId] }).error?.code).toBe("INVALID_ARGUMENT");
  });
});
