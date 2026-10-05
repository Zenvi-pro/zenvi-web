import { describe, expect, test } from "vitest";
import { loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";

function spans(track: { clipList: { name: string; span: { start: number; end: number; in: number; out: number } }[] } | undefined) {
  return (track?.clipList ?? []).map((clip) => [clip.name, clip.span.start, clip.span.end, clip.span.in]);
}

describe("premiere_place_clip", () => {
  test("appends after the last clip by default and brings the linked audio", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const extra = fx.mock.project.addMedia("d.mov", "/media/d.mov", 6);
    const receipt = fx.call("premiere_place_clip", { item: extra.nodeId });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Placed "d.mov" on V1 at 12 s (12-18 s, overwrite) with linked A1');
    expect(receipt.data.clip).toMatchObject({ start: 12, end: 18, track: { kind: "video", index: 0 }, item_id: extra.nodeId });
    expect(receipt.data.linked).toEqual([expect.objectContaining({ track: { kind: "audio", index: 0 }, start: 12, end: 18 })]);
    expect(spans(edit.sequence.audioTrackList[0]).at(-1)).toEqual(["d.mov", 12, 18, 0]);
  });

  test("overwrite with a source range; the item's marks are restored", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.items.c.setInPoint(1, 4);
    const receipt = fx.call("premiere_place_clip", { item: edit.items.c.nodeId, time: 2.5, source_in: 3, source_out: 5, track: { kind: "video", index: 0 } });
    expect(receipt.data.clip).toMatchObject({ start: 2.5, end: 4.5, in_point: 3 });
    expect(spans(edit.sequence.videoTrackList[0])).toEqual([
      ["a.mov", 0, 2.5, 2],
      ["c.mov", 2.5, 4.5, 3],
      ["b.mov", 4.5, 9, 1.5],
      ["c.mov", 9, 12, 5],
    ]);
    expect(edit.items.c.markCalls).toEqual(["in=1@4", "in=3@4", "out=5@4", "in=1@4", "out=20@4"]);
  });

  test("insert pushes the later clips right", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const extra = fx.mock.project.addMedia("d.mov", "/media/d.mov", 2);
    fx.call("premiere_place_clip", { item: extra.nodeId, time: 4, mode: "insert" });
    expect(spans(edit.sequence.videoTrackList[0])).toEqual([
      ["a.mov", 0, 4, 2],
      ["d.mov", 4, 6, 0],
      ["b.mov", 6, 11, 1],
      ["c.mov", 11, 14, 5],
    ]);
  });

  test("refusals: locked track, a bin, an empty source range, audio-only on video", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.sequence.videoTrackList[1]!.locked = true;
    expect(fx.call("premiere_place_clip", { item: edit.items.a.nodeId, track: { kind: "video", index: 1 } }).summary).toBe(
      "Error: Track V2 is locked; unlock it in Premiere first",
    );
    const bin = fx.mock.project.rootItem.childList.find((item) => item.name === "Footage");
    expect(fx.call("premiere_place_clip", { item: bin?.nodeId }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_place_clip", { item: edit.items.a.nodeId, source_in: 5, source_out: 4 }).error?.code).toBe("INVALID_ARGUMENT");
    const placed = fx.call("premiere_place_clip", { item: edit.items.music.nodeId, track: { kind: "video", index: 2 } });
    expect(placed).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    expect(fx.call("premiere_place_clip", { item: "nope" }).error?.code).toBe("NOT_FOUND");
  });
});

describe("premiere_edit_clip move", () => {
  test("move by a delta takes the linked audio along", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "move", by: 1 });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Moved "c.mov" from 9 s to 10 s with its linked clip');
    expect(edit.v.c.span).toMatchObject({ start: 10, end: 13 });
    expect(edit.audio.c.span).toMatchObject({ start: 10, end: 13 });
    expect(receipt.undoSteps).toBe(2);
  });

  test("move onto another clip is refused; to = start is unchanged; exactly one of to/by", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const blocked = fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "move", to: 6 });
    expect(blocked.error?.code).toBe("INVALID_ARGUMENT");
    expect(blocked.summary).toContain('would overlap "b.mov"');
    expect(fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "move", to: 9 }).status).toBe("unchanged");
    expect(fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "move" }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "move", to: 20, by: 1 }).error?.code).toBe("INVALID_ARGUMENT");
    expect(edit.v.c.span.start).toBe(9);
  });

  test("move without linked clips moves only the video", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "move", to: 15, include_linked: false });
    expect(edit.v.c.span.start).toBe(15);
    expect(edit.audio.c.span.start).toBe(9);
  });
});

