/**
 * Gain staging: from the measured stems of a timeline (speech, music, SFX,
 * ambience) to the dB each role needs so the mix lands on a loudness target
 * with the roles in a sensible balance, and how far to duck the beds under
 * speech. Pure: the stems are planar PCM the host rendered through the same
 * audio plan an export uses.
 *
 * Every number is derived from what was measured, never from what an earlier
 * run did, so running it again on its own result finds nothing left to change.
 */

import { SILENCE_LUFS, measureLoudness, sliceWindows, type LoudnessReport } from "./loudness.js";

export type MasterPreset = "social" | "broadcast" | "podcast";

export interface PresetTarget {
  /** Integrated loudness to reach, LUFS. */
  targetLufs: number;
  /** True-peak ceiling, dBTP. */
  ceilingDbtp: number;
  summary: string;
}

/** Delivery targets: Instagram/TikTok/YouTube Shorts, EBU R128 broadcast, podcast platforms. */
export const MASTER_PRESETS: Readonly<Record<MasterPreset, PresetTarget>> = {
  social: { targetLufs: -14, ceilingDbtp: -1, summary: "Social platforms (-14 LUFS, -1 dBTP)" },
  broadcast: { targetLufs: -23, ceilingDbtp: -1, summary: "EBU R128 broadcast (-23 LUFS, -1 dBTP)" },
  podcast: { targetLufs: -16, ceilingDbtp: -1, summary: "Podcast (-16 LUFS, -1 dBTP)" },
};

/** The mix groups clips are staged in. Unclassified clips count as music. */
export type StemRole = "speech" | "music" | "sfx" | "ambient";
export const STEM_ROLES: readonly StemRole[] = ["speech", "music", "sfx", "ambient"];

/**
 * Integrated loudness of each role relative to the lead role (speech when
 * there is any, else music, else SFX), LU. Dialogue anchors the mix; the bed
 * sits well under it between lines and is ducked further while someone talks;
 * SFX accents stay audible over the bed. Without speech the music leads and
 * SFX hits sit just under it, so the cuts still punch.
 */
export const ROLE_OFFSET_LU: Readonly<{ withSpeech: Record<StemRole, number>; withoutSpeech: Record<StemRole, number> }> = {
  withSpeech: { speech: 0, music: -8, sfx: -6, ambient: -14 },
  withoutSpeech: { speech: 0, music: 0, sfx: -3, ambient: -12 },
};

/** How far under the speech a bed sits while it is talking, LU. */
export const BED_UNDER_SPEECH_LU = 14;
/** A bed already within this many LU of its target under speech is left alone. */
export const DUCK_TOLERANCE_LU = 1;
/** Deepest duck the planner asks for, dB (the duck tool's floor). */
export const MAX_DUCK_DB = 24;
/** One role is never moved further than this, dB. */
export const MAX_ROLE_MOVE_DB = 30;

const ATTACK = 0.15;
const RELEASE = 0.4;

export type SpeechWindow = [number, number];

export interface StemAudio {
  role: StemRole;
  channels: Float32Array[];
}

export interface GainStageInput {
  sampleRate: number;
  stems: readonly StemAudio[];
  target: PresetTarget;
  /** "auto": move roles to ROLE_OFFSET_LU. "keep": keep the balance, only scale the whole mix. */
  balance: "auto" | "keep";
  /** Timeline seconds the speech occupies, padded and merged the way the ducker pads them; beds are ducked in these. */
  speechWindows: readonly SpeechWindow[];
  /** false: never plan a duck. */
  duck: boolean;
}

export interface GainStagePlan {
  /** The role the others are placed against. */
  lead: StemRole;
  /** dB to add to every clip of the role, global gain included. */
  roleGainDb: Partial<Record<StemRole, number>>;
  /** Gain on the whole mix on top of the balance, dB. */
  globalDb: number;
  /** Extra attenuation of music and ambience inside the speech windows, dB (<= 0; 0 = none). */
  duckDb: number;
  /** What limits the loudness: reaching the target, or the true-peak ceiling. */
  limitedBy: "target" | "peak";
  before: { mix: LoudnessReport; stems: Partial<Record<StemRole, LoudnessReport>> };
  /** The mix after the plan, from the stems themselves. */
  predicted: LoudnessReport;
  /** The target was not reached because of the ceiling: the shortfall, LU (>= 0). */
  shortfallLu: number;
}

