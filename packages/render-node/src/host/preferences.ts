/**
 * Taste data: every side-by-side judgment appended to a JSONL file
 * (`ZENVI_PREFERENCES_LOG`), one `PreferenceRecord` per order watched, the
 * renders named by the SHA-256 of their bytes so a row still means
 * something after the files move. The bench and the owner's rating page
 * (~/zenvi-motion/bench/rate) write the same shape into the same file.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PreferenceRecord } from "@zenvi/engine";

export async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface PreferenceInput {
  source: string;
  judge: string;
  prompt: string;
  brief?: string;
  a: { path: string; seconds: number };
  b: { path: string; seconds: number };
  winner: PreferenceRecord["winner"];
  scores: PreferenceRecord["scores"];
}

/** Append one row. One `appendFile` per row (O_APPEND), so concurrent writers do not interleave lines. */
export async function appendPreference(log: string, input: PreferenceInput, now: () => Date = () => new Date()): Promise<PreferenceRecord> {
  const side = async (s: { path: string; seconds: number }) => ({ sha256: await fileSha256(s.path), path: s.path, seconds: Math.round(s.seconds * 100) / 100 });
  const record: PreferenceRecord = {
    v: 1,
    at: now().toISOString(),
    source: input.source,
    judge: input.judge,
    prompt: input.prompt,
    brief_sha256: input.brief ? createHash("sha256").update(input.brief).digest("hex") : null,
    a: await side(input.a),
    b: await side(input.b),
    winner: input.winner,
    scores: input.scores,
  };
  await mkdir(path.dirname(path.resolve(log)), { recursive: true });
  await appendFile(log, `${JSON.stringify(record)}\n`);
  return record;
}
