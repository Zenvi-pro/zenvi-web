/**
 * Speech on the web surfaces, through runTool with string arguments the way
 * the Zenvi Assistant sends them: transcripts (index cues, kept speech
 * recognition results, new transcriptions through `AudioHost.transcribe`),
 * word cuts on real word timings, caption export, transcript-driven ducking
 * and develop's add_captions_tool. The fake host's recognizer hears
 * SPOKEN_WORDS in every media file. Ported from zenvi-core develop
 * tests/test_speech_phase5.py and tests/test_editor_tools_titles_text_captions.py.
 */

import { describe, expect, it } from "vitest";
import { TranscriptionError, transcriptionHttpError } from "../analysis/transcription.js";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import type { Clip, Effect, Keyframe, ProjectFile } from "../model/types.js";
import { addClip } from "../ops/clips.js";
import { addFile } from "../ops/files.js";
import { parseCaptionText, displayText } from "./caption-cues.js";
import type { ToolReceipt } from "./receipt.js";
import { runTool } from "./registry.js";
import { fakeHost, type FakeHost, type FakeHostOptions } from "./test-support/fake-host.js";
import { IDS, L1, audioInfo, fixtureDoc, imageInfo, media, videoInfo } from "./test-support/fixture.js";
import { storedTranscript } from "./transcripts.js";

const L2 = 2_000_000;

let txCounter = 0;
function newDoc(profile = "FHD 1080p 30 fps"): ProjectDocument {
  return new ProjectDocument(createProject({ id: "PROJECT001", profile }), { newTransactionId: () => `tx-${(txCounter += 1)}` });
}

/** A talking clip: a 22.7 s video with sound placed with ops (optionally indexed); returns its id. */
function addSpeaker(
  doc: ProjectDocument,
  opts: { position?: number; start?: number; end?: number; layer?: number; ai?: Record<string, unknown>; path?: string } = {},
): string {
  const path = opts.path ?? `/media/speaker-${doc.project.files.length}.mp4`;
  return doc.transaction("setup", (tx) => {
    const file = addFile(tx, media(path, videoInfo(path, 22.7)));
    if (opts.ai) tx.update(["files", { id: file.id }], { ai_metadata: opts.ai });
    return addClip(tx, { fileId: file.id, position: opts.position ?? 0, layer: opts.layer ?? L1, start: opts.start ?? 0, end: opts.end ?? 22.7 }).id;
  });
}

function addMusic(doc: ProjectDocument, opts: { position?: number; end?: number; layer?: number } = {}): string {
  const path = `/media/music-${doc.project.files.length}.mp3`;
  return doc.transaction("setup", (tx) => {
    const file = addFile(tx, media(path, audioInfo(path, 60)));
    return addClip(tx, { fileId: file.id, position: opts.position ?? 0, layer: opts.layer ?? L2, start: 0, end: opts.end ?? 20 }).id;
  });
}

function clip(doc: ProjectDocument, id: string): Clip | undefined {
  return doc.project.clips.find((c) => c.id === id);
}

function fileOf(doc: ProjectDocument, clipId: string): ProjectFile {
  return doc.project.files.find((f) => f.id === clip(doc, clipId)!.file_id)!;
}

async function call(doc: ProjectDocument, host: FakeHost, name: string, args: Record<string, unknown> = {}): Promise<ToolReceipt> {
  return (await runTool({ doc, host }, name, args)).data!;
}

function data(receipt: ToolReceipt): Record<string, unknown> {
  return receipt.data as Record<string, unknown>;
}

function transcribeCalls(host: FakeHost): string[] {
  return host.calls.filter((c) => c.startsWith("transcribe "));
}

function captionsOf(doc: ProjectDocument, clipId: string): Effect[] {
  return (clip(doc, clipId)?.effects ?? []).filter((e) => e.class_name === "Caption");
}

function y(kf: unknown, i = 0): number {
  return (kf as Keyframe).Points[i]!.co.Y;
}

