/**
 * Speech to text on the web surfaces: what the engine's speech tools and the
 * hosts that transcribe (`AudioHost.transcribe`) agree on.
 *
 * Zenvi desktop transcribes on device (faster-whisper or Apple
 * SpeechAnalyzer, zenvi-core src/classes/speech/asr.py) and keeps words as
 * {text, startSec, endSec} (speech/cache.py `Word`). Zenvi Cloud, the zenvi CLI
 * and the web editor send mono speech audio to the Zenvi backend instead
 * (`POST /api/v1/transcription`, zenvi-backend api/routes/transcription.py)
 * and get the same word shape back. The rules every host shares live here,
 * once: the language and prompt to ask for, how much audio one upload may
 * carry, where long media is split, how the answer is read, and what each
 * backend error means to a person.
 */

import type { AudioEnvelope } from "../tools/types.js";

/** A word or segment of speech, in seconds from the start of the media. */
export interface TimedText {
  text: string;
  startSec: number;
  endSec: number;
}

/** What `AudioHost.transcribe` returns: the speech in a media file. */
export interface Transcription {
  /** ISO 639-1 code of the speech ("en"), or "" when unknown. */
  language: string;
  /** Model that transcribed it, e.g. "whisper-1". */
  model: string;
  /** Spoken words in order, punctuated like the desktop's (see `punctuateWords`). */
  words: TimedText[];
  /** Sentence-like segments, punctuated. */
  segments: TimedText[];
  /** Seconds of audio transcribed. */
  durationSeconds: number;
  /** Heard on this machine (kept as transcriptionSource "local", like the desktop's), not by the Zenvi server. */
  onDevice?: boolean;
}

/** The backend route (zenvi-backend PR #67). */
export const TRANSCRIPTION_PATH = "/api/v1/transcription";
/** The backend refuses larger uploads (413). */
export const TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
/** Media longer than this goes up in pieces: 20 minutes of 32 kbps MP3 is about 4.8 MB. */
export const SPEECH_CHUNK_SECONDS = 20 * 60;
/** Speech audio the hosts send: mono, 16 kHz (what the desktop's ASR reads too). */
export const SPEECH_SAMPLE_RATE = 16000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type TranscriptionErrorCode =
  /** The server has no speech recognition: an older server (404) or one not set up (503). */
  | "unavailable"
  /** Not signed in, or the session expired (401 / 403). */
  | "sign_in"
  /** Out of Zenvi credits (402). */
  | "credits"
  /** The upload is over the server's limit (413). */
  | "too_large"
  /** The server refused the audio or a parameter (415 / 422). */
  | "rejected"
  /** The media has no audio stream. */
  | "no_audio"
  /** Anything else: the provider failed, the network, an unreadable answer. */
  | "failed";

