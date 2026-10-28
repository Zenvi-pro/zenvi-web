import { describe, expect, it } from "vitest";
import type { TimedText } from "../../analysis/transcription.js";
import { pickBrollWords } from "../broll-words.js";
import { EditHarness } from "../test-support/edit-harness.js";
import type { FakeHostOptions } from "../test-support/fake-host.js";
import { findPhrase, type TimelineWord } from "../timeline-words.js";

/** Words said one after another from `start`, `step` seconds apart. */
function spoken(text: string, start = 0, step = 0.4): TimedText[] {
  return text.split(/\s+/).map((w, i) => ({ text: w, startSec: start + i * step, endSec: start + i * step + step * 0.8 }));
}

function harness(words: TimedText[], opts: { onDevice?: boolean; host?: FakeHostOptions } = {}): { ed: EditHarness; clip: string; file: string; asked: string[] } {
  const ed = new EditHarness({ host: opts.host ?? {} });
  const file = ed.addFile("video", { hasAudio: true, duration: 60, name: "talk.mp4" });
  const clip = ed.addClip(file, { position: 0, end: 60 });
  const asked: string[] = [];
  ed.host.audio!.transcribe = async (path, options) => {
    asked.push(`${path}|${options?.prompt ?? ""}`);
    return { language: "en", model: "whisper-base", words: structuredClone(words), segments: [], durationSeconds: 60, ...(opts.onDevice ? { onDevice: true } : {}) };
  };
  if (opts.onDevice) ed.host.audio!.transcribesOnDevice = true;
  return { ed, clip, file, asked };
}

describe("align_lyrics_tool", () => {
  it("keeps the lyrics' spelling with heard times, and captions and transcripts use them", async () => {
    const heard = [...spoken("excuse me while i kiss this guy", 1), ...spoken("purple haze all in my brain", 10)];
    const { ed, clip, asked } = harness(heard, { onDevice: true });
    const lyrics = "'Scuse me while I kiss the sky\nPurple haze, all in my brain";
    const receipt = await ed.call("align_lyrics_tool", { timeline_clip_id: clip, text: lyrics });
    expect(receipt.status, receipt.summary).toBe("applied");
    expect(receipt.summary).toMatch(/^Aligned 13 words in 2 line\(s\) to clip \w+: \d+% heard \(whisper-base, on device\)\.$/);
    expect(asked[0]).toContain("|'Scuse me while I kiss the sky Purple haze, all in my brain");
    const lines = (receipt.data as { lines: { text: string; start: number; end: number }[] }).lines;
    expect(lines[0]).toMatchObject({ text: "'Scuse me while I kiss the sky" });
    expect(lines[1]!.start).toBe(10);
    // The heard words are the file's transcript now: the transcript reads the lyrics.
    const transcript = await ed.call("get_transcript_tool", { clipId: clip, includeWords: true });
    expect(JSON.stringify(transcript.data)).toContain("haze,");
    expect(JSON.stringify(transcript.data)).not.toContain("guy");
  });

  it("warns when most of the words were not heard", async () => {
    const { ed, clip } = harness(spoken("oh oh oh yeah", 1));
    const receipt = await ed.call("align_lyrics_tool", { timeline_clip_id: clip, text: "Never gonna give you up\nnever gonna let you down" });
    expect(receipt.status).toBe("applied");
    expect(receipt.warnings.join(" ")).toMatch(/only 0% of the words were heard/);
  });

  it("is unavailable without speech recognition", async () => {
    const ed = new EditHarness({ host: { omit: ["audio.transcribe"] } });
    const clip = ed.addClip(ed.addFile("audio", { name: "song.mp3" }), { position: 0, end: 30 });
    const receipt = await ed.call("align_lyrics_tool", { timeline_clip_id: clip, text: "la la" });
    expect(receipt.status).toBe("refused");
    expect(receipt.summary).toContain("zenvi speech setup");
  });
});

