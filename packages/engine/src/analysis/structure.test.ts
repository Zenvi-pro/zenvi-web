import { describe, expect, it } from "vitest";
import { detectStructure } from "./structure.js";
import { synthSong, type SongPart } from "./testing.js";

const C = [60, 64, 67];
const AM = [57, 60, 64];
const F = [53, 57, 60, 65];
const G = [55, 59, 62];

const intro: SongPart = { bars: 8, chord: C, chordGain: 0.03 };
const verse: SongPart = { bars: 8, chord: AM, kick: true, hats: true, chordGain: 0.04 };
const chorus: SongPart = { bars: 8, chord: F, kick: true, snare: true, hats: true, bass: true, chordGain: 0.09 };
const outro: SongPart = { bars: 4, chord: C, chordGain: 0.025 };

describe("detectStructure", () => {
  it("finds a pop song's sections on its bar lines and labels the repeating loud part the chorus", () => {
    const song = synthSong([intro, verse, chorus, verse, chorus, outro]);
    const found = detectStructure(song.pcm, song.sampleRate);
    expect(found.bpm).toBeGreaterThan(118);
    expect(found.bpm).toBeLessThan(122);
    expect(found.barSeconds).toBeCloseTo(2, 1);
    expect(found.sections.map((s) => s.label)).toEqual(["intro", "verse", "chorus", "verse", "chorus", "outro"]);
    found.sections.forEach((s, i) => expect(Math.abs(s.start - song.starts[i]!)).toBeLessThan(0.15));
    // The two verses and the two choruses are the same parts of the song.
    const groups = found.sections.map((s) => s.group);
    expect(groups[1]).toBe(groups[3]);
    expect(groups[2]).toBe(groups[4]);
    expect(groups[1]).not.toBe(groups[2]);
    expect(found.sections[2]!.levelDb).toBeGreaterThan(found.sections[1]!.levelDb);
    // Phrases every four bars from each section start.
    expect(found.phrases.length).toBeGreaterThanOrEqual(10);
    expect(found.phrases).toContain(found.sections[2]!.start);
  });

  it("calls a bass slam after a riser the drop, and the riser the build", () => {
    const song = synthSong([
      { bars: 8, chord: G, kick: true, hats: true, chordGain: 0.04 },
      { bars: 8, chord: G, riser: true, chordGain: 0.03 },
      { bars: 8, chord: F, kick: true, snare: true, hats: true, bass: true, chordGain: 0.08 },
    ]);
    const found = detectStructure(song.pcm, song.sampleRate);
    expect(found.sections.map((s) => s.label)).toEqual(["verse", "build", "drop"]);
    expect(found.drops).toHaveLength(1);
    expect(Math.abs(found.drops[0]!.timeSec - song.starts[2]!)).toBeLessThan(0.15);
    expect(found.drops[0]!.strength).toBeGreaterThan(0.4);
  });

  it("finds the stop in a section as a dip", () => {
    const song = synthSong([verse, chorus]);
    // Two beats of silence inside the chorus: a stop.
    const at = Math.round((song.starts[1]! + 6) * song.sampleRate);
    song.pcm.fill(0, at, at + song.sampleRate);
    const found = detectStructure(song.pcm, song.sampleRate);
    expect(found.dips.some((d) => d.start < song.starts[1]! + 6.2 && d.end > song.starts[1]! + 6.8)).toBe(true);
  });

  it("gives silence no sections", () => {
    const found = detectStructure(new Float32Array(22050 * 3), 22050);
    expect(found.sections.length).toBeLessThanOrEqual(1);
    expect(found.drops).toEqual([]);
  });
});