/** A failed transcription, with a message written for a person (no "Error:" prefix). */
export class TranscriptionError extends Error {
  override readonly name = "TranscriptionError";
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const CODES: ReadonlySet<string> = new Set(["unavailable", "sign_in", "credits", "too_large", "rejected", "no_audio", "failed"]);

/** True for a `TranscriptionError`, also one from another copy of this module (bundles). */
export function isTranscriptionError(error: unknown): error is TranscriptionError {
  if (error instanceof TranscriptionError) return true;
  if (!(error instanceof Error) || error.name !== "TranscriptionError") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CODES.has(code);
}

/** What 404 means before zenvi-backend #67 is deployed. */
export const SPEECH_NOT_AVAILABLE = "speech recognition is not available yet on this Zenvi server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The backend's error detail: `{detail: {code, message}}`, `{detail: "…"}` or plain text. */
function detailOf(body: unknown): string {
  if (typeof body === "string") return body.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!isRecord(body)) return "";
  const detail = body.detail ?? body.message ?? body.error;
  if (typeof detail === "string") return detail.trim();
  if (isRecord(detail) && typeof detail.message === "string") return detail.message.trim();
  return "";
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The error for a non-2xx answer of `POST /api/v1/transcription`. */
export function transcriptionHttpError(status: number, body: unknown): TranscriptionError {
  const detail = detailOf(body);
  if (status === 404) return new TranscriptionError("unavailable", `${SPEECH_NOT_AVAILABLE} (it needs a newer Zenvi backend)`);
  if (status === 503) return new TranscriptionError("unavailable", `speech recognition is not set up on this Zenvi server${detail ? ` (${detail.replace(/\.$/, "")})` : ""}`);
  if (status === 401 || status === 403) return new TranscriptionError("sign_in", "transcribing speech needs a Zenvi sign-in; sign in to Zenvi and try again");
  if (status === 402) return new TranscriptionError("credits", sentence(`not enough Zenvi credits to transcribe this audio (2 credits per started minute)${detail ? `: ${detail}` : ""}`));
  if (status === 413) return new TranscriptionError("too_large", sentence(detail || "the audio is over the server's 25 MB limit"));
  if (status === 415 || status === 422) return new TranscriptionError("rejected", sentence(`the Zenvi server refused the audio${detail ? `: ${detail}` : ""}`));
  return new TranscriptionError("failed", sentence(`transcription failed (HTTP ${status})${detail ? `: ${detail}` : ""}`));
}

// ---------------------------------------------------------------------------
// Language and prompt
// ---------------------------------------------------------------------------

/** Whisper's language names by ISO code (openai/whisper tokenizer.py LANGUAGES). */
const WHISPER_LANGUAGES: Readonly<Record<string, string>> = {
  en: "english", zh: "chinese", de: "german", es: "spanish", ru: "russian", ko: "korean", fr: "french", ja: "japanese",
  pt: "portuguese", tr: "turkish", pl: "polish", ca: "catalan", nl: "dutch", ar: "arabic", sv: "swedish", it: "italian",
  id: "indonesian", hi: "hindi", fi: "finnish", vi: "vietnamese", he: "hebrew", uk: "ukrainian", el: "greek", ms: "malay",
  cs: "czech", ro: "romanian", da: "danish", hu: "hungarian", ta: "tamil", no: "norwegian", th: "thai", ur: "urdu",
  hr: "croatian", bg: "bulgarian", lt: "lithuanian", la: "latin", mi: "maori", ml: "malayalam", cy: "welsh", sk: "slovak",
  te: "telugu", fa: "persian", lv: "latvian", bn: "bengali", sr: "serbian", az: "azerbaijani", sl: "slovenian",
  kn: "kannada", et: "estonian", mk: "macedonian", br: "breton", eu: "basque", is: "icelandic", hy: "armenian",
  ne: "nepali", mn: "mongolian", bs: "bosnian", kk: "kazakh", sq: "albanian", sw: "swahili", gl: "galician",
  mr: "marathi", pa: "punjabi", si: "sinhala", km: "khmer", sn: "shona", yo: "yoruba", so: "somali", af: "afrikaans",
  oc: "occitan", ka: "georgian", be: "belarusian", tg: "tajik", sd: "sindhi", gu: "gujarati", am: "amharic",
  yi: "yiddish", lo: "lao", uz: "uzbek", fo: "faroese", ht: "haitian creole", ps: "pashto", tk: "turkmen",
  nn: "nynorsk", mt: "maltese", sa: "sanskrit", lb: "luxembourgish", my: "myanmar", bo: "tibetan", tl: "tagalog",
  mg: "malagasy", as: "assamese", tt: "tatar", haw: "hawaiian", ln: "lingala", ha: "hausa", ba: "bashkir",
  jw: "javanese", su: "sundanese", yue: "cantonese",
};

const CODE_BY_NAME: ReadonlyMap<string, string> = new Map(Object.entries(WHISPER_LANGUAGES).map(([code, name]) => [name, code]));

/**
 * The language a provider reported ("english", "en", "en-US") as an ISO
 * code, or "" when it is not one Zenvi knows. Stored transcripts keep codes,
 * like the desktop's (`TranscriptRecord.language`).
 */
export function speechLanguageCode(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "auto") return "";
  const byName = CODE_BY_NAME.get(raw);
  if (byName) return byName;
  const primary = raw.split(/[-_]/)[0] ?? "";
  return primary in WHISPER_LANGUAGES ? primary : "";
}

/**
 * The `language` to send for a tool's language argument: an ISO 639-1 code
 * ("en-US" → "en", "English" → "en"), or "" to detect it ("auto", blank,
 * unknown). The backend takes two letters only.
 */