/** A refusal that leaves the project's history and timeline as they were (a kept transcript aside). */
async function expectRefusal(doc: ProjectDocument, host: FakeHost, name: string, args: Record<string, unknown>, needle: string | RegExp): Promise<ToolReceipt> {
  const clips = JSON.stringify(doc.project.clips);
  const undo = doc.undoLabels.length;
  const r = await call(doc, host, name, args);
  expect(r.summary, JSON.stringify(args)).toMatch(/^Error/);
  if (typeof needle === "string") expect(r.summary, JSON.stringify(args)).toContain(needle);
  else expect(r.summary, JSON.stringify(args)).toMatch(needle);
  expect(r.undoSteps).toBe(0);
  expect(doc.undoLabels.length).toBe(undo);
  expect(JSON.stringify(doc.project.clips)).toBe(clips);
  return r;
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

describe("get_transcript_tool and transcribe_media_tool", () => {
  it("transcribes a clip the index does not know once, keeps the words on its file, and makes no undo step", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipB });
    expect(r.status).toBe("applied");
    expect(r.undoSteps).toBe(0);
    expect(r.summary).toMatch(/^Transcribed 9 words \(server, en\)\. clipId=CLIPBROL01 Full dialogue in data\.script\./);
    expect(data(r)).toMatchObject({ transcriptionSource: "server", wordTiming: "exact", transcriptGeneration: 1, modelId: "whisper-1", language: "en", clipIds: [IDS.clipB] });
    expect(data(r).script).toBe("Hello and welcome.\n\nUm, today we talk about cameras.");
    expect(r.warnings).toEqual([]);
    expect(doc.undoLabels).toEqual([]);
    expect(transcribeCalls(host)).toEqual(["transcribe /media/broll.mp4 auto"]);
    const kept = storedTranscript(doc.project.files.find((f) => f.id === IDS.broll));
    expect(kept).toMatchObject({ generation: 1, transcriptionSource: "server", requestLanguage: "auto", language: "en", modelId: "whisper-1" });
    expect(kept!.words[3]).toEqual({ text: "Um,", startSec: 2.6, endSec: 2.9 });

    // Words map onto the timeline: clip B sits at 10 s.
    const full = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipB, detail_level: "full" });
    expect((data(full).clips as { compactWords: unknown[] }[])[0]!.compactWords[3]).toEqual([3, "Um,", 378]);
    expect(transcribeCalls(host)).toHaveLength(1);
  });

  it("reads the media index for free, with estimated word timings", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipA });
    expect(data(r)).toMatchObject({ transcriptionSource: "index_cues", wordTiming: "estimated", transcriptGeneration: 1 });
    expect(r.warnings.join(" ")).toContain("estimated");
    expect(transcribeCalls(host)).toEqual([]);
  });

  it("prefers a kept transcription to the index, after it in generation, so word indices agree with remove_words_tool", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const t = await call(doc, host, "transcribe_media_tool", { fileId: IDS.interview });
    expect(t.summary).toMatch(/^Transcribed 9 words \(server, en\)\. fileId=FILEINTV01 /);
    expect(data(t)).toMatchObject({ transcriptGeneration: 2, wordCount: 9, transcriptionSource: "server" });
    const r = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipA });
    expect(data(r)).toMatchObject({ transcriptionSource: "server", wordTiming: "exact", transcriptGeneration: 2 });
    expect(transcribeCalls(host)).toHaveLength(1);
    // The index's own data is untouched.
    expect(doc.project.files.find((f) => f.id === IDS.interview)?.ai_metadata).toMatchObject({ analyzed: true, transcript_cues: expect.any(Array) });
  });

  it("asks for the language given, never reuses another language's words, and force transcribes again", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await call(doc, host, "get_transcript_tool", { clipId: IDS.clipB, language: "en-US" });
    await call(doc, host, "get_transcript_tool", { clipId: IDS.clipB, language: "auto" });
    await call(doc, host, "get_transcript_tool", { clipId: IDS.clipB, language: "en" });
    expect(transcribeCalls(host)).toEqual(["transcribe /media/broll.mp4 en"]);
    const fr = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipB, language: "fr" });
    expect(data(fr)).toMatchObject({ language: "fr", transcriptGeneration: 2 });
    const forced = await call(doc, host, "transcribe_media_tool", { fileId: IDS.broll, force: "true" });
    expect(data(forced).transcriptGeneration).toBe(3);
    expect(transcribeCalls(host)).toHaveLength(3);
  });

  it("transcribes the only media-bin file of an empty timeline, and a fileId as clipId", async () => {
    const doc = newDoc();
    doc.transaction("import", (tx) => addFile(tx, media("/media/talk.mp4", videoInfo("/media/talk.mp4", 8)), { id: "FILETALK01" }));
    const host = fakeHost();
    const r = await call(doc, host, "get_transcript_tool");
    expect(r.summary).toMatch(/fileId=FILETALK01 .*\(timeline was empty; transcribed the media-bin file\.\)$/);
    expect(data(r)).toMatchObject({ fileIds: ["FILETALK01"], clipIds: [], nextAction: expect.stringContaining("place file on timeline") });
    const asClip = await call(doc, host, "get_transcript_tool", { clipId: "FILETALK01" });
    expect(data(asClip).fileIds).toEqual(["FILETALK01"]);
    expect(transcribeCalls(host)).toHaveLength(1);
  });

  it("answers media without sound as unchanged, without asking the server", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipLogo });
    expect(r.status).toBe("unchanged");
    expect(r.summary).toMatch(/^This video has no audio track/);
    expect(transcribeCalls(host)).toEqual([]);
  });

  it("transcribes the talking footage of an untargeted call, and leaves the music bed alone", async () => {
    const doc = newDoc();
    const a = addSpeaker(doc);
    const music = addMusic(doc);
    const host = fakeHost();
    const r = await call(doc, host, "get_transcript_tool");
    expect(data(r).clipIds).toEqual([a]);
    expect(r.warnings.join(" ")).toContain(`clip ${music}`);
    expect(r.warnings.join(" ")).toContain("audio-only");
    expect(transcribeCalls(host)).toEqual(["transcribe /media/speaker-0.mp4 auto"]);
    // Named, the bed is transcribed.
    await call(doc, host, "get_transcript_tool", { clipId: music });
    expect(transcribeCalls(host)).toHaveLength(2);
  });

  it("says in words what the server answered, and keeps history untouched", async () => {
    const doc = fixtureDoc();
    const credits = fakeHost({ transcripts: { "/media/broll.mp4": transcriptionHttpError(402, { detail: "Insufficient credits" }) } });
    const r = await expectRefusal(doc, credits, "get_transcript_tool", { clipId: IDS.clipB }, "Could not transcribe any clip. clip CLIPBROL01: not enough Zenvi credits to transcribe this audio");
    expect(r.status).toBe("error");
    const signedOut = fakeHost({ transcripts: { "/media/broll.mp4": new TranscriptionError("sign_in", "transcribing speech needs a Zenvi sign-in; sign in to Zenvi and try again") } });
    await expectRefusal(doc, signedOut, "transcribe_media_tool", { fileId: IDS.broll }, "is not available in this Zenvi surface: transcribing speech needs a Zenvi sign-in");
    const broken = fakeHost({ transcripts: { "/media/broll.mp4": new Error("socket hang up") } });
    await expectRefusal(doc, broken, "get_transcript_tool", { clipId: IDS.clipB }, "Transcription failed: socket hang up");
    expect(storedTranscript(doc.project.files.find((f) => f.id === IDS.broll))).toBeNull();
  });

  it("falls back to the index when the server cannot transcribe", async () => {
    const doc = fixtureDoc();
    const host = fakeHost({ transcripts: { "/media/interview.mp4": transcriptionHttpError(404, { detail: "Not Found" }) } });
    const r = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipA, force: "true" });
    expect(data(r)).toMatchObject({ transcriptionSource: "index_cues" });
    expect(r.warnings.join(" ")).toContain("speech recognition failed (speech recognition is not available yet on this Zenvi server");
  });
});