describe("premiere_edit_clip trim", () => {
  test("trims head and tail together with the source points, linked audio included", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_edit_clip", { clip: edit.v.b.nodeId, action: "trim", start: 4.5, end: 8 });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Trimmed "b.mov" to 4.5-8 s with its linked clip');
    expect(edit.v.b.span).toEqual({ start: 4.5, end: 8, in: 1.5, out: 5 });
    expect(edit.audio.b.span).toEqual({ start: 4.5, end: 8, in: 1.5, out: 5 });
    expect(edit.v.b.writes).toEqual(["start=4.5", "inPoint=1.5", "end=8", "outPoint=5"]);
  });

  test("extending into a neighbour or before the media start is refused before any change", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const into = fx.call("premiere_edit_clip", { clip: edit.v.b.nodeId, action: "trim", end: 10 });
    expect(into.summary).toContain('would overlap "c.mov" on V1');
    const early = fx.call("premiere_edit_clip", { clip: edit.v.b.nodeId, action: "trim", start: 2.5 });
    expect(early.error?.code).toBe("INVALID_ARGUMENT");
    expect(edit.v.b.writes).toEqual([]);
  });

  test("Premiere's clamp at the end of the media is reported", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.items.c.mediaDuration = 9;
    const receipt = fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "trim", end: 14, include_linked: false });
    expect(receipt.status).toBe("applied");
    expect(edit.v.c.span.end).toBe(13);
    expect(receipt.warnings[0]).toContain("Premiere kept 9-13 s instead of 9-14 s");
  });

  test("retimed clips are refused", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.v.a.speed = 2;
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "trim", end: 3 }).error?.code).toBe("UNSUPPORTED");
  });
});

describe("premiere_edit_clip enable, rename, delete", () => {
  test("disable then enable the clip and its linked audio", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "disable" })).toMatchObject({ status: "applied", data: { enabled: false } });
    expect([edit.v.a.disabled, edit.audio.a.disabled]).toEqual([true, true]);
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "disable" }).status).toBe("unchanged");
    fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "enable" });
    expect([edit.v.a.disabled, edit.audio.a.disabled]).toEqual([false, false]);
  });

  test("rename", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "rename", name: "Hook" }).summary).toBe('Renamed clip "a.mov" to "Hook"');
    expect(edit.v.a.name).toBe("Hook");
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "rename" }).error?.code).toBe("INVALID_ARGUMENT");
  });

  test("delete with ripple removes the linked pair and closes the gap on their tracks only", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_edit_clip", { clip: edit.v.b.nodeId, action: "delete", ripple: true });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Deleted "b.mov" and 1 linked clip and closed the gap');
    expect(spans(edit.sequence.videoTrackList[0])).toEqual([
      ["a.mov", 0, 4, 2],
      ["c.mov", 4, 7, 5],
    ]);
    expect(spans(edit.sequence.audioTrackList[0])).toEqual([
      ["a.mov", 0, 4, 2],
      ["c.mov", 4, 7, 5],
    ]);
    expect(spans(edit.sequence.audioTrackList[1])).toEqual([["music.wav", 0, 12, 0]]);
    expect(receipt.data.rippled).toEqual([
      { track: { kind: "video", index: 0 }, closed: 5, moved: 1 },
      { track: { kind: "audio", index: 0 }, closed: 5, moved: 1 },
    ]);
    expect(receipt.warnings[0]).toContain("clips on other tracks did not move");
  });

  test("delete without ripple leaves the gap", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.call("premiere_edit_clip", { clip: edit.v.b.nodeId, action: "delete" });
    expect(spans(edit.sequence.videoTrackList[0])).toEqual([
      ["a.mov", 0, 4, 2],
      ["c.mov", 9, 12, 5],
    ]);
  });
});

