/**
 * Tracks, markers, the playhead, the timeline view and the selection.
 * Ported from zenvi-core develop tests/test_editor_tools_tracks_nav_tracks.py,
 * _markers.py, _playback.py (seek) and _view.py, through runTool with the
 * Assistant's string arguments. In an editor (the fake host's player and UI)
 * the tools drive it; without one (CLI, cloud) they use the playhead saved
 * with the project and refuse what needs an editor.
 */

import { describe, expect, it } from "vitest";
import { addTransition } from "../ops/transitions.js";
import { timecode } from "./catalog/tracks-nav.js";
import { runTool } from "./registry.js";
import { EditHarness } from "./test-support/edit-harness.js";
import { fakeHost } from "./test-support/fake-host.js";

const T1 = 1_000_000;
const T2 = 2_000_000;
const T3 = 3_000_000;

type Row = Record<string, unknown>;

function layerOf(ed: EditHarness, number: number) {
  return ed.doc.project.layers.find((l) => l.number === number);
}

function numbers(ed: EditHarness): number[] {
  return ed.doc.project.layers.map((l) => l.number).sort((a, b) => a - b);
}

function transition(ed: EditHarness, layer: number, position: number): string {
  return ed.doc.transaction("setup", (tx) => addTransition(tx, { layer, position, duration: 1, maskId: "common/fade", direction: "in" }).id);
}

/** 40 s of video on track 1 (30 fps) and the player at 0. */
function timeline(): { ed: EditHarness; clip: string } {
  const ed = new EditHarness();
  const clip = ed.addClip(ed.addFile("video", { duration: 40 }), { position: 0 });
  return { ed, clip };
}

/** Run a tool on the same project without a player or UI (the CLI / cloud hosts). */
async function headless(ed: EditHarness, name: string, args: Record<string, unknown> = {}) {
  return (await runTool({ doc: ed.doc, host: fakeHost({ without: ["player", "ui"] }) }, name, args)).data!;
}

// ---------------------------------------------------------------------------
// update_track_tool / remove_track_tool
// ---------------------------------------------------------------------------

describe("update_track_tool", () => {
  it("renames and locks a track, one undo step each", async () => {
    const ed = new EditHarness();
    let r = await ed.receipt("update_track_tool", { track: "2", name: "B-roll" });
    expect(r.changed).toEqual(["name"]);
    expect((r.track as Row).name).toBe("B-roll");
    expect(layerOf(ed, T2)!.label).toBe("B-roll");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.mark();
    r = await ed.receipt("update_track_tool", { track: "B-roll", lock: "true" });
    expect((r.track as Row).locked).toBe(true);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(layerOf(ed, T2)!.lock).toBe(false);
  });

  it("renames and locks together in one step", async () => {
    const ed = new EditHarness();
    const receipt = await ed.call("update_track_tool", { track: "3", name: "Titles", lock: true });
    expect((receipt.data as Row).changed).toEqual(["name", "lock"]);
    expect(receipt.summary).toBe("Track 3 renamed to 'Titles' and locked.");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect([layerOf(ed, T3)!.label, layerOf(ed, T3)!.lock]).toEqual(["", false]);
  });

  it("asking for what a track already has changes nothing; a locked track can be renamed; '' clears", async () => {
    const ed = new EditHarness();
    ed.lockTrack(T1);
    const receipt = await ed.call("update_track_tool", { track: "1", lock: true });
    expect(receipt.status).toBe("unchanged");
    expect(receipt.summary).toBe("Nothing changed: track 1 is already locked.");
    expect((receipt.data as Row).changed).toEqual([]);
    expect(ed.stepsSinceMark()).toBe(0);
    await ed.receipt("update_track_tool", { track: "1", name: "Base" });
    await ed.receipt("update_track_tool", { track: "Base", name: "" });
    expect(layerOf(ed, T1)!.label).toBe("");
  });

  it("warns when another track has the name", async () => {
    const ed = new EditHarness();
    await ed.receipt("update_track_tool", { track: "1", name: "Music" });
    const r = await ed.receipt("update_track_tool", { track: "2", name: "music" });
    expect(String(r.warning)).toContain("already has this name");
  });

  it("refuses with nothing to change, an unknown track or no track", async () => {
    const ed = new EditHarness();
    await ed.refused("update_track_tool", { track: "1" }, "nothing to change");
    await ed.refused("update_track_tool", { track: "9", name: "x" }, "Unknown track");
    await ed.refused("update_track_tool", { name: "x" }, "'track' is a required property");
  });

  it("a locked track is refused by the editing tools", async () => {
    const ed = new EditHarness();
    const c = ed.addClip(ed.addFile("video"), { layer: T1 });
    await ed.receipt("update_track_tool", { track: "1", lock: true });
    ed.mark();
    await ed.refused("delete_from_timeline_tool", { timeline_clip_id: c }, "locked");
    expect(ed.clip(c)).toBeDefined();
  });
});

