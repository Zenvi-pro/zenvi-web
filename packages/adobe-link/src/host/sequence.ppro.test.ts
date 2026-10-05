import { describe, expect, test } from "vitest";
import { fakeInstall, loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";
import { TICKS_PER_SECOND } from "../testing/premiere-mock.js";

describe("premiere_get_sequence", () => {
  test("tracks, clips with properties, transitions and markers", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.v.b.componentList[1]?.param("Scale").setValue(110);
    edit.v.b.componentList[1]?.param("Position").setValue([0.25, 0.5]);
    edit.v.b.componentList[0]?.param("Opacity").setValue(80);
    const rotation = edit.v.c.componentList[1]?.param("Rotation");
    rotation?.setTimeVarying(true);
    edit.audio.music.componentList[0]?.param("Level").setValue(Math.pow(10, (-12 - 15) / 20));
    edit.v.b.selected = true;
    edit.sequence.videoTrackList[0]?.addTransition("Cross Dissolve", 3.75, 4.25);
    edit.sequence.markers.createMarker(2).name = "Hook";
    edit.sequence.videoTrackList[1]!.locked = true;

    const receipt = fx.call("premiere_get_sequence");
    expect(receipt.status).toBe("ok");
    expect(receipt.summary).toBe('Sequence "Main": 1920x1080, 30 fps, 12 s, 3 video tracks, 3 audio tracks, 7 clips, 1 marker');
    const tracks = receipt.data.tracks as { label: string; locked: boolean; clips: Record<string, unknown>[]; transitions: unknown[] }[];
    expect(tracks.map((track) => track.label)).toEqual(["V1", "V2", "V3", "A1", "A2", "A3"]);
    expect(tracks[1]?.locked).toBe(true);
    expect(tracks[0]?.transitions).toEqual([{ name: "Cross Dissolve", start: 3.75, end: 4.25 }]);
    expect(tracks[0]?.clips[1]).toMatchObject({
      name: "b.mov",
      track: { kind: "video", index: 0 },
      start: 4,
      end: 9,
      duration: 5,
      in_point: 1,
      out_point: 6,
      media_path: "/media/b.mov",
      item_id: edit.items.b.nodeId,
      enabled: true,
      speed: 1,
      selected: true,
      effects: [],
      position: [480, 540],
      scale: 110,
      rotation: 0,
      opacity: 80,
      blend_mode: "normal",
    });
    expect(tracks[0]?.clips[2]?.animated).toEqual(["Motion > Rotation"]);
    expect(tracks[4]?.clips[0]).toMatchObject({ name: "music.wav", volume_db: -12 });
    expect(receipt.data.markers).toEqual([expect.objectContaining({ start: 2, end: 2, name: "Hook", type: "Comment", color: "green" })]);
  });

  test("max_clips truncates with a warning; a named sequence is found", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fx.mock.project.addSequence({ name: "Other", active: true });
    const receipt = fx.call("premiere_get_sequence", { sequence: "Main", max_clips: 2, include_properties: false });
    expect(receipt.data).toMatchObject({ sequence_id: edit.sequence.sequenceID, clip_count: 7, active: false });
    expect(receipt.warnings).toEqual(["Listed 2 of 7 clips; raise `max_clips` to see the rest"]);
    expect((receipt.data.tracks as { clips: Record<string, unknown>[] }[])[0]?.clips[0]).not.toHaveProperty("effects");
    expect(fx.call("premiere_get_sequence", { sequence: "Missing" }).error?.code).toBe("NOT_FOUND");
  });
});

