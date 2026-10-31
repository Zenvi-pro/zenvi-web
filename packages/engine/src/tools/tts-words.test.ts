import { describe, expect, it } from "vitest";
import { scriptWordTimes } from "./tts-words.js";
import { EditHarness } from "./test-support/edit-harness.js";

describe("scriptWordTimes", () => {
  it("lays the script over the voice's speech runs by word length, never across a pause", () => {
    const words = scriptWordTimes("Welcome to the show. Stay for the twist!", [[0.5, 2], [2.5, 4.5]], 5);
    expect(words.map((w) => w.text)).toEqual(["Welcome", "to", "the", "show.", "Stay", "for", "the", "twist!"]);
    for (const w of words) {
      expect(w.endSec).toBeGreaterThanOrEqual(w.startSec);
      const inside = (s: number, e: number) => w.startSec >= s - 1e-9 && w.endSec <= e + 1e-9;
      expect(inside(0.5, 2) || inside(2.5, 4.5), JSON.stringify(w)).toBe(true);
    }
    expect(words[0]!.startSec).toBe(0.5);
    expect(words.at(-1)!.endSec).toBe(4.5);
    // Longer words take longer.
    expect(words[0]!.endSec - words[0]!.startSec).toBeGreaterThan(words[1]!.endSec - words[1]!.startSec);
  });

  it("uses the whole file when no speech run was found, and nothing for an empty script", () => {
    expect(scriptWordTimes("One two", [], 2).map((w) => [w.startSec, w.endSec])).toEqual([[0, 1], [1, 2]]);
    expect(scriptWordTimes("  — ", [[0, 1]], 1)).toEqual([]);
  });
});

