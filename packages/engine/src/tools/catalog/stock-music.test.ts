import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";

const SR = BEAT_SAMPLE_RATE;

/** A kick-and-hat groove at `bpm`, `seconds` long, at `gain` (quiet pads are 0.05). */
function groove(bpm: number, seconds = 16, gain = 0.9): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  let x = 11;
  const noise = () => {
    x = Math.imul(x, 1664525) + 1013904223;
    return ((x >>> 8) & 0xffff) / 32768 - 1;
  };
  const beat = 60 / bpm;
  const add = (at: number, g: number, decay: number, wave: (k: number) => number) => {
    const start = Math.round(at * SR);
    for (let k = 0; k < SR * 0.3 && start + k < out.length; k += 1) out[start + k] = out[start + k]! + g * Math.exp(-k / (decay * SR)) * wave(k);
  };
  for (let n = 0; n * beat < seconds; n += 1) {
    add(n * beat, (n % 4 === 0 ? 0.9 : 0.6) * gain, 0.08, (k) => Math.sin((2 * Math.PI * (50 + 80 * Math.exp(-k / (0.02 * SR))) * k) / SR));
    add(n * beat + beat / 2, 0.12 * gain, 0.01, noise);
  }
  return out;
}

const sound = (id: number, license = "http://creativecommons.org/publicdomain/zero/1.0/") => ({
  id,
  name: `loop ${id}`,
  duration: 90,
  username: `user${id}`,
  license,
  tags: ["loop"],
  previews: { hq_mp3: `https://cdn.freesound.test/${id}-hq.mp3` },
});

/** 8 s of a quiet 128 groove, then the full one: a drop at 8 s. */
function dropping(): Float32Array {
  const quiet = groove(128, 8, 0.02);
  const loud = groove(128, 16);
  const out = new Float32Array(quiet.length + loud.length);
  out.set(quiet);
  out.set(loud, quiet.length);
  return out;
}

/** Previews by id: 31 = 90 BPM, 32 = 128 BPM, 33 = 160 BPM, 34 = a quiet 128 pad, 35 = 128 with a drop at 8 s. */
const PREVIEWS: Record<string, Float32Array> = {
  "31": groove(90),
  "32": groove(128),
  "33": groove(160),
  "34": groove(128, 16, 0.02),
  "35": dropping(),
};

/** How many previews the host was asked to decode. */
let decoded = 0;

function musicHost(options: { decode?: boolean; urls?: boolean; refuse?: boolean; sounds?: unknown[]; onSearch?: (query: string) => void } = {}): FakeHost {
  const host = fakeHost({
    routes: {
      "/api/v1/freesound/search": (_body, path) => {
        const query = new URL(path, "http://x").searchParams.get("query") ?? "";
        options.onSearch?.(query);
        return { count: 4, sounds: options.sounds ?? [sound(31), sound(32), sound(33), sound(34, "http://creativecommons.org/licenses/by/4.0/")] };
      },
    },
  });
  decoded = 0;
  host.audio = {
    analyzeAudio: async () => ({ sampleRate: 16000, frameSize: 480, rms: new Float32Array(0) }),
    ...(options.urls === false ? {} : { decodesUrls: true }),
    ...(options.decode === false
      ? {}
      : {
          decodePcm: async (url: string) => {
            decoded += 1;
            if (options.refuse) throw new Error("not media in this project");
            const samples = PREVIEWS[/\/(\d+)-hq/.exec(url)![1]!]!;
            return { sampleRate: SR, samples };
          },
        }),
  };
  return host;
}

interface Row {
  sound_id: number;
  bpm?: number | null;
  bpm_match?: string;
  bpm_also?: number[];
  energy?: string;
  loudness_db?: number;
}
type Data = { query: string; bpm_range?: [number, number]; measured: number; results: Row[]; nearest?: Row[] };

const search = async (args: Record<string, unknown>, host = musicHost()) => {
  const result = await runTool({ doc: new ProjectDocument(createProject({ id: "MUSICPROJ1" })), host }, "search_freesound_music_tool", args);
  return { result, data: (result.data as { data: Data }).data, warnings: (result.data as { warnings?: string[] }).warnings ?? [] };
};