describe("remove_track_tool", () => {
  it("removes an empty track; undo brings it back", async () => {
    const ed = new EditHarness();
    const r = await ed.receipt("remove_track_tool", { track: "3" });
    expect(numbers(ed)).toEqual([T1, T2, 4_000_000, 5_000_000]);
    expect((r.removed_track as Row).layer).toBe(T3);
    expect(r.deleted_clip_ids).toEqual([]);
    expect((r.tracks as Row[]).map((t) => t.track)).toEqual([1, 2, 3, 4]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(numbers(ed)).toContain(T3);
  });

  it("a track with clips needs with_clips; then one undo restores everything", async () => {
    const ed = new EditHarness();
    const f = ed.addFile("video", { duration: 30 });
    const a = ed.addClip(f, { layer: T2, position: 0 });
    const b = ed.addClip(f, { layer: T2, position: 30 });
    const keep = ed.addClip(f, { layer: T1, position: 0 });
    const t = transition(ed, T2, 29);
    ed.host.editor.selection = { clips: [a], transitions: [], effects: [] };
    const before = structuredClone([ed.clip(a), ed.clip(b)]);
    ed.mark();
    await ed.refused("remove_track_tool", { track: "2" }, "2 clip(s) and 1 transition(s)", "with_clips=true");
    expect(ed.clip(a)).toBeDefined();
    const r = await ed.receipt("remove_track_tool", { track: "2", with_clips: "true" });
    expect((r.deleted_clip_ids as string[]).sort()).toEqual([a, b].sort());
    expect(r.deleted_transition_ids).toEqual([t]);
    expect([ed.clip(a), ed.clip(b), ed.clip(keep) !== undefined]).toEqual([undefined, undefined, true]);
    expect(numbers(ed)).not.toContain(T2);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(numbers(ed)).toContain(T2);
    expect([ed.clip(a), ed.clip(b)]).toEqual(before);
    expect(ed.transition(t)).toBeDefined();
    ed.doc.redo();
    expect(ed.clip(a)).toBeUndefined();
  });

  it("refuses a locked track, an unknown one and the last one", async () => {
    const ed = new EditHarness();
    ed.lockTrack(T2);
    await ed.refused("remove_track_tool", { track: "2" }, "track 2 is locked; unlock it first");
    await ed.refused("remove_track_tool", { track: "Nope" }, "Unknown track");
    ed.setLayers([T1]);
    await ed.refused("remove_track_tool", { track: "1" }, "at least one track");
  });
});

// ---------------------------------------------------------------------------
// update_marker_tool / remove_marker_tool
// ---------------------------------------------------------------------------

describe("update_marker_tool", () => {
  it("renames by id, moves and recolours by name; undo restores", async () => {
    const ed = new EditHarness();
    const id = ed.addMarker(10, "Verse");
    let r = await ed.receipt("update_marker_tool", { marker: id, name: "Chorus" });
    expect(r.changed).toEqual(["name"]);
    expect(ed.doc.project.markers[0]!.name).toBe("Chorus");
    expect(ed.stepsSinceMark()).toBe(1);
    ed.mark();
    r = await ed.receipt("update_marker_tool", { marker: "chorus", position_seconds: "14.5", color: "Yellow" });
    expect((r.changed as string[]).sort()).toEqual(["color", "position"]);
    const m = ed.doc.project.markers[0]!;
    expect([m.position, m.vector, m.icon]).toEqual([14.5, "yellow", "yellow.png"]);
    expect((r.marker as Row).timecode).toBe("00:00:14,15");
    ed.doc.undo();
    expect([ed.doc.project.markers[0]!.position, ed.doc.project.markers[0]!.vector]).toEqual([10, "blue"]);
  });

  it("finds and renames a marker the web's add_marker_tool made (its label)", async () => {
    const ed = new EditHarness();
    await ed.receipt("add_marker_tool", { position_seconds: "4", name: "Intro" });
    ed.mark();
    await ed.receipt("update_marker_tool", { marker: "Intro", name: "Opening" });
    const m = ed.doc.project.markers[0]!;
    expect([m.label, "name" in m]).toEqual(["Opening", false]);
    expect((await ed.call("list_markers_tool")).summary).toContain("name=Opening");
  });

  it("no-op and refusals change nothing", async () => {
    const ed = new EditHarness();
    const id = ed.addMarker(10, "Verse");
    ed.addMarker(20, "Dup");
    ed.addMarker(30, "Dup");
    const receipt = await ed.call("update_marker_tool", { marker: id, name: "Verse" });
    expect(receipt.status).toBe("unchanged");
    expect((receipt.data as Row).changed).toEqual([]);
    expect(ed.stepsSinceMark()).toBe(0);
    await ed.refused("update_marker_tool", { marker: id }, "nothing to change");
    await ed.refused("update_marker_tool", { marker: "Nope", name: "x" }, "no marker with id or name 'Nope'; markers: Verse (00:00:10,00)");
    await ed.refused("update_marker_tool", { marker: "Dup", name: "x" }, "2 markers are named 'Dup'");
    await ed.refused("update_marker_tool", { marker: id, position_seconds: 999 }, "past the end");
  });
});

describe("remove_marker_tool", () => {
  it("removes by name, id, time and all; each is one undo step", async () => {
    const ed = new EditHarness();
    const a = ed.addMarker(3, "Intro");
    ed.addMarker(12, "Drop");
    ed.addMarker(20, "Outro");
    ed.addMarker(25);
    const r = await ed.receipt("remove_marker_tool", { markers: ["Drop"] });
    expect((r.removed as Row[]).map((m) => m.name)).toEqual(["Drop"]);
    expect(r.remaining).toBe(3);
    expect(ed.stepsSinceMark()).toBe(1);
    await ed.receipt("remove_marker_tool", { markers: [a] });
    await ed.receipt("remove_marker_tool", { at_seconds: "20.3" });
    expect(ed.doc.project.markers.map((m) => m.name ?? "")).toEqual([""]);
    ed.mark();
    await ed.receipt("remove_marker_tool", { all: "true" });
    expect(ed.doc.project.markers).toEqual([]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.doc.project.markers).toHaveLength(1);
  });

  it("removes several markers named in a comma list as one step", async () => {
    const ed = new EditHarness();
    ed.addMarker(1, "A");
    ed.addMarker(2, "B");
    const receipt = await ed.call("remove_marker_tool", { markers: "A, B" });
    expect(receipt.summary).toBe("Removed 2 markers.");
    expect(ed.doc.project.markers).toEqual([]);
    expect(ed.stepsSinceMark()).toBe(1);
    ed.doc.undo();
    expect(ed.doc.project.markers).toHaveLength(2);
  });

  it("refusals leave the markers", async () => {
    const ed = new EditHarness();
    await ed.refused("remove_marker_tool", { all: true }, "no markers");
    ed.addMarker(10, "Dup");
    ed.addMarker(20, "Dup");
    await ed.refused("remove_marker_tool", {}, "say which markers");
    await ed.refused("remove_marker_tool", { markers: ["Dup"], all: true }, "only one of");
    await ed.refused("remove_marker_tool", { markers: ["Dup"] }, "2 markers are named 'Dup'");
    await ed.refused("remove_marker_tool", { at_seconds: 15 }, "nearest");
    await ed.refused("remove_marker_tool", { markers: ["Nope"] }, "no marker");
    expect(ed.doc.project.markers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// seek_playhead_tool
// ---------------------------------------------------------------------------

describe("seek_playhead_tool", () => {
  it("goes to seconds and frames; no undo step", async () => {
    const { ed } = timeline();
    const receipt = await ed.call("seek_playhead_tool", { seconds: "32" });
    const r = receipt.data as Row;
    expect([r.frame, r.timecode, r.seconds]).toEqual([961, "00:00:32,00", 32]);
    expect(ed.host.calls).toContain("seek 32");
    expect(receipt.summary).toBe("Playhead at 00:00:32,00, frame 961.");
    expect((await ed.receipt("seek_playhead_tool", { frame: "100" })).frame).toBe(100);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("notes a time past the content and refuses one past the timeline", async () => {
    const { ed } = timeline();
    const r = await ed.receipt("seek_playhead_tool", { seconds: 50 });
    expect(String(r.note)).toContain("past the end of the last clip");
    await ed.refused("seek_playhead_tool", { seconds: 400 }, "past the end of the timeline");
  });

  it("goes to the start and the end (the last playable frame)", async () => {
    const { ed } = timeline();
    ed.host.player!.seek(500 / 30);
    expect((await ed.receipt("seek_playhead_tool", { to: "start" })).frame).toBe(1);
    expect((await ed.receipt("seek_playhead_tool", { to: "END" })).frame).toBe(1199);
  });

  it("goes to a marker by name, id or part of a name", async () => {
    const { ed } = timeline();
    const drop = ed.addMarker(12, "Drop");
    ed.addMarker(20, "Outro");
    const r = await ed.receipt("seek_playhead_tool", { marker: "Drop" });
    expect(r.frame).toBe(361);
    expect((r.marker as Row).name).toBe("Drop");
    expect((await ed.receipt("seek_playhead_tool", { marker: drop })).frame).toBe(361);
    expect((await ed.receipt("seek_playhead_tool", { marker: "out" })).frame).toBe(601);
    const refused = await ed.refused("seek_playhead_tool", { marker: "Bridge" }, "Drop", "Outro");
    expect(refused.summary).toContain("no marker with id or name 'Bridge'");
  });

  it("a shared marker name goes to the first", async () => {
    const { ed } = timeline();
    ed.addMarker(20, "Beat");
    ed.addMarker(8, "Beat");
    const r = await ed.receipt("seek_playhead_tool", { marker: "beat" });
    expect(r.frame).toBe(241);
    expect(String(r.note)).toContain("went to the first");
  });

  it("next and previous marker, with the end of the content as a stop when nothing is selected", async () => {
    const { ed } = timeline();
    ed.addMarker(5, "A");
    ed.addMarker(15, "B");
    ed.host.player!.seek(6);
    let r = await ed.receipt("seek_playhead_tool", { to: "next_marker" });
    expect([r.frame, (r.marker as Row).name]).toEqual([451, "B"]);
    r = await ed.receipt("seek_playhead_tool", { to: "previous_marker" });
    expect(r.frame).toBe(151);
    expect((await ed.receipt("seek_playhead_tool", { to: "previous_marker" })).frame).toBe(1);
    await ed.refused("seek_playhead_tool", { to: "previous_marker" }, "no marker before 00:00:00,00");
    ed.host.player!.seek(451 / 30);
    expect((await ed.receipt("seek_playhead_tool", { to: "next_marker" })).frame).toBe(1199);
    await ed.refused("seek_playhead_tool", { to: "next_marker" }, "no marker after");
  });

  it("next marker stops at the selected clip's edges", async () => {
    const { ed } = timeline();
    const c = ed.addClip(ed.addFile("video", { duration: 10 }), { layer: T2, position: 20 });
    ed.host.editor.selection = { clips: [c], transitions: [], effects: [] };
    expect((await ed.receipt("seek_playhead_tool", { to: "next_marker" })).frame).toBe(601);
  });

  it("next and previous edit, on every track or one", async () => {
    const { ed } = timeline();
    ed.addClip(ed.addFile("video", { duration: 10 }), { layer: T2, position: 12 }); // edges 12 and 22 on track 2
    expect((await ed.receipt("seek_playhead_tool", { to: "next_edit" })).frame).toBe(361);
    expect((await ed.receipt("seek_playhead_tool", { to: "next_edit" })).frame).toBe(661);
    expect((await ed.receipt("seek_playhead_tool", { to: "next_edit" })).frame).toBe(1199); // clamped to the end
    await ed.refused("seek_playhead_tool", { to: "next_edit" }, "no clip edge");
    ed.host.player!.seek(0);
    expect((await ed.receipt("seek_playhead_tool", { to: "next_edit", track: "1" })).frame).toBe(1199);
    expect((await ed.receipt("seek_playhead_tool", { to: "previous_edit", track: "2" })).frame).toBe(661);
  });

  it("seeks and plays", async () => {
    const { ed } = timeline();
    ed.host.player!.seek(40);
    const r = await ed.receipt("seek_playhead_tool", { to: "start", play: "true" });
    expect([r.playing, r.started_playing, r.frame]).toEqual([true, true, 1]);
    expect(ed.host.player!.playing).toBe(true);
  });

  it("refuses to play from the end or on an empty timeline, before moving", async () => {
    const { ed } = timeline();
    await ed.refused("seek_playhead_tool", { seconds: 39.99, play: true }, "the playhead is at the end of the timeline");
    expect(ed.host.calls.filter((c) => c.startsWith("seek"))).toEqual([]);
    const empty = new EditHarness();
    await empty.refused("seek_playhead_tool", { to: "start", play: true }, "the timeline is empty");
  });

  it("centres the timeline when the target is off screen", async () => {
    const { ed } = timeline();
    await ed.receipt("seek_playhead_tool", { seconds: 10 });
    expect(ed.host.calls).not.toContain("centerOnPlayhead");
    await ed.receipt("seek_playhead_tool", { seconds: 35 });
    expect(ed.host.calls).toContain("centerOnPlayhead");
  });

  it("refuses what makes no sense", async () => {
    const { ed } = timeline();
    await ed.refused("seek_playhead_tool", {}, "say where to go");
    await ed.refused("seek_playhead_tool", { seconds: 1, marker: "A" }, "give only one of seconds, frame, marker or to (got seconds, marker)");
    await ed.refused("seek_playhead_tool", { to: "start", track: "1" }, "track only applies");
    await ed.refused("seek_playhead_tool", { seconds: -2 }, "Error");
    await ed.refused("seek_playhead_tool", { frame: 0 }, "Error");
    await ed.refused("seek_playhead_tool", { to: "middle" }, "Error");
    expect(ed.host.calls.filter((c) => c.startsWith("seek"))).toEqual([]);
  });

  it.each([
    [{ num: 24, den: 1 }, 32, 769, "00:00:32,00"],
    [{ num: 60, den: 1 }, 1.5, 91, "00:00:01,30"],
    [{ num: 30000, den: 1001 }, 32, 960, "00:00:31,28"], // 29.97: frame 960 starts at 31.998 s
  ])("follows the project frame rate %j", async (fps, seconds, frame, code) => {
    const ed = new EditHarness({ fps });
    ed.addClip(ed.addFile("video", { duration: 60 }));
    const r = await ed.receipt("seek_playhead_tool", { seconds });
    expect([r.frame, r.timecode]).toEqual([frame, code]);
    await ed.call("update_marker_tool", { marker: ed.addMarker(seconds + 0.5, "M"), position_seconds: seconds + 0.004 });
    expect(ed.doc.project.markers[0]!.position).toBeCloseTo((frame - 1) / (fps.num / fps.den), 9); // snapped to the grid
    expect((await ed.receipt("seek_playhead_tool", { marker: "M" })).frame).toBe(frame);
  });

  it("without a preview moves the playhead saved with the project; play needs an editor", async () => {
    const { ed } = timeline();
    const receipt = await headless(ed, "seek_playhead_tool", { seconds: "12" });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe("Playhead at 00:00:12,00, frame 361 (saved with the project; there is no preview player here).");
    expect(ed.doc.project.playhead_position).toBe(12);
    expect((receipt.data as Row).saved).toBe(true);
    expect(ed.stepsSinceMark()).toBe(0);
    const play = await headless(ed, "seek_playhead_tool", { to: "start", play: true });
    expect(play.summary).toMatch(/^Error: seek_playhead_tool is not available in this Zenvi surface: there is no preview player here/);
    expect(ed.doc.project.playhead_position).toBe(12);
    // The saved playhead is where tools without a time work, e.g. a marker.
    await headless(ed, "add_marker_tool", { name: "Here" });
    expect(ed.doc.project.markers.find((m) => m.label === "Here")!.position).toBe(12);
  });
});

describe("timecode", () => {
  it("is the ruler's HH:MM:SS,FF", () => {
    const ed = new EditHarness();
    expect(timecode(ed.doc.project, 3725.5)).toBe("01:02:05,15");
    expect(timecode(ed.doc.project, -1)).toBe("00:00:00,00");
  });
});

// ---------------------------------------------------------------------------
// set_timeline_view_tool
// ---------------------------------------------------------------------------

describe("set_timeline_view_tool", () => {
  it("zooms in and out by steps, no undo step", async () => {
    const { ed } = timeline();
    await ed.receipt("set_timeline_view_tool", { zoom: "in", steps: "3" });
    expect(ed.host.calls.filter((c) => c === "zoomIn")).toHaveLength(3);
    const receipt = await ed.call("set_timeline_view_tool", { zoom: "out" });
    expect(receipt.summary).toBe("Timeline view: zoomed out 1 step.");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("zoom to fit shows every clip", async () => {
    const { ed } = timeline();
    ed.addClip(ed.addFile("video", { duration: 30 }), { position: 30, layer: T2 }); // content now ends at 60 s
    const receipt = await ed.call("set_timeline_view_tool", { zoom: "fit" });
    expect(ed.host.calls).toContain("showRange 0.000-61.200");
    expect(receipt.summary).toBe("Timeline view: fit every clip (0 to 00:01:00,00).");
    expect(((receipt.data as Row).zoom as Row).visible_range).toEqual([0, 61.2]);
  });

  it("shows N seconds around the playhead, or a range", async () => {
    const { ed } = timeline();
    ed.host.player!.seek(20);
    const r = await ed.receipt("set_timeline_view_tool", { visible_seconds: 10 });
    expect((r.zoom as Row).visible_range).toEqual([15, 25]);
    await ed.receipt("set_timeline_view_tool", { start_seconds: 30, end_seconds: 60 });
    expect(ed.host.calls).toContain("showRange 30.000-60.000");
  });

  it("centres on the playhead", async () => {
    const { ed } = timeline();
    await ed.receipt("set_timeline_view_tool", { center_on_playhead: true });
    expect(ed.host.calls).toEqual(["centerOnPlayhead"]);
  });

  it("switches the toolbar modes; the web editor has no timing mode", async () => {
    const { ed } = timeline();
    const r = await ed.receipt("set_timeline_view_tool", { snapping: "false", razor: "true" });
    expect(ed.host.calls).toEqual(["mode snapping false", "mode razor true"]);
    expect(r.modes).toEqual({ snapping: false, razor: true, timing: null });
    const again = await ed.call("set_timeline_view_tool", { snapping: false, timing: false });
    expect(again.summary).toBe("Timeline view: snapping already off; timing already off.");
    const timing = await ed.refused("set_timeline_view_tool", { timing: true }, "has no timing mode");
    expect(timing.status).toBe("refused");
  });

  it.each([
    [{}, "nothing to change"],
    [{ zoom: "fit", visible_seconds: 5 }, "only one of"],
    [{ start_seconds: 5 }, "both"],
    [{ start_seconds: 9, end_seconds: 4 }, "after"],
    [{ start_seconds: 400, end_seconds: 500 }, "past the end"],
    [{ zoom: "fit", steps: 2 }, "steps only"],
    [{ zoom: "sideways" }, "zoom"],
  ])("refuses %j", async (args, fragment) => {
    const { ed } = timeline();
    await ed.refused("set_timeline_view_tool", args, fragment);
    expect(ed.host.calls).toEqual([]);
  });

  it("needs an editor", async () => {
    const { ed } = timeline();
    const receipt = await headless(ed, "set_timeline_view_tool", { zoom: "fit" });
    expect(receipt.summary).toBe(
      "Error: set_timeline_view_tool is not available in this Zenvi surface: it needs the editor UI, which this host does not provide.",
    );
  });
});

// ---------------------------------------------------------------------------
// select_timeline_items_tool
// ---------------------------------------------------------------------------

/** Track 1: clips at 0 and 10; track 2: clips at 5 and 20 plus a transition at 19. */
function stage() {
  const ed = new EditHarness();
  const f = ed.addFile("video", { duration: 5 });
  const a = ed.addClip(f, { layer: T1, position: 0 });
  const b = ed.addClip(f, { layer: T1, position: 10 });
  const c = ed.addClip(f, { layer: T2, position: 5 });
  const d = ed.addClip(f, { layer: T2, position: 20 });
  const t = transition(ed, T2, 19);
  ed.mark();
  const pairs = (): [string, string][] => {
    const s = ed.host.editor.selection;
    return [...s.clips.map((id) => [id, "clip"] as [string, string]), ...s.transitions.map((id) => [id, "transition"] as [string, string]), ...s.effects.map((id) => [id, "effect"] as [string, string])];
  };
  return { ed, a, b, c, d, t, pairs };
}

describe("select_timeline_items_tool", () => {
  it("selects every clip on a track, no undo step", async () => {
    const { ed, a, b, pairs } = stage();
    const r = await ed.receipt("select_timeline_items_tool", { track: "1" });
    expect(pairs()).toEqual([
      [a, "clip"],
      [b, "clip"],
    ]);
    const clips = (r.selection as Row).clips as Row[];
    expect(clips.map((c) => c.timeline_clip_id)).toEqual([a, b]);
    expect(clips[0]!.track).toBe(1);
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("adds, removes and clears", async () => {
    const { ed, a, b, c, pairs } = stage();
    await ed.receipt("select_timeline_items_tool", { timeline_clip_ids: [a] });
    await ed.receipt("select_timeline_items_tool", { mode: "add", timeline_clip_ids: c });
    expect(pairs()).toEqual([
      [a, "clip"],
      [c, "clip"],
    ]);
    await ed.receipt("select_timeline_items_tool", { mode: "remove", timeline_clip_ids: [a] });
    expect(pairs()).toEqual([[c, "clip"]]);
    const none = await ed.call("select_timeline_items_tool", { mode: "remove", timeline_clip_ids: [b] });
    expect(none.summary).toBe("Selection: 1 clip. (none of those were selected)");
    const r = await ed.receipt("select_timeline_items_tool", { mode: "None" });
    expect(pairs()).toEqual([]);
    expect((r.selection as Row).count).toBe(0);
  });

  it("selects by time range, with transitions", async () => {
    const { ed, a, b, c, d, t, pairs } = stage();
    await ed.receipt("select_timeline_items_tool", { start_seconds: 4, end_seconds: 12 });
    expect(pairs()).toEqual([
      [a, "clip"],
      [c, "clip"],
      [b, "clip"],
    ]);
    await ed.receipt("select_timeline_items_tool", { start_seconds: "12" });
    expect(pairs()).toEqual([[b, "clip"]]);
    const r = await ed.receipt("select_timeline_items_tool", { track: "2", start_seconds: 18, end_seconds: 30, include_transitions: true });
    expect(new Set(pairs().map((p) => p.join(":")))).toEqual(new Set([`${t}:transition`, `${d}:clip`]));
    expect((((r.selection as Row).transitions as Row[])[0]!).transition_id).toBe(t);
  });

  it("refuses a moment without a clip", async () => {
    const { ed } = stage();
    await ed.refused("select_timeline_items_tool", { start_seconds: 26 }, "nothing to select on any track between 00:00:26,00 and 00:00:26,00");
  });

  it("selects all, and ripples to everything after on the same track", async () => {
    const { ed, a, b, c, d, t, pairs } = stage();
    expect(((await ed.receipt("select_timeline_items_tool", { mode: "all" })).selection as Row).count).toBe(5);
    await ed.receipt("select_timeline_items_tool", { timeline_clip_ids: [c] });
    await ed.receipt("select_timeline_items_tool", { mode: "ripple" });
    expect(new Set(pairs().map((p) => p.join(":")))).toEqual(new Set([`${c}:clip`, `${d}:clip`, `${t}:transition`]));
    await ed.receipt("select_timeline_items_tool", { mode: "none" });
    await ed.receipt("select_timeline_items_tool", { mode: "ripple", timeline_clip_ids: [a] });
    expect(new Set(pairs().map((p) => p.join(":")))).toEqual(new Set([`${a}:clip`, `${b}:clip`]));
  });

  it("selects an effect and shows the Properties panel; a clip by query", async () => {
    const { ed, b, pairs } = stage();
    const effect = ed.addEffect(b, "Blur");
    const r = await ed.receipt("select_timeline_items_tool", { effect_ids: [effect], show_properties: true });
    expect((r.selection as Row).effects).toEqual([{ effect_id: effect, class_name: "Blur", timeline_clip_id: b }]);
    expect(ed.host.calls).toContain("showProperties");
    const g = ed.addFile("video", { name: "interview_take2.mp4" });
    const e = ed.addClip(g, { layer: T3, position: 2 });
    await ed.receipt("select_timeline_items_tool", { clip_query: "interview", track: "3" });
    expect(pairs()).toEqual([[e, "clip"]]);
  });

  it("marks clips on locked tracks", async () => {
    const { ed } = stage();
    ed.lockTrack(T1);
    const r = await ed.receipt("select_timeline_items_tool", { track: "1" });
    expect(((r.selection as Row).clips as Row[]).every((c) => c.locked === true)).toBe(true);
  });

  it("refusals change nothing", async () => {
    const { ed, a, b, pairs } = stage();
    await ed.receipt("select_timeline_items_tool", { timeline_clip_ids: [a] });
    for (const [args, needle] of [
      [{ timeline_clip_ids: [b, "nope"] }, "nope"],
      [{}, "needs something"],
      [{ mode: "all", track: "1" }, "takes no targets"],
      [{ end_seconds: 5 }, "needs start_seconds"],
      [{ start_seconds: 9, end_seconds: 2 }, "before"],
      [{ transition_ids: ["zz"] }, "no transition"],
      [{ effect_ids: ["zz"] }, "no effect"],
      [{ track: "7" }, "7"],
    ] as const) {
      await ed.refused("select_timeline_items_tool", args as Record<string, unknown>, needle);
    }
    expect(pairs()).toEqual([[a, "clip"]]);
  });

  it("needs an editor", async () => {
    const { ed, a } = stage();
    const receipt = await headless(ed, "select_timeline_items_tool", { timeline_clip_ids: [a] });
    expect(receipt.summary).toMatch(/^Error: select_timeline_items_tool is not available in this Zenvi surface: it needs the editor UI/);
  });
});

// ---------------------------------------------------------------------------
// get_playhead_and_selection_tool
// ---------------------------------------------------------------------------

describe("get_playhead_and_selection_tool", () => {
  it("reads the playhead, playback, selection, view and nearby markers", async () => {
    const ed = new EditHarness();
    const clip = ed.addClip(ed.addFile("video", { duration: 30 }), { position: 0 });
    ed.host.editor.selection = { clips: [clip], transitions: [], effects: [] };
    ed.addMarker(5, "A");
    ed.addMarker(15, "B");
    ed.host.player!.seek(10);
    ed.host.player!.play();
    const receipt = await ed.call("get_playhead_and_selection_tool");
    const r = receipt.data as Row;
    expect(r.playhead).toEqual({ frame: 301, seconds: 10, timecode: "00:00:10,00" });
    expect(r.playback).toEqual({ playing: true, speed: 1 });
    expect((((r.selection as Row).clips as Row[])[0]!).timeline_clip_id).toBe(clip);
    expect(((r.view as Row).zoom as Row).visible_seconds).toBe(30);
    expect(((r.view as Row).zoom as Row).visible_range).toEqual([0, 30]);
    expect(((r.view as Row).modes as Row).snapping).toBe(true);
    const tl = r.timeline as Row;
    expect([(tl.previous_marker as Row).name, (tl.next_marker as Row).name]).toEqual(["A", "B"]);
    expect((tl.content_end as Row).seconds).toBe(30);
    expect(receipt.summary).toBe("Playhead at 00:00:10,00 (frame 301), playing; 1 item(s) selected.");
    expect(ed.stepsSinceMark()).toBe(0);
  });

  it("without an editor reports the saved playhead and no selection", async () => {
    const ed = new EditHarness();
    ed.addClip(ed.addFile("video", { duration: 30 }));
    ed.doc.setUntracked(["playhead_position"], 2.5);
    const receipt = await headless(ed, "get_playhead_and_selection_tool");
    const r = receipt.data as Row;
    expect(r.playhead).toEqual({ frame: 76, seconds: 2.5, timecode: "00:00:02,15" });
    expect([r.selection, r.view, r.saved]).toEqual([null, null, true]);
    expect(receipt.summary).toBe(
      "Playhead at 00:00:02,15 (frame 76), saved with the project: no editor is open here, so there is no playback, selection or timeline view.",
    );
  });
});
