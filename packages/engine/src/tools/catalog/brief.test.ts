import { describe, expect, it } from "vitest";
import { BRIEF_KEY, readBrief } from "../../brief/brief.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { finishGaps } from "../../review/finish.js";
import type { RgbaImage } from "../../render/types.js";
import { runTool } from "../registry.js";
import type { ToolHost, ToolImage } from "../types.js";
import { fakeHost } from "../test-support/fake-host.js";
import { audioInfo, imageInfo, media, videoInfo } from "../test-support/fixture.js";
import { METHOD } from "../test-support/brief-fixture.js";
import { encodePng } from "../test-support/pixel-host.js";

const L1 = 1_000_000;

/** A 1080x1920 project with a portrait clip, a landscape clip, a photo, a song and a TTS voice in the bin. */
function bin(): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id: "BRIEFTOOLS" }));
  doc.transaction("fixture", (tx) => {
    tx.replace(["width"], 1080);
    tx.replace(["height"], 1920);
    addFile(tx, media("/m/run.mp4", videoInfo("/m/run.mp4", 12, { width: 1080, height: 1920, has_audio: false })), { id: "RUNXXXXXXX" });
    addFile(tx, media("/m/city.mp4", videoInfo("/m/city.mp4", 8, { has_audio: false })), { id: "CITYXXXXXX" });
    addFile(tx, media("/m/logo.png", imageInfo("/m/logo.png")), { id: "LOGOXXXXXX" });
    addFile(tx, media("/m/song.mp3", audioInfo("/m/song.mp3", 95)), { id: "SONGXXXXXX" });
    addFile(tx, media("/m/zenvi_tts_1.wav", audioInfo("/m/zenvi_tts_1.wav", 6)), { id: "VOICEXXXXX" });
  });
  return doc;
}

function solid(r: number, g: number, b: number): ToolImage {
  const image: RgbaImage = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) };
  for (let i = 0; i < image.data.length; i += 4) image.data.set([r, g, b, 255], i);
  return { mimeType: "image/png", data: Buffer.from(encodePng(image)).toString("base64") };
}

const BRIEF = {
  goal: "Make runners want the shoe in one watch",
  platform: "Instagram Reels",
  aspect: "9:16",
  length_seconds: 6,
  style: "hype-reel",
  techniques: [
    { id: "flash-frames", why: "the drop at 3 s", tools: ["apply_motion_transitions_tool"] },
    { id: "kinetic-word-slam", why: "the claim lands", tools: ["add_kinetic_title_tool"] },
    { id: "match-cut", why: "feet line up across cuts", tools: ["match_cut_montage_tool"] },
  ],
  hook: "A shoe hits wet tarmac in close-up, impact on frame 1",
  beats: [
    { start: 0, end: 3, name: "hook" },
    { start: 3, end: 5, name: "drop" },
    { start: 5, end: 6, name: "end card" },
  ],
  shots: [
    { beat: "hook", source: "media", file_id: "RUNXXXXXXX", note: "feet, low angle" },
    { beat: "drop", source: "stock", note: "track sprint, side on" },
  ],
  checklist: ["a sound on every cut", "ends on a held logo"],
  ...METHOD,
};

