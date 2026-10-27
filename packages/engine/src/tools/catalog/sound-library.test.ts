import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { Rng } from "../../sfx/dsp.js";
import { readSoundKit } from "../../sfx/kit.js";
import { isSfxClip } from "../../sfx/moments.js";
import { runTool } from "../registry.js";
import { fetchLibraryHost, type LibraryFetch } from "../sfx-library.js";
import { OPENVERSE_FIXTURES, fakeHost, type FakeHost, type FakeHostOptions } from "../test-support/fake-host.js";
import { media, videoInfo } from "../test-support/fixture.js";

const WHOOSH_ID = String(OPENVERSE_FIXTURES[0]!.id);
const HIT_ID = String(OPENVERSE_FIXTURES[1]!.id);
const NC_ID = String(OPENVERSE_FIXTURES[2]!.id);

/** 0.25 s of silence, a 0.8 s noise swell, 0.5 s of silence: stereo, 44.1 kHz. */
function swell(): { sampleRate: number; samples: Float32Array; right: Float32Array } {
  const sr = 44100;
  const rng = new Rng(3);
  const left = new Float32Array(Math.round(1.55 * sr));
  const right = new Float32Array(left.length);
  for (let i = 0; i < 0.8 * sr; i += 1) {
    const env = Math.sin((Math.PI * i) / (0.8 * sr)) ** 2 * 0.2;
    left[Math.round(0.25 * sr) + i] = rng.bipolar() * env;
    right[Math.round(0.25 * sr) + i] = rng.bipolar() * env;
  }
  return { sampleRate: sr, samples: left, right };
}

/** A fake host that downloads and decodes library sounds. */
function libraryHost(options: FakeHostOptions = {}): FakeHost {
  const host = fakeHost(options);
  host.audio!.decodePcm = async (path, o) => {
    host.calls.push(`decodePcm ${path} ${o?.channels ?? 1}`);
    return swell();
  };
  return host;
}

/** 8 s: four shots of 2 s (cuts at 2, 4 and 6 s), no music. */
function edit(): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "LIBPROJ001" }));
  scratch.transaction("fixture", (tx) => {
    for (const name of ["aa", "bb", "cc", "dd"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 30)), { id: `SHOT${name.toUpperCase()}XXXX` });
    const top = tx.project.layers.map((l) => l.number).sort((a, b) => b - a)[0]!;
    ["AA", "BB", "CC", "DD"].forEach((name, i) => addClip(tx, { fileId: `SHOT${name}XXXX`, position: i * 2, layer: top, start: 1, end: 3, id: `CUT${String(i).padStart(7, "0")}` }));
  });
  const project: Project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return new ProjectDocument(project);
}

function data<T>(result: { data?: unknown }): T {
  return (result.data as { data: T }).data;
}

function summary(result: { data?: unknown }): string {
  return (result.data as { summary: string }).summary;
}

const sfxClips = (doc: ProjectDocument): Clip[] => doc.project.clips.filter(isSfxClip);
const credited = (doc: ProjectDocument): ProjectFile[] => doc.project.files.filter((f) => f.zenvi_credit);

