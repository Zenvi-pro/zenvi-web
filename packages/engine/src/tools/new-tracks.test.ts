/**
 * Placement tools add tracks an agent names just past the top of the stack
 * (track="6" with 5 tracks means "a new track on top"; the most common
 * refusal in the W28 transcript replay). Mirrors zenvi-core
 * tests/test_track_autocreate.py.
 */

import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { ensureTrack } from "../ops/overlays.js";
import { runTool } from "./registry.js";
import { fakeHost } from "./test-support/fake-host.js";
import { IDS, fixtureDoc } from "./test-support/fixture.js";
import { MAX_NEW_TRACKS_ON_TOP, normalizeTrackOrLayerArg, resolvePlacementTrack } from "./tracks.js";

const TOP = 5_000_000;

function layerNumbers(doc: ProjectDocument): number[] {
  return doc.project.layers.map((l) => l.number).sort((a, b) => a - b);
}

async function run(doc: ProjectDocument, name: string, args: Record<string, unknown>) {
  return (await runTool({ doc, host: fakeHost({ without: ["frames"] }) }, name, args)).data!;
}

describe("resolvePlacementTrack", () => {
  const layers = fixtureDoc().project.layers;

  it.each([
    ["6", 1],
    ["track 7", 2],
    ["Track #8", 3],
  ])("resolves %s (5 tracks) to the topmost of %i new track(s)", (raw, count) => {
    expect(resolvePlacementTrack(raw, layers)).toEqual({ layer: TOP + count * 1_000_000, newTracks: count });
  });

  it("resolves existing tracks exactly like normalizeTrackOrLayerArg", () => {
    for (const raw of ["1", "5", "3000000", "L2", "", "track 2"]) {
      expect(resolvePlacementTrack(raw, layers)).toEqual(normalizeTrackOrLayerArg(raw, layers));
    }
  });

  it(`refuses more than ${MAX_NEW_TRACKS_ON_TOP} past the top, 0 and names, as before`, () => {
    for (const raw of ["9", "0", "-1", "music"]) {
      expect(resolvePlacementTrack(raw, layers).error).toMatch(/^Error: Unknown track or layer/);
    }
  });

  it("lets a numeric label win over a new track", () => {
    const labelled = layers.map((l, i) => (i === 0 ? { ...l, label: "6" } : l));
    expect(resolvePlacementTrack("6", labelled)).toEqual({ layer: 1_000_000 });
  });

  it("plans the first tracks of a project with none", () => {
    expect(resolvePlacementTrack("2", [])).toEqual({ layer: 2_000_000, newTracks: 2 });
    expect(normalizeTrackOrLayerArg("2", [])).toEqual({ error: "Error: No tracks in project." });
  });
});

describe("ensureTrack", () => {
  it("adds the empty tracks between the top and the one asked for", () => {
    const doc = fixtureDoc();
    doc.transaction("t", (tx) => ensureTrack(tx, TOP + 3_000_000, "Titles"));
    expect(layerNumbers(doc).slice(5)).toEqual([6_000_000, 7_000_000, 8_000_000]);
    expect(doc.project.layers.find((l) => l.number === 8_000_000)?.label).toBe("Titles");
    expect(doc.project.layers.find((l) => l.number === 7_000_000)?.label).toBe("");
  });
});

describe("placing on a track past the top", () => {
  it("add_clip_to_timeline_tool adds the track and places the clip in one undo step", async () => {
    const doc = fixtureDoc();
    const r = await run(doc, "add_clip_to_timeline_tool", { file_id: IDS.broll, full_file: "true", track: "6", position_seconds: "2" });
    expect(r.status).toBe("applied");
    expect(r.summary).toContain("on track 6000000 (stack_from_bottom=6, z_from_bottom=5) on a new track");
    expect(r.createdTracks).toEqual([{ index: 5, id: expect.any(String), layer: 6_000_000 }]);
    expect(doc.project.clips.find((c) => c.id === r.clips[0]?.id)?.layer).toBe(6_000_000);
    expect(doc.undoLabels).toHaveLength(1);
    doc.undo();
    expect(layerNumbers(doc)).toEqual([1, 2, 3, 4, 5].map((n) => n * 1_000_000));
  });

  it("add_clip_to_timeline_tool adds the tracks in between too", async () => {
    const doc = fixtureDoc();
    const r = await run(doc, "add_clip_to_timeline_tool", { file_id: IDS.logo, track: "8", position_seconds: "0" });
    expect(r.summary).toContain("on a new track (3 tracks added on top)");
    expect(r.createdTracks.map((t) => t.layer)).toEqual([6_000_000, 7_000_000, 8_000_000]);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("refuses four past the top and changes nothing", async () => {
    const doc = fixtureDoc();
    const before = JSON.stringify(doc.project);
    const r = await run(doc, "add_clip_to_timeline_tool", { file_id: IDS.logo, track: "9", position_seconds: "0" });
    expect(r.summary).toMatch(/^Error: Unknown track or layer '9'/);
    expect(JSON.stringify(doc.project)).toBe(before);
    expect(doc.undoLabels).toEqual([]);
  });

  it("add_clips_to_timeline_tool places the sequence on the new track", async () => {
    const doc = fixtureDoc();
    const r = await run(doc, "add_clips_to_timeline_tool", { file_ids: `["${IDS.broll}", "${IDS.logo}"]`, track: "6", start_seconds: "0" });
    expect(r.summary).toMatch(/^Placed 2 clip\(s\) on track 6 on a new track from 0\.00 s/);
    expect((r.data as Record<string, unknown>).new_tracks).toBe(1);
    expect(r.createdTracks.map((t) => t.layer)).toEqual([6_000_000]);
    expect(doc.project.clips.filter((c) => c.layer === 6_000_000)).toHaveLength(2);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("import_stock_media_tool imports and places on the new track in one undo step", async () => {
    const doc = fixtureDoc();
    const r = await run(doc, "import_stock_media_tool", { local_path: "/clips/stock.mp4", track: "7", position_seconds: "1" });
    expect(r.summary).toContain("on a new track (2 tracks added on top)");
    expect(r.createdTracks.map((t) => t.layer)).toEqual([6_000_000, 7_000_000]);
    expect(doc.undoLabels).toHaveLength(1);
  });
});

describe("other placement tools on a track past the top", () => {
  it("generate_tts_and_add_to_timeline_tool adds the track in the same undo step as the audio", async () => {
    const doc = fixtureDoc();
    const r = await run(doc, "generate_tts_and_add_to_timeline_tool", { text: "Hi there", track: "6", position: "1" });
    expect(r.summary).toMatch(/^Added TTS audio to timeline at position 1\.0s on track 6000000 \(stack_from_bottom=6, z_from_bottom=5\) on a new track timeline_clip_id=\w+\.$/);
    expect(r.createdTracks.map((t) => t.layer)).toEqual([6_000_000]);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("add_timer_tool (a planOverlayTrack overlay) adds the tracks in between too", async () => {
    const doc = fixtureDoc();
    const r = await run(doc, "add_timer_tool", { mode: "count_up", duration_seconds: "3", track: "7" });
    expect(r.status).toBe("applied");
    expect(r.createdTracks.map((t) => t.layer)).toEqual([6_000_000, 7_000_000]);
    expect(doc.undoLabels).toHaveLength(1);
  });
});
