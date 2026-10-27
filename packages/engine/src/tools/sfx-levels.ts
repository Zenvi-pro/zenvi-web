/**
 * The mix pass of automatic sound design: every cue's gain from what it
 * will actually sound like over what plays under it (sfx/levels.ts). The
 * host mixes the timeline without its sound effects (`AudioHost.mixPcm`,
 * the export's own mix, volume curves and all) and decodes each sound once;
 * a cue's lead layer then lands its role's prominence over the bed, its
 * other layers keep their designed balance to it, and simultaneous layers
 * never sum past -3 dBFS. Where the host cannot measure, the designed
 * gains stand.
 */

import type { Clip } from "../model/types.js";
import type { DesignedCue, CueLayer } from "../sfx/design.js";
import { SFX_SAMPLE_RATE } from "../sfx/dsp.js";
import { bedLevelAt, envelope50, gainOverBed, peakNear, type LevelRole } from "../sfx/levels.js";
import { isSfxClip } from "../sfx/moments.js";
import { fileById } from "./catalog/common.js";
import type { ToolCall } from "./define.js";
import type { PreparedSfx } from "./sfx-media.js";

/** Summed peak of layers landing together, dBFS: headroom for the bed and the master (CRAFT.md §4 peaks -1…-3). */
const STACK_PEAK_DB = -3;
/** Most the measured bed moves a cue from its designed level, dB. */
const MAX_SHIFT_DB = 6;
/** Layers this close together are one stack, seconds. */
const STACK_WINDOW = 0.015;
/** The layer that carries a cue's level, in order of preference. */
const LEAD: readonly CueLayer[] = ["body", "whoosh", "ui", "micro", "riser", "transient"];

interface Measured {
  /** 50 ms peak around the hit at 0 dB gain, dBFS. */
  peak50: number;
  /** Sample peak, dBFS. */
  peak: number;
}

export interface LevelResult {
  gains: number[];
  /** Cues whose gain came from the measured bed. */
  levelled: number;
  note?: string;
}

const db = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

async function measureSound(call: ToolCall, sound: PreparedSfx): Promise<Measured | null> {
  const path = sound.media?.path ?? (sound.fileId ? String(fileById(call.doc.project, sound.fileId)?.path ?? "") : "");
  if (!path) return null;
  const pcm = await call.host.audio!.decodePcm!(path, { sampleRate: SFX_SAMPLE_RATE, channels: 2, maxSeconds: 130, signal: call.signal });
  let peak = 0;
  for (const ch of [pcm.samples, pcm.right ?? pcm.samples]) for (let i = 0; i < ch.length; i += 1) peak = Math.max(peak, Math.abs(ch[i]!));
  return { peak50: peakNear(envelope50(pcm.samples, pcm.right, pcm.sampleRate), sound.hit), peak: db(peak) };
}

/** Gains for `cues` (played by `sounds`, designed at `gains`), levelled over the bed where the host can measure it. */
export async function levelCues(call: ToolCall, cues: readonly DesignedCue[], sounds: readonly PreparedSfx[], gains: readonly number[], previous: readonly Clip[]): Promise<LevelResult> {
  const out = [...gains];
  const audio = call.host.audio;
  if (!audio?.decodePcm) return { gains: stacked(cues, out, null), levelled: 0 };
  const measured = new Map<string, Promise<Measured | null>>();
  const of = (s: PreparedSfx) => {
    if (!measured.has(s.key)) measured.set(s.key, measureSound(call, s).catch(() => null));
    return measured.get(s.key)!;
  };
  const levels = await Promise.all(sounds.map(of));
  let bed: Float32Array | null = null;
  let note: string | undefined;
  const replaced = new Set(previous.map((c) => c.id));
  const under = call.doc.project.clips.filter((c) => !isSfxClip(c) && !replaced.has(c.id)).map((c) => c.id);
  if (audio.mixPcm && under.length > 0) {
    try {
      const mix = await audio.mixPcm(call.doc.project, { clipIds: under, signal: call.signal });
      bed = envelope50(mix.channels[0]!, mix.channels[1], mix.sampleRate);
    } catch (error) {
      note = `The timeline's audio could not be mixed to level the effects against it (${error instanceof Error ? error.message : String(error)}), so they keep their designed levels.`;
    }
  }
  let levelled = 0;
  if (bed) {
    // One lead per answered hit point and role: its layers move with it.
    const groups = new Map<string, number[]>();
    cues.forEach((c, i) => {
      if (c.role === "bed") return;
      const key = `${c.point}:${c.role}:${c.point < 0 ? i : ""}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    for (const members of groups.values()) {
      const lead = [...members].sort((a, b) => LEAD.indexOf(cues[a]!.layer) - LEAD.indexOf(cues[b]!.layer))[0]!;
      const level = levels[lead];
      if (!level) continue;
      const role = cues[lead]!.role as LevelRole;
      const target = gainOverBed(role, level.peak50, bedLevelAt(bed, cues[lead]!.at));
      if (target === null) continue;
      // The bed moves the level, within reason: a near-silent stretch does not turn a sweetener into a slam.
      const shift = Math.max(-MAX_SHIFT_DB, Math.min(MAX_SHIFT_DB, target - gains[lead]!));
      for (const i of members) out[i] = Math.max(-40, Math.min(0, Math.round((gains[i]! + shift) * 10) / 10));
      levelled += members.length;
    }
  }
  return { gains: stacked(cues, out, levels), levelled, ...(note ? { note } : {}) };
}

/** A cue, or layers landing together, never peak past STACK_PEAK_DB: the stack comes down as one (no spike the master must turn the whole mix down for). */
function stacked(cues: readonly DesignedCue[], gains: number[], levels: readonly (Measured | null)[] | null): number[] {
  const order = cues.map((c, i) => i).sort((a, b) => cues[a]!.at - cues[b]!.at);
  let k = 0;
  while (k < order.length) {
    const group = [order[k]!];
    while (k + group.length < order.length && cues[order[k + group.length]!]!.at - cues[order[k]!]!.at <= STACK_WINDOW) group.push(order[k + group.length]!);
    k += group.length;
    const sum = group.reduce((s, i) => s + 10 ** ((gains[i]! + (levels?.[i]?.peak ?? -1)) / 20), 0);
    const over = db(sum) - STACK_PEAK_DB;
    if (over > 0) for (const i of group) gains[i] = Math.round((gains[i]! - over) * 10) / 10;
  }
  return gains;
}