const BEDS: readonly StemRole[] = ["music", "ambient"];

/** Least material between the lines worth measuring a bed on, seconds. */
const MIN_BETWEEN_LINES = 1.5;

/** The gaps around `windows` once each is widened by the duck's ramps, so a bed's measured level is its level, not its level mid-duck. */
function betweenWindows(windows: readonly SpeechWindow[], seconds: number): SpeechWindow[] {
  const widened = windows.map(([s, e]): SpeechWindow => [s - ATTACK, e + RELEASE + 0.05]).sort((a, b) => a[0] - b[0]);
  const gaps: SpeechWindow[] = [];
  let at = 0;
  for (const [s, e] of widened) {
    if (s > at) gaps.push([at, s]);
    at = Math.max(at, e);
  }
  if (at < seconds) gaps.push([at, seconds]);
  return gaps;
}

/** A gain envelope of 1 with `gain` inside the windows, ramped by `attack` before and `release` after. */
export function duckEnvelope(length: number, sampleRate: number, windows: readonly SpeechWindow[], gain: number, attack = ATTACK, release = RELEASE): Float32Array {
  const env = new Float32Array(length).fill(1);
  if (gain >= 1) return env;
  for (const [s, e] of windows) {
    const from = Math.max(0, Math.round((s - attack) * sampleRate));
    const start = Math.min(length, Math.max(0, Math.round(s * sampleRate)));
    const end = Math.min(length, Math.max(0, Math.round(e * sampleRate)));
    const to = Math.min(length, Math.round((e + release) * sampleRate));
    for (let i = from; i < start; i += 1) env[i] = Math.min(env[i]!, 1 + (gain - 1) * ((i - from) / Math.max(1, start - from)));
    for (let i = start; i < end; i += 1) env[i] = Math.min(env[i]!, gain);
    for (let i = end; i < to; i += 1) env[i] = Math.min(env[i]!, gain + (1 - gain) * ((i - end) / Math.max(1, to - end)));
  }
  return env;
}

const fromDb = (db: number): number => 10 ** (db / 20);

function mixStems(
  stems: readonly StemAudio[],
  sampleRate: number,
  gainDb: Partial<Record<StemRole, number>>,
  duck: { db: number; windows: readonly SpeechWindow[] },
): Float32Array[] {
  const length = stems.reduce((n, s) => Math.max(n, s.channels[0]?.length ?? 0), 0);
  const channelCount = stems.reduce((n, s) => Math.max(n, s.channels.length), 0);
  const out = Array.from({ length: channelCount }, () => new Float32Array(length));
  const env = duck.db < 0 ? duckEnvelope(length, sampleRate, duck.windows, fromDb(duck.db)) : undefined;
  for (const stem of stems) {
    const gain = fromDb(gainDb[stem.role] ?? 0);
    const envelope = env && BEDS.includes(stem.role) ? env : undefined;
    stem.channels.forEach((channel, c) => {
      const dest = out[c]!;
      for (let i = 0; i < channel.length; i += 1) dest[i]! += channel[i]! * gain * (envelope ? envelope[i]! : 1);
    });
  }
  return out;
}

/** Sum stems of one role (several clips' worth are already one stem; this joins duplicates). */
function groupStems(stems: readonly StemAudio[]): StemAudio[] {
  const byRole = new Map<StemRole, StemAudio>();
  for (const stem of stems) {
    const have = byRole.get(stem.role);
    if (!have) {
      byRole.set(stem.role, { role: stem.role, channels: stem.channels.map((c) => Float32Array.from(c)) });
      continue;
    }
    stem.channels.forEach((channel, c) => {
      const dest = have.channels[c];
      if (dest) for (let i = 0; i < Math.min(dest.length, channel.length); i += 1) dest[i]! += channel[i]!;
    });
  }
  return [...byRole.values()];
}

/**
 * Plan the gains. Returns null when the mix is silent (nothing above the
 * -70 LUFS gate): there is nothing to stage and any gain would be noise.
 */
