import { describe, expect, it } from "vitest";
import { synthSong } from "../../analysis/testing.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "../test-support/fixture.js";

const C = [60, 64, 67];
const AM = [57, 60, 64];
const F = [53, 57, 60, 65];
const SONG = synthSong([
  { bars: 8, chord: C, chordGain: 0.03 },
  { bars: 8, chord: AM, kick: true, hats: true, chordGain: 0.04 },
  { bars: 8, chord: F, kick: true, snare: true, hats: true, bass: true, chordGain: 0.09 },
  { bars: 8, chord: AM, kick: true, hats: true, chordGain: 0.04 },
]);

function hostWithSong(): FakeHost {
  const host = fakeHost();
  host.audio!.decodePcm = async () => ({ sampleRate: SONG.sampleRate, samples: SONG.pcm });
  return host;
}

interface Data {
  clock: string;
  sections: { label: string; group: string; start: number; end: number }[];
  markerIds?: string[];
}

async function run(doc: ReturnType<typeof fixtureDoc>, args: Record<string, unknown>, host = hostWithSong()) {
  const result = await runTool({ doc, host }, "detect_music_structure_tool", args);
  const receipt = result.data as ToolReceipt;
  return { receipt, data: receipt.data as unknown as Data };
}

describe("detect_music_structure_tool", () => {
  it("reads a file's form on the file clock without touching the project", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const { receipt, data } = await run(doc, { file_id: IDS.music });
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(0);
    expect(data.clock).toBe("file");
    expect(data.sections.map((s) => s.label)).toEqual(["intro", "verse", "chorus", "verse"]);
    expect(receipt.summary).toMatch(/^4 section\(s\) in .*: intro A 0\.0, verse B 16\.0, chorus C 32\.0, verse B 48\.0; 120\.\d BPM/);
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("marks the section starts the music clip plays, once: one undo step, a rerun changes nothing", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    // The fixture's music clip plays 0-19 s of the file from timeline 0: the intro and the verse.
    const { receipt, data } = await run(doc, { clip_id: IDS.clipMusic, add_markers: "true" });
    expect(receipt.undoSteps).toBe(1);
    expect(data.sections.map((s) => [s.label, s.start, s.end])).toEqual([["intro", 0, 15.999], ["verse", 15.999, 19]]);
    expect(data.markerIds).toHaveLength(2);
    const added = doc.project.markers.filter((m) => data.markerIds!.includes(m.id));
    expect(added.map((m) => [m.label, m.vector])).toEqual([["intro A", "white"], ["verse B", "blue"]]);
    const again = await run(doc, { clip_id: IDS.clipMusic, add_markers: "true" });
    expect(again.receipt.status).toBe("unchanged");
    doc.undo();
    expect(snapshotOf(doc.project)).toEqual(before);
  });
});