describe("search_sfx_tool", () => {
  it("lists the recipes that fit, then Openverse's commercial-use results, never a non-commercial one unasked", async () => {
    const host = fakeHost();
    const result = await runTool({ doc: edit(), host }, "search_sfx_tool", { query: "whoosh" });
    const results = data<{ results: { provider: string; id: string; license: string }[] }>(result).results;
    expect(results[0]!.provider).toBe("procedural");
    expect(results.filter((r) => r.provider === "openverse").map((r) => r.id)).toEqual([WHOOSH_ID, HIT_ID]);
    expect(summary(result)).toMatch(/Add one with add_sfx_tool provider=<provider> sound_id=<id>/);
    const asked = await runTool({ doc: edit(), host }, "search_sfx_tool", { query: "riser", provider: "openverse", license: "any", include_noncommercial: true });
    expect(data<{ results: { id: string }[] }>(asked).results.map((r) => r.id)).toContain(NC_ID);
    expect(host.calls.at(-1)).toMatch(/license=cc0%2Cpdm%2Cby%2Cby-sa%2Cby-nd%2Csampling%2B%2Cby-nc%2Cby-nc-sa%2Cby-nc-nd%2Cnc-sampling%2B/);
  });

  it("filters by length and licence, and refuses impossible filters", async () => {
    const doc = edit();
    const cc0 = await runTool({ doc, host: fakeHost() }, "search_sfx_tool", { query: "hit", provider: "openverse", license: "cc0" });
    expect(data<{ results: { license: string }[] }>(cc0).results.map((r) => r.license)).toEqual(["cc0"]);
    const short = await runTool({ doc, host: fakeHost() }, "search_sfx_tool", { query: "hit", provider: "openverse", max_seconds: "1" });
    expect(data<{ results: { id: string }[] }>(short).results.map((r) => r.id)).toEqual([HIT_ID]);
    expect(summary(await runTool({ doc, host: fakeHost() }, "search_sfx_tool", { query: "hit", min_seconds: 5, max_seconds: 1 }))).toBe("Error: min_seconds is more than max_seconds.");
    expect(summary(await runTool({ doc, host: fakeHost() }, "search_sfx_tool", { query: "hit", include_noncommercial: true }))).toBe("Error: include_noncommercial goes with license=any.");
  });

  it("leaves room for a library result in auto however small count is", async () => {
    const result = await runTool({ doc: edit(), host: fakeHost() }, "search_sfx_tool", { query: "whoosh", count: 3 });
    const results = data<{ results: { provider: string }[] }>(result).results;
    expect(results).toHaveLength(3);
    expect(results.at(-1)!.provider).toBe("openverse");
  });

  it("falls back to Freesound through the backend when Openverse cannot answer", async () => {
    const host = fakeHost({
      library: {
        "https://api.openverse.org/v1/audio/?": () => {
          throw new Error("Openverse's rate limit is reached (20 searches a minute, 200 a day without a key).");
        },
      },
      routes: { "/api/v1/freesound/search": () => ({ sounds: [{ id: 9, name: "Snap click", duration: 0.2, username: "bo", license: "http://creativecommons.org/publicdomain/zero/1.0/", previews: { hq_mp3: "https://cdn.freesound.org/9-hq.mp3" } }] }) },
    });
    const result = await runTool({ doc: edit(), host }, "search_sfx_tool", { query: "click", provider: "auto" });
    const found = data<{ results: { provider: string }[]; notes: string[] }>(result);
    expect(found.results.map((r) => r.provider)).toContain("freesound");
    expect(found.notes[0]).toMatch(/^Openverse: Openverse's rate limit is reached .* Searched Freesound instead\.$/);
  });
});

describe("fetchLibraryHost", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

  it("reaches only the libraries, sends the token, and says what a rate limit is", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetch: LibraryFetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return url.includes("slow") ? { ok: false, status: 429, headers: { get: (n: string) => (n === "retry-after" ? "42" : null) }, json: async () => ({}) } : ok({ results: [] });
    };
    const host = fetchLibraryHost({ fetch, openverseToken: "tok" });
    await expect(host.getJson("https://api.openverse.org/v1/audio/?q=a")).resolves.toEqual({ results: [] });
    expect(seen[0]!.headers.authorization).toBe("Bearer tok");
    await expect(host.getJson("https://api.openverse.org.evil.test/v1/")).rejects.toThrow(/is not a sound library/);
    await expect(host.getJson("http://169.254.169.254/latest")).rejects.toThrow(/is not a sound library/);
    await expect(host.getJson("https://api.openverse.org/v1/audio/?q=slow")).rejects.toThrow(/rate limit is reached .*; try again in 42 s\./);
    expect(seen).toHaveLength(2);
  });
});