describe("search_freesound_music_tool by tempo", () => {
  it("does not download or measure anything for a plain search", async () => {
    const host = musicHost();
    const { result, data } = await search({ query: "loop", count: 4 }, host);
    expect(result.ok, result.text).toBe(true);
    expect(decoded).toBe(0);
    expect(data.results).toHaveLength(4);
    expect(data.results[0]).not.toHaveProperty("bpm");
    expect(host.backendCalls[0]?.path).toBe("/api/v1/freesound/search?query=loop&page_size=8");
  });

  it("does not try to measure on a host that cannot decode URLs (Zenvi Cloud)", async () => {
    const { data, warnings } = await search({ query: "loop", bpm: 128 }, musicHost({ urls: false }));
    expect(decoded).toBe(0);
    expect(data.results).toHaveLength(4);
    expect(warnings.join(" ")).toMatch(/not applied/);
  });

  it("measures the results when a tempo is asked for: bpm, loudness and energy", async () => {
    const { result, data } = await search({ query: "loop", count: 4, bpm_range: "60-200" });
    expect(result.ok, result.text).toBe(true);
    const byId = new Map(data.results.map((r) => [r.sound_id, r]));
    expect(Math.abs(byId.get(32)!.bpm! - 128)).toBeLessThan(3);
    expect(byId.get(32)!.energy).toBe("high");
    expect(byId.get(34)!.energy).toBe("low");
    expect(byId.get(34)!.loudness_db!).toBeLessThan(byId.get(32)!.loudness_db! - 20);
    expect(result.text).toMatch(/id=32 .*bpm=12\d(\.\d)? .*energy=high .*loudness=-\d+(\.\d)?dB/);
  });

  it("keeps a tempo out of the search text and filters by the measured tempo instead", async () => {
    const queries: string[] = [];
    const { data, warnings } = await search({ query: "synthwave 128 bpm" }, musicHost({ onSearch: (q) => queries.push(q) }));
    expect(queries).toEqual(["synthwave"]);
    expect(data.bpm_range![0]).toBeLessThan(128);
    expect(data.bpm_range![1]).toBeGreaterThan(128);
    expect(data.results.map((r) => r.sound_id).sort()).toEqual([32, 34]);
    expect(warnings.join(" ")).toMatch(/Moved the tempo out of the query/);
  });

  it("takes bpm_range as a pair or 'lo-hi', and a half or double reading counts", async () => {
    const pair = await search({ query: "hype", bpm_range: [150, 170] });
    expect(pair.data.results.map((r) => r.sound_id)).toEqual([33]);
    const text = await search({ query: "hype", bpm_range: "150-170" });
    expect(text.data.results.map((r) => r.sound_id)).toEqual([33]);
    // The groove reads as 80 or 160: either way the 160 reading is there.
    const row = pair.data.results[0]!;
    expect(row.bpm_match ? row.bpm_also : [row.bpm]).toContainEqual(expect.closeTo(160, -1));
  });

  it("refuses a tempo range it cannot read, without searching", async () => {
    const host = musicHost();
    const { result } = await search({ query: "loop", bpm_range: "fast" }, host);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Error: bpm_range must be two tempos");
    expect(host.backendCalls).toHaveLength(0);
  });

  it("filters by energy", async () => {
    const { data } = await search({ query: "loop", energy: "low" });
    expect(data.results.map((r) => r.sound_id)).toEqual([34]);
  });

  it("names the nearest tracks when none fits", async () => {
    const { result, data } = await search({ query: "loop", bpm: 200 });
    expect(data.results).toEqual([]);
    expect(data.nearest!.length).toBeGreaterThan(0);
    expect(result.text).toContain("No Freesound tracks for 'loop' at 190-210 BPM among the 4 measured.");
    expect(result.text).toContain("Nearest by tempo:");
  });

  it("searches without the mood when the mood leaves nothing", async () => {
    const queries: string[] = [];
    const { data, warnings } = await search({ query: "loop", mood: "dark" }, musicHost({ onSearch: (q) => queries.push(q), sounds: [] }));
    expect(queries).toEqual(["loop dark", "loop"]);
    expect(data.results).toEqual([]);
    expect(warnings.join(" ")).toMatch(/Nothing matched with the mood 'dark'/);
  });

  it("says so, and does not filter, where previews cannot be measured", async () => {
    for (const host of [musicHost({ decode: false }), musicHost({ refuse: true })]) {
      const { result, data, warnings } = await search({ query: "loop bpm 128" }, host);
      expect(result.ok, result.text).toBe(true);
      expect(data.results).toHaveLength(4);
      expect(warnings.join(" ")).toMatch(/not applied|filters are not applied/);
      expect(data.results[0]).not.toHaveProperty("bpm");
    }
  });
});

describe("search_freesound_music_tool licences", () => {
  const sounds = () => [sound(31), sound(32, "http://creativecommons.org/licenses/by-nc/4.0/"), sound(33, "http://creativecommons.org/licenses/by/4.0/")];
  it("keeps only commercial-use licences by default, CC0 only with licence=cc0, everything with licence=any", async () => {
    const plain = await search({ query: "loop" }, musicHost({ sounds: sounds() }));
    expect(plain.data.results.map((r) => r.sound_id)).toEqual([31, 33]);
    expect(plain.warnings.join(" ")).toMatch(/1 of 3 results dropped: not licensed for commercial use/);
    const cc0 = await search({ query: "loop", licence: "cc0" }, musicHost({ sounds: sounds() }));
    expect(cc0.data.results.map((r) => r.sound_id)).toEqual([31]);
    const any = await search({ query: "loop", licence: "any" }, musicHost({ sounds: sounds() }));
    expect(any.data.results.map((r) => r.sound_id)).toEqual([31, 33, 32]);
  });

  it("measures a music-bed search without filters, and keeps the track whose energy curve drops, saying where", async () => {
    const bed = await search({ query: "loop", count: 4, min_seconds: 30 });
    expect(bed.data.measured).toBeGreaterThan(0);
    expect(bed.data.results[0]).toHaveProperty("energy_curve", "steady");
    const sounds = [sound(32), sound(35)];
    const { result, data } = await search({ query: "loop", energy_curve: "drop" }, musicHost({ sounds }));
    expect(data.results.map((r) => r.sound_id)).toEqual([35]);
    expect((data.results[0] as { drop_seconds?: number }).drop_seconds).toBeGreaterThanOrEqual(7);
    expect((data.results[0] as { drop_seconds?: number }).drop_seconds).toBeLessThanOrEqual(9);
    expect(result.text).toMatch(/id=35 .*curve=drop \(drop at [789]s\)/);
  });
});
