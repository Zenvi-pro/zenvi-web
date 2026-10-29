/**
 * Registers one vitest test per truth case. A case in KNOWN_FAILURES must
 * still fail (so fixing the bug forces removing the entry); every other case
 * must pass. With ZENVI_TOOL_TRUTH_REPORT set, each outcome is appended to
 * `<dir>/cases.jsonl` and its two frames saved for the contact sheet.
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MixPcm } from "@zenvi/engine";
import { encodePng } from "../image/png.js";
import { removeDir } from "../test-support/fixtures.js";
import { caseSlug, fullMode, openSession, runCase, type CaseOutcome, type TruthCase, type TruthSession } from "./harness.js";
import { KNOWN_FAILURES } from "./ledger.js";

/** 16-bit PCM WAV of a mix, for a person to listen to. */
function encodeWav(mix: MixPcm): Buffer {
  const channels = mix.channels.length;
  const frames = mix.channels[0]?.length ?? 0;
  const out = Buffer.alloc(44 + frames * channels * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + frames * channels * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(mix.sampleRate, 24);
  out.writeUInt32LE(mix.sampleRate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const v = Math.max(-1, Math.min(1, mix.channels[c]![i]!));
      out.writeInt16LE(Math.round(v * 32767), 44 + (i * channels + c) * 2);
    }
  }
  return out;
}

async function record(c: TruthCase, outcome: CaseOutcome): Promise<void> {
  const dir = process.env.ZENVI_TOOL_TRUTH_REPORT;
  if (!dir) return;
  await mkdir(path.join(dir, "frames"), { recursive: true });
  const known = KNOWN_FAILURES[c.id];
  const line = {
    id: c.id,
    tool: c.tool,
    param: c.param,
    probe: c.probe.kind,
    pass: outcome.failures.length === 0,
    known: known?.issue ?? null,
    failures: outcome.failures,
    change: Number.isFinite(outcome.change) ? Number(outcome.change.toFixed(3)) : null,
    desktop: outcome.desktop ?? null,
  };
  await appendFile(path.join(dir, "cases.jsonl"), `${JSON.stringify(line)}\n`);
  const slug = caseSlug(c.id);
  if (outcome.mixes) {
    await mkdir(path.join(dir, "sounds"), { recursive: true });
    await writeFile(path.join(dir, "sounds", `${slug}.base.wav`), encodeWav(outcome.mixes.base));
    await writeFile(path.join(dir, "sounds", `${slug}.variant.wav`), encodeWav(outcome.mixes.variant));
  }
  if (outcome.frames) {
    await writeFile(path.join(dir, "frames", `${slug}.base.png`), encodePng(outcome.frames.base));
    await writeFile(path.join(dir, "frames", `${slug}.variant.png`), encodePng(outcome.frames.variant));
  }
}

export function truthSuite(name: string, cases: readonly TruthCase[]): void {
  describe(name, () => {
    let session: TruthSession;
    beforeAll(async () => {
      session = await openSession();
    });
    afterAll(async () => removeDir(session?.dir));

    it("has unique case ids", () => {
      const ids = cases.map((c) => c.id);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    });

    for (const c of cases) {
      it(c.id, async () => {
        const outcome = await runCase(session, c);
        await record(c, outcome);
        const known = KNOWN_FAILURES[c.id];
        if (known && (known.only !== "full" || fullMode())) {
          expect(outcome.failures, `${c.id} passes now: remove it from KNOWN_FAILURES (${known.issue})`).not.toEqual([]);
        } else {
          expect(outcome.failures, c.id).toEqual([]);
        }
      });
    }
  });
}