// ---------------------------------------------------------------------------
// remove_words_tool
// ---------------------------------------------------------------------------

describe("remove_words_tool on real word timings", () => {
  it("cuts the filler exactly and closes the gap in one undo step; undo keeps the transcript", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "remove_words_tool", { timeline_clip_id: IDS.clipB, fillerPreset: "um_uh" });
    expect(r.status).toBe("applied");
    expect(r.summary).toBe("Removed 1 word(s), closed 0.30s.");
    expect(r.undoSteps).toBe(1);
    expect(data(r)).toMatchObject({ removedWordIndices: [3], fragmentCount: 2, transcriptionSource: "server", transcriptGeneration: 1 });
    expect(data(r).script).toBe("Hello and welcome. today we talk about cameras.");
    const b = clip(doc, IDS.clipB)!;
    expect([b.position, b.start, b.end]).toEqual([10, 0, 2.6]);
    const second = doc.project.clips.find((c) => c.id === (data(r).createdClipIds as string[])[0])!;
    expect(second.position).toBeCloseTo(12.6, 9);
    expect(second.start).toBeCloseTo(2.9, 9);
    expect(clip(doc, IDS.clipTail)!.position).toBeCloseTo(14.7, 9);
    expect(r.shifted).toEqual([{ clipId: IDS.clipTail, deltaSec: expect.closeTo(-0.3, 9) }]);
    doc.undo();
    expect(clip(doc, IDS.clipB)).toMatchObject({ position: 10, start: 0, end: 5 });
    expect(doc.project.clips).toHaveLength(5);
    expect(storedTranscript(doc.project.files.find((f) => f.id === IDS.broll))?.words).toHaveLength(9);
  });

  it("cuts matches case- and punctuation-insensitively, and an indexed clip still gets exact timings", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "remove_words_tool", { clipId: IDS.clipA, matches: '["CAMERAS", "today"]' });
    expect(data(r)).toMatchObject({ removedWordIndices: [4, 8], transcriptionSource: "server", transcriptGeneration: 2 });
    expect(transcribeCalls(host)).toEqual(["transcribe /media/interview.mp4 auto"]);
  });

  it("refuses word indices nobody has seen yet, and takes them after get_transcript_tool", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    await expectRefusal(doc, host, "remove_words_tool", { clipId: IDS.clipB, wordIndices: "[3]" }, "wordIndices refer to words you have not seen");
    // The transcription is kept: the next get_transcript_tool reads it without a new call.
    const t = await call(doc, host, "get_transcript_tool", { clipId: IDS.clipB });
    const r = await call(doc, host, "remove_words_tool", { clipId: IDS.clipB, wordIndices: "[3]", transcriptGeneration: String(data(t).transcriptGeneration) });
    expect(data(r).removedWordIndices).toEqual([3]);
    expect(transcribeCalls(host)).toHaveLength(1);
  });

  it("refuses stale word indices but recomputes matches from the live words", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    // Indices read from the index (generation 1) do not point at the recognizer's words (generation 2).
    await call(doc, host, "transcribe_media_tool", { fileId: IDS.interview });
    const stale = await expectRefusal(doc, host, "remove_words_tool", { clipId: IDS.clipA, wordIndices: [2], matches: ["um"], transcriptGeneration: 1 }, "transcriptGeneration mismatch — call get_transcript_tool again.");
    expect(data(stale)).toEqual({ transcriptGeneration: 2, requested: 1 });
    const r = await call(doc, host, "remove_words_tool", { clipId: IDS.clipA, matches: ["um"], transcriptGeneration: 1 });
    expect(r.status).toBe("applied");
    expect(r.warnings).toContain("transcriptGeneration 1 stale; using live generation 2");
  });

  it("refuses what it cannot do before paying for a transcription", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    doc.transaction("retime", (tx) => tx.update(["clips", { id: IDS.clipB }], { speed: 2 }));
    await expectRefusal(doc, host, "remove_words_tool", { clipId: IDS.clipB, fillerPreset: "um_uh" }, "speed change or time curve");
    await expectRefusal(doc, host, "remove_words_tool", { clipId: IDS.clipA, fillerPreset: "uhm" }, "Unknown fillerPreset 'uhm'");
    await expectRefusal(doc, host, "remove_words_tool", { matches: ["um"] }, "clipId is required when the timeline has zero or multiple clips");
    await expectRefusal(doc, host, "remove_words_tool", { clipId: IDS.interview, matches: ["um"] }, "is a media-bin fileId with multiple timeline clips");
    await expectRefusal(doc, host, "remove_words_tool", { clipId: IDS.broll, matches: ["um"] }, "");
    expect(transcribeCalls(host)).toEqual([]);
  });

  it("says when nothing matched, without an undo step", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "remove_words_tool", { clipId: IDS.clipB, matches: ["FlowCut"] });
    expect(r.status).toBe("unchanged");
    expect(r.summary).toBe("No words matched — nothing removed. (no transcript words matched ['FlowCut'])");
    expect(doc.undoLabels).toEqual([]);
  });

  it("deletes the clip and closes the gap when every word goes", async () => {
    const doc = newDoc();
    const only = addSpeaker(doc, { position: 0, start: 2.6, end: 2.9 });
    const after = addSpeaker(doc, { position: 0.3, start: 5, end: 7 });
    const host = fakeHost();
    const r = await call(doc, host, "remove_words_tool", { clipId: only, fillerPreset: "um_uh" });
    expect(r.summary).toBe("Removed 1 word(s) (entire clip).");
    expect(r.removedClipIds).toEqual([only]);
    expect(clip(doc, after)!.position).toBeCloseTo(0, 9);
  });
});