describe("premiere_create_sequence", () => {
  test("builds from the closest installed preset (via QE) and sets the exact size and rate", () => {
    const fx = loadPremiere();
    const install = fakeInstall(fx, {
      sequencePresets: {
        "Digital SLR/1080p/DSLR 1080p24.sqpreset": "1920 1080 24",
        "Digital SLR/1080p/DSLR 1080p30.sqpreset": "1920 1080 30",
        "HDV/HDV 1080i30.sqpreset": "1440 1080 29.97",
        "AVCHD/1080p/AVCHD 1080p25.sqpreset": "1920 1080 25",
      },
    });
    const receipt = fx.call("premiere_create_sequence", { name: "Promo" });
    expect(receipt.status).toBe("applied");
    expect(receipt.data).toMatchObject({
      preset: "1080p30",
      base_preset: install.files["Digital SLR/1080p/DSLR 1080p30.sqpreset"],
      sequence: { name: "Promo", width: 1920, height: 1080, fps: 30 },
      active: true,
    });
    expect(fx.mock.state.qeCalls).toContain("project.newSequence(Promo, DSLR 1080p30.sqpreset)");
    expect(fx.mock.state.calls.some((call) => call.startsWith("setSettings"))).toBe(false);
    expect(fx.mock.project.activeSequence?.name).toBe("Promo");
  });

  test("vertical: a 1080p preset made 1080x1920 at 30 fps through setSettings", () => {
    const fx = loadPremiere();
    fakeInstall(fx, { sequencePresets: { "AVCHD/1080p/AVCHD 1080p25.sqpreset": "1920 1080 25" } });
    const receipt = fx.call("premiere_create_sequence", { name: "Reel", preset: "vertical", bin: "Sequences" });
    expect(receipt.data).toMatchObject({ sequence: { width: 1080, height: 1920, fps: 30 } });
    const created = fx.mock.project.sequenceList.find((sequence) => sequence.name === "Reel");
    expect(created?.timebase).toBe(String(TICKS_PER_SECOND / 30));
    expect(created?.videoDisplayFormat).toBe(104);
    expect(created?.projectItem.parent?.name).toBe("Sequences");
    expect(receipt.warnings).toEqual([]);
  });

  test("warns when Premiere keeps another frame rate", () => {
    const fx = loadPremiere();
    fakeInstall(fx, { sequencePresets: { "x/HD 1080p 25.sqpreset": "1920 1080 25" } });
    fx.mock.state.lockFrameRate = true;
    const receipt = fx.call("premiere_create_sequence", { preset: "1080p24" });
    expect(receipt.status).toBe("applied");
    expect(receipt.warnings).toEqual(["Premiere kept 1920x1080 at 25 fps instead of 1920x1080 at 24 fps"]);
  });

  test("from_clips matches the first clip; bins in from_clips are refused", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_create_sequence", { name: "Selects", from_clips: [edit.items.b.nodeId, edit.items.a.nodeId] });
    expect(receipt).toMatchObject({ status: "applied", data: { preset: null, sequence: { name: "Selects" } } });
    expect(receipt.summary).toContain("from 2 clips");
    const bin = fx.mock.project.rootItem.childList.find((item) => item.name === "Footage");
    expect(fx.call("premiere_create_sequence", { from_clips: [bin?.nodeId] }).error?.code).toBe("INVALID_ARGUMENT");
  });

  test("without installed presets it refuses before changing anything", () => {
    const fx = loadPremiere();
    fakeInstall(fx, {});
    const receipt = fx.call("premiere_create_sequence", {});
    expect(receipt.error?.code).toBe("UNSUPPORTED");
    expect(receipt.summary).toContain("No sequence presets (.sqpreset) found");
    expect(fx.mock.project.sequenceList).toEqual([]);
  });
});

describe("premiere_open_sequence", () => {
  test("opens by name; already active is unchanged; unknown is refused", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const other = fx.mock.project.addSequence({ name: "Other", active: false });
    expect(fx.call("premiere_open_sequence", { sequence: "Other" })).toMatchObject({ status: "applied", undoSteps: 0, data: { sequence_id: other.sequenceID } });
    expect(fx.mock.project.activeSequence).toBe(other);
    expect(fx.call("premiere_open_sequence", { sequence: other.sequenceID }).status).toBe("unchanged");
    expect(fx.call("premiere_open_sequence", { sequence: "Nope" }).error?.code).toBe("NOT_FOUND");
    expect(fx.call("premiere_open_sequence", { sequence: edit.sequence.sequenceID }).status).toBe("applied");
  });
});

describe("premiere_add_marker", () => {
  test("a named chapter marker with duration and colour at a snapped time", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_add_marker", { time: 2.01, name: "Act 2", comment: "Music drops", duration: 1.5, color: "red", type: "chapter" });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Added a chapter marker "Act 2" at 2 s for 1.5 s on sequence "Main"');
    expect(receipt.warnings).toEqual(["Snapped time 2.01 s to the frame grid: 2 s (frame 60 at 30 fps)"]);
    const marker = edit.sequence.markers.list[0];
    expect(marker).toMatchObject({ name: "Act 2", comments: "Music drops", type: "Chapter", colorIndex: 1 });
    expect(Number(marker?.end.ticks) / TICKS_PER_SECOND).toBe(3.5);
  });

  test("a clip marker lands on the source item at the matching source time", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const receipt = fx.call("premiere_add_marker", { clip: edit.v.b.nodeId, time: 6, name: "Smile" });
    expect(receipt.data).toMatchObject({ target: "clip", clip: edit.v.b.nodeId, marker: { time: 6, source_time: 3 } });
    expect(edit.items.b.markers.list.map((marker) => Number(marker.start.ticks) / TICKS_PER_SECOND)).toEqual([3]);
    expect(edit.sequence.markers.numMarkers).toBe(0);
  });

  test("defaults to the playhead; refuses a time outside the clip and unknown colours", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.sequence.setPlayerPosition(String(5 * TICKS_PER_SECOND));
    expect(fx.call("premiere_add_marker", {}).data).toMatchObject({ marker: { time: 5, type: "comment" } });
    expect(fx.call("premiere_add_marker", { clip: edit.v.a.nodeId, time: 7 }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_add_marker", { color: "pink" }).error?.code).toBe("INVALID_ARGUMENT");
  });
});

describe("review fixes: create_sequence", () => {
  test("open: false puts the previous sequence back and reports the new one as not active", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    fakeInstall(fx, { sequencePresets: { "Digital SLR/1080p/DSLR 1080p30.sqpreset": "1920 1080 30" } });
    const receipt = fx.call("premiere_create_sequence", { name: "Side", open: false });
    expect(receipt).toMatchObject({ status: "applied", data: { sequence: { name: "Side" }, active: false } });
    expect(receipt.summary).not.toContain("active sequence");
    expect(fx.mock.project.activeSequence).toBe(edit.sequence);
    const opened = fx.call("premiere_create_sequence", { name: "Next" });
    expect(opened.data.active).toBe(true);
    expect(opened.summary).toContain(", now the active sequence");
    expect(fx.mock.project.activeSequence?.name).toBe("Next");
  });
});
