/**
 * analyze_mix_tool: the Zenvi Sound Score of the timeline (mastering/score.ts)
 * from renders of the mix and of each stem (voice / music / sfx / ambience,
 * ../mix-roles.ts), the placed sound-effect cues and the edit's hit points.
 * Read-only: no transaction, no undo step. The text is the token-cheap
 * view (one line per failing metric with its fix, then the top 3 fixes as
 * tool calls); `data` carries the same numbers for programs.
 */

import { z } from "zod";
import { MIX_GENRES, formatMixScore, scoreMix, type MixScore } from "../../mastering/score.js";
import type { Project } from "../../model/types.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { refused, unchanged, type ToolReceipt } from "../receipt.js";
import { cuesOf, hitPointsOf, mixEntries, renderStems, type MixEntry } from "../mix-roles.js";
import { fpsFloatOf } from "./common.js";

const TOOL = "analyze_mix_tool";

const input = z.strictObject({
  genre: z
    .enum(MIX_GENRES)
    .default("general")
    .describe("Sets the target bands (loudness range, cue density, hit coverage): hype, flash_montage, saas_ui, talking_head, match_cut, 3d_product, video_essay, editorial, multiplicity, general."),
  hit_times: z.array(z.number().min(0)).max(500).optional().describe("Timeline seconds that want a sound. Default: the edit's cuts, transitions, title entrances and flashes."),
  detail: z.enum(["compact", "full"]).default("compact").describe("compact: failing metrics, their fixes and the top 3; full: every metric and every clip's stem."),
});
type Input = z.output<typeof input>;

/** Render and score the timeline (shared with master_audio_tool). */
export async function measureMix(call: ToolCall, project: Project, genre: Input["genre"], hitTimes?: readonly number[]): Promise<{ score: MixScore; entries: MixEntry[] }> {
  const entries = mixEntries(project);
  const renders = await renderStems(call, project, entries);
  const score = scoreMix({
    sampleRate: renders.sampleRate,
    mix: renders.mix,
    stems: renders.stems,
    genre,
    fps: fpsFloatOf(project),
    hits: hitPointsOf(project, hitTimes),
    cues: cuesOf(project),
  });
  return { score, entries };
}

/** The numbers without the prose: [value, lo, hi, status] per metric, plus each failing metric's calls. */
function compactData(score: MixScore, entries: readonly MixEntry[], full: boolean): Record<string, unknown> {
  const metrics: Record<string, unknown> = {};
  for (const [key, m] of Object.entries(score.metrics)) {
    if (m.value === null) continue;
    metrics[key] = full ? m : m.status === "ok" ? [m.value, m.target[0], m.target[1], "ok"] : { value: m.value, target: m.target, status: m.status, ...(m.calls ? { calls: m.calls } : {}) };
  }
  const stems: Record<string, string[]> = {};
  for (const e of entries) (stems[e.mixRole] ??= []).push(e.id);
  return {
    score: score.score,
    rawScore: score.rawScore,
    gatesFailed: score.gatesFailed,
    genre: score.genre,
    durationS: score.durationS,
    metrics,
    topFixes: score.topFixes.map((f) => ({ metric: f.metric, fix: f.text, calls: f.calls })),
    stems: full ? stems : Object.fromEntries(Object.entries(stems).map(([k, v]) => [k, v.length])),
    speech: score.speech.slice(0, full ? 50 : 8),
  };
}

export const analyzeMixTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Analyze mix",
    description:
      "Score the timeline's sound (the Zenvi Sound Score, 0-100): renders the mix and each stem (voice, music, sfx, ambience) and measures loudness LUFS / true peak / LRA / crest, " +
      "voice over the bed while speaking, SFX and music masking the voice, spectral balance, phone and mono translation, hit-point coverage and cue timing, cue prominence by role, repetition and density, " +
      "each against the genre's target band, with the exact fix as tool calls (set_audio_gain_tool, duck_tool, automate_volume_tool, eq_tool, compress_tool, move_clip_tool, add_sfx_tool, master_audio_tool). " +
      "A clipped, quiet or voice-buried mix fails a gate and scores at most 60. Read-only. Loop: analyze -> apply the top fixes -> analyze again (stop at 85+ with no gate failed, at most 3 rounds), then master_audio_tool.",
    input,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    requires: ["audio"],
    run: async (call, args: Input): Promise<ToolReceipt> => {
      if (!call.host.audio?.mixPcm) return unavailable(TOOL, "this host cannot render the timeline mix to measure it.");
      const project = call.doc.project;
      if (mixEntries(project).length === 0) return refused(TOOL, "No timeline clips with audio: nothing to score.");
      let measured;
      try {
        measured = await measureMix(call, project, args.genre, args.hit_times);
      } catch (error) {
        return refused(TOOL, `could not render the timeline audio to measure it: ${error instanceof Error ? error.message : String(error)}`);
      }
      const { score, entries } = measured;
      const full = args.detail === "full";
      const text = formatMixScore(score, { all: full });
      const stemLine = `Stems: ${["voice", "music", "sfx", "ambience"].map((r) => `${r} ${entries.filter((e) => e.mixRole === r).length}`).join(", ")} clip(s).`;
      return unchanged(TOOL, `${text}\n${stemLine}`, { data: compactData(score, entries, full) });
    },
  }),
];
