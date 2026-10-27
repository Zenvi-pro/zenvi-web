/**
 * master_audio_tool iterate=true (zenvi-motion sound/DEPLOY.md S3.6): score
 * the mix (analyze_mix_tool's measurement), apply the top fixes, score again,
 * at most MAX_ROUNDS rounds, stopping at TARGET_SCORE with no gate failed
 * (the loudness gate aside: mastering meets it last), then master; when the
 * peaks keep the master short of its target, the cue that makes the peak is
 * lowered (or the stem whose crest does is compressed) and the mix mastered again (at most
 * MAX_ROUNDS times). Rounds
 * run on a scratch copy of the project through the same tools an agent would
 * call; a round that lowers the score is dropped and the loop stops. The
 * result lands in the real project as one transaction: one undo step for
 * the whole run.
 */

import { ProjectDocument, type Transaction } from "../../history/document.js";
import type { MixGenre, MixScore } from "../../mastering/score.js";
import type { Project } from "../../model/types.js";
import type { ToolCall } from "../define.js";
import { applied, unchanged, type ToolReceipt } from "../receipt.js";
import { measureMix } from "./analyze-mix.js";

export const MAX_ROUNDS = 3;
export const TARGET_SCORE = 85;
const PEAK_MARGIN_DB = 0.2;

/** `a` scores higher than `b`: the capped score, then the raw score. */
function isBetter(a: MixScore, b: MixScore): boolean {
  const capped = (a.score ?? 0) - (b.score ?? 0);
  return capped !== 0 ? capped > 0 : (a.rawScore ?? 0) > (b.rawScore ?? 0);
}

/** Gates the loop must clear itself; L1 (loudness) is what the master step after it fixes. */
const blocking = (s: MixScore): string[] => s.gatesFailed.filter((g) => g !== "L1_integrated");

type Collection = "clips" | "files" | "layers" | "effects";
const COLLECTIONS: Collection[] = ["layers", "files", "clips", "effects"];

/** Make `tx.project` equal `target`: clips, files, tracks and transitions item by item, any other top-level key it has whole. */
export function applyProjectState(tx: Transaction, target: Project): void {
  const record = target as unknown as Record<string, unknown>;
  const current = tx.project as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if ((COLLECTIONS as string[]).includes(key) || !(key in current) || JSON.stringify(record[key]) === JSON.stringify(current[key])) continue;
    tx.replace([key], structuredClone(record[key]));
  }
  for (const key of COLLECTIONS) {
    const want = (target[key] ?? []) as { id: string }[];
    const have = (tx.project[key] ?? []) as { id: string }[];
    const wanted = new Set(want.map((x) => String(x.id)));
    for (const item of have) if (!wanted.has(String(item.id))) tx.delete([key, { id: item.id }]);
    for (const item of want) {
      const current = (tx.project[key] as { id: string }[]).find((x) => String(x.id) === String(item.id));
      if (!current) tx.insert([key], structuredClone(item));
      else if (JSON.stringify(current) !== JSON.stringify(item)) tx.replace([key, { id: item.id }], structuredClone(item));
    }
  }
}

interface Round {
  before: number | null;
  after: number | null;
  fixes: string[];
  kept: boolean;
}

