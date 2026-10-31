import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseTranscription } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeAudio, makeSpeech, makeTempDir, removeDir } from "../test-support/fixtures.js";
import { createNodeHost } from "../host/node-host.js";
import { modelAssets, modelDir } from "../matte/model-cache.js";
import { cacheDir } from "../svg/fonts.js";
import { speechRuntimeDir } from "./runtime.js";
import { chunksToAnswer, localSpeechReady, segmentWords, transcribeLocally } from "./local.js";
import { SPEECH_MODELS, speechModelBytes, speechModelId, speechModelPresent } from "./models.js";

let dir: string;
/** Tests point the cache at a temp folder; the speech model is read from the person's own cache, where setup put it. */
const userCache = { ...process.env, ZENVI_CACHE_DIR: cacheDir({ ...process.env, ZENVI_CACHE_DIR: "" }) };

beforeAll(async () => {
  dir = await makeTempDir("zenvi-local-speech-");
});

afterAll(async () => {
  await removeDir(dir);
});

describe("Whisper's answer", () => {
  it("becomes the backend's shape: words, sentence segments, an open last word closed at the end", () => {
    const answer = chunksToAnswer(
      [
        { text: " Hello", timestamp: [0.1, 0.4] },
        { text: " world.", timestamp: [0.4, 0.9] },
        { text: " Again", timestamp: [2.5, 2.9] },
        { text: " now", timestamp: [2.9, null] },
      ],
      { language: "en", model: "whisper-base", durationSeconds: 3.4 },
    );
    const t = parseTranscription(answer);
    expect(t.words.map((w) => [w.text, w.startSec, w.endSec])).toEqual([
      ["Hello", 0.1, 0.4],
      ["world.", 0.4, 0.9],
      ["Again", 2.5, 2.9],
      ["now", 2.9, 3.4],
    ]);
    expect(t.segments.map((s) => s.text)).toEqual(["Hello world.", "Again now"]);
    expect(t.durationSeconds).toBe(3.4);
  });

  it("splits segments at long pauses as well as at sentence ends", () => {
    const words = [
      { text: "one", startSec: 0, endSec: 0.3 },
      { text: "two", startSec: 0.35, endSec: 0.6 },
      { text: "three", startSec: 2, endSec: 2.4 },
    ];
    expect(segmentWords(words).map((s) => s.text)).toEqual(["one two", "three"]);
  });
});

describe("speech models", () => {
  it("pin every file with a checksum and a size, and say how much they download", () => {
    for (const model of Object.values(SPEECH_MODELS)) {
      for (const asset of modelAssets(model)) {
        expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(asset.url).toMatch(/^https:\/\//);
      }
      expect(model.license).toBe("MIT");
    }
    expect(speechModelBytes(SPEECH_MODELS.base) / 2 ** 20).toBeLessThan(90);
    expect(speechModelBytes(SPEECH_MODELS.small) / 2 ** 20).toBeLessThan(260);
  });

  it("read the model from ZENVI_SPEECH_MODEL", () => {
    expect(speechModelId({})).toBe("base");
    expect(speechModelId({ ZENVI_SPEECH_MODEL: "Small" })).toBe("small");
    expect(speechModelId({ ZENVI_SPEECH_MODEL: "large" })).toBe("base");
  });

  it("are not there in an empty cache, and the host then does not offer local speech", () => {
    const env = { ZENVI_CACHE_DIR: path.join(dir, "empty-cache"), ZENVI_SPEECH: "local" };
    expect(speechModelPresent(SPEECH_MODELS.base, { env })).toBe(false);
    expect(localSpeechReady({ env })).toBe(false);
    const host = createNodeHost({ env });
    expect(host.audio?.transcribe).toBeUndefined();
    expect(host.audio?.transcribesOnDevice).toBeUndefined();
  });
});

describe("a runtime that will not start", () => {
  it("falls back to the Zenvi backend, except for a call made because on-device speech is free", async () => {
    const env = { ZENVI_CACHE_DIR: path.join(dir, "broken-cache"), ZENVI_SPEECH: "auto" };
    const pkg = path.join(speechRuntimeDir(env), "node_modules", "@huggingface", "transformers");
    await mkdir(pkg, { recursive: true });
    await writeFile(path.join(speechRuntimeDir(env), "package.json"), "{}");
    await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "@huggingface/transformers", main: "index.js" }));
    await writeFile(path.join(pkg, "index.js"), 'throw new Error("broken build");\n');
    const model = SPEECH_MODELS.base;
    for (const asset of modelAssets(model)) {
      const file = path.join(modelDir(model, { env }), asset.file);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "");
    }
    const uploads: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      uploads.push(String(url));
      return new Response(JSON.stringify({ language: "en", model: "whisper-1", duration_seconds: 1, words: [{ word: "hello", start: 0.1, end: 0.5 }], segments: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const host = createNodeHost({ env, backend: { baseUrl: "http://127.0.0.1:9", token: async () => "t", fetchImpl } });
    expect(host.audio?.transcribesOnDevice).toBe(true);
    const file = await makeAudio(dir, "tone.wav", { duration: 1 });
    await expect(host.audio!.transcribe!(file, { onDeviceOnly: true })).rejects.toMatchObject({ code: "unavailable" });
    expect(uploads).toEqual([]);
    const t = await host.audio!.transcribe!(file);
    expect(t.words.map((w) => w.text)).toEqual(["hello"]);
    expect(t.onDevice).toBeUndefined();
    expect(uploads).toHaveLength(1);
  });
});

// Runs where `zenvi speech setup` has run (the runtime and weights are in Zenvi's cache) and the system can speak.
describe.runIf(localSpeechReady({ env: userCache }))("on-device transcription", () => {
  it("hears generated speech with word timings", async () => {
    const file = await makeSpeech(dir, "fox.wav", "The quick brown fox jumps over the lazy dog.", { padSeconds: 1 });
    if (!file) return;
    const t = await transcribeLocally(file, { env: userCache });
    expect(t.onDevice).toBe(true);
    expect(t.language).toBe("en");
    const words = t.words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, ""));
    expect(words).toEqual(expect.arrayContaining(["quick", "brown", "fox", "lazy", "dog"]));
    // The voice starts after a second of silence; words follow each other.
    expect(t.words[0]!.startSec).toBeGreaterThan(0.7);
    for (let i = 1; i < t.words.length; i += 1) expect(t.words[i]!.startSec).toBeGreaterThanOrEqual(t.words[i - 1]!.startSec);
    expect(t.words[t.words.length - 1]!.endSec).toBeLessThanOrEqual(t.durationSeconds + 0.01);
  }, 120_000);

  it("is the node host's transcribe, marked on device", async () => {
    const file = await makeSpeech(dir, "host.wav", "Captions land on every word.");
    if (!file) return;
    const host = createNodeHost({ env: { ...userCache, ZENVI_SPEECH: "auto" } });
    expect(host.audio?.transcribesOnDevice).toBe(true);
    const t = await host.audio!.transcribe!(file);
    expect(t.words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, ""))).toEqual(expect.arrayContaining(["captions", "every", "word"]));
  }, 120_000);
});
