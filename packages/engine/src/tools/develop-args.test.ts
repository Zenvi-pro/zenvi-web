/**
 * Arguments and rules zenvi-core develop (1f80cb3d0) added to tools this
 * catalog had already ported: play_tool actions, add_track_tool placement,
 * marker names and colours, ripple delete, import files alias, narration
 * start and name, save_first, add_effect if_exists, track references, and
 * set_keyframes point times, interpolation and modes.
 */

import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import type { Clip, Keyframe } from "../model/types.js";
import { pendingArgumentMessage } from "./pending.js";
import { runTool } from "./registry.js";
import { fakeHost } from "./test-support/fake-host.js";
import { IDS, L1, fixtureDoc } from "./test-support/fixture.js";
import { normalizeTrackOrLayerArg } from "./tracks.js";

function clip(doc: ProjectDocument, id: string): Clip {
  return doc.project.clips.find((c) => c.id === id)!;
}

async function summary(doc: ProjectDocument, host: ReturnType<typeof fakeHost>, name: string, args: Record<string, unknown>): Promise<string> {
  return (await runTool({ doc, host }, name, args)).data!.summary;
}

describe("play_tool", () => {
  it("plays, pauses, toggles and stops like the desktop's transport", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    expect(await summary(doc, host, "play_tool", { action: "play" })).toBe("Playing at 1x, now at 1.00 s.");
    expect(await summary(doc, host, "play_tool", { action: "play" })).toBe("Already playing at 1x (now at 1.00 s).");
    expect(await summary(doc, host, "play_tool", {})).toBe("Paused at 1.00 s.");
    expect(await summary(doc, host, "play_tool", { action: "pause" })).toBe("Already paused at 1.00 s.");
    expect(await summary(doc, host, "play_tool", { action: "stop" })).toBe("Stopped: paused at the start (0.00 s).");
    expect(host.calls).toEqual(["play", "toggle", "pause", "seek 0"]);
    expect(doc.undoLabels).toEqual([]);
  });

  it("steps by frames and pauses", async () => {
    const doc = fixtureDoc();
    const host = fakeHost({ playhead: 1 });
    expect(await summary(doc, host, "play_tool", { action: "step_forward", frames: "3" })).toBe("Stepped to 1.10 s (frame 34), paused.");
    expect(await summary(doc, host, "play_tool", { action: "step_back", frames: "40" })).toBe("Stepped to 0.00 s (frame 1), paused.");
    expect(await summary(doc, host, "play_tool", { action: "step_back" })).toBe("Error: already at the first frame; nothing to step back to.");
  });

  it("refuses speeds this player does not have, and arguments that do not go with the action", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const normalOnly = "Error: play_tool is not available in this Zenvi surface: this player plays at normal speed only (no fast forward, rewind or other speeds).";
    expect(await summary(doc, host, "play_tool", { action: "fast_forward" })).toBe(normalOnly);
    expect(await summary(doc, host, "play_tool", { action: "rewind" })).toBe(normalOnly);
    expect(await summary(doc, host, "play_tool", { action: "play", speed: "2" })).toBe(normalOnly);
    expect(await summary(doc, host, "play_tool", { action: "pause", speed: "1" })).toBe("Error: speed only applies to action='play'.");
    expect(await summary(doc, host, "play_tool", { action: "play", frames: "2" })).toBe("Error: frames only applies to step_forward / step_back.");
    expect(host.calls).toEqual([]);
    expect(await summary(doc, host, "play_tool", { speed: "1" })).toBe("Playing at 1x, now at 1.00 s.");
  });

  it("will not play an empty timeline", async () => {
    const doc = new ProjectDocument(createProject());
    expect(await summary(doc, fakeHost(), "play_tool", { action: "play" })).toBe("Error: the timeline is empty: there is nothing to play.");
  });
});

describe("add_track_tool", () => {
  it("adds on top by default, at the bottom, and blocks of named tracks above or below a track, one undo step each", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    expect(await summary(doc, host, "add_track_tool", {})).toBe("Added track 6 at the top. Track numbers count from the bottom.");
    expect(await summary(doc, host, "add_track_tool", { position: "bottom", name: "Music" })).toBe(
      "Added track 1 ('Music') at the bottom. Track numbers count from the bottom.",
    );
    const block = await runTool({ doc, host }, "add_track_tool", { position: "above", relative_to: "2", name: "B-roll", count: "2" });
    expect(block.data!.summary).toBe("Added 2 tracks (track 3 ('B-roll 1'), track 4 ('B-roll 2')) above track 2. Track numbers count from the bottom.");
    expect(block.data!.createdTracks).toHaveLength(2);
    expect(await summary(doc, host, "add_track_tool", { position: "below", relative_to: "Music" })).toBe(
      "Added track 1 below track 2 ('Music'). Track numbers count from the bottom.",
    );
    const labels = [...doc.project.layers].sort((a, b) => a.number - b.number).map((l) => l.label);
    expect(labels.slice(0, 5)).toEqual(["", "Music", "", "B-roll 1", "B-roll 2"]);
    expect(doc.undoLabels).toHaveLength(4);
  });

  it("refuses relative_to without above/below, and above/below without relative_to", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    expect(await summary(doc, host, "add_track_tool", { position: "above" })).toBe(
      "Error: position='above' needs relative_to: the track to add it above (a UI track number (1 = bottom), track name, track id (L3) or layer number).",
    );
    expect(await summary(doc, host, "add_track_tool", { relative_to: "2" })).toBe("Error: relative_to only applies to position 'above' or 'below'; got position='top'.");
    expect(await summary(doc, host, "add_track_tool", { position: "below", relative_to: "Nope" })).toMatch(/^Error: Unknown track or layer 'Nope'/);
    expect(doc.undoLabels).toEqual([]);
  });
});

