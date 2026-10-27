import { describe, expect, it } from "vitest";
import { classifyEnergy, matchTempo, parseTempoRange, rangeAround, splitTempoFromQuery, tempoDistance } from "./music.js";

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