describe("generate_tts_and_add_to_timeline_tool word timings", () => {
  it("keeps the script's words on the voice's file, so captions and transcripts work with no speech recognition", async () => {
    const ed = new EditHarness({ host: { omit: ["audio.transcribe"] } });
    ed.addClip(ed.addFile("video"), { position: 0, end: 6 });
    const text = (await ed.call("generate_tts_and_add_to_timeline_tool", { text: "Welcome to the show. Stay for the twist", position_seconds: "1" })).summary;
    const clipId = /timeline_clip_id=(\w+)\./.exec(text)![1]!;
    expect(text).toContain(`Its 8 words are timed to the voice's pauses: kinetic_captions_tool timeline_clip_ids=["${clipId}"]`);
    const clip = ed.clip(clipId)!;
    const asr = (ed.doc.project.files.find((f) => f.id === clip.file_id)!.ai_metadata as { asr: { transcriptionSource: string; words: unknown[] } }).asr;
    expect(asr.transcriptionSource).toBe("tts_script");
    expect(asr.words).toHaveLength(8);

    // No one on camera: the captions find the voice by themselves, timed on the timeline (the clip starts at 1 s).
    const captions = await ed.call("kinetic_captions_tool", {});
    expect(captions.status, captions.summary).toBe("applied");
    expect(captions.warnings.join(" ")).toContain("TTS script laid over the voice's pauses");
    // A language given with no speech recognition here still takes the script's words.
    ed.doc.undo();
    const english = await ed.call("kinetic_captions_tool", { language: "en" });
    expect(english.status, english.summary).toBe("applied");
    const transcript = await ed.call("get_transcript_tool", { clipId, includeWords: true });
    expect(transcript.status, transcript.summary).toBe("applied");
    expect(JSON.stringify(transcript.data)).toContain("Welcome");
  });

  it("add_captions_tool captions a voiceover from its script's words (zenvi.pro: 'no speech was found')", async () => {
    for (const omit of [[], ["audio.transcribe"]] as const) {
      const ed = new EditHarness({ host: { omit: [...omit] } });
      ed.addClip(ed.addFile("video"), { position: 0, end: 6 });
      const summary = (await ed.call("generate_tts_and_add_to_timeline_tool", { text: "Captions should follow every word of this voiceover.", position_seconds: "1" })).summary;
      const clipId = /timeline_clip_id=(\w+)\./.exec(summary)![1]!;
      const captions = await ed.call("add_captions_tool", { timeline_clip_id: clipId, style: "classic" });
      expect(captions.status, captions.summary).toBe("applied");
      expect(captions.summary).toMatch(/^Added \d+ caption\(s\) from the transcript/);
      expect(captions.warnings).toContain(`clip ${clipId}: word times are the TTS script laid over the voice's pauses`);
    }
  });

  it("spreads the words over the voice's length when its pauses cannot be measured", async () => {
    const ed = new EditHarness({ host: { without: ["audio"] } });
    ed.addClip(ed.addFile("video"), { position: 0, end: 6 });
    const summary = (await ed.call("generate_tts_and_add_to_timeline_tool", { text: "Stay for the twist", position_seconds: "0" })).summary;
    expect(summary).toMatch(/Its 4 words are spread over the voice's length .*say the timing is approximate\.$/);
    const clipId = /timeline_clip_id=(\w+)\./.exec(summary)![1]!;
    const file = ed.doc.project.files.find((f) => f.id === ed.clip(clipId)!.file_id)!;
    const words = (file.ai_metadata as { asr: { words: { startSec: number; endSec: number }[] } }).asr.words;
    expect(words).toHaveLength(4);
    expect(words[0]!.startSec).toBe(0);
    expect(words.at(-1)!.endSec).toBeCloseTo(Number(file.duration), 2);
  });

  it("captions the TTS voice, not stock footage's ambient sound, when both are on the timeline", async () => {
    const ed = new EditHarness({ host: { omit: ["audio.transcribe"] } });
    ed.addClip(ed.addFile("video", { hasAudio: true }), { position: 0, end: 6 });
    const summary = (await ed.call("generate_tts_and_add_to_timeline_tool", { text: "Welcome to the show", position_seconds: "0" })).summary;
    const voice = /timeline_clip_id=(\w+)\./.exec(summary)![1]!;
    const captions = await ed.call("kinetic_captions_tool", {});
    expect(captions.status, captions.summary).toBe("applied");
    const sources = new Set(ed.doc.project.clips.flatMap((c) => (c.zenvi_kinetic_captions as { source_clip_ids?: string[] } | undefined)?.source_clip_ids ?? []));
    expect([...sources]).toEqual([voice]);
  });

  it("times the script by the words heard in the voice when speech recognition runs on this machine", async () => {
    const ed = new EditHarness();
    const heard = ["welcome", "to", "the", "show", "stay", "for", "the", "twist"].map((text, i) => ({ text, startSec: 0.2 + i * 0.3 + (i >= 4 ? 0.6 : 0), endSec: 0.45 + i * 0.3 + (i >= 4 ? 0.6 : 0) }));
    const asked: string[] = [];
    ed.host.audio!.transcribesOnDevice = true;
    ed.host.audio!.transcribe = async (path, options) => {
      expect(options?.onDeviceOnly).toBe(true);
      asked.push(`${path} ${options?.prompt ?? ""}`);
      return { language: "en", model: "whisper-base", words: heard, segments: [], durationSeconds: 3.5, onDevice: true };
    };
    const summary = (await ed.call("generate_tts_and_add_to_timeline_tool", { text: "Welcome to the show. Stay for the twist!", position_seconds: "0" })).summary;
    expect(summary).toContain("Its 8 words are timed to where they are heard in the voice");
    expect(asked[0]).toMatch(/zenvi_tts_.*Welcome to the show\. Stay for the twist!$/);
    const clipId = /timeline_clip_id=(\w+)\./.exec(summary)![1]!;
    const asr = (ed.doc.project.files.find((f) => f.id === ed.clip(clipId)!.file_id)!.ai_metadata as { asr: { transcriptionSource: string; words: { text: string; startSec: number }[] } }).asr;
    expect(asr.transcriptionSource).toBe("aligned_text");
    expect(asr.words.map((w) => w.text)).toEqual(["Welcome", "to", "the", "show.", "Stay", "for", "the", "twist!"]);
    expect(asr.words[4]!.startSec).toBe(2);
  });
});