export function planGainStage(input: GainStageInput): GainStagePlan | null {
  const { sampleRate, target } = input;
  const stems = groupStems(input.stems);
  const dry = mixStems(stems, sampleRate, {}, { db: 0, windows: [] });
  const mixBefore = measureLoudness(dry, sampleRate);
  if (mixBefore.integrated === SILENCE_LUFS) return null;

  const measured: Partial<Record<StemRole, LoudnessReport>> = {};
  // What a bed is set against is its level between the lines (the part a duck does not touch), so ducking it never moves its role level.
  const gaps = input.duck ? betweenWindows(input.speechWindows, dry[0]!.length / sampleRate) : [];
  const betweenSeconds = gaps.reduce((n, [s, e]) => n + e - s, 0);
  const levels: Partial<Record<StemRole, number>> = {};
  for (const stem of stems) {
    const report = measureLoudness(stem.channels, sampleRate);
    if (report.integrated === SILENCE_LUFS) continue;
    measured[stem.role] = report;
    const between = BEDS.includes(stem.role) && betweenSeconds >= MIN_BETWEEN_LINES;
    levels[stem.role] = between ? measureLoudness(sliceWindows(stem.channels, sampleRate, gaps), sampleRate).integrated : report.integrated;
    if (levels[stem.role] === SILENCE_LUFS) levels[stem.role] = report.integrated;
  }
  const present = STEM_ROLES.filter((r) => measured[r] !== undefined);
  const lead = present.includes("speech") ? "speech" : (present.find((r) => r !== "ambient") ?? present[0]!);
  const withSpeech = lead === "speech";

  const roleGainDb: Partial<Record<StemRole, number>> = {};
  for (const role of present) {
    if (input.balance === "keep" || role === lead) {
      roleGainDb[role] = 0;
      continue;
    }
    const wanted = levels[lead]! + (withSpeech ? ROLE_OFFSET_LU.withSpeech : ROLE_OFFSET_LU.withoutSpeech)[role];
    roleGainDb[role] = Math.max(-MAX_ROLE_MOVE_DB, Math.min(MAX_ROLE_MOVE_DB, wanted - levels[role]!));
  }

  // Beds while someone talks: where the music is still louder than BED_UNDER_SPEECH_LU under the speech, duck it by the difference.
  let duckDb = 0;
  if (input.duck && withSpeech && input.speechWindows.length > 0) {
    const speechInside = measureLoudness(sliceWindows(stems.find((s) => s.role === "speech")!.channels, sampleRate, input.speechWindows), sampleRate).integrated;
    const staged = mixStems(
      stems.filter((s) => BEDS.includes(s.role)),
      sampleRate,
      roleGainDb,
      { db: 0, windows: [] },
    );
    const bedInside = measureLoudness(sliceWindows(staged, sampleRate, input.speechWindows), sampleRate).integrated;
    if (speechInside !== SILENCE_LUFS && bedInside !== SILENCE_LUFS) {
      const needed = speechInside - BED_UNDER_SPEECH_LU - bedInside;
      if (needed < -DUCK_TOLERANCE_LU) duckDb = Math.max(-MAX_DUCK_DB, needed);
    }
  }

  const staged = mixStems(stems, sampleRate, roleGainDb, { db: duckDb, windows: input.speechWindows });
  const stagedReport = measureLoudness(staged, sampleRate);
  // Loudness scales exactly with gain, so the global gain is a subtraction; the ceiling caps it.
  const toTarget = target.targetLufs - stagedReport.integrated;
  const toCeiling = target.ceilingDbtp - stagedReport.truePeakDb;
  const globalDb = Math.min(toTarget, toCeiling);
  for (const role of present) roleGainDb[role] = (roleGainDb[role] ?? 0) + globalDb;
  const predicted: LoudnessReport = {
    ...stagedReport,
    integrated: stagedReport.integrated + globalDb,
    momentaryMax: stagedReport.momentaryMax + globalDb,
    shortTermMax: stagedReport.shortTermMax + globalDb,
    samplePeakDb: stagedReport.samplePeakDb + globalDb,
    truePeakDb: stagedReport.truePeakDb + globalDb,
  };
  return {
    lead,
    roleGainDb,
    globalDb,
    duckDb,
    limitedBy: toCeiling < toTarget ? "peak" : "target",
    before: { mix: mixBefore, stems: measured },
    predicted,
    shortfallLu: Math.max(0, target.targetLufs - predicted.integrated),
  };
}
