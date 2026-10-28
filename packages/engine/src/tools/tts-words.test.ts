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
    const transcript = await ed.call("get_transcript_tool", { clipId, includeWords: true });
    expect(transcript.status, transcript.summary).toBe("applied");
    expect(JSON.stringify(transcript.data)).toContain("Welcome");
  });
});