describe("add_sfx_tool with a library sound", () => {
  it("looks it up, downloads, trims and levels it, records its credit, and places it in one undo step", async () => {
    const doc = edit();
    const host = libraryHost();
    const result = await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 4 });
    expect(summary(result)).toMatch(/^Added 'Glass impact hit' with its transient on 4\.00 s \(-8 dB\)\. CC BY 4\.0: credit it \(list_credits_tool\)\.$/);
    expect(host.calls).toContain(`library https://api.openverse.org/v1/audio/${HIT_ID}/`);
    expect(host.calls.some((c) => c.startsWith("importUrl https://cdn.freesound.test/"))).toBe(true);
    expect(host.calls.some((c) => /^decodePcm \S+ 2$/.test(c))).toBe(true);
    const [clip] = sfxClips(doc);
    expect(clip!.title).toBe("Glass impact hit");
    expect(clip!.zenvi_sfx).toMatchObject({ recipe: "impact_punch", auto: false, library: `openverse:${HIT_ID}` });
    const [file] = credited(doc);
    expect(file!.zenvi_credit).toMatchObject({ provider: "openverse", id: HIT_ID, license: "by", license_name: "CC BY 4.0", attribution_required: true });
    // The swell's silence is trimmed: 0.25 s ahead of it, most of the 0.5 s after.
    expect(data<{ trimmed_silence_seconds: number }>(result).trimmed_silence_seconds).toBeGreaterThan(0.6);
    // Its transient (padded to a frame) lands on the moment.
    expect(clip!.position + (file!.zenvi_sfx as { hit: number }).hit - clip!.start).toBeCloseTo(4, 3);
    expect(doc.undoLabels).toEqual(["Add sound 'Glass impact hit'"]);

    // The same sound again reuses the file: nothing downloaded twice.
    const before = host.calls.filter((c) => c.startsWith("importUrl")).length;
    expect(data<{ cached: boolean }>(await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 6 })).cached).toBe(true);
    expect(host.calls.filter((c) => c.startsWith("importUrl")).length).toBe(before);
    expect(credited(doc)).toHaveLength(1);
    doc.undo(2);
    expect(doc.project.files.some((f) => f.zenvi_credit)).toBe(false);
  });

  it("plays a whoosh with its peak on the moment and takes the role it is given", async () => {
    const doc = edit();
    const result = await runTool({ doc, host: libraryHost() }, "add_sfx_tool", { provider: "openverse", sound_id: WHOOSH_ID, clip_id: "CUT0000002" });
    expect(summary(result)).toMatch(/^Added 'Deep Whoosh #1' with its peak on the start of cc\.mp4 \(-?\d+ dB\)\. CC0 1\.0, no credit needed\.$/);
    expect(data<{ role: string; recipe: string }>(result)).toMatchObject({ role: "whoosh", recipe: "whoosh_medium" });
    const asRiser = await runTool({ doc, host: libraryHost() }, "add_sfx_tool", { provider: "openverse", sound_id: WHOOSH_ID, at_seconds: 6, role: "riser" });
    expect(summary(asRiser)).toMatch(/with its end on 6\.00 s/);
  });

  it("refuses a non-commercial licence unless allowed, and arguments that do not fit the sound", async () => {
    const doc = edit();
    const host = libraryHost();
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: NC_ID, at_seconds: 4 }))).toMatch(
      /^Error: 'Tension riser' is CC BY-NC 4\.0: not for commercial use\. .*allow_noncommercial=true/,
    );
    expect((await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: NC_ID, at_seconds: 4, allow_noncommercial: true })).ok).toBe(true);
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 4, pitch: 2 }))).toMatch(/^Error: pitch shape procedural recipes/);
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { recipe: "pop", at_seconds: 4, role: "hit" }))).toBe("Error: role goes with a library sound, not a recipe.");
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { recipe: "pop", provider: "openverse", sound_id: HIT_ID, at_seconds: 4 }))).toMatch(/^Error: give recipe, or provider and sound_id/);
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: "not-a-uuid", at_seconds: 4 }))).toMatch(/is not an Openverse id/);
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: "9f8e7d6c-0000-4000-8000-00000000dead", at_seconds: 4 }))).toMatch(/^Error: could not look up Openverse sound .*404/);
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 9 }))).toMatch(/after the end of the picture/);
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("finds a Freesound sound again by its title, its licence from Freesound", async () => {
    const doc = edit();
    const host = libraryHost({
      routes: { "/api/v1/freesound/search": () => ({ sounds: [{ id: 51, name: "Thump", duration: 0.5, username: "cy", license: "http://creativecommons.org/licenses/by/4.0/", previews: { hq_mp3: "https://cdn.freesound.org/previews/0/51_1-hq.mp3" } }] }) },
    });
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { provider: "freesound", sound_id: "51", at_seconds: 2 }))).toMatch(/pass title/);
    const result = await runTool({ doc, host }, "add_sfx_tool", { provider: "freesound", sound_id: "51", title: "Thump", at_seconds: 2 });
    expect(result.ok).toBe(true);
    expect(credited(doc)[0]!.zenvi_credit).toMatchObject({ provider: "freesound", id: "51", license: "by", landing_url: "https://freesound.org/s/51/" });
    expect(summary(await runTool({ doc, host }, "add_sfx_tool", { provider: "freesound", sound_id: "52", title: "Thump", at_seconds: 2 }))).toMatch(/^Error: Freesound sound 52 was not found/);
  });

  it("is refused where library sounds cannot be downloaded and decoded", async () => {
    const result = await runTool({ doc: edit(), host: fakeHost({ omit: ["media.importUrl"] }) }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 2 });
    expect(summary(result)).toMatch(/^Error: library sounds are not available in this Zenvi surface/);
  });
});

