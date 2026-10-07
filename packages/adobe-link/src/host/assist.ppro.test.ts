import { describe, expect, test } from "vitest";
import { loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";

describe("premiere_auto_reframe", () => {
  test("9:16 of a 1080p sequence: a new 1080x1920 sequence, opened; the original is untouched", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_auto_reframe", {});
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Auto-reframed "Main" to 9:16 as "Main 9x16" (1080x1920) and opened it');
    expect(fx.mock.state.calls).toContain("autoReframeSequence(9, 16, default, Main 9x16, false)");
    // Premiere keeps the source height (608x1080); the frame size is then set.
    expect(fx.mock.state.calls).toContain("setSettings(Main 9x16: 1080x1920 @ 8467200000)");
    expect(receipt.data).toMatchObject({ sequence: { width: 1080, height: 1920 }, source_sequence_id: edit.sequence.sequenceID });
    expect(fx.mock.project.activeSequence?.name).toBe("Main 9x16");
    expect(edit.sequence.frameSizeHorizontal).toBe(1920);
  });

  test("4:5 and 1:1 keep the short side; names and motion pass through", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    expect(fx.call("premiere_auto_reframe", { aspect: "4:5", name: "Feed", motion: "slower", open: false }).data).toMatchObject({
      sequence: { name: "Feed", width: 1080, height: 1350 },
    });
    expect(fx.mock.project.activeSequence?.name).toBe("Main");
    expect(fx.call("premiere_auto_reframe", { aspect: "1:1", sequence: "Main" }).data).toMatchObject({ sequence: { width: 1080, height: 1080 } });
  });

  test("refusals: still analysing (BUSY), no Auto Reframe in this build", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.state.analysisDone = false;
    expect(fx.call("premiere_auto_reframe", {}).error?.code).toBe("BUSY");
    fx.mock.state.analysisDone = true;
    (edit.sequence as unknown as Record<string, unknown>).autoReframeSequence = undefined;
    expect(fx.call("premiere_auto_reframe", {}).summary).toContain("needs Premiere Pro 2020 (14.0) or later");
    expect(fx.mock.project.sequenceList).toHaveLength(1);
  });
});

describe("premiere_scene_detect", () => {
  test("cuts every clip of V1 (and linked audio), then restores the selection", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.audio.music.selected = true;
    const receipt = fx.call("premiere_scene_detect", {});
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe("Scene Edit Detection on 3 clips of V1: 6 new clips from the cuts");
    expect(fx.mock.state.calls).toContain("performSceneEditDetectionOnSelection(ApplyCuts, true, MediumSensitivity)");
    expect(edit.sequence.videoTrackList[0]?.clipList).toHaveLength(6);
    expect(edit.sequence.allClips().filter((clip) => clip.selected).map((clip) => clip.nodeId)).toEqual([edit.audio.music.nodeId]);
  });

  test("markers on chosen clips land on their source items", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_scene_detect", { clips: [edit.v.b.nodeId], action: "markers", sensitivity: "high" });
    expect(receipt.data).toMatchObject({ analysed: [edit.v.b.nodeId], new_markers: 1, new_clips: 0 });
    expect(edit.items.b.markers.numMarkers).toBe(1);
    expect(receipt.warnings[0]).toContain("on the source items");
    expect(fx.mock.state.calls).toContain("performSceneEditDetectionOnSelection(CreateMarkers, true, HighSensitivity)");
  });

  test("refusals: audio track, a clip from another track, an empty track", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_scene_detect", { track: { kind: "audio", index: 0 } }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_scene_detect", { clips: [edit.audio.a.nodeId] }).summary).toContain("is on A1, not V1");
    expect(fx.call("premiere_scene_detect", { track: { kind: "video", index: 2 } }).summary).toContain("has no clips");
  });
});

describe("review fixes: scene_detect", () => {
  test("two halves of one source item count that item's new markers once", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_razor", { time: 6, tracks: [{ kind: "video", index: 0 }] }).status).toBe("applied");
    const halves = edit.sequence.videoTrackList[0]?.clipList.filter((clip) => clip.projectItem === edit.items.b) ?? [];
    expect(halves).toHaveLength(2);
    const receipt = fx.call("premiere_scene_detect", { clips: halves.map((clip) => clip.nodeId), action: "markers" });
    expect(receipt.status).toBe("applied");
    expect(edit.items.b.markers.numMarkers).toBe(2);
    expect(receipt.data).toMatchObject({ new_markers: 2, new_clips: 0 });
  });
});
