import { describe, expect, it } from "vitest";
import { classifyEnergy, energyCurve, matchTempo, musicSearchFromText, parseTempoRange, rangeAround, splitTempoFromQuery, tempoDistance } from "./music.js";

describe("splitTempoFromQuery", () => {
  it("takes the tempo out of the words and keeps the rest", () => {
    expect(splitTempoFromQuery("hype trap beat 160 bpm")).toEqual({ query: "hype trap beat", range: rangeAround(160) });
    expect(splitTempoFromQuery("128BPM house")).toEqual({ query: "house", range: rangeAround(128) });
    expect(splitTempoFromQuery("lofi, bpm: 85, chill")).toEqual({ query: "lofi, chill", range: rangeAround(85) });
    expect(splitTempoFromQuery("tempo 90 hip hop")).toEqual({ query: "hip hop", range: rangeAround(90) });
  });

  it("reads a range", () => {
    expect(splitTempoFromQuery("upbeat pop 120-130 bpm")).toEqual({ query: "upbeat pop", range: [120, 130] });
    expect(splitTempoFromQuery("edm 140 to 150 BPM drop")).toEqual({ query: "edm drop", range: [140, 150] });
  });

  it("leaves numbers that are not tempos alone", () => {
    expect(splitTempoFromQuery("80s synthwave")).toEqual({ query: "80s synthwave" });
    expect(splitTempoFromQuery("track 5")).toEqual({ query: "track 5" });
  });

  it("never returns an empty query", () => {
    expect(splitTempoFromQuery("120 bpm")).toEqual({ query: "music", range: rangeAround(120) });
  });
});

describe("parseTempoRange", () => {
  it("takes a pair or 'lo-hi' in either order", () => {
    expect(parseTempoRange([120, 140])).toEqual([120, 140]);
    expect(parseTempoRange("150–130")).toEqual([130, 150]);
    expect(parseTempoRange("fast")).toBeNull();
  });

  it("reads the string forms agents send: quoted twice, bracketed, in words", () => {
    // Bench round 3 (product3d): bpm_range "\"130-150\"" was refused.
    expect(parseTempoRange('"130-150"')).toEqual([130, 150]);
    expect(parseTempoRange("[120, 130]")).toEqual([120, 130]);
    expect(parseTempoRange("120 to 130 bpm")).toEqual([120, 130]);
    expect(parseTempoRange("120")).toBeNull();
    expect(parseTempoRange("120-130-140")).toBeNull();
  });
});

describe("matchTempo", () => {
  const range: [number, number] = [150, 170];
  it("matches the tempo and its double or half reading", () => {
    expect(matchTempo({ bpm: 160, alternatives: [] }, range)).toBe("exact");
    expect(matchTempo({ bpm: 80, alternatives: [{ bpm: 160, support: 0.9 }] }, range)).toBe("double-time");
    expect(matchTempo({ bpm: 320 / 1.0, alternatives: [{ bpm: 160, support: 0.9 }] }, range)).toBe("half-time");
    expect(matchTempo({ bpm: 80, alternatives: [{ bpm: 160, support: 0.4 }] }, range)).toBeNull();
    expect(matchTempo({ bpm: 120, alternatives: [{ bpm: 60, support: 1 }] }, range)).toBeNull();
  });

  it("measures how far off a track is", () => {
    expect(tempoDistance({ bpm: 160, alternatives: [] }, range)).toBe(0);
    expect(tempoDistance({ bpm: 120, alternatives: [{ bpm: 60, support: 1 }] }, range)).toBe(30);
    expect(tempoDistance({ bpm: 80, alternatives: [{ bpm: 160, support: 1 }] }, range)).toBe(0);
  });
});

describe("classifyEnergy", () => {
  it("is low for a quiet pad, high for a loud driving loop", () => {
    expect(classifyEnergy(-34, 0.09)).toBe("low");
    expect(classifyEnergy(-16, 0.2)).toBe("medium");
    expect(classifyEnergy(-8, 0.38)).toBe("high");
  });
});

describe("energyCurve", () => {
  const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
  it("calls a quiet intro and a lift that holds a drop, with where it lands", () => {
    const curve = energyCurve([...flat(10, -32), ...flat(20, -14)]);
    expect(curve.shape).toBe("drop");
    expect(curve.dropSeconds).toBe(10);
    expect(curve.levels).toHaveLength(8);
  });
  it("tells a build, a fade and a steady track apart", () => {
    expect(energyCurve(Array.from({ length: 30 }, (_, i) => -30 + i * 0.5)).shape).toBe("build");
    expect(energyCurve(Array.from({ length: 30 }, (_, i) => -12 - i * 0.5)).shape).toBe("fade");
    expect(energyCurve(flat(30, -14).map((v, i) => v + (i % 2))).shape).toBe("steady");
    expect(energyCurve([-20, -10]).shape).toBe("steady");
  });
  it("is not fooled by one loud hit in a quiet track", () => {
    expect(energyCurve([...flat(12, -30), ...flat(3, -10), ...flat(12, -30)]).shape).not.toBe("drop");
  });
});

describe("musicSearchFromText", () => {
  it("turns a brief's music line into measured filters and a genre query", () => {
    expect(musicSearchFromText("Dark synthwave, 128 bpm, high energy, builds to a drop at 9 s", 15)).toEqual({
      query: "Dark synthwave",
      bpm_range: [122, 134],
      energy: "high",
      energy_curve: "drop",
      min_seconds: 15,
    });
    expect(musicSearchFromText("soft acoustic guitar", 6)).toEqual({ query: "acoustic guitar", energy: "low", min_seconds: 10 });
    // A "Music:" label is not the genre, and the range stays inside the search's 40-300 BPM.
    expect(musicSearchFromText("Music: dark trap, 290 bpm", 15)).toMatchObject({ query: "dark trap", bpm_range: [276, 300] });
  });
});
