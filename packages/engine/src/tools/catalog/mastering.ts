/**
 * master_audio_tool: measure the timeline mix and gain-stage it to a loudness
 * target. Web/CLI-only (the desktop contract has no mastering tool); it
 * writes what the desktop already plays: clip volume curves and the
 * Compressor's makeup gain, so the same mix comes out of libopenshot.
 *
 * The host renders the stems (speech / music / SFX / ambience) through the
 * audio plan an export uses; `mastering/` measures them (BS.1770 / R128) and
 * plans the gains; this file turns the plan into one transaction. The duck
 * under speech is `buildDuckPoints`, the same envelope duck_under_speech_tool
 * writes.
 */

import { z } from "zod";
import { ProjectDocument, type Transaction } from "../../history/document.js";
import { MASTER_PRESETS, planGainStage, STEM_ROLES, type GainStagePlan, type PresetTarget, type StemRole, type SpeechWindow } from "../../mastering/gain-stage.js";
import { measureLoudness, SILENCE_LUFS, type LoudnessReport } from "../../mastering/loudness.js";
import { addEffect, removeEffect, setEffectProperty } from "../../ops/effects.js";
import { setClipKeyframes } from "../../ops/clips.js";
import type { Clip, Effect, KeyframePoint, Project } from "../../model/types.js";
import {
  MAX_LEVEL,
  buildDuckPoints,
  clampWindows,
  clipSourceFrameRange,
  clipTimelineExtent,
  curvePoints,
  duckedWindows,
  hasVideoStream,
  makePoint,
  mergeWindows,
  speechWindowsFromSource,
} from "../audio-mix.js";
import { STEM_ROLE_OF, mixRoleOf } from "../mix-roles.js";
import { MIX_GENRES } from "../../mastering/score.js";
import { markMastered } from "../../review/finish.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { measureMix } from "./analyze-mix.js";
import { iterateMaster, PEAK_MARGIN_DB } from "./master-loop.js";
import { applyPeakRides, planPeakRides, rideBudget, ridesSummary, type Rides } from "./master-limit.js";
import { applied, refused, unchanged, type ToolReceipt } from "../receipt.js";
import { energyVadWindows } from "../speech.js";
import { lockedTrackError } from "../tracks.js";
import { collectTimelineAudio, type AudioEntry } from "./audio.js";
import { fpsFloatOf, idList } from "./common.js";

const TOOL = "master_audio_tool";

/** A clip's gain is not touched below this many dB: inaudible, and the ramps of an earlier duck keep a re-measure from agreeing any closer. */
export const NO_CHANGE_DB = 0.5;
/** After the verification render, the global gain is corrected when it is off by more than this, dB. */
const CORRECT_ABOVE_DB = 0.1;
/** The Compressor's makeup range in the effect panel, dB. */
const MAX_MAKEUP_DB = 12;
/** Gain stages one clip may carry: +48 dB of makeup, enough to lift a -45 dBFS recording. */
const MAX_STAGES = 4;

/**
 * The mix group of a clip: the stem analyze_mix_tool scores it in
 * (../mix-roles.ts: its own or its track's role, a sound-design clip's sfx,
 * the analysis' role, else what its shape says: sound without picture is
 * music from MUSIC_MIN_DURATION seconds up and an effect below it; footage
 * with sound could be anything, so it stays with the music, a neutral bed).
 */
function stemOf(project: Project, entry: AudioEntry): StemRole {
  return STEM_ROLE_OF[mixRoleOf(project, entry)];
}

const ids = z.union([z.string(), z.array(z.string())]);