describe("inspect_media_bin_tool", () => {
  it("lists each file's kind, length, orientation and speech, and what the bin means for the plan", async () => {
    const doc = bin();
    const result = await runTool({ doc, host: fakeHost() as ToolHost }, "inspect_media_bin_tool", { measure: false });
    expect(result.ok).toBe(true);
    const files = (result.data!.data as { files: { id: string; kind: string; orientation: string | null; speech: string; seconds: number | null }[] }).files;
    const byId = Object.fromEntries(files.map((f) => [f.id, f]));
    expect(byId.RUNXXXXXXX).toMatchObject({ kind: "video", orientation: "portrait", speech: "no", seconds: 12 });
    expect(byId.CITYXXXXXX).toMatchObject({ kind: "video", orientation: "landscape" });
    expect(byId.LOGOXXXXXX).toMatchObject({ kind: "image", seconds: null });
    expect(byId.SONGXXXXXX).toMatchObject({ kind: "music", orientation: null });
    expect(byId.VOICEXXXXX).toMatchObject({ kind: "voice", speech: "yes" });
    expect(result.text).toContain("Someone speaks");
    expect(result.data!.undoSteps).toBe(0);
    expect(doc.undoLabels).toEqual(["fixture"]);
  });

  it("measures colours and motion from tiny frames and sound energy from an RMS pass", async () => {
    const doc = bin();
    const host = fakeHost();
    let n = 0;
    host.frames!.renderFrame = async () => (n++ % 2 === 0 ? solid(20, 40, 200) : solid(230, 230, 230));
    const result = await runTool({ doc, host: host as ToolHost }, "inspect_media_bin_tool", {});
    const files = (result.data!.data as { files: { id: string; colors: string[]; energy: string | null; brightness: string | null }[] }).files;
    const run = files.find((f) => f.id === "RUNXXXXXXX")!;
    expect(run.colors[0]).toBe("#1428c8");
    expect(run.brightness).toBe("dark");
    // A blue frame then a white one: as much change as a hard whip.
    expect(run.energy).toBe("high");
    expect(files.find((f) => f.id === "SONGXXXXXX")!.energy).not.toBeNull();
    expect(host.calls).toContain("analyzeAudio /m/song.mp3");
  });

  it("never runs a title through the audio pass", async () => {
    const doc = bin();
    doc.transaction("title", (tx) => addFile(tx, media("/m/title.svg", imageInfo("/m/title.svg")), { id: "TITLEXXXXX" }));
    const host = fakeHost();
    const result = await runTool({ doc, host: host as ToolHost }, "inspect_media_bin_tool", {});
    const files = (result.data!.data as { files: { id: string; kind: string }[] }).files;
    expect(files.find((f) => f.id === "TITLEXXXXX")?.kind).toBe("title");
    expect(host.calls).not.toContain("analyzeAudio /m/title.svg");
  });
});

