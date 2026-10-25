import { describe, expect, it } from "vitest";
import {
  FILLER_PROMPT,
  SPEECH_NOT_AVAILABLE,
  TranscriptionError,
  asrLanguage,
  isTranscriptionError,
  mergeTranscriptions,
  parseTranscription,
  planSpeechChunks,
  punctuateWords,
  repairWordTimes,
  speechLanguageCode,
  transcriptionHttpError,
  transcriptionPrompt,
} from "./transcription.js";

/** The backend's answer for "Hello, and welcome. Um, this is Zenvi." (whisper-1 words carry no punctuation). */
const ANSWER = {
  text: "Hello, and welcome. Um, this is Zenvi.",
  language: "english",
  duration_seconds: 4.2,
  model: "whisper-1",
  words: [
    { text: "Hello", startSec: 0.1, endSec: 0.5 },
    { text: "and", startSec: 0.6, endSec: 0.8 },
    { text: "welcome", startSec: 0.8, endSec: 1.3 },
    { text: "Um", startSec: 2.0, endSec: 2.3 },
    { text: "this", startSec: 2.5, endSec: 2.7 },
    { text: "is", startSec: 2.7, endSec: 2.8 },
    { text: "Zenvi", startSec: 2.8, endSec: 3.4 },
  ],
  segments: [
    { text: "Hello, and welcome.", startSec: 0.0, endSec: 1.4 },
    { text: "Um, this is Zenvi.", startSec: 1.9, endSec: 3.5 },
  ],
};

describe("parseTranscription", () => {
  it("reads the backend's answer, punctuates words from the segments and keeps an ISO language", () => {
    const t = parseTranscription(ANSWER);
    expect(t.language).toBe("en");
    expect(t.model).toBe("whisper-1");
    expect(t.durationSeconds).toBe(4.2);
    expect(t.words.map((w) => w.text)).toEqual(["Hello,", "and", "welcome.", "Um,", "this", "is", "Zenvi."]);
    expect(t.words[3]).toEqual({ text: "Um,", startSec: 2.0, endSec: 2.3 });
    expect(t.segments).toHaveLength(2);
  });

  it("skips empty and backwards items, sorts by time and accepts start/end and word keys", () => {
    const t = parseTranscription({
      language: "de",
      words: [
        { word: "zwei", start: 1, end: 1.5 },
        { text: "eins", start: "0.2", end: "0.6" },
        { text: " ", startSec: 2, endSec: 3 },
        { text: "rückwärts", startSec: 3, endSec: 2 },
      ],
    });
    expect(t.words.map((w) => w.text)).toEqual(["eins", "zwei"]);
    expect(t.language).toBe("de");
    expect(t.durationSeconds).toBe(1.5);
  });

  it("refuses an answer without a words list", () => {
    expect(() => parseTranscription({ text: "hi" })).toThrow(TranscriptionError);
    expect(() => parseTranscription(null)).toThrow(/no words list/);
  });
});

describe("repairWordTimes", () => {
  it("gives a word Whisper squeezed to nothing a duration, up to the next word and the end of the audio", () => {
    // From a live answer: "Thanks for watching." with "watching." at 9.08-9.08.
    const words = [
      { text: "Thanks", startSec: 8.1, endSec: 8.58 },
      { text: "for", startSec: 8.58, endSec: 9.08 },
      { text: "watching.", startSec: 9.08, endSec: 9.08 },
    ];
    expect(repairWordTimes(words, 11.73)[2]).toEqual({ text: "watching.", startSec: 9.08, endSec: 9.71 });
    expect(repairWordTimes(words, 9.3)[2]!.endSec).toBe(9.3);
    const crowded = [
      { text: "a", startSec: 1, endSec: 1 },
      { text: "b", startSec: 1.05, endSec: 1.4 },
    ];
    expect(repairWordTimes(crowded)[0]!.endSec).toBe(1.05);
    expect(repairWordTimes(words, 11.73).slice(0, 2)).toEqual(words.slice(0, 2));
  });

  it("is applied to the backend's answer", () => {
    const t = parseTranscription({ words: [{ text: "end", startSec: 2, endSec: 2 }], segments: [], duration_seconds: 3 });
    expect(t.words[0]).toEqual({ text: "end", startSec: 2, endSec: 2.21 });
  });
});

describe("punctuateWords", () => {
  it("re-synchronises after a word the segments spell differently", () => {
    const words = [
      { text: "a", startSec: 0, endSec: 1 },
      { text: "wellknown", startSec: 1, endSec: 2 },
      { text: "fact", startSec: 2, endSec: 3 },
    ];
    const out = punctuateWords(words, [{ text: "A well-known fact!", startSec: 0, endSec: 3 }]);
    expect(out.map((w) => w.text)).toEqual(["A", "well-known", "fact!"]);
  });

  it("leaves words alone when the segments do not match them", () => {
    const words = [{ text: "hello", startSec: 0, endSec: 1 }];
    expect(punctuateWords(words, [{ text: "Bonjour.", startSec: 0, endSec: 1 }])).toEqual(words);
  });
});