// ---------------------------------------------------------------------------
// export_captions_tool
// ---------------------------------------------------------------------------

describe("export_captions_tool", () => {
  it("writes an SRT on the recognizer's word timings", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "export_captions_tool", { path: "/out/b.srt", clipId: IDS.clipB });
    expect(r.summary).toBe("Exported 2 cue(s) to /out/b.srt.");
    expect(data(r)).toMatchObject({ transcriptionSource: "server", wordTiming: "exact", count: 2 });
    expect(String(host.written.get("/out/b.srt"))).toBe(
      "1\n00:00:10,500 --> 00:00:14,100\nHello and welcome. Um, today we talk about\n\n2\n00:00:14,100 --> 00:00:14,600\ncameras.\n",
    );
    const vtt = await call(doc, host, "export_captions_tool", { path: "/out/b.vtt", clipId: IDS.clipB, format: "vtt" });
    expect(vtt.status).toBe("applied");
    expect(String(host.written.get("/out/b.vtt"))).toMatch(/^WEBVTT\n\n00:00:10\.500 --> 00:00:14\.100\n/);
    expect(transcribeCalls(host)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// duck_under_speech_tool speech_clip_ids=auto
// ---------------------------------------------------------------------------

describe("duck_under_speech_tool with speech_clip_ids=auto", () => {
  it("finds the speech of footage nobody indexed by transcribing it, and keeps the words", async () => {
    const doc = newDoc();
    const talk = addSpeaker(doc, { position: 0, end: 10 });
    const music = addMusic(doc, { end: 10 });
    const host = fakeHost();
    const r = await call(doc, host, "duck_under_speech_tool", { bed_clip_ids: music, speech_clip_ids: "auto" });
    expect(r.status).toBe("applied");
    expect(r.summary).toMatch(/^Ducked 1 bed clip\(s\) under 1 speech clip\(s\)\./);
    expect(r.summary).toContain(`speech sources: ${talk} (transcript, 2 windows)`);
    expect(r.undoSteps).toBe(1);
    expect(transcribeCalls(host)).toEqual(["transcribe /media/speaker-0.mp4 auto"]);
    expect(storedTranscript(fileOf(doc, talk))?.words).toHaveLength(9);
    // The next call reads the kept words, as analyze_timeline_audio_tool does.
    const again = await call(doc, host, "analyze_timeline_audio_tool", { timeline_clip_id: talk, detail: "windows" });
    expect(again.summary).toContain("audio_role=speech");
    expect(again.summary).toContain("speech windows (transcript, timeline s): 0.50-2.00, 2.60-4.60");
    expect(transcribeCalls(host)).toHaveLength(1);
  });

  it("does not take a word or two heard in a tone for dialogue", async () => {
    const doc = newDoc();
    const talk = addSpeaker(doc, { position: 0, end: 10, path: "/media/talk.mp4" });
    addSpeaker(doc, { position: 10, end: 16, path: "/media/tone.mp4" });
    const music = addMusic(doc, { end: 16 });
    const tone = { language: "en", model: "whisper-1", words: [{ text: "Beeeeeeeep", startSec: 0, endSec: 1.54 }], segments: [], durationSeconds: 6 };
    const host = fakeHost({ transcripts: { "/media/tone.mp4": tone } });
    const r = await call(doc, host, "duck_under_speech_tool", { bed_clip_ids: music });
    expect(r.summary).toContain(`under 1 speech clip(s)`);
    expect(r.summary).toContain(`speech sources: ${talk} (transcript, 2 windows)`);
    expect(transcribeCalls(host)).toEqual(["transcribe /media/talk.mp4 auto", "transcribe /media/tone.mp4 auto"]);
  });

  it("still uses the indexed cues first", async () => {
    const doc = fixtureDoc();
    const host = fakeHost();
    const r = await call(doc, host, "duck_under_speech_tool", { bed_clip_ids: IDS.clipMusic });
    expect(r.summary).toContain("speech sources: CLIPINTV01 (cues");
    expect(transcribeCalls(host)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// add_captions_tool (develop's Caption effect)
// ---------------------------------------------------------------------------

const SRT = `1
00:00:00,500 --> 00:00:03,000
Welcome back to my channel.

2
00:00:03,200 --> 00:00:07,500
Today we are exploring the city.

3
00:00:07,700 --> 00:00:11,000
First stop: my favorite coffee shop.
`;

function captionCues(doc: ProjectDocument, clipId: string, n = 0): { start: number; end: number; text: string }[] {
  return parseCaptionText(String(captionsOf(doc, clipId)[n]?.caption_text ?? ""));
}

describe("add_captions_tool", () => {
  it("captions a clip from given cues in timeline seconds, as a Caption effect, in one undo step", async () => {
    const doc = newDoc();
    const c = addSpeaker(doc, { position: 2 });
    const host = fakeHost();
    const r = await call(doc, host, "add_captions_tool", {
      timeline_clip_id: c,
      cues: [
        { start: 3, end: 5, text: "Hello there" },
        { start: 5.5, end: 7, text: "Bye" },
      ],
    });
    expect(r.summary).toBe(`Added 2 caption(s) from cues on ${c}.`);
    const [effect] = captionsOf(doc, c);
    expect(effect!.apply_before_clip).toBe(false);
    expect(captionCues(doc, c).map((q) => [q.start, q.end])).toEqual([
      [1, 3],
      [3.5, 5],
    ]);
    expect(data(r).captioned).toEqual([expect.objectContaining({ timeline_clip_id: c, overlay: false, cues: 2, first: 3, last: 7, replaced: false, track: 1 })]);
    expect(r.undoSteps).toBe(1);
    doc.undo();
    expect(captionsOf(doc, c)).toEqual([]);
    expect(transcribeCalls(host)).toEqual([]);
  });

  it("keeps a subtitle file in the trimmed clip's media time", async () => {
    const doc = newDoc();
    const c = addSpeaker(doc, { position: 5, start: 1, end: 9 });
    const host = fakeHost({ texts: { "/subs/captions.srt": SRT } });
    const r = await call(doc, host, "add_captions_tool", { srtPath: "/subs/captions.srt", clipId: c });
    expect(captionCues(doc, c).map((q) => q.start)).toEqual([0.5, 3.2, 7.7]);
    expect((data(r).captioned as { first: number }[])[0]!.first).toBe(4.5);
    const rows = ((await call(doc, host, "list_captions_tool", { timeline_clip_id: c })).data as { caption_tracks: { cues: { visible: boolean; start: number; source_start: number }[] }[] }).caption_tracks[0]!.cues;
    expect(rows.map((q) => q.visible)).toEqual([true, true, true]);
    expect([rows[1]!.start, rows[1]!.source_start]).toEqual([7.2, 3.2]);
  });

  it("skips cues outside the clip, or refuses when none fall inside", async () => {
    const doc = newDoc();
    const c = addSpeaker(doc, { position: 0, start: 0, end: 4 });
    const host = fakeHost({ texts: { "/subs/captions.srt": SRT } });
    const r = await call(doc, host, "add_captions_tool", { srtPath: "/subs/captions.srt", timeline_clip_id: c });
    expect((data(r).captioned as { cues: number }[])[0]!.cues).toBe(2);
    expect(r.warnings[0]).toContain("outside");
    await expectRefusal(doc, host, "add_captions_tool", { timeline_clip_id: c, cues: [{ start: 30, end: 31, text: "late" }] }, "none of the 1 cue");
  });

  it("puts subtitles without a clip on a transparent Captions overlay above the video", async () => {
    const doc = newDoc();
    addSpeaker(doc, { position: 0, end: 22.7 });
    const host = fakeHost({ texts: { "/subs/captions.srt": SRT } });
    const r = await call(doc, host, "add_captions_tool", { srtPath: "/subs/captions.srt", style: "yellow" });
    const entry = (data(r).captioned as Record<string, unknown>[])[0]!;
    expect(entry).toMatchObject({ overlay: true, layer: 2_000_000, track: 2 });
    const overlay = clip(doc, String(entry.timeline_clip_id))!;
    expect(overlay).toMatchObject({ zenvi_role: "captions", title: "Captions", position: 0.5 });
    expect(Math.round((overlay.end - overlay.start) * 1000) / 1000).toBe(10.5);
    const cues = captionCues(doc, overlay.id);
    expect([cues[0]!.start, cues[cues.length - 1]!.end]).toEqual([0, 10.5]);
    expect(doc.project.files.find((f) => f.id === overlay.file_id)?.zenvi_role).toBe("text_overlay");
    expect(r.undoSteps).toBe(1);
    doc.undo();
    expect(clip(doc, overlay.id)).toBeUndefined();
    expect(doc.project.files.find((f) => f.id === overlay.file_id)).toBeUndefined();
  });

  it("captions from the media index, phrased like the desktop", async () => {
    const doc = newDoc();
    const ai = {
      analyzed: true,
      transcript_cues: [
        { start: 1, end: 6, text: "so today we are going to walk all the way across the city together" },
        { start: 7, end: 8, text: "at 10:30" },
      ],
    };
    const c = addSpeaker(doc, { ai });
    const host = fakeHost();
    const r = await call(doc, host, "add_captions_tool", { clipId: c, maxWords: "6" });
    const cues = captionCues(doc, c);
    expect(data(r)).toMatchObject({ source: "transcript", transcriptionSource: "index_cues" });
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues.every((q) => displayText(q.text).split(" ").length <= 6)).toBe(true);
    expect(displayText(cues[cues.length - 1]!.text)).toBe("at 10:30");
    expect(cues[cues.length - 1]!.text).toContain("​:");
    expect(r.warnings.some((w) => w.includes("adjusted"))).toBe(true);
    expect(transcribeCalls(host)).toEqual([]);
  });

  it("captions a clip nobody indexed from speech recognition, on the words' own timings", async () => {
    const doc = newDoc();
    const c = addSpeaker(doc, { position: 4, start: 0.4 });
    const host = fakeHost();
    const r = await call(doc, host, "add_captions_tool", { timeline_clip_id: c, style: "reels" });
    expect(r.summary).toBe(`Added 2 caption(s) from the transcript on ${c}.`);
    expect(data(r)).toMatchObject({ source: "transcript", transcriptionSource: "server", style: "reels" });
    expect(captionCues(doc, c)).toEqual([
      { start: 0.5, end: 2.6, text: "Hello and welcome." },
      { start: 2.6, end: 4.6, text: "Um, today we talk about cameras." },
    ]);
    expect((data(r).captioned as { first: number }[])[0]!.first).toBe(4.1);
    expect(r.watchSuggested).toEqual({ clipId: c, start: 4.1, end: 7.1 });
    expect(r.undoSteps).toBe(1);
    expect(transcribeCalls(host)).toEqual([`transcribe /media/speaker-0.mp4 auto`]);
    // Undo keeps the words: captions again cost nothing.
    doc.undo();
    await call(doc, host, "add_captions_tool", { timeline_clip_id: c });
    expect(transcribeCalls(host)).toHaveLength(1);
  });

  it("captions the talking clips of an untargeted call; a clip without sound is refused", async () => {
    const doc = newDoc();
    const a = addSpeaker(doc);
    addMusic(doc, { end: 10 });
    const still = doc.transaction("still", (tx) => {
      const file = addFile(tx, media("/media/still.png", imageInfo("/media/still.png")));
      return addClip(tx, { fileId: file.id, position: 30, layer: L1, start: 0, end: 3 }).id;
    });
    const host = fakeHost();
    const r = await call(doc, host, "add_captions_tool");
    expect((data(r).captioned as { timeline_clip_id: string }[]).map((e) => e.timeline_clip_id)).toEqual([a]);
    expect(transcribeCalls(host)).toEqual(["transcribe /media/speaker-0.mp4 auto"]);
    await expectRefusal(doc, host, "add_captions_tool", { timeline_clip_id: still }, "no transcript is available to caption from");
  });

  it("replaces a clip's captions, or adds a second track", async () => {
    const doc = newDoc();
    const c = addSpeaker(doc);
    const host = fakeHost();
    await call(doc, host, "add_captions_tool", { timeline_clip_id: c, cues: [{ start: 1, end: 2, text: "first" }] });
    await call(doc, host, "add_captions_tool", { timeline_clip_id: c, cues: [{ start: 3, end: 4, text: "second" }] });
    expect(captionsOf(doc, c)).toHaveLength(1);
    expect(captionCues(doc, c)[0]!.text).toBe("second");
    await call(doc, host, "add_captions_tool", { timeline_clip_id: c, replace_existing: "false", cues: [{ start: 5, end: 6, text: "third" }] });
    expect(captionsOf(doc, c)).toHaveLength(2);
  });

  it("maps a style to Caption properties on a vertical frame, in capitals", async () => {
    const doc = newDoc("FHD Vertical 1080p 30 fps");
    const c = addSpeaker(doc);
    const host = fakeHost();
    const r = await call(doc, host, "add_captions_tool", { timeline_clip_id: c, style: "reels", uppercase: "true", cues: [{ start: 1, end: 2, text: "big words" }] });
    const [e] = captionsOf(doc, c);
    expect(e!.caption_font).toBe("Arial Black");
    expect(y(e!.stroke_width)).toBeGreaterThan(0);
    expect(y(e!.background_alpha)).toBe(0);
    // 0.075 of the 1080 px short side = 81 px; Caption scales by width/600 -> 45.
    expect(y(e!.font_size)).toBe(45);
    expect(captionCues(doc, c)[0]!.text).toBe("BIG WORDS");
    expect(y(e!.top)).toBeGreaterThan(0.6);
    expect(y(e!.top)).toBeLessThan(0.8);
    expect((data(r).look as { position: string }).position).toBe("bottom");
    await call(doc, host, "edit_captions_tool", { timeline_clip_id: c, position: "top" });
    expect(y(captionsOf(doc, c)[0]!.top)).toBeLessThan(0.12);
  });

  it.each([
    [{ cues: [{ start: 1, end: 2, text: "a" }], srtPath: "/x.srt" }, "either cues or srtPath"],
    [{ srtPath: "/definitely/missing.srt" }, "not found"],
    [{ cues: [{ start: 2, end: 1, text: "a" }] }, "0 <= start < end"],
    [{ cues: [{ start: 1, end: 2, text: " " }] }, "has no text"],
    [{ cues: [{ start: 1, end: 2, text: "a" }], trackIndex: 1 }, "trackIndex"],
    [{ cues: [{ start: 1, end: 2, text: "a" }], time_base: "source" }, "needs the clip"],
    [{ style: "comic" }, "'comic' is not one of"],
    [{ cues: [{ start: 1, end: 2, text: "a" }], text_color: "nope" }, "text_color"],
    [{ clipId: "nope", cues: [{ start: 1, end: 2, text: "a" }] }, "no timeline clip"],
    [{ clipId: "A", timeline_clip_id: "B" }, "name different clips"],
  ])("refuses %j", async (args, needle) => {
    const doc = newDoc();
    addSpeaker(doc);
    const host = fakeHost();
    await expectRefusal(doc, host, "add_captions_tool", args as Record<string, unknown>, needle);
    expect(transcribeCalls(host)).toEqual([]);
  });

  it("refuses a clip on a locked track before transcribing it", async () => {
    const doc = newDoc();
    const c = addSpeaker(doc);
    doc.setUntracked(["layers", { number: L1 }, "lock"], true);
    const host = fakeHost();
    await expectRefusal(doc, host, "add_captions_tool", { timeline_clip_id: c }, "locked");
    await expectRefusal(doc, host, "add_captions_tool", { timeline_clip_id: c, cues: [{ start: 1, end: 2, text: "a" }] }, "locked");
    expect(transcribeCalls(host)).toEqual([]);
  });

  it("says when the server cannot transcribe a clip that has no index", async () => {
    const doc = newDoc();
    const c = addSpeaker(doc, { path: "/media/old-server.mp4" });
    const options: FakeHostOptions = { transcripts: { "/media/old-server.mp4": transcriptionHttpError(404, { detail: "Not Found" }) } };
    const r = await expectRefusal(doc, fakeHost(options), "add_captions_tool", { timeline_clip_id: c }, "speech recognition is not available yet on this Zenvi server");
    expect(r.status).toBe("refused");
    expect(r.summary).toMatch(/^Error: add_captions_tool is not available in this Zenvi surface: /);
    expect(r.summary).toContain("Pass cues or srtPath");
  });
});
