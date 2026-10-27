/**
 * master_audio_tool iterate=true (zenvi-motion sound/DEPLOY.md S3.6): score
 * the mix (analyze_mix_tool's measurement), apply the top fixes, score again,
 * at most MAX_ROUNDS rounds, stopping at TARGET_SCORE with no gate failed
 * (the loudness gate aside: mastering meets it last), then master. Rounds
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

/** Gates the loop must clear itself; L1 (loudness) is what the master step after it fixes. */
const blocking = (s: MixScore): string[] => s.gatesFailed.filter((g) => g !== "L1_integrated");

type Collection = "clips" | "files" | "layers" | "effects";
const COLLECTIONS: Collection[] = ["layers", "files", "clips", "effects"];

/** Make `tx.project`'s clips, files, tracks and transitions equal `target`'s, item by item. */
export function applyProjectState(tx: Transaction, target: Project): void {
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
  let score = (await measureMix(call, scratch.project, genre)).score;
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
    const next = (await measureMix(call, scratch.project, genre)).score;
    const better = (next.rawScore ?? 0) >= (score.rawScore ?? 0);
    rounds.push({ before: score.rawScore, after: next.rawScore, fixes: done, kept: better });
    if (!better) {
      scratch.transaction("revert round", (tx) => applyProjectState(tx, saved));
      break;
    }
    score = next;
  }
  const mastered = await run(scratch, tool, { ...masterArgs, iterate: false, score: false });
  const changed = JSON.stringify(scratch.project) !== JSON.stringify(call.doc.project);
  const final = changed ? (await measureMix(call, scratch.project, genre)).score : first;
  const data = {
    genre,
    scoreBefore: first.score,
    rawBefore: first.rawScore,
    scoreAfter: final.score,
    rawAfter: final.rawScore,
    gatesFailed: final.gatesFailed,
    rounds,
    master: mastered ? { status: mastered.status, summary: mastered.summary, data: mastered.data } : null,
    topFixes: final.topFixes.map((f) => ({ metric: f.metric, fix: f.text, calls: f.calls })),
  };
  const summary = `Sound Score ${first.score} -> ${final.score} (raw ${first.rawScore} -> ${final.rawScore}) in ${rounds.filter((r) => r.kept).length} fix round(s), then ${mastered?.summary ?? "mastering failed"}`;
  if (!changed) return unchanged(tool, `${summary} Nothing changed.`, { data });
  call.commit((tx) => applyProjectState(tx, scratch.project), "Master audio (iterate)");
  return applied(tool, summary, { data, warnings: mastered?.warnings ?? [], notes: mastered?.notes ?? [] });
}