describe("languages and prompts", () => {
  it("sends two-letter codes or nothing", () => {
    expect(asrLanguage("auto")).toBe("");
    expect(asrLanguage("")).toBe("");
    expect(asrLanguage("en-US")).toBe("en");
    expect(asrLanguage("English")).toBe("en");
    expect(asrLanguage("pt_BR")).toBe("pt");
    expect(asrLanguage("klingon")).toBe("");
    // Whisper knows Cantonese, but the backend takes two letters only.
    expect(asrLanguage("yue")).toBe("");
    expect(speechLanguageCode("cantonese")).toBe("yue");
  });

  it("asks Whisper to keep fillers for English and detected speech only", () => {
    expect(transcriptionPrompt("")).toBe(FILLER_PROMPT);
    expect(transcriptionPrompt("en")).toBe(FILLER_PROMPT);
    expect(transcriptionPrompt("de")).toBe("");
  });
});

describe("transcriptionHttpError", () => {
  it("says in words what each answer means", () => {
    const missing = transcriptionHttpError(404, { detail: "Not Found" });
    expect(missing.code).toBe("unavailable");
    expect(missing.message).toContain(SPEECH_NOT_AVAILABLE);
    expect(transcriptionHttpError(503, { detail: { code: "not_configured", message: "Transcription is not configured on this server." } }).message).toBe(
      "speech recognition is not set up on this Zenvi server (Transcription is not configured on this server)",
    );
    expect(transcriptionHttpError(401, {}).code).toBe("sign_in");
    const credits = transcriptionHttpError(402, { detail: "Insufficient credits" });
    expect(credits.code).toBe("credits");
    expect(credits.message).toBe("not enough Zenvi credits to transcribe this audio (2 credits per started minute): Insufficient credits.");
    expect(transcriptionHttpError(413, { detail: { code: "too_large", message: "The audio is over 25 MB." } }).message).toBe("The audio is over 25 MB.");
    expect(transcriptionHttpError(422, { detail: { code: "bad_language", message: "language is an ISO 639-1 code" } }).code).toBe("rejected");
    const provider = transcriptionHttpError(502, { detail: { code: "provider_error", message: "Transcription failed: timeout" } });
    expect(provider.code).toBe("failed");
    expect(provider.message).toBe("transcription failed (HTTP 502): Transcription failed: timeout.");
    expect(transcriptionHttpError(500, "<html>oops</html>").message).toContain("HTTP 500");
  });

  it("recognises errors from another copy of the module by name and code", () => {
    const foreign = Object.assign(new Error("x"), { name: "TranscriptionError", code: "credits" });
    expect(isTranscriptionError(foreign)).toBe(true);
    expect(isTranscriptionError(Object.assign(new Error("x"), { name: "TranscriptionError", code: "nope" }))).toBe(false);
    expect(isTranscriptionError(new Error("x"))).toBe(false);
  });
});

describe("long media", () => {
  it("keeps short media in one piece and splits long media at the limit", () => {
    expect(planSpeechChunks(0, 600)).toEqual([]);
    expect(planSpeechChunks(300, 600)).toEqual([[0, 300]]);
    expect(planSpeechChunks(1500, 600)).toEqual([
      [0, 600],
      [600, 1200],
      [1200, 1500],
    ]);
  });

  it("splits in the quietest moment before the limit", () => {
    // 100 frames per second of loud audio, with a pause at 585-586 s.
    const rate = 16000;
    const frameSize = 160;
    const seconds = 900;
    const rms = new Float32Array(seconds * 100).fill(0.3);
    for (let i = 58500; i < 58600; i += 1) rms[i] = 0.001;
    const chunks = planSpeechChunks(seconds, 600, { sampleRate: rate, frameSize, rms });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]![1]).toBeGreaterThan(585);
    expect(chunks[0]![1]).toBeLessThan(586);
    expect(chunks[1]).toEqual([chunks[0]![1], 900]);
  });

  it("merges pieces with their offsets", () => {
    const piece = parseTranscription(ANSWER);
    const merged = mergeTranscriptions([
      { offset: 0, transcription: piece },
      { offset: 600, transcription: piece },
    ]);
    expect(merged.words).toHaveLength(14);
    expect(merged.words[7]).toEqual({ text: "Hello,", startSec: 600.1, endSec: 600.5 });
    expect(merged.durationSeconds).toBe(604.2);
    expect(merged.language).toBe("en");
  });
});