describe("premiere_edit_clip speed (QE)", () => {
  test("half speed with ripple: QE setSpeed with five arguments, verified through getSpeed", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "speed", speed: 0.5 });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Set "c.mov" to 50% speed (9-15 s)');
    expect(fx.mock.state.qeCalls).toContain(`item.setSpeed(0.5, ${6 * 254016000000}, false, true, false)`);
    expect(edit.v.c.speed).toBe(0.5);
  });

  test("a slowdown that would run into the next clip needs ripple", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "speed", speed: 0.5 }).summary).toContain("pass ripple: true");
    const rippled = fx.call("premiere_edit_clip", { clip: edit.v.a.nodeId, action: "speed", speed: 0.5, ripple: true });
    expect(rippled.status).toBe("applied");
    expect(edit.v.b.span.start).toBe(8);
  });

  test("a build without QE setSpeed is refused; a setSpeed that does not take is an error", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.state.qeSetSpeed = false;
    expect(fx.call("premiere_edit_clip", { clip: edit.v.c.nodeId, action: "speed", speed: 2 }).error?.code).toBe("UNSUPPORTED");
    const fx2 = loadPremiere();
    const edit2 = standardEdit(fx2);
    const original = edit2.v.c.getSpeed;
    edit2.v.c.getSpeed = () => 1;
    const receipt = fx2.call("premiere_edit_clip", { clip: edit2.v.c.nodeId, action: "speed", speed: 2 });
    expect(receipt).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    expect(receipt.warnings.join(" ")).toContain("its own undo step");
    edit2.v.c.getSpeed = original;
  });
});

describe("premiere_razor", () => {
  test("cuts every unlocked track with a clip at the time, through QE", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.sequence.audioTrackList[1]!.locked = true;
    const receipt = fx.call("premiere_razor", { time: 2 });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe("Cut 2 clips at 2 s (V1, A1)");
    expect(receipt.warnings).toEqual(["Skipped locked track A2"]);
    expect(fx.mock.state.qeCalls.filter((call) => call.startsWith("track.razor"))).toEqual(["track.razor(00:00:02:00)", "track.razor(00:00:02:00)"]);
    expect(spans(edit.sequence.videoTrackList[0]).slice(0, 2)).toEqual([
      ["a.mov", 0, 2, 2],
      ["a.mov", 2, 4, 4],
    ]);
    expect(receipt.data.cuts).toEqual([
      expect.objectContaining({ track: { kind: "video", index: 0 }, left: expect.objectContaining({ end: 2 }), right: expect.objectContaining({ start: 2 }) }),
      expect.objectContaining({ track: { kind: "audio", index: 0 } }),
    ]);
  });

  test("only the tracks asked for; nothing under the time is unchanged; an edit point is not a cut", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_razor", { time: 6, tracks: [{ kind: "audio", index: 1 }] });
    expect(receipt.summary).toBe("Cut 1 clip at 6 s (A2)");
    expect(edit.sequence.videoTrackList[0]?.clipList).toHaveLength(3);
    expect(fx.call("premiere_razor", { time: 30 }).status).toBe("unchanged");
    const atCut = fx.call("premiere_razor", { time: 4, tracks: [{ kind: "video", index: 0 }] });
    expect(atCut).toMatchObject({ status: "unchanged", warnings: ["Nothing to cut on V1 at 4 s"] });
  });

  test("a sequence QE cannot list is opened so QE can reach it", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.project.addSequence({ name: "Other" });
    fx.mock.state.qeSequenceAtThrows = true;
    const receipt = fx.call("premiere_razor", { time: 1, sequence: "Main", tracks: [{ kind: "video", index: 0 }] });
    expect(receipt.status).toBe("applied");
    expect(receipt.warnings).toContain('Opened sequence "Main" so the QE DOM can reach it');
    expect(fx.mock.project.activeSequence).toBe(edit.sequence);
  });

  test("a sequence QE lists is reached without opening it", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const other = fx.mock.project.addSequence({ name: "Other" });
    const receipt = fx.call("premiere_razor", { time: 1, sequence: "Main", tracks: [{ kind: "video", index: 0 }] });
    expect(receipt.warnings).toEqual([]);
    expect(fx.mock.project.activeSequence).toBe(other);
    expect(edit.sequence.videoTrackList[0]?.clipList).toHaveLength(4);
  });
});