describe("save_brief_tool / get_brief_tool", () => {
  it("saves the brief as one undo step under settings.zenvi_brief, keeps other keys, and a repeat save records nothing", async () => {
    const doc = bin();
    (doc.project as unknown as Record<string, unknown>).desktop_only_key = { keep: true };
    const ctx = { doc, host: fakeHost() as ToolHost };
    const first = await runTool(ctx, "save_brief_tool", BRIEF);
    expect(first.ok, first.text).toBe(true);
    expect(first.data!.undoSteps).toBe(1);
    expect(readBrief(doc.project)?.style).toBe("hype-reel");
    expect((doc.project as unknown as Record<string, unknown>).desktop_only_key).toEqual({ keep: true });

    const again = await runTool(ctx, "save_brief_tool", BRIEF);
    expect(again.data!.status).toBe("unchanged");
    expect(doc.undoLabels).toEqual(["fixture", "Save brief"]);

    doc.undo(1);
    expect(doc.project.settings[BRIEF_KEY]).toBeUndefined();
  });

  it("hands over a measured music search when the bin has no music, built from the brief's music line", async () => {
    const doc = bin();
    doc.transaction("no song", (tx) => tx.replace(["files"], doc.project.files.filter((f) => f.id !== "SONGXXXXXX")));
    const saved = await runTool({ doc, host: fakeHost() as ToolHost }, "save_brief_tool", { ...BRIEF, music: "dark trap, 140 bpm, high energy, drop on the hook" });
    expect(saved.data?.status, saved.text).toBe("applied");
    const search = (saved.data?.data as { music_search?: Record<string, unknown> }).music_search;
    expect(search).toEqual({ query: "dark trap", bpm_range: [133, 147], energy: "high", energy_curve: "drop", min_seconds: 10 });
    expect(saved.data?.summary).toMatch(/No music in the bin: fetch it measured, search_freesound_music_tool \{"query":"dark trap"/);
    // Saving the same brief again (an agent resuming) changes nothing and still hands the search over.
    const steps = doc.undoLabels.length;
    const again = await runTool({ doc, host: fakeHost() as ToolHost }, "save_brief_tool", { ...BRIEF, music: "dark trap, 140 bpm, high energy, drop on the hook" });
    expect(again.data?.status).toBe("unchanged");
    expect((again.data?.data as { music_search?: unknown }).music_search).toEqual(search);
    expect(again.data?.summary).toMatch(/No music in the bin/);
    expect(doc.undoLabels).toHaveLength(steps);
    // With a song in the bin there is nothing to fetch.
    const withSong = await runTool({ doc: bin(), host: fakeHost() as ToolHost }, "save_brief_tool", { ...BRIEF, music: "dark trap, 140 bpm" });
    expect((withSong.data?.data as { music_search?: unknown }).music_search).toBeUndefined();
  });

  it("takes the Assistant's string arguments", async () => {
    const doc = bin();
    const args = { ...BRIEF, length_seconds: "6", techniques: JSON.stringify(BRIEF.techniques), beats: JSON.stringify(BRIEF.beats.map((b) => ({ ...b, start: String(b.start) }))) };
    const result = await runTool({ doc, host: fakeHost() as ToolHost }, "save_brief_tool", args);
    expect(result.ok, result.text).toBe(true);
    expect(readBrief(doc.project)?.beats[1]!.start).toBe(3);
  });

  it("refuses beats out of order, ending before they start or after the length, and more than four techniques, without an undo step", async () => {
    const doc = bin();
    const ctx = { doc, host: fakeHost() as ToolHost };
    const backwards = await runTool(ctx, "save_brief_tool", { ...BRIEF, beats: [{ start: 2, end: 1, name: "hook" }] });
    expect(backwards.data!.summary).toMatch(/Error: beat "hook" ends at 1 s/);
    const late = await runTool(ctx, "save_brief_tool", { ...BRIEF, beats: [{ start: 0, end: 4, name: "hook" }, { start: 4, end: 8, name: "drop" }] });
    expect(late.data!.summary).toMatch(/beat "drop" ends at 8 s, past the brief's 6 s/);
    const unordered = await runTool(ctx, "save_brief_tool", { ...BRIEF, beats: [{ start: 3, end: 6, name: "drop" }, { start: 0, end: 3, name: "hook" }] });
    expect(unordered.data!.summary).toMatch(/beat "hook" starts at 0 s, before "drop" \(3 s\): list the beats in order/);
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, why: "because" }));
    expect((await runTool(ctx, "save_brief_tool", { ...BRIEF, techniques: five })).ok).toBe(false);
    expect(doc.undoLabels).toEqual(["fixture"]);
  });

  it("saves a brief that skips the motif method: advice from 20 s or when asked, never a refusal", async () => {
    const doc = bin();
    const ctx = { doc, host: fakeHost() as ToolHost };
    const minimal = { goal: "g", platform: "Reels", aspect: "9:16", length_seconds: 6, style: "hype-reel", hook: "h", beats: [{ start: 0, end: 6, name: "all" }] };
    const quick = await runTool(ctx, "save_brief_tool", minimal);
    expect(quick.data!.status).toBe("applied");
    expect(quick.data!.warnings.join(" ")).not.toContain("motif method");
    const asked = await runTool(ctx, "save_brief_tool", { ...minimal, hook: "h2", check_method: true });
    expect(asked.data!.status).toBe("applied");
    expect(asked.data!.warnings.join(" ")).toMatch(/^Advice, the motif method \(BRIEF.md 4-6; saved anyway\): motifs: 0 of the 8-12/);
    expect(readBrief(doc.project)).not.toHaveProperty("check_method");
    const long = await runTool(ctx, "save_brief_tool", { ...minimal, length_seconds: 30, beats: [{ start: 0, end: 30, name: "all" }] });
    expect(long.data!.status).toBe("applied");
    expect(long.data!.warnings.join(" ")).toContain("storyboard: 0 rows");
    expect(doc.undoLabels).toEqual(["fixture", "Save brief", "Save brief", "Save brief"]);
  });

  it("an agent's brief replaces the auto one and is never marked auto", async () => {
    const doc = bin();
    doc.setUntracked(["settings"], { zenvi_brief: { ...BRIEF, auto: true } });
    await runTool({ doc, host: fakeHost() as ToolHost }, "save_brief_tool", { ...BRIEF, auto: true, hook: "a new hook" });
    expect(readBrief(doc.project)?.auto).toBeUndefined();
    expect(readBrief(doc.project)?.hook).toBe("a new hook");
  });

  it("warns when the shot plan names a file the bin does not have", async () => {
    const doc = bin();
    const result = await runTool({ doc, host: fakeHost() as ToolHost }, "save_brief_tool", { ...BRIEF, shots: [{ source: "media", file_id: "NOPEXXXXXX", note: "x" }] });
    expect(result.data!.warnings.join(" ")).toContain("NOPEXXXXXX");
    const rows = METHOD.storyboard.map((r, i) => (i === 0 ? { ...r, file_id: "GONEXXXXXX" } : r));
    const story = await runTool({ doc, host: fakeHost() as ToolHost }, "save_brief_tool", { ...BRIEF, storyboard: rows });
    expect(story.data!.warnings.join(" ")).toContain("GONEXXXXXX");
  });

  it("get_brief_tool without a brief says how to make one; with one it checks beats and techniques", async () => {
    const doc = bin();
    const ctx = { doc, host: fakeHost() as ToolHost };
    const none = await runTool(ctx, "get_brief_tool", {});
    expect(none.data!.status).toBe("unchanged");
    expect(none.text).toContain("save_brief_tool");

    await runTool(ctx, "save_brief_tool", BRIEF);
    doc.transaction("cut", (tx) => {
      addClip(tx, { fileId: "RUNXXXXXXX", position: 0, layer: L1, start: 0, end: 3 });
      addClip(tx, { fileId: "CITYXXXXXX", position: 3, layer: L1, start: 0, end: 3 });
    });
    const got = await runTool(ctx, "get_brief_tool", {});
    const check = (got.data!.data as { check: { beats: { name: string; hit: boolean }[]; techniques: { id: string; status: string }[] } }).check;
    expect(check.beats.map((b) => b.hit)).toEqual([true, true, false]);
    expect(Object.fromEntries(check.techniques.map((t) => [t.id, t.status]))).toEqual({ "flash-frames": "missing", "kinetic-word-slam": "missing", "match-cut": "unverified" });
    expect(got.text).toContain("BRIEF: The brief borrows flash-frames");
    expect(got.text).toContain("Checklist: a sound on every cut");

    // One unreadable tool in the list (a montage of plain cuts) may have built it: unverified, not missing.
    await runTool(ctx, "save_brief_tool", { ...BRIEF, techniques: [{ id: "match-cut", why: "feet line up", tools: ["match_cut_montage_tool", "apply_motion_transitions_tool"] }] });
    const mixed = await runTool(ctx, "get_brief_tool", {});
    expect((mixed.data!.data as { check: { techniques: { status: string }[] } }).check.techniques[0]!.status).toBe("unverified");
  });
});