describe("add_marker_tool", () => {
  it("stores the name and the desktop's colour tag", async () => {
    const doc = fixtureDoc();
    await runTool({ doc, host: fakeHost() }, "add_marker_tool", { position_seconds: 7, name: "Drop", color: "red" });
    expect(doc.project.markers.find((m) => m.position === 7)).toMatchObject({ label: "Drop", icon: "red.png", vector: "red" });
  });
});

describe("delete_from_timeline_tool ripple", () => {
  it("closes the gap the deleted clip leaves", async () => {
    const doc = fixtureDoc();
    const text = await summary(doc, fakeHost(), "delete_from_timeline_tool", { timeline_clip_id: IDS.clipB, ripple: "true" });
    expect(text).toMatch(/^Deleted timeline clip CLIPBROL01 \('broll\.mp4'\) from track 1000000 .* at 10\.00s and closed the gap: 1 later item\(s\) on that track moved left\. 1 undo step\.$/);
    expect(clip(doc, IDS.clipTail).position).toBe(10);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("leaves the gap without it", async () => {
    const doc = fixtureDoc();
    await runTool({ doc, host: fakeHost() }, "delete_from_timeline_tool", { timeline_clip_id: IDS.clipB });
    expect(clip(doc, IDS.clipTail).position).toBe(15);
  });
});

describe("import_files_tool", () => {
  it("takes files as an alias of paths", async () => {
    const host = fakeHost();
    const result = await runTool({ doc: fixtureDoc(), host }, "import_files_tool", { files: ["/media/new.mp4"] });
    expect(result.ok).toBe(true);
    expect(host.calls).toContain("importPath /media/new.mp4");
  });
});

describe("generate_tts_and_add_to_timeline_tool", () => {
  it("starts at position_seconds, else the playhead, and names the narration file", async () => {
    const doc = fixtureDoc();
    const atPlayhead = await summary(doc, fakeHost({ playhead: 3 }), "generate_tts_and_add_to_timeline_tool", { text: "Welcome to Lisbon on a sunny day in spring" });
    expect(atPlayhead).toMatch(/^Added TTS audio to timeline at position 3\.0s /);
    expect(doc.project.files.at(-1)?.name).toBe("Narration - Welcome to Lisbon on a sunny...");
    const placed = await summary(doc, fakeHost(), "generate_tts_and_add_to_timeline_tool", { text: "Hi", position_seconds: "2", name: "Intro VO" });
    expect(placed).toMatch(/^Added TTS audio to timeline at position 2\.0s /);
    expect(doc.project.files.at(-1)?.name).toBe("Intro VO");
  });

  it("refuses position and position_seconds that disagree", async () => {
    const doc = fixtureDoc();
    expect(await summary(doc, fakeHost(), "generate_tts_and_add_to_timeline_tool", { text: "Hi", position: "1", position_seconds: "2" })).toBe(
      "Error: position (1.0) and position_seconds (2.0) disagree; pass position_seconds only.",
    );
    expect(doc.undoLabels).toEqual([]);
  });
});

describe("save_first", () => {
  it("saves the current project before new_project_tool / open_project_tool replace it", async () => {
    const host = fakeHost();
    expect(await summary(fixtureDoc(), host, "new_project_tool", { save_first: true, discard_unsaved: true })).toBe("New project created.");
    host.storage!.open = async () => ({ ...fixtureDoc().project, id: "OTHER00001", clips: [] });
    const doc = fixtureDoc();
    expect(await summary(doc, host, "open_project_tool", { file_path: "/projects/other.zvn", save_first: "true" })).toBe("Opened project /projects/other.zvn.");
    expect(doc.project.id).toBe("OTHER00001");
    expect(host.calls).toEqual(["save ", "save "]);
  });

  it("is refused where there is no project storage", async () => {
    expect(await summary(fixtureDoc(), fakeHost({ without: ["storage"] }), "new_project_tool", { save_first: true })).toBe(
      "Error: new_project_tool is not available in this Zenvi surface: save_first needs project storage, which this host does not provide.",
    );
  });

  it("open_project_tool asks for file_path (recent_index is not ported)", async () => {
    expect(await summary(fixtureDoc(), fakeHost(), "open_project_tool", {})).toBe("Error: give file_path (a .zvn project) or recent_index.");
  });
});

describe("add_effect_tool if_exists", () => {
  it("does not stack a second copy of an effect the clip has, unless asked", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur" });
    const again = await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur" });
    expect(again.data).toMatchObject({ status: "unchanged", summary: "Blur is already on 1 clip(s) with these settings; nothing changed.", undoSteps: 0 });
    expect(clip(doc, IDS.clipA).effects).toHaveLength(1);
    const stacked = await runTool({ doc, host }, "add_effect_tool", { timeline_clip_id: IDS.clipA, effect: "Blur", if_exists: "add" });
    expect(stacked.data?.status).toBe("applied");
    expect(clip(doc, IDS.clipA).effects).toHaveLength(2);
    expect(doc.undoLabels).toHaveLength(2);
  });
});

describe("track references (track_display.normalize_track_or_layer_arg)", () => {
  const layers = [
    { id: "L1", number: 1_000_000, y: 0, label: "", lock: false },
    { id: "L2", number: 2_000_000, y: 0, label: "Music 1", lock: false },
    { id: "L3", number: 3_000_000, y: 0, label: "Voice", lock: false },
  ];

  it("reads a number, 'track N' and 'Track #N' as UI track N, never as part of a name", () => {
    expect(normalizeTrackOrLayerArg("1", layers)).toEqual({ layer: 1_000_000 });
    expect(normalizeTrackOrLayerArg("Track #2", layers)).toEqual({ layer: 2_000_000 });
    expect(normalizeTrackOrLayerArg("ui track 3", layers)).toEqual({ layer: 3_000_000 });
    expect(normalizeTrackOrLayerArg("voi", layers)).toEqual({ layer: 3_000_000 });
  });
});

describe("set_keyframes_tool", () => {
  // CLIPINTV02: interview 10-14 s, at 15 s on the timeline, 30 fps: X 301 is its first visible frame.
  const points = (doc: ProjectDocument) => (clip(doc, IDS.clipTail).alpha as Keyframe).Points.map((p) => [p.co.X, p.co.Y, p.interpolation]);

  it("reads seconds from the clip's first visible frame, takes timeline and source seconds, and defaults to bezier", async () => {
    const doc = fixtureDoc();
    const result = await runTool({ doc, host: fakeHost() }, "set_keyframes_tool", {
      timeline_clip_id: IDS.clipTail,
      property: "alpha",
      points: [{ seconds: 0, value: 0 }, { timeline_seconds: 16, value: 1 }, { source_seconds: 13, value: 0.5, interpolation: "linear" }],
    });
    expect(result.ok).toBe(true);
    expect(points(doc)).toEqual([
      [301, 0, 0],
      [331, 1, 0],
      [391, 0.5, 1],
    ]);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("merges or replaces a range, with a default interpolation", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const base = [{ seconds: 0, value: 0 }, { seconds: 1, value: 1 }, { seconds: 3, value: 0 }];
    await runTool({ doc, host }, "set_keyframes_tool", { timeline_clip_id: IDS.clipTail, property: "alpha", points: base });
    await runTool({ doc, host }, "set_keyframes_tool", { timeline_clip_id: IDS.clipTail, property: "alpha", points: [{ seconds: 2, value: 0.5 }], mode: "merge", interpolation: "constant" });
    expect(points(doc)).toEqual([
      [301, 0, 0],
      [331, 1, 0],
      [361, 0.5, 2],
      [391, 0, 0],
    ]);
    await runTool({ doc, host }, "set_keyframes_tool", {
      timeline_clip_id: IDS.clipTail,
      property: "alpha",
      points: [{ seconds: 1, value: 0.2 }, { seconds: 2, value: 0.3 }],
      mode: "replace_range",
    });
    expect(points(doc)).toEqual([
      [301, 0, 0],
      [331, 0.2, 0],
      [361, 0.3, 0],
      [391, 0, 0],
    ]);
  });

  it("refuses points outside the clip, on the same frame, with two times, without a value, or with an ease preset", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const run = (pts: unknown[]) => summary(doc, host, "set_keyframes_tool", { timeline_clip_id: IDS.clipTail, property: "alpha", points: pts });
    expect(await run([{ seconds: 5, value: 1 }])).toBe(
      "Error: points[0] (seconds=5) lands on frame 451, outside clip CLIPINTV02; valid: frames 301-421, seconds 0-4.000 from the clip's start, " +
        "timeline_seconds 15.000-19.000, source_seconds 10.000-14.000.",
    );
    expect(await run([{ seconds: 0, value: 1 }, { frame: 301, value: 0 }])).toBe("Error: points[0] and points[1] land on the same frame 301.");
    expect(await run([{ seconds: 0, frame: 301, value: 1 }])).toBe("Error: points[0] needs exactly one of frame, seconds, timeline_seconds or source_seconds.");
    expect(await run([{ seconds: 0 }])).toBe("Error: points[0] needs a value here (keeping the curve's current value is not ported to this Zenvi surface yet).");
    expect(await run([{ seconds: 0, value: 1, ease: "ease_in" }])).toBe(pendingArgumentMessage("set_keyframes_tool", "points[0].ease"));
    expect(doc.undoLabels).toEqual([]);
    expect(clip(doc, IDS.clipTail).layer).toBe(L1);
  });
});