const input = z.strictObject({
  preset: z
    .enum(["social", "broadcast", "podcast"])
    .default("social")
    .describe("Delivery target: social = -14 LUFS / -1 dBTP (Reels, TikTok, Shorts), broadcast = -23 LUFS (EBU R128), podcast = -16 LUFS."),
  target_lufs: z.number().min(-40).max(-6).optional().describe("Integrated loudness to reach, LUFS. Overrides the preset's."),
  true_peak_dbtp: z.number().min(-9).max(0).optional().describe("True-peak ceiling, dBTP. Overrides the preset's."),
  balance: z
    .enum(["auto", "keep"])
    .default("auto")
    .describe("auto: dialogue anchors the mix, music sits under it (ducked while someone talks), SFX accents over the bed. keep: keep the current balance and only scale the mix."),
  duck: z.boolean().default(true).describe("Duck music/ambience under speech where it is not already ducked (the same envelope as duck_under_speech_tool)."),
  speech_clip_ids: ids.optional().describe("Clips that carry dialogue, when they are not indexed (otherwise unclassified clips count as music)."),
  music_clip_ids: ids.optional().describe("Clips to treat as music."),
  sfx_clip_ids: ids.optional().describe("Clips to treat as sound effects."),
  dry_run: z.boolean().default(false).describe("Measure and plan only: report the loudness before and after, change nothing."),
  genre: z.enum(MIX_GENRES).default("general").describe("The Sound Score's target bands (analyze_mix_tool genre) for score and iterate."),
  score: z.boolean().default(true).describe("Score the mastered mix with analyze_mix_tool's Sound Score (in data.score)."),
  limit: z
    .boolean()
    .default(true)
    .describe("When the true-peak ceiling stops the mix short of the target, ride the frames that peak down (volume keyframes: the music and ambience under a hit up to 10 dB, else every clip playing there up to 4 dB; a look-ahead limiter the desktop plays too), so the mix gets there."),
  iterate: z
    .boolean()
    .default(false)
    .describe("Before mastering, run analyze_mix_tool's loop: apply its top fixes and re-score, up to 3 rounds, until 85+ with no gate failed; a round that lowers the score is dropped. The whole run is one undo step."),
});

type Input = z.output<typeof input>;

interface Staged {
  entry: AudioEntry;
  stem: StemRole;
  locked: boolean;
}

export interface Measured {
  integratedLufs: number | null;
  momentaryMaxLufs: number | null;
  shortTermMaxLufs: number | null;
  loudnessRange: number;
  samplePeakDbfs: number | null;
  truePeakDbtp: number | null;
}

const finite = (x: number): number | null => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

function measuredOf(report: LoudnessReport): Measured {
  return {
    integratedLufs: finite(report.integrated),
    momentaryMaxLufs: finite(report.momentaryMax),
    shortTermMaxLufs: finite(report.shortTermMax),
    loudnessRange: Math.round(report.range * 10) / 10,
    samplePeakDbfs: finite(report.samplePeakDb),
    truePeakDbtp: finite(report.truePeakDb),
  };
}

const fmtLufs = (x: number | null): string => (x === null ? "silence" : `${x.toFixed(1)} LUFS`);
const fmtPeak = (x: number | null): string => (x === null ? "-inf dBTP" : `${x.toFixed(1)} dBTP`);

/** The effects that are only a gain: live Compressors at ratio 1 (the stages this tool adds), in apply order. A bypassed one adds nothing. */
function gainEffects(clip: Clip): Effect[] {
  return (clip.effects ?? []).filter((e) => e.class_name === "Compressor" && keyframeValue(e.ratio, 1) === 1 && keyframeValue(e.bypass, 0) === 0);
}

function keyframeValue(kf: unknown, fallback: number): number {
  const points = (kf as { Points?: { co?: { Y?: unknown } }[] } | undefined)?.Points;
  const y = Number(points?.[0]?.co?.Y);
  return Number.isFinite(y) ? y : fallback;
}

/** Multiply a clip's volume curve by `factor`, keeping its shape (points above MAX_LEVEL are clamped). */
function scaledVolume(clip: Clip, fps: Project["fps"], factor: number): KeyframePoint[] {
  const points = curvePoints(clip);
  if (points.length === 0) return [makePoint(clipSourceFrameRange(clip, fps)[0], Math.min(MAX_LEVEL, factor))];
  return points.map((p) => makePoint(p.co.X, Math.max(0, Math.min(MAX_LEVEL, p.co.Y * factor)), p.interpolation));
}

function curvePeak(clip: Clip): number {
  return curvePoints(clip).reduce((m, p) => Math.max(m, p.co.Y), 1);
}

const dbToFactor = (db: number): number => 10 ** (db / 20);

