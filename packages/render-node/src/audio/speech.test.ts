import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isTranscriptionError, SPEECH_NOT_AVAILABLE, type TranscriptionError } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffprobe } from "../probe/ffprobe.js";
import { makeAudio, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { backendSpeechUpload } from "../host/backend.js";
import { createNodeHost } from "../host/node-host.js";
import { FLAC_SPEECH, MP3_SPEECH, extractSpeechAudio, speechFormat, transcribeMediaFile, type SpeechPiece, type SpeechUpload } from "./speech.js";

let dir: string;
let server: Server;
let baseUrl: string;
/** What the fake backend received: headers and the multipart body as text (latin1). */
const received: { auth?: string; contentType?: string; body: string }[] = [];
/** The fake backend's answer to the next request. */
let next: { status: number; body: unknown } = { status: 200, body: {} };

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-speech-");
  server = createServer((req, res) => {
    void readBody(req).then((body) => {
      received.push({ auth: req.headers.authorization, contentType: req.headers["content-type"], body: body.toString("latin1") });
      res.writeHead(req.url === "/api/v1/transcription" ? next.status : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/api/v1/transcription" ? next.body : { detail: "Not Found" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await removeDir(dir);
});

/** An upload that records each piece and answers one word per piece, 0.5 s in. */
function recordingUpload(pieces: SpeechPiece[]): SpeechUpload {
  return async (piece, fields) => {
    pieces.push(piece);
    return {
      text: `piece ${pieces.length}.`,
      language: "english",
      duration_seconds: 1,
      model: "whisper-1",
      words: [{ text: "piece", startSec: 0.5, endSec: 0.9 }],
      segments: [{ text: `Piece ${pieces.length}${fields.language ? ` ${fields.language}` : ""}.`, startSec: 0.4, endSec: 1 }],
    };
  };
}

describe("speech audio for the backend", () => {
  it("extracts mono 16 kHz speech audio, MP3 when ffmpeg can", async () => {
    const tone = await makeAudio(dir, "tone.wav", { hz: 440, duration: 3, sampleRate: 48000, channels: 2 });
    const format = await speechFormat();
    expect([MP3_SPEECH, FLAC_SPEECH]).toContain(format);
    const bytes = await extractSpeechAudio(tone, { start: 1, duration: 1.5 }, format);
    const out = `${dir}/piece.${format.extension}`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(out, bytes);
    const probe = await ffprobe(out);
    const audio = probe.streams.find((s) => s.codec_type === "audio")!;
    expect(audio.channels).toBe(1);
    expect(audio.sample_rate).toBe("16000");
    expect(Number(probe.format.duration)).toBeGreaterThan(1.3);
    expect(Number(probe.format.duration)).toBeLessThan(1.7);
  });

  it("transcribes in pieces with their offsets, and refuses media without sound", async () => {
    const tone = await makeAudio(dir, "talk.wav", { hz: 300, duration: 2.5 });
    const pieces: SpeechPiece[] = [];
    const short = { ...FLAC_SPEECH, chunkSeconds: 1 };
    const result = await transcribeMediaFile(tone, { upload: recordingUpload(pieces), format: short, language: "en", prompt: "hmm" });
    expect(pieces.map((p) => p.offset)).toHaveLength(3);
    expect(pieces[0]!.offset).toBe(0);
    expect(pieces[0]!.fileName).toBe("talk-1.flac");
    expect(pieces[0]!.contentType).toBe("audio/flac");
    expect(result.words.map((w) => w.text)).toEqual(["Piece", "Piece", "Piece"]);
    result.words.forEach((w, i) => expect(w.startSec).toBeCloseTo(pieces[i]!.offset + 0.5, 3));
    // Each split sits before the piece's limit, the last piece ends the media.
    expect(pieces[1]!.offset).toBeGreaterThan(0.5);
    expect(pieces[1]!.offset).toBeLessThanOrEqual(1);
    expect(result.language).toBe("en");
    expect(result.model).toBe("whisper-1");
    const silent = await makeVideo(dir, "silent.mp4", { duration: 1, width: 64, height: 48 });
    const error = await transcribeMediaFile(silent, { upload: recordingUpload([]) }).catch((e: unknown) => e);
    expect(isTranscriptionError(error) && (error as TranscriptionError).code).toBe("no_audio");
  });
});

describe("backendSpeechUpload", () => {
  it("posts the audio, language and prompt as multipart with the signed-in token", async () => {
    next = { status: 200, body: { words: [], segments: [], language: "english", model: "whisper-1", duration_seconds: 1 } };
    const upload = backendSpeechUpload({ baseUrl: `${baseUrl}/`, token: async () => "tok-1" });
    const answer = await upload({ bytes: new Uint8Array([73, 68, 51]), fileName: "talk.mp3", contentType: "audio/mpeg", offset: 0 }, { language: "en", prompt: "Umm" });
    expect(answer).toMatchObject({ model: "whisper-1" });
    const sent = received.at(-1)!;
    expect(sent.auth).toBe("Bearer tok-1");
    expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent.body).toContain('name="file"; filename="talk.mp3"');
    expect(sent.body).toContain("Content-Type: audio/mpeg");
    expect(sent.body).toMatch(/name="language"\r\n\r\nen\r\n/);
    expect(sent.body).toMatch(/name="prompt"\r\n\r\nUmm\r\n/);
  });

  it("turns the backend's answers into errors in words", async () => {
    const upload = backendSpeechUpload({ baseUrl });
    const piece = { bytes: new Uint8Array([1]), fileName: "a.mp3", contentType: "audio/mpeg", offset: 0 };
    const cases: [number, unknown, string, RegExp][] = [
      [404, { detail: "Not Found" }, "unavailable", new RegExp(SPEECH_NOT_AVAILABLE)],
      [401, { detail: "Not authenticated" }, "sign_in", /zenvi login/],
      [402, { detail: "Insufficient credits" }, "credits", /not enough Zenvi credits/],
      [502, { detail: { code: "provider_error", message: "Transcription failed: boom" } }, "failed", /HTTP 502\): Transcription failed: boom/],
    ];
    for (const [status, body, code, message] of cases) {
      next = { status, body };
      const error = await upload(piece, { language: "", prompt: "" }).catch((e: unknown) => e);
      expect(isTranscriptionError(error), String(status)).toBe(true);
      expect((error as TranscriptionError).code).toBe(code);
      expect((error as TranscriptionError).message).toMatch(message);
    }
    const down = backendSpeechUpload({ baseUrl: "http://127.0.0.1:9" });
    const error = await down(piece, { language: "", prompt: "" }).catch((e: unknown) => e);
    expect((error as TranscriptionError).code).toBe("failed");
  });

  it("is what the Node host's transcribe sends, only with a backend", async () => {
    next = {
      status: 200,
      body: { language: "english", model: "whisper-1", duration_seconds: 2, words: [{ text: "hello", startSec: 0.2, endSec: 0.6 }], segments: [{ text: "Hello!", startSec: 0, endSec: 1 }] },
    };
    const tone = await makeAudio(dir, "host.wav", { hz: 200, duration: 2 });
    expect(createNodeHost().audio!.transcribe).toBeUndefined();
    const host = createNodeHost({ backend: { baseUrl, token: async () => "tok-2" } });
    const result = await host.audio!.transcribe!(tone, { language: "", prompt: "" });
    expect(result.words).toEqual([{ text: "Hello!", startSec: 0.2, endSec: 0.6 }]);
    expect(received.at(-1)!.auth).toBe("Bearer tok-2");
  });
});