describe("the finish and review_edit_tool against the brief", () => {
  it("a 16:9 project with a 9:16 brief is not finished, and review_edit_tool lists the brief's misses and checklist", async () => {
    const doc = bin();
    const ctx = { doc, host: fakeHost() as ToolHost };
    await runTool(ctx, "save_brief_tool", { ...BRIEF, techniques: [] });
    doc.transaction("cut", (tx) => {
      tx.replace(["width"], 1920);
      tx.replace(["height"], 1080);
      addClip(tx, { fileId: "RUNXXXXXXX", position: 0, layer: L1, start: 0, end: 3 });
      addClip(tx, { fileId: "CITYXXXXXX", position: 3, layer: L1, start: 0, end: 2 });
      addClip(tx, { fileId: "LOGOXXXXXX", position: 5, layer: L1, start: 0, end: 1 });
    });
    const gap = finishGaps(doc.project).find((g) => g.kind === "brief");
    expect(gap?.message).toContain("The brief is 9:16 but the project is 1920x1080");
    expect(gap?.next).toEqual([{ tool: "get_brief_tool", args: {} }]);

    const review = await runTool(ctx, "review_edit_tool", { image: false, audio: false });
    expect(review.text).toContain("Brief (hype-reel): 3/3 beats start on a picture change");
    expect(review.text).toContain("Look for on the sheet (the style's checklist): a sound on every cut · ends on a held logo");
    expect((review.data!.data as { ok: boolean }).ok).toBe(false);
  });

  it("an edit without a brief owes none", () => {
    expect(finishGaps(bin().project).some((g) => g.kind === "brief")).toBe(false);
  });
});