function ridesText(r: ReturnType<typeof ridesSummary>): string {
  return `; peaks ridden down in ${r.frames} frame(s): ${[r.bedMaxDb > 0 ? `the bed under hits up to ${r.bedMaxDb} dB` : "", r.allMaxDb > 0 ? `everything up to ${r.allMaxDb} dB` : ""].filter(Boolean).join(", ")}`;
}

/** Shortfall at the ceiling worth riding the peaks for, LU; also the least a ridden plan must gain to be kept. */
const RIDE_ABOVE_LU = 0.5;

export interface ClipGainResult {
  /** Gain actually applied, dB. */
  appliedDb: number;
  /** Of which through the Compressor's makeup, dB. */
  makeupDb: number;
}

/**
 * Add `deltaDb` to a clip: boosts go through the makeup gain of Compressors
 * at ratio 1 (volume stops at +2.3 dB; one Compressor at +12 dB, so a very
 * quiet clip carries a few), cuts first take that back, then go through the
 * volume curve. A boost past the stages spills into the volume curve as far
 * as it may go; what cannot be applied is not (the result says so).
 */
export function applyClipGain(tx: Transaction, clipId: string, deltaDb: number): ClipGainResult {
  const project = tx.project;
  const clip = project.clips.find((c) => String(c.id) === clipId)!;
  const stages = gainEffects(clip);
  const before = stages.reduce((sum, e) => sum + keyframeValue(e.makeup_gain, 0), 0);
  const makeup = Math.max(0, Math.min(MAX_MAKEUP_DB * MAX_STAGES, before + deltaDb));
  let rest = deltaDb - (makeup - before);
  if (Math.abs(makeup - before) > 1e-9) {
    let left = makeup;
    for (let i = 0; i < Math.max(stages.length, Math.ceil(makeup / MAX_MAKEUP_DB)); i += 1) {
      const share = Math.min(MAX_MAKEUP_DB, left);
      left -= share;
      const stage = stages[i];
      if (!stage) addEffect(tx, clipId, "Compressor", { makeup_gain: share, ratio: 1, threshold: 0 });
      else if (share <= 0) removeEffect(tx, String(stage.id));
      else if (Math.abs(share - keyframeValue(stage.makeup_gain, 0)) > 1e-9) setEffectProperty(tx, String(stage.id), "makeup_gain", share);
    }
  }
  if (Math.abs(rest) > 1e-9) {
    const current = tx.project.clips.find((c) => String(c.id) === clipId)!;
    const headroom = rest > 0 ? MAX_LEVEL / curvePeak(current) : 1;
    const factor = Math.min(dbToFactor(rest), headroom);
    const points = scaledVolume(current, project.fps, factor);
    setClipKeyframes(tx, clipId, "volume", points.map((p) => ({ frame: p.co.X, value: p.co.Y, interpolation: p.interpolation })), { mode: "replace", derived: true });
    rest -= 20 * Math.log10(factor);
  }
  return { appliedDb: deltaDb - rest, makeupDb: makeup - before };
}

interface Edits {
  /** dB per clip id. */
  gains: ReadonlyMap<string, number>;
  /** Peak rides on these clips (master-limit.ts), written before the gains. */
  rides?: { db: Rides; clips: readonly { id: string; bed: boolean }[] };
  /** Beds ducked under these speech windows (timeline s) by `duckDb`. */
  duck?: { db: number; windows: readonly SpeechWindow[]; beds: readonly string[] };
}

/** Write the plan into a transaction; returns what each clip got. */
export function applyEdits(tx: Transaction, edits: Edits): Map<string, ClipGainResult> {
  const results = new Map<string, ClipGainResult>();
  const { duck } = edits;
  if (edits.rides) applyPeakRides(tx, edits.rides.db, edits.rides.clips);
  if (duck && duck.db < 0) {
    for (const id of duck.beds) {
      const clip = tx.project.clips.find((c) => String(c.id) === id)!;
      const [start, end] = clipTimelineExtent(clip);
      const windows = clampWindows(duck.windows, start, end);
      if (windows.length === 0) continue;
      // The windows are already padded (duckedWindows), so the envelope must not pad them again.
      const points = buildDuckPoints(clip, tx.project.fps, windows, dbToFactor(duck.db), { padBefore: 0, padAfter: 0 });
      if (points.length === 0) continue;
      setClipKeyframes(tx, id, "volume", points.map((p) => ({ frame: p.co.X, value: p.co.Y, interpolation: p.interpolation })), { mode: "replace", derived: true });
    }
  }
  for (const [id, db] of edits.gains) results.set(id, applyClipGain(tx, id, db));
  return results;
}