describe("place_on_word_tool", () => {
  it("lands a title on every time a word is said, its text the word, each on the word's frame", async () => {
    const { ed } = harness([...spoken("the camera is great", 1), ...spoken("this camera again", 8)]);
    const receipt = await ed.call("place_on_word_tool", { word: "camera", every: true, what: "title", args: { duration_seconds: 1 } });
    expect(receipt.status, receipt.summary).toBe("applied");
    expect(receipt.summary).toMatch(/^Placed 2 title\(s\) on "camera" at 1\.40s, 8\.40s, each on its word's frame\.$/);
    const placements = (receipt.data as { placements: { missFrames: number; word: string }[] }).placements;
    expect(placements.map((p) => p.missFrames)).toEqual([0, 0]);
    // One undo step removes both titles.
    const clips = ed.doc.project.clips.length;
    ed.doc.undo();
    expect(ed.doc.project.clips.length).toBeLessThan(clips);
    expect(ed.doc.project.clips).toHaveLength(1);
  });

  it("leads the word by offset_frames and lands after a phrase with anchor=end", async () => {
    const { ed } = harness(spoken("and then boom it happened", 2, 0.5));
    const lead = await ed.call("place_on_word_tool", { word: "boom", what: "cut", offset_frames: -3 });
    expect(lead.status, lead.summary).toBe("applied");
    // boom starts at 3.0 s; three frames earlier at 30 fps.
    expect((lead.data as { placements: { target: number }[] }).placements[0]!.target).toBe(2.9);
    const after = await ed.call("place_on_word_tool", { word: "it happened", what: "cut", anchor: "end" });
    expect((after.data as { placements: { target: number }[] }).placements[0]!.target).toBe(4.4);
  });

  it("refuses a missing occurrence and says which words are close", async () => {
    const { ed } = harness(spoken("cameras and lenses", 1));
    const steps = ed.doc.undoLabels.length;
    const second = await ed.call("place_on_word_tool", { word: "lenses", occurrence: 2, what: "cut" });
    expect(second.summary).toBe('Error: "lenses" is said 1 time(s); occurrence 2 does not exist.');
    const close = await ed.call("place_on_word_tool", { word: "camera", what: "cut" });
    expect(close.summary).toMatch(/^Error: "camera" is not said in the speech searched\. Close words: cameras/);
    const noFile = await ed.call("place_on_word_tool", { word: "cameras", what: "clip" });
    expect(noFile.summary).toBe("Error: what=clip needs args.file_id (the media-bin file to cut to).");
    expect(ed.doc.undoLabels).toHaveLength(steps);
  });
});

describe("insert_broll_on_words_tool", () => {
  const talk =
    "Last summer we drove across Iceland in an old camper. The glaciers were enormous and the waterfalls never stopped. " +
    "We camped near Vik where the black beaches meet the ocean. Every morning the puffins circled the cliffs. " +
    "By the end the camper needed new tyres and we needed coffee.";

  it("cuts away on content words every 5-8 seconds, muted, from different sources, in one undo step", async () => {
    const { ed, clip } = harness(spoken(talk, 0.5, 0.45));
    const sources = ["glacier.mp4", "beach.mp4", "puffin.mp4", "road.mp4", "coffee.mp4", "cliffs.mp4"].map((name) => ed.addFile("video", { name, duration: 8 }));
    const receipt = await ed.call("insert_broll_on_words_tool", { timeline_clip_ids: [clip] });
    expect(receipt.status, receipt.summary).toBe("applied");
    const inserts = (receipt.data as { inserts: { at: number; word: string; file_id: string; clip_id: string; seconds: number }[] }).inserts;
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < inserts.length; i += 1) {
      const gap = inserts[i]!.at - inserts[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(gap).toBeLessThanOrEqual(8 + 1e-6);
    }
    expect(new Set(inserts.map((r) => r.file_id)).size).toBe(inserts.length);
    for (const r of inserts) {
      expect(sources).toContain(r.file_id);
      expect(r.word).not.toMatch(/^(the|and|we|were|in|an)$/i);
      expect(r.seconds).toBe(1.2);
      const placed = ed.clip(r.clip_id)!;
      expect((placed.volume as { Points: { co: { Y: number } }[] }).Points[0]!.co.Y).toBe(0);
    }
    // A file named for the word goes on it.
    const glacier = inserts.find((r) => /glacier/i.test(r.word));
    if (glacier) expect(glacier.file_id).toBe(sources[0]);
    ed.doc.undo();
    expect(ed.doc.project.clips).toHaveLength(1);
  });

  it("finds stock for each keyword with stock=true", async () => {
    const video = (id: number) => ({
      id,
      width: 1920,
      height: 1080,
      duration: 12,
      user_name: `user${id}`,
      url: `https://www.pexels.com/video/clip-${id}/`,
      video_files: [{ quality: "hd", file_type: "video/mp4", width: 1280, height: 720, link: `https://cdn.test/${id}-720.mp4` }],
    });
    const pexels = { total_results: 2, videos: [video(31), video(32)] };
    const { ed, clip } = harness(spoken(talk, 0.5, 0.45), { host: { routes: { "/api/v1/pexels/search": () => pexels }, without: ["frames"] } });
    const receipt = await ed.call("insert_broll_on_words_tool", { timeline_clip_ids: [clip], keywords: ["glaciers", "puffins"], stock: true });
    expect(receipt.status, receipt.summary).toBe("applied");
    const inserts = (receipt.data as { inserts: { word: string; file_id: string }[] }).inserts;
    expect(inserts.map((r) => r.word)).toEqual(["glaciers", "puffins"]);
    expect(new Set(inserts.map((r) => r.file_id)).size).toBe(2);
    // The imports and the inserts are one undo step.
    ed.doc.undo();
    expect(ed.doc.project.files).toHaveLength(1);
  });

  it("refuses when there is no B-roll to cut to", async () => {
    const { ed, clip } = harness(spoken(talk));
    const receipt = await ed.call("insert_broll_on_words_tool", { timeline_clip_ids: [clip] });
    expect(receipt.summary).toMatch(/^Error: the media bin has no B-roll/);
  });
});

describe("word helpers", () => {
  const words = (items: [string, number][]): TimelineWord[] => items.map(([text, start]) => ({ text, key: text.toLowerCase().replace(/[^a-z0-9]/g, ""), start, end: start + 0.3, clipId: "C", exact: true }));

  it("findPhrase finds consecutive words, ignoring case and punctuation", () => {
    const hits = findPhrase(words([["Hit", 1], ["the", 1.3], ["Road,", 1.6], ["hit", 5], ["the", 5.3], ["road", 5.6]]), "hit the road");
    expect(hits.map((h) => h.start)).toEqual([1, 5]);
  });

  it("pickBrollWords skips function words and keeps the spacing", () => {
    const list = words([["the", 0], ["Iceland", 2.2], ["and", 4], ["glaciers", 7.5], ["really", 9], ["puffins", 13], ["we", 14]]);
    const picked = pickBrollWords(list, { minGap: 5, maxGap: 8, notBefore: 1, maxCount: 5 });
    expect(picked.map((w) => w.text)).toEqual(["Iceland", "glaciers", "puffins"]);
  });
});
