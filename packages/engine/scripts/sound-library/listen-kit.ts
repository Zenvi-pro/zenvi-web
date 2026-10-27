/**
 * The curation's listening pass: an audio model hears every curated sound
 * (curate-kit.ts select's curated.json), eight at a time, each told its
 * category, and says whether it is a clean recording of that kind of sound
 * or noisy, synthetic-sounding, the wrong thing, or made of several sounds.
 * Its verdicts go to listen.json (id -> {ok, quality, note}); select reads
 * them, drops what failed, and refills the group; run this again for the
 * newcomers (sounds already heard are skipped).
 *
 *   OPENAI_API_KEY=... npx tsx listen-kit.ts <work-dir>
 *
 * The key is read from the environment and never written. Each sound is
 * cut to its first 6 s around the onset with ffmpeg (beds and typing runs
 * do not need more to judge).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Measured } from "./curate-kit.js";

const MODEL = process.env.KIT_LISTEN_MODEL ?? "gpt-audio-1.5";
const BATCH = 8;

interface Verdict {
  ok: boolean;
  quality: number;
  note: string;
}

const RULES =
  "You are a senior sound editor choosing sounds for a professional sound-effects library used in short-form video (Reels, ads, product promos). " +
  "You will hear several numbered sounds, each with the category it is meant to fill. For each one decide if it belongs in a high-quality library for that category. " +
  "Refuse (ok=false) a sound that: has audible hiss, hum, room noise or wind rumble; is distorted or clipped; sounds synthetic or cheap (a chiptune blip, a toy) where a real recording is wanted " +
  "(for glitch, sparkle and notify a clean electronic or tonal sound is fine); is not that kind of sound; has speech or music in it; is several different sounds in a row where one is wanted " +
  "(typing and ambience are naturally long); or is so quiet, muffled or lo-fi that it would not cut through on a phone. " +
  "quality 1-5: 5 = pro library grade, 3 = usable, 1 = unusable. Be strict: about a quarter of what you hear should fail. " +
  'Answer only JSON: {"verdicts":[{"n":1,"ok":true,"quality":4,"note":"<what you heard>"}, ...]} with one entry per sound, notes at most 12 words.';

function clip(file: string, onsetMs: number): string {
  const out = execFileSync("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, onsetMs / 1000 - 0.05)), "-t", "6", "-i", file, "-ac", "1", "-ar", "24000", "-b:a", "64k", "-f", "mp3", "-"], { maxBuffer: 32 * 1024 * 1024 });
  return out.toString("base64");
}

async function listen(batch: readonly Measured[], previews: string, key: string): Promise<Verdict[]> {
  const content: unknown[] = [{ type: "text", text: RULES }];
  batch.forEach((m, i) => {
    content.push({ type: "text", text: `Sound ${i + 1} — category: ${m.group} (named "${m.name}")` });
    content.push({ type: "input_audio", input_audio: { data: clip(path.join(previews, `${m.id}.mp3`), m.analysis.onsetMs), format: "mp3" } });
  });
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, modalities: ["text"], temperature: 0.1, messages: [{ role: "user", content }] }),
    });
    if (response.ok) {
      const data = (await response.json()) as { choices: { message: { content: string } }[] };
      const text = data.choices[0]!.message.content;
      const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { verdicts: (Verdict & { n: number })[] };
      return batch.map((_, i) => json.verdicts.find((v) => v.n === i + 1) ?? { ok: true, quality: 3, note: "no verdict" });
    }
    if (attempt >= 3 || ![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`OpenAI answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
  }
}

const [dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: listen-kit.ts <work-dir>");
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("listen-kit.ts needs OPENAI_API_KEY in the environment");
const file = path.join(dir, "listen.json");
const heard = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Verdict>) : {};
const todo = (JSON.parse(readFileSync(path.join(dir, "curated.json"), "utf8")) as Measured[]).filter((m) => !heard[m.id]);
// Batches stay within one category where they can, so the model compares like with like.
todo.sort((a, b) => a.group.localeCompare(b.group) || a.id - b.id);
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const verdicts = await listen(batch, path.join(dir, "previews"), key);
  batch.forEach((m, k) => (heard[m.id] = { ok: verdicts[k]!.ok && verdicts[k]!.quality >= 3, quality: verdicts[k]!.quality, note: verdicts[k]!.note }));
  writeFileSync(file, JSON.stringify(heard, null, 1));
  console.log(`${Math.min(i + BATCH, todo.length)}/${todo.length}: ${batch.map((m, k) => `${m.group}:${m.id}=${verdicts[k]!.ok ? verdicts[k]!.quality : "x"}`).join(" ")}`);
}
const all = Object.values(heard);
console.log(`${all.length} heard, ${all.filter((v) => !v.ok).length} refused`);