async function renderStem(call: ToolCall, project: Project, clipIds: readonly string[] | undefined) {
  return call.host.audio!.mixPcm!(project, { clipIds, signal: call.signal });
}

/** Speech windows of the entries called speech, merged; the VAD host path covers a clip that was named speech but is not indexed. */
async function speechWindowsOf(call: ToolCall, staged: readonly Staged[]): Promise<SpeechWindow[]> {
  const windows: SpeechWindow[] = [];
  for (const { entry, stem } of staged) {
    if (stem !== "speech") continue;
    if (entry.windows.length > 0) {
      windows.push(...entry.windows);
      continue;
    }
    const audio = call.host.audio;
    const path = String((entry.clip.reader as { path?: unknown } | undefined)?.path ?? entry.file?.path ?? "");
    if (!audio || !path) continue;
    try {
      const envelope = await audio.analyzeAudio(path, { signal: call.signal });
      windows.push(...speechWindowsFromSource(energyVadWindows(envelope, { minSpeechSec: 0.12, minSilenceSec: 0.35 }), entry.clip));
    } catch (error) {
      call.host.log?.(`${TOOL}: no speech windows for ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return mergeWindows(windows);
}

/** Filed under a stem by set_track_role_tool (its track) or by hand (the clip). */
function hasOwnRole(project: Project, entry: AudioEntry): boolean {
  return Boolean((entry.clip as { zenvi_audio_role?: unknown }).zenvi_audio_role || project.layers.find((l) => Number(l.number) === entry.layer)?.zenvi_audio_role);
}

function role(id: string, lists: Record<StemRole, Set<string>>): StemRole | undefined {
  return STEM_ROLES.find((r) => lists[r].has(id));
}

function planNumbers(plan: GainStagePlan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [r, db] of Object.entries(plan.roleGainDb)) out[r] = Math.round(db * 100) / 100;
  return out;
}

export const masteringTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Master audio",
    description:
      "Measure the timeline's mix (integrated loudness LUFS, true peak, per-role levels) and gain-stage it to a delivery target so it is loud, clean and balanced: " +
      "dialogue anchors the mix, music sits under it and ducks while someone talks, SFX stay over the bed. " +
      "Writes clip volume and Compressor makeup gain only (the desktop plays the same mix), one undo step, and returns the before/after loudness. " +
      "Presets: social -14 LUFS / -1 dBTP, broadcast -23, podcast -16. Run it LAST, after the edit, music and sound design are in place (any audio edit after it unmasters the mix), then render_video and review_render_tool; running it again changes nothing. " +
        "iterate=true (with genre) first runs analyze_mix_tool's loop (duck the bed to 10 dB under the voice, fix levels, timing, masking: its top fixes, re-scored, up to 3 rounds) and then masters, all one undo step: the best finishing call. " +
      "If the true-peak ceiling stops the mix short of the target, the frames that peak are ridden down (the bed under a hit up to 10 dB, else every clip playing there up to 4 dB; limit=false: stop at the ceiling and say so). " +
      "dry_run=true measures and plans without changing anything. Refuses timelines with no audible audio.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["audio"],
    run: async (call, args: Input): Promise<ToolReceipt | string> => {
      const host = call.host.audio;
      if (!host?.mixPcm) {
        return unavailable(TOOL, "this host cannot render the timeline mix to measure it.");
      }
      if (args.iterate && !args.dry_run) {
        const { iterate: _iterate, ...rest } = args;
        return iterateMaster(call, TOOL, rest, args.genre);
      }
      const project = call.doc.project;
      const base = targetOf(args);
      const entries = collectTimelineAudio(project);
      if (entries.length === 0) return refused(TOOL, "No timeline clips with audio: nothing to master.");

      // Roles: what the analysis says, then the caller's overrides.
      const lists: Record<StemRole, Set<string>> = {
        speech: new Set(idList(args.speech_clip_ids)),
        music: new Set(idList(args.music_clip_ids)),
        sfx: new Set(idList(args.sfx_clip_ids)),
        ambient: new Set(),
      };
      const staged: Staged[] = entries.map((entry) => ({
        entry,
        stem: role(entry.id, lists) ?? stemOf(project, entry),
        locked: Boolean(lockedTrackError(entry.layer, project.layers)),
      }));
      if (staged.every((s) => s.locked)) {
        return refused(TOOL, `Every clip with audio is on a locked track (${staged.slice(0, 5).map((s) => s.entry.id).join(", ")}): unlock the tracks to master them.`);
      }
      const unclassified = staged.filter((s) => s.entry.role === "unknown" && !role(s.entry.id, lists) && hasVideoStream(s.entry.clip, s.entry.file) && !hasOwnRole(project, s.entry));

      const speech = await speechWindowsOf(call, staged);
      const total = staged.reduce((m, s) => Math.max(m, s.entry.end), 0);
      const padded = duckedWindows({ position: 0, start: 0, end: total }, speech);
      const planOn = async (p: Project) => {
        const stems = await Promise.all(
          STEM_ROLES.map(async (r) => {
            const clipIds = staged.filter((s) => s.stem === r).map((s) => s.entry.id);
            return clipIds.length === 0 ? null : { role: r, ...(await renderStem(call, p, clipIds)) };
          }),
        );
        const present = stems.filter((s): s is NonNullable<typeof s> => s !== null);
        const sampleRate = present[0]!.sampleRate;
        const plan = planGainStage({
          sampleRate,
          stems: present.map((s) => ({ role: s.role, channels: s.channels })),
          target: base,
          balance: args.balance,
          speechWindows: padded,
          duck: args.duck,
        });
        return { plan, present, sampleRate };
      };
      let planned;
      try {
        planned = await planOn(project);
      } catch (error) {
        return `Error: could not render the timeline audio to measure it: ${error instanceof Error ? error.message : String(error)}`;
      }
      let plan = planned.plan;
      if (!plan) return refused(TOOL, "The timeline mix is silent (nothing above -70 LUFS): nothing to master. Check the clips' volume and that their media has sound.");
      const first = plan;

      // Short of the target at the ceiling: ride the peaks down (master-limit.ts), then plan again on a copy that has the rides.
      let rides: Rides | null = null;
      // The voice too: a talking head's own crest is what stops it short, and a few dB off a plosive for three frames is what any dialogue limiter does.
      const rideable = staged.filter((st) => !st.locked);
      const ridden = rideable.map((st) => ({ id: st.entry.id, bed: st.stem === "music" || st.stem === "ambient" }));
      if (args.limit && plan.limitedBy === "peak" && plan.shortfallLu > RIDE_ABOVE_LU && ridden.length > 0) {
        const { present, sampleRate } = planned;
        rides = planPeakRides(present.map((st) => ({ channels: st.channels, gainDb: plan!.roleGainDb[st.role] ?? 0, bed: st.role === "music" || st.role === "ambient" })), sampleRate, fpsFloatOf(project), base.ceilingDbtp, plan.shortfallLu, rideBudget(rideable.map((st) => st.entry.clip)));
        if (rides) {
          const scratch = new ProjectDocument(structuredClone(project));
          scratch.transaction("ride (check)", (tx) => applyPeakRides(tx, rides!, ridden));
          let again: GainStagePlan | null = null;
          try {
            again = (await planOn(scratch.project)).plan;
          } catch (error) {
            call.host.log?.(`${TOOL}: peak rides skipped: ${error instanceof Error ? error.message : String(error)}`);
          }
          if (again && again.predicted.integrated > plan.predicted.integrated + RIDE_ABOVE_LU) plan = again;
          else rides = null;
        }
      }

      const warnings: string[] = [];
      if (unclassified.length > 0) {
        warnings.push(
          `${unclassified.length} clip(s) are footage with sound that is not indexed, so they were staged with the music: ` +
            `${unclassified.slice(0, 5).map((s) => s.entry.id).join(", ")}. Pass speech_clip_ids / sfx_clip_ids to place them.`,
        );
      }
      const lockedClips = staged.filter((s) => s.locked);
      if (lockedClips.length > 0) {
        warnings.push(`${lockedClips.length} clip(s) on locked tracks were measured but not changed: ${lockedClips.slice(0, 5).map((s) => s.entry.id).join(", ")}.`);
      }

      const beds = args.duck && plan.duckDb < 0 ? staged.filter((s) => (s.stem === "music" || s.stem === "ambient") && !s.locked).map((s) => s.entry.id) : [];
      const gainFor = (globalCorrection: number): Map<string, number> => {
        const gains = new Map<string, number>();
        for (const s of staged) {
          if (s.locked) continue;
          const db = plan.roleGainDb[s.stem];
          if (db !== undefined) gains.set(s.entry.id, db + globalCorrection);
        }
        return gains;
      };
      const unmoved = (gains: ReadonlyMap<string, number>): boolean => beds.length === 0 && !rides && [...gains.values()].every((db) => Math.abs(db) < NO_CHANGE_DB);

      const before = measuredOf(first.before.mix);
      const data: Record<string, unknown> = {
        preset: args.preset,
        target: { lufs: base.targetLufs, truePeakDbtp: base.ceilingDbtp },
        before: { ...before, stems: Object.fromEntries(Object.entries(first.before.stems).map(([r, rep]) => [r, measuredOf(rep!)])) },
        lead: plan.lead,
      };
      const notes: string[] = [];
      const shortfallNote = (): void => {
        if (plan.limitedBy === "peak" && plan.shortfallLu > 0.5) {
          notes.push(
            `${plan.shortfallLu.toFixed(1)} LU short of ${base.targetLufs} LUFS at the ${base.ceilingDbtp} dBTP ceiling: the peaks (usually SFX hits) set the limit. ` +
              `Export with loudness normalisation (render_video loudness='${args.preset}', zenvi render --loudness ${args.preset}) to reach the target with a true-peak limiter, or turn the loudest SFX down.`,
          );
        }
      };
      const gains = gainFor(0);
      if (unmoved(gains)) {
        data.after = before;
        data.limitedBy = plan.limitedBy;
        shortfallNote();
        const where = plan.limitedBy === "peak" && plan.shortfallLu > 0.5 ? "At the true-peak ceiling" : "Already mastered";
        if (!args.dry_run) markMastered(call.doc, args.preset, before.integratedLufs);
        return unchanged(TOOL, `${where}: ${fmtLufs(before.integratedLufs)}, ${fmtPeak(before.truePeakDbtp)} (target ${base.targetLufs} LUFS / ${base.ceilingDbtp} dBTP). Nothing changed.`, { data, warnings, notes });
      }

      // Verify on a scratch copy of the project, so the final gain accounts for what the clips really sound like with the edit.
      const edit = (g: Map<string, number>): Edits => ({ gains: g, ...(rides ? { rides: { db: rides, clips: ridden } } : {}), duck: beds.length > 0 ? { db: plan.duckDb, windows: padded, beds } : undefined });
      let correction = 0;
      let verified: LoudnessReport | undefined;
      try {
        const scratch = new ProjectDocument(structuredClone(project));
        scratch.transaction("master (check)", (tx) => applyEdits(tx, edit(gains)));
        const mix = await renderStem(call, scratch.project, undefined);
        verified = measureLoudness(mix.channels, mix.sampleRate);
        if (verified.integrated !== SILENCE_LUFS) {
          const wanted = plan.predicted.integrated;
          // The preset's ceiling keeps iterate's margin: the score's own render differs from this one by keyframe rounding.
          const ceiling = base.ceilingDbtp - (args.true_peak_dbtp === undefined ? PEAK_MARGIN_DB : 0);
          correction = Math.min(wanted - verified.integrated, ceiling - verified.truePeakDb);
          if (Math.abs(correction) < CORRECT_ABOVE_DB) correction = 0;
        }
      } catch (error) {
        call.host.log?.(`${TOOL}: verification render failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const finalGains = gainFor(correction);

      const predicted = measuredOf(verified ? { ...verified, integrated: verified.integrated + correction, truePeakDb: verified.truePeakDb + correction } : plan.predicted);
      if (args.dry_run) {
        data.after = predicted;
        data.gainsDb = planNumbers(plan);
        data.duckDb = Math.round(plan.duckDb * 100) / 100;
        if (rides) data.peakRides = ridesSummary(rides, project);
        shortfallNote();
        return unchanged(
          TOOL,
          `Would master ${fmtLufs(before.integratedLufs)}, ${fmtPeak(before.truePeakDbtp)} -> ${fmtLufs(predicted.integratedLufs)}, ${fmtPeak(predicted.truePeakDbtp)} (${args.preset})${rides ? ridesText(ridesSummary(rides, project)) : ""}. dry_run: nothing was changed.`,
          { data, warnings, notes },
        );
      }

      const results = call.commit((tx) => applyEdits(tx, edit(finalGains)), "Master audio");

      let after = predicted;
      try {
        const mix = await renderStem(call, call.doc.project, undefined);
        after = measuredOf(measureLoudness(mix.channels, mix.sampleRate));
      } catch (error) {
        warnings.push(`The result could not be measured again (${error instanceof Error ? error.message : String(error)}); the figures after are predicted.`);
      }
      shortfallNote();
      if (after.integratedLufs !== null && Math.abs(after.integratedLufs - (predicted.integratedLufs ?? after.integratedLufs)) > 0.5) {
        warnings.push(`Measured ${fmtLufs(after.integratedLufs)} after the edit, ${fmtLufs(predicted.integratedLufs)} was expected: audio effects or a clip the tool could not move changed the sum.`);
      }
      const short = [...results.entries()].filter(([id, r]) => Math.abs(r.appliedDb - (finalGains.get(id) ?? 0)) > 0.25);
      if (short.length > 0) {
        warnings.push(`${short.length} clip(s) could not take their full gain (volume tops out at ${MAX_LEVEL}, makeup at ${MAX_MAKEUP_DB} dB): ${short.slice(0, 5).map(([id]) => id).join(", ")}.`);
      }
      if (args.score) {
        try {
          const { score } = await measureMix(call, call.doc.project, args.genre);
          data.score = { score: score.score, rawScore: score.rawScore, gatesFailed: score.gatesFailed, topFixes: score.topFixes.map((f) => ({ metric: f.metric, fix: f.text, calls: f.calls })) };
          const fix = score.topFixes.find((f) => f.metric !== "L1_integrated");
          notes.push(
            `Sound Score ${score.score}/100${score.gatesFailed.length ? ` (gate failed: ${score.gatesFailed.join(", ")})` : ""}` +
              (fix && (score.score ?? 0) < 85 ? `; biggest gap: ${fix.text}. master_audio_tool iterate=true applies the fixes and masters again in one step (an edit after mastering unmasters the mix).` : "."),
          );
        } catch (error) {
          warnings.push(`The Sound Score could not be measured (${error instanceof Error ? error.message : String(error)}).`);
        }
      }
      markMastered(call.doc, args.preset, after.integratedLufs);
      data.after = after;
      data.gainsDb = planNumbers(plan);
      data.duckDb = Math.round(plan.duckDb * 100) / 100;
      data.limitedBy = plan.limitedBy;
      if (rides) data.peakRides = ridesSummary(rides, project);
      data.clips = [...results.entries()].map(([id, r]) => ({ id, role: staged.find((s) => s.entry.id === id)?.stem, gainDb: Math.round(r.appliedDb * 100) / 100, makeupDb: Math.round(r.makeupDb * 100) / 100 }));
      return applied(
        TOOL,
        `Mastered (${args.preset}): ${fmtLufs(before.integratedLufs)}, ${fmtPeak(before.truePeakDbtp)} -> ${fmtLufs(after.integratedLufs)}, ${fmtPeak(after.truePeakDbtp)}` +
          (plan.duckDb < 0 ? `; beds ducked ${plan.duckDb.toFixed(1)} dB under speech` : "") +
          (rides ? ridesText(ridesSummary(rides, project)) : "") +
          ".",
        { data, warnings, notes },
      );
    },
  }),
];

function targetOf(args: Input): PresetTarget {
  const preset = MASTER_PRESETS[args.preset];
  return { ...preset, targetLufs: args.target_lufs ?? preset.targetLufs, ceilingDbtp: args.true_peak_dbtp ?? preset.ceilingDbtp };
}