describe("list_credits_tool", () => {
  it("lists the credit lines the timeline's library sounds need, required ones first, once per sound", async () => {
    const doc = edit();
    const host = libraryHost();
    await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: WHOOSH_ID, at_seconds: 2 });
    await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 4 });
    await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 6 });
    const result = await runTool({ doc, host }, "list_credits_tool", {});
    expect(summary(result)).toMatch(/^1 sound needs credit .*:\n {2}"Glass impact hit" by maker .* is licensed under CC BY 4\.0\..*\n1 public-domain sound \(credit optional\):\n {2}"Deep Whoosh #1"/);
    const found = data<{ required: number; lines: string[]; credits: { clip_ids: string[] }[] }>(result);
    expect(found.required).toBe(1);
    expect(found.credits[0]!.clip_ids).toHaveLength(2);
    expect(doc.undoLabels).toHaveLength(3);
  });

  it("credits a sound once when it plays in two roles (two files)", async () => {
    const doc = edit();
    const host = libraryHost();
    await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 4 });
    await runTool({ doc, host }, "add_sfx_tool", { provider: "openverse", sound_id: HIT_ID, at_seconds: 6, role: "boom" });
    expect(credited(doc)).toHaveLength(2);
    const found = data<{ required: number; lines: string[]; credits: { file_ids: string[]; clip_ids: string[] }[] }>(await runTool({ doc, host }, "list_credits_tool", {}));
    expect(found.lines).toHaveLength(1);
    expect(found.credits[0]!.file_ids).toHaveLength(2);
    expect(found.credits[0]!.clip_ids).toHaveLength(2);
  });
});