export async function iterateMaster(call: ToolCall, tool: string, masterArgs: Record<string, unknown>, genre: MixGenre): Promise<ToolReceipt> {
  const { runTool } = await import("../registry.js");
  const scratch = new ProjectDocument(structuredClone(call.doc.project));
  const run = async (doc: ProjectDocument, name: string, args: Record<string, unknown>) => (await runTool({ doc, host: call.host, signal: call.signal }, name, args)).data;
  const rounds: Round[] = [];
  const measure = async (): Promise<MixScore> => (await measureMix(call, scratch.project, genre)).score;
  let score = await measure();
  const first = score;
  for (let i = 0; i < MAX_ROUNDS; i += 1) {
    if ((score.score ?? 0) >= TARGET_SCORE && blocking(score).length === 0) break;
    const fixes = score.topFixes.filter((f) => f.metric !== "L1_integrated" && f.calls.length > 0);
    if (fixes.length === 0) break;
    const saved = structuredClone(scratch.project);
    const done: string[] = [];
    for (const fix of fixes) {
      for (const c of fix.calls) {
        const receipt = await run(scratch, c.tool, c.args);
        if (receipt && (receipt.status === "applied" || receipt.status === "unchanged")) done.push(`${fix.metric}: ${c.tool} ${JSON.stringify(c.args)}`);
      }
    }
    const next = await measure();
    // A round is kept only when it raises the score: a level change that scores the same only moves the mix around.
    const better = isBetter(next, score);
    rounds.push({ before: score.rawScore, after: next.rawScore, fixes: done, kept: better });
    if (!better) {
      scratch.transaction("revert round", (tx) => applyProjectState(tx, saved));
      break;
    }
    score = next;
  }
  // The rounds set the balance and the duck by measurement: mastering then only scales (keep) and does not duck again.
  const fixed = rounds.some((r) => r.kept);
  // A 0.2 dB margin under the ceiling: the verification render and the score's own render differ by keyframe rounding.
  const ceiling = (typeof masterArgs.true_peak_dbtp === "number" ? masterArgs.true_peak_dbtp : -1) - PEAK_MARGIN_DB;
  const masterCall = { ...masterArgs, iterate: false, score: false, true_peak_dbtp: ceiling, ...(fixed ? { balance: "keep", duck: false } : {}) };
  let mastered = await run(scratch, tool, masterCall);
  let final = await measure();
  // Peak-limited short of the target: the cue that makes the peak (METRICS.md L2) is lowered once, or a voice whose own
  // crest does is compressed once, then the mix is mastered again; a step that does not raise the score is undone.
  // Stems summing into the peak are left to the export limiter (render loudness=social): per-clip sample limiters on
  // the timeline raise the inter-sample peaks they are meant to catch.
  const trimmed: string[] = [];
  const tried = new Set<string>();
  for (let k = 0; k < MAX_ROUNDS && mastered; k += 1) {
    const md = (mastered.data ?? {}) as { limitedBy?: string; target?: { lufs: number }; after?: { integratedLufs: number | null } };
    const shortfall = (md.target?.lufs ?? -14) - (md.after?.integratedLufs ?? -14);
    if (md.limitedBy !== "peak" || shortfall <= 0.5) break;
    const culprit = final.metrics.L2_true_peak?.culprit as { cue?: string; stem?: string } | undefined;
    const key = culprit?.cue ?? culprit?.stem;
    if (!key || tried.has(key)) break;
    tried.add(key);
    const saved = structuredClone(scratch.project);
    let step: string;
    if (culprit!.cue) {
      const db = -Math.min(6, Math.round((shortfall + 1) * 10) / 10);
      await run(scratch, "set_audio_gain_tool", { clip_ids: [culprit!.cue], gain_db: db });
      step = `${culprit!.cue} ${db} dB`;
    } else if (culprit!.stem === "voice") {
      if ((await run(scratch, "compress_tool", { role: "voice", preset: "voice" }))?.status !== "applied") break;
      step = "voice compressed";
    } else break;
    const remastered = await run(scratch, tool, masterCall);
    const next = await measure();
    if (!isBetter(next, final)) {
      scratch.transaction("revert peak step", (tx) => applyProjectState(tx, saved));
      break;
    }
    trimmed.push(step);
    mastered = remastered;
    final = next;
  }
  const changed = JSON.stringify(scratch.project) !== JSON.stringify(call.doc.project);
  if (!changed) final = first;
  const data = {
    genre,
    scoreBefore: first.score,
    rawBefore: first.rawScore,
    scoreAfter: final.score,
    rawAfter: final.rawScore,
    gatesFailed: final.gatesFailed,
    rounds,
    peakTrims: trimmed,
    master: mastered ? { status: mastered.status, summary: mastered.summary, data: mastered.data } : null,
    topFixes: final.topFixes.map((f) => ({ metric: f.metric, fix: f.text, calls: f.calls })),
  };
  const summary =
    `Sound Score ${first.score} -> ${final.score} (raw ${first.rawScore} -> ${final.rawScore}) in ${rounds.filter((r) => r.kept).length} fix round(s)` +
    `${trimmed.length ? `, peaks: ${trimmed.join(", ")}` : ""}, then ${mastered?.summary ?? "mastering failed"}`;
  if (!changed) return unchanged(tool, `${summary} Nothing changed.`, { data });
  // DEPLOY.md S3.6: no mix comes out worse than it went in.
  if (isBetter(first, final)) return unchanged(tool, `${summary} That scores lower than before, so nothing was changed.`, { data });
  call.commit((tx) => applyProjectState(tx, scratch.project), "Master audio (iterate)");
  return applied(tool, summary, { data, warnings: mastered?.warnings ?? [], notes: mastered?.notes ?? [] });
}