export function asrLanguage(language: unknown): string {
  const code = speechLanguageCode(language);
  return /^[a-z]{2}$/.test(code) ? code : "";
}

/**
 * Whisper leaves out "um" and "uh" unless the prompt has them (OpenAI's
 * speech-to-text guide), and cutting fillers is what people ask for most.
 */
export const FILLER_PROMPT = "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking.";

/** The prompt for a request in `language` (an `asrLanguage` code): the filler prompt for English or detection, none otherwise. */
export function transcriptionPrompt(language: string): string {
  return language === "" || language === "en" ? FILLER_PROMPT : "";
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** Valid {text, startSec, endSec} items (also {text|word, start, end}), sorted by start. */
function timedItems(value: unknown): TimedText[] {
  if (!Array.isArray(value)) return [];
  const out: TimedText[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const text = String(item.text ?? item.word ?? "").trim();
    const start = finite(item.startSec ?? item.start);
    const end = finite(item.endSec ?? item.end);
    if (!text || start === null || end === null || start < 0 || end < start) continue;
    out.push({ text, startSec: start, endSec: end });
  }
  return out.map((item, i) => ({ item, i })).sort((a, b) => a.item.startSec - b.item.startSec || a.i - b.i).map(({ item }) => item);
}

/** Lowercase letters and digits only (zenvi-core speech/word_ranges.normalize_word). */
function normalized(value: string): string {
  return Array.from(value.toLowerCase())
    .filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    .join("");
}

/** How far ahead a word looks for its token in the segments' text before giving up. */
const ALIGN_LOOKAHEAD = 12;

/**
 * Words with the punctuation of the segments' text. The backend's words carry
 * none ("Hello", "world"); its segments do ("Hello, world."). The desktop's
 * faster-whisper words keep theirs ("Hello,", "world."), and readable
 * captions, scripts with paragraphs (`wordsToScript`) and sentence-aware
 * phrasing need it. A word takes the next segment token that normalizes to
 * the same letters and digits; words without one stay as they are.
 */
export function punctuateWords(words: readonly TimedText[], segments: readonly TimedText[]): TimedText[] {
  const tokens = segments.flatMap((s) => s.text.split(/\s+/).filter(Boolean));
  const keys = tokens.map(normalized);
  let cursor = 0;
  return words.map((word) => {
    const key = normalized(word.text);
    if (!key) return { ...word };
    for (let k = cursor; k < Math.min(tokens.length, cursor + ALIGN_LOOKAHEAD); k += 1) {
      if (keys[k] === key) {
        cursor = k + 1;
        return { ...word, text: tokens[k]! };
      }
    }
    return { ...word };
  });
}

/** Shorter words have no time to cut or show: Whisper's timestamps step by 20 ms. */
const MIN_WORD_SECONDS = 0.02;

/**
 * Words whose start and end collapsed get a duration back. Whisper squeezes
 * the last word of a stretch of speech to nothing ("watching." 9.08-9.08 after
 * "for" 8.58-9.08), and a word without time would drop out of a clip's words,
 * its captions and its cuts. It gets about 70 ms per character (0.15-0.8 s),
 * never past the next word or the end of the audio.
 */
export function repairWordTimes(words: readonly TimedText[], durationSeconds = Number.POSITIVE_INFINITY): TimedText[] {
  return words.map((word, i) => {
    if (word.endSec - word.startSec >= MIN_WORD_SECONDS) return { ...word };
    const next = words.slice(i + 1).find((w) => w.startSec > word.startSec)?.startSec ?? Number.POSITIVE_INFINITY;
    const audioEnd = durationSeconds > word.startSec ? durationSeconds : Number.POSITIVE_INFINITY;
    const wanted = word.startSec + Math.min(0.8, Math.max(0.15, 0.07 * Array.from(word.text).length));
    const end = Math.max(word.endSec, Math.min(wanted, next, audioEnd));
    return { ...word, endSec: roundMs(end) };
  });
}

/**
 * The backend's answer (`{text, language, duration_seconds, model, words,
 * segments}`) as a Transcription. Throws a TranscriptionError("failed") when
 * it is not one.
 */
export function parseTranscription(answer: unknown): Transcription {
  if (!isRecord(answer) || !Array.isArray(answer.words)) {
    throw new TranscriptionError("failed", "the Zenvi server's transcription answer had no words list");
  }
  const segments = timedItems(answer.segments);
  const reported = finite(answer.duration_seconds ?? answer.durationSeconds);
  const duration = reported !== null && reported > 0 ? reported : undefined;
  const words = repairWordTimes(punctuateWords(timedItems(answer.words), segments), duration);
  const lastEnd = Math.max(0, ...words.map((w) => w.endSec), ...segments.map((s) => s.endSec));
  return {
    language: speechLanguageCode(answer.language),
    model: typeof answer.model === "string" ? answer.model : "",
    words,
    segments,
    durationSeconds: duration ?? lastEnd,
  };
}

/** One transcription from pieces transcribed separately, each starting `offset` seconds into the media. */
export function mergeTranscriptions(parts: readonly { offset: number; transcription: Transcription }[]): Transcription {
  const shift = (items: readonly TimedText[], offset: number): TimedText[] =>
    items.map((t) => ({ text: t.text, startSec: roundMs(t.startSec + offset), endSec: roundMs(t.endSec + offset) }));
  const words = parts.flatMap((p) => shift(p.transcription.words, p.offset));
  const segments = parts.flatMap((p) => shift(p.transcription.segments, p.offset));
  const last = parts[parts.length - 1];
  return {
    language: parts.map((p) => p.transcription.language).find(Boolean) ?? "",
    model: parts.map((p) => p.transcription.model).find(Boolean) ?? "",
    words,
    segments,
    durationSeconds: last ? last.offset + last.transcription.durationSeconds : 0,
  };
}

function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Long media
// ---------------------------------------------------------------------------

/** How far before a piece's end a quieter place to split is looked for. */
const QUIET_SEARCH_SECONDS = 30;
/** Loudness is averaged over this window when looking for a pause. */
const QUIET_WINDOW_SECONDS = 0.3;

/** The centre of the quietest stretch of `envelope` between `from` and `to` seconds. */
function quietestPoint(envelope: AudioEnvelope, from: number, to: number): number {
  const rate = envelope.sampleRate > 0 ? envelope.sampleRate : SPEECH_SAMPLE_RATE;
  const frameSec = Math.max(1, envelope.frameSize) / rate;
  const first = Math.max(0, Math.ceil(from / frameSec));
  const last = Math.min(envelope.rms.length, Math.floor(to / frameSec));
  const width = Math.max(1, Math.round(QUIET_WINDOW_SECONDS / frameSec));
  if (last - first < width) return to;
  let sum = 0;
  for (let i = first; i < first + width; i += 1) sum += Number(envelope.rms[i]) || 0;
  let best = sum;
  let bestStart = first;
  for (let i = first + width; i < last; i += 1) {
    sum += (Number(envelope.rms[i]) || 0) - (Number(envelope.rms[i - width]) || 0);
    // Later wins ties: the pieces stay as long as allowed.
    if (sum <= best) {
      best = sum;
      bestStart = i - width + 1;
    }
  }
  return (bestStart + width / 2) * frameSec;
}

/**
 * Where to split `duration` seconds of media into pieces of at most
 * `maxSeconds`: [start, end] pairs. With the media's loudness envelope each
 * split goes to the quietest moment in the last 30 s before the limit, so a
 * word is not cut in two.
 */
export function planSpeechChunks(duration: number, maxSeconds: number = SPEECH_CHUNK_SECONDS, envelope?: AudioEnvelope): [number, number][] {
  const total = Number(duration);
  if (!(total > 0)) return [];
  const step = Math.max(1, Number(maxSeconds) || SPEECH_CHUNK_SECONDS);
  const chunks: [number, number][] = [];
  let cursor = 0;
  while (total - cursor > step) {
    const limit = cursor + step;
    const from = Math.max(cursor + step / 2, limit - QUIET_SEARCH_SECONDS);
    const cut = envelope ? quietestPoint(envelope, from, limit) : limit;
    chunks.push([cursor, cut]);
    cursor = cut;
  }
  chunks.push([cursor, total]);
  return chunks;
}