describe("create_sound_kit_tool", () => {
  it("stores a library kit: sounds downloaded once into the bin with their credits, one undo step", async () => {
    const doc = edit();
    const host = libraryHost();
    const result = await runTool({ doc, host }, "create_sound_kit_tool", { name: "Glass", source: "mixed", variants: 1 });
    expect(result.ok).toBe(true);
    const kit = readSoundKit(doc.project)!;
    expect(kit).toMatchObject({ name: "Glass", source: "mixed" });
    // The fake library's whoosh fits the whoosh role; synthesised roles stay procedural.
    expect(kit.slots.whoosh).toMatchObject({ source: "library", sounds: [{ provider: "openverse", id: WHOOSH_ID }] });
    expect(kit.slots.click?.source).toBe("procedural");
    // The only riser the library has is non-commercial; its impacts are not risers: the riser is synthesised.
    expect(kit.slots.riser?.source).toBe("procedural");
    expect((result.data as { warnings: string[] }).warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^No usable library riser for 'riser' \(\d found, 0 named like one\): it is synthesised\.$/)]));
    const fileIds = data<{ file_ids: string[] }>(result).file_ids;
    expect(fileIds.length).toBeGreaterThan(0);
    for (const id of fileIds) expect(doc.project.files.find((f) => f.id === id)?.zenvi_credit).toBeTruthy();
    expect(doc.undoLabels).toEqual(["Create sound kit 'Glass'"]);
    doc.undo();
    expect(readSoundKit(doc.project)).toBeNull();
    expect(doc.project.files.some((f) => f.zenvi_credit)).toBe(false);
  });

  it("says nothing changed when the same procedural kit is made again", async () => {
    const doc = edit();
    expect((await runTool({ doc, host: fakeHost() }, "create_sound_kit_tool", { tone: "bright", seed: 4 })).ok).toBe(true);
    const again = await runTool({ doc, host: fakeHost() }, "create_sound_kit_tool", { tone: "bright", seed: 4 });
    expect((again.data as { status: string }).status).toBe("unchanged");
    expect(doc.undoLabels).toHaveLength(1);
  });

  it("refuses a library kit where nothing can be searched or downloaded", async () => {
    const result = await runTool({ doc: edit(), host: fakeHost({ without: ["library", "backend"] }) }, "create_sound_kit_tool", { source: "library" });
    expect(summary(result)).toMatch(/^Error: source=library is not available in this Zenvi surface/);
  });
});

describe("auto_sound_design_tool with a kit", () => {
  it("plays every cue through the project's kit by default, so the whooshes are one family", async () => {
    const doc = edit();
    const host = libraryHost();
    await runTool({ doc, host }, "create_sound_kit_tool", { name: "Dark", tone: "dark", seed: 5 });
    const kit = readSoundKit(doc.project)!;
    const result = await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "hype" });
    expect(summary(result)).toMatch(/^Sound-designed the edit as .* \(\w+, read from the edit; hype, sound kit 'Dark'\)/);
    const cues = data<{ sources: string; cues: { recipe: string }[] }>(result);
    expect(cues.sources).toBe("kit");
    const allowed = new Set(Object.values(kit.slots).map((e) => (e?.source === "procedural" ? e.recipe : "")));
    for (const cue of cues.cues) if (!["swoosh_hit", "sparkle", "typing_burst", "camera_shutter", "keyboard_key"].includes(cue.recipe)) expect(allowed.has(cue.recipe)).toBe(true);

    const procedural = await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "hype", sources: "procedural" });
    expect(data<{ kit: unknown }>(procedural).kit).toBeNull();
  });

  it("keeps the kit's library sounds in the bin across reruns and plays them", async () => {
    const doc = edit();
    const host = libraryHost();
    await runTool({ doc, host }, "create_sound_kit_tool", { source: "mixed", variants: 1 });
    const kitFiles = data<{ file_ids: string[] }>(await runTool({ doc, host }, "create_sound_kit_tool", { source: "mixed", variants: 1, name: "Again" })).file_ids;
    const first = await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "hype" });
    expect(data<{ cues: { library?: string }[] }>(first).cues.some((c) => c.library?.startsWith("openverse:"))).toBe(true);
    await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "subtle" });
    for (const id of kitFiles) expect(doc.project.files.some((f) => f.id === id)).toBe(true);
  });

  it("picks library sounds for this run with sources=mixed, and refuses sources=kit without a kit", async () => {
    const doc = edit();
    const host = libraryHost();
    expect(summary(await runTool({ doc, host }, "auto_sound_design_tool", { sources: "kit" }))).toMatch(/^Error: the project has no sound kit/);
    const result = await runTool({ doc, host }, "auto_sound_design_tool", { intensity: "hype", sources: "mixed" });
    expect(summary(result)).toMatch(/^Sound-designed the edit as .* \(\w+, read from the edit; hype, mixed sounds\)/);
    expect(data<{ kit: { stored: boolean } }>(result).kit.stored).toBe(false);
    expect(readSoundKit(doc.project)).toBeNull();
    expect(doc.undoLabels).toEqual(["Automatic sound design"]);
  });
});
