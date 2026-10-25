import { SPEECH_SAMPLE_RATE, TRANSCRIPTION_PATH, isTranscriptionError } from "@zenvi/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backendWavUpload, encodeWav, transcribeSamples, type WavUpload } from "./transcribe";

afterEach(() => vi.unstubAllGlobals());

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM WAV", () => {
    const wav = encodeWav(Float32Array.from([0, 0.5, -1, 2]), 16000);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 16))).toBe("WAVEfmt ");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)]).toEqual([0, 16383, -32768, 32767]);
  });
});

describe("transcribeSamples", () => {
  it("sends long audio in WAV pieces split at a pause and merges the words with their offsets", async () => {
    const rate = SPEECH_SAMPLE_RATE;
    // 25 s of tone with a pause at 8.5-9 s; pieces of at most 10 s.
    const mono = new Float32Array(25 * rate).map((_, i) => 0.3 * Math.sin(i / 3));
    mono.fill(0, Math.round(8.5 * rate), 9 * rate);
    const sent: { name: string; seconds: number; language: string }[] = [];
    const upload: WavUpload = async (wav, name, fields) => {
      sent.push({ name, seconds: (wav.length - 44) / 2 / rate, language: fields.language });
      return { language: "english", model: "whisper-1", duration_seconds: 1, words: [{ text: "hi", startSec: 0.25, endSec: 0.5 }], segments: [{ text: "Hi.", startSec: 0, endSec: 1 }] };
    };
    const result = await transcribeSamples(mono, { upload, chunkSeconds: 10, language: "en", name: "My talk.mov" });
    expect(sent.map((s) => s.name)).toEqual(["My_talk-1.wav", "My_talk-2.wav", "My_talk-3.wav"]);
    expect(sent[0]!.seconds).toBeGreaterThan(8.5);
    expect(sent[0]!.seconds).toBeLessThan(9);
    expect(sent.every((s) => s.language === "en")).toBe(true);
    expect(result.words[1]!.startSec).toBeCloseTo(sent[0]!.seconds + 0.25, 2);
    expect(result.words.map((w) => w.text)).toEqual(["Hi.", "Hi.", "Hi."]);
  });

  it("posts multipart to the backend and turns a 404 into words", async () => {
    const requests: { url: string; body: FormData }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, body: init.body as FormData });
      return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    });
    const error = await backendWavUpload(encodeWav(new Float32Array(16), 16000), "talk.wav", { language: "", prompt: "Umm" }).catch((e: unknown) => e);
    expect(isTranscriptionError(error) && error.code).toBe("unavailable");
    expect(requests[0]!.url.endsWith(TRANSCRIPTION_PATH.replace("/api/v1", ""))).toBe(true);
    expect((requests[0]!.body.get("file") as File).type).toBe("audio/wav");
    expect(requests[0]!.body.get("prompt")).toBe("Umm");
    expect(requests[0]!.body.get("language")).toBeNull();
  });
});
