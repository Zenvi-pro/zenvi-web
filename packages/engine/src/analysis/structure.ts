/**
 * Music structure for cutting to a song's form (TECHNIQUES2 T073 bar- and
 * phrase-locked cutting, T076 the cold drop): sections with labels, drops,
 * phrase starts and dips, from mono PCM. Pure (no DOM, no Node).
 *
 *   bars       the beat tracker's downbeats (analysis/beats.ts); 2 s blocks when
 *              the audio has no steady beat
 *   features   per bar: a 12-bin chroma (harmony: 65 Hz-2 kHz folded onto pitch
 *              classes, 4096-point FFT) and the level of the bass (30-150 Hz),
 *              mids (150 Hz-2 kHz), highs (2-8 kHz) and the whole mix, in dB
 *   boundaries novelty between the four bars before and the four after each bar
 *              line (Foote 2000's checkerboard, as a distance of means), peaks at
 *              least four bars apart, nudged onto the four-bar phrase grid
 *   groups     sections whose harmony and levels match are the same part (A, B…)
 *   labels     heuristics an editor would use: the loudest part that repeats is
 *              the chorus (unless a part heard once is 3 dB louder still); one of
 *              the loudest sections that brings the bass in at least 8 dB over a
 *              section with next to none is a drop; first and last sections 6 dB
 *              under the chorus are the intro and outro; the section rising into
 *              a chorus is the pre-chorus (into a drop: the build); a one-off
 *              quieter part after the first chorus is the bridge, or a breakdown
 *              when the bass drops out
 *   dips       stretches of at least 0.2 s where the mids fall 9 dB under their
 *              local level: vocal rests and stops (dense mixes hide some)
 *
 * Labels are a reading, not ground truth: `group` letters say what repeats,
 * which is the part to trust when a label looks wrong.
 */

import { BEAT_SAMPLE_RATE, detectBeats, fft, type BeatOptions } from "./beats.js";

export const SECTION_LABELS = ["intro", "verse", "pre_chorus", "chorus", "build", "drop", "bridge", "breakdown", "outro"] as const;
export type SectionLabel = (typeof SECTION_LABELS)[number];

export interface MusicSection {
  start: number;
  end: number;
  label: SectionLabel;
  /** Sections with the same letter are the same part of the song (harmony and levels match). */
  group: string;
  bars: number;
  /** Mean loudness relative to the loudest section, dB (0 = loudest). */
  levelDb: number;
}

export interface MusicStructure {
  bpm: number;
  beatsPerBar: number;
  /** Seconds between bar lines (0 without a steady beat: 2 s blocks were used). */
  barSeconds: number;
  sections: MusicSection[];
  /** Where the bass slams back in over a much quieter stretch: the hit a cold open or a hard cut waits for. */
  drops: { timeSec: number; strength: number }[];
  /** First beat of every four-bar phrase, counted from each section start (section starts included). */
  phrases: number[];
  /** Stretches where the mid band dips (vocal rests, stops): where a reset or a breath cut lands. */
  dips: { start: number; end: number }[];
  /** 0..1: how steady the bar grid is and how clearly the song repeats itself. */
  confidence: number;
}

const WIN = 4096;
const HOP = 2048;
/** Bars on each side of a bar line the novelty compares. */
const NOVELTY_BARS = 4;
/** Shortest section, bars. */
const MIN_SECTION_BARS = 4;
/** Bars in a phrase. */
const PHRASE_BARS = 4;
/** Weakest change that starts a section: about 3 dB across the bands, or a chord change. */
const MIN_NOVELTY = 0.5;
/** A drop brings the bass in by at least this much over the section before, dB. */
const DROP_BASS_DB = 8;

interface Frames {
  times: Float64Array;
  chroma: Float64Array[];
  /** dB per frame: bass, mids, highs, whole mix. */
  bands: Float64Array[];
}

const db = (power: number) => 10 * Math.log10(power + 1e-10);

function frameFeatures(pcm: Float32Array, sampleRate: number): Frames {
  const count = pcm.length >= WIN ? Math.floor((pcm.length - WIN) / HOP) + 1 : 0;
  const hann = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
  const binHz = sampleRate / WIN;
  const pitchClass = new Int8Array(WIN / 2).fill(-1);
  for (let k = 1; k < WIN / 2; k += 1) {
    const f = k * binHz;
    if (f >= 65 && f <= 2000) pitchClass[k] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const times = new Float64Array(count);
  const chroma: Float64Array[] = [];
  const bands: Float64Array[] = [];
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  for (let f = 0; f < count; f += 1) {
    const offset = f * HOP;
    let energy = 0;
    for (let i = 0; i < WIN; i += 1) {
      const x = pcm[offset + i]!;
      energy += x * x;
      re[i] = x * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const c = new Float64Array(12);
    let low = 0;
    let mid = 0;
    let high = 0;
    for (let k = 1; k < WIN / 2; k += 1) {
      const power = re[k]! * re[k]! + im[k]! * im[k]!;
      const hz = k * binHz;
      if (hz < 30) continue;
      if (hz < 150) low += power;
      else if (hz < 2000) mid += power;
      else if (hz < 8000) high += power;
      const pc = pitchClass[k]!;
      if (pc >= 0) c[pc] = c[pc]! + power;
    }
    times[f] = (offset + WIN / 2) / sampleRate;
    chroma.push(c);
    bands.push(Float64Array.of(db(low), db(mid), db(high), db(energy / WIN)));
  }
  return { times, chroma, bands };
}

interface Unit {
  start: number;
  end: number;
  /** Unit-length chroma (log-compressed). */
  chroma: Float64Array;
  /** dB: bass, mids, highs, whole mix. */
  bands: Float64Array;
}

function units(frames: Frames, edges: readonly number[]): Unit[] {
  const out: Unit[] = [];
  let f = 0;
  for (let u = 0; u + 1 < edges.length; u += 1) {
    const start = edges[u]!;
    const end = edges[u + 1]!;
    const c = new Float64Array(12);
    const power = new Float64Array(4);
    let n = 0;
    while (f < frames.times.length && frames.times[f]! < start) f += 1;
    for (let g = f; g < frames.times.length && frames.times[g]! < end; g += 1) {
      for (let k = 0; k < 12; k += 1) c[k] = c[k]! + frames.chroma[g]![k]!;
      for (let k = 0; k < 4; k += 1) power[k] = power[k]! + 10 ** (frames.bands[g]![k]! / 10);
      n += 1;
    }
    let norm = 0;
    for (let k = 0; k < 12; k += 1) {
      c[k] = Math.log1p(c[k]! / Math.max(1, n));
      norm += c[k]! * c[k]!;
    }
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < 12; k += 1) c[k] = c[k]! / norm;
    out.push({ start, end, chroma: c, bands: power.map((p) => db(p / Math.max(1, n))) });
  }
  return out;
}

function mean(list: readonly Unit[]): { chroma: Float64Array; bands: Float64Array } {
  const chroma = new Float64Array(12);
  const bands = new Float64Array(4);
  for (const u of list) {
    for (let k = 0; k < 12; k += 1) chroma[k] = chroma[k]! + u.chroma[k]! / list.length;
    for (let k = 0; k < 4; k += 1) bands[k] = bands[k]! + u.bands[k]! / list.length;
  }
  return { chroma, bands };
}

/** How different two stretches sound: harmony (1 - cosine) plus levels (mean dB apart / 6). */
function distance(a: { chroma: Float64Array; bands: Float64Array }, b: { chroma: Float64Array; bands: Float64Array }): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < 12; k += 1) {
    dot += a.chroma[k]! * b.chroma[k]!;
    na += a.chroma[k]! * a.chroma[k]!;
    nb += b.chroma[k]! * b.chroma[k]!;
  }
  const harmony = 1 - dot / (Math.sqrt(na * nb) || 1);
  let levels = 0;
  for (let k = 0; k < 4; k += 1) levels += Math.min(20, Math.abs(a.bands[k]! - b.bands[k]!)) / 4;
  return 4 * harmony + levels / 6;
}

/** Bar lines (indices into `list`) where a new section starts, the first one (0) included. */
function boundaries(list: readonly Unit[], phraseOrigin: number): number[] {
  const n = list.length;
  if (n < 2 * MIN_SECTION_BARS) return [0];
  const novelty = new Float64Array(n);
  for (let i = 2; i <= n - 2; i += 1) {
    const w = Math.min(NOVELTY_BARS, i, n - i);
    novelty[i] = distance(mean(list.slice(i - w, i)), mean(list.slice(i, i + w)));
  }
  const peak = Math.max(...novelty, 0);
  // A section change rises out of the bars around it; a bumpy stretch inside a section does not.
  const prominent = (i: number) => {
    const left = Math.min(...novelty.slice(Math.max(2, i - NOVELTY_BARS), i + 1));
    const right = Math.min(...novelty.slice(i, Math.min(n - 1, i + NOVELTY_BARS + 1)));
    return novelty[i]! - Math.max(left, right) >= 0.5 * novelty[i]!;
  };
  // A bar line on the phrase grid wins a near-tie with the bar next to it: sections start on phrases.
  const score = (i: number) => novelty[i]! * ((i - phraseOrigin) % PHRASE_BARS === 0 ? 1.15 : 1);
  const candidates: number[] = [];
  for (let i = 2; i <= n - 2; i += 1) {
    if (novelty[i]! < Math.max(MIN_NOVELTY, 0.2 * peak) || !prominent(i)) continue;
    let top = true;
    for (let j = Math.max(2, i - 2); j <= Math.min(n - 2, i + 2); j += 1) if (j !== i && score(j) > score(i)) top = false;
    if (top) candidates.push(i);
  }
  const chosen: number[] = [];
  for (const i of candidates.sort((a, b) => score(b) - score(a))) {
    if (i < MIN_SECTION_BARS && i !== phraseOrigin) continue;
    if (n - i < MIN_SECTION_BARS) continue;
    if (chosen.every((j) => Math.abs(j - i) >= MIN_SECTION_BARS)) chosen.push(i);
  }
  return [0, ...chosen.sort((a, b) => a - b)];
}

function slope(list: readonly Unit[]): number {
  if (list.length < 2) return 0;
  const head = mean(list.slice(0, Math.max(1, Math.floor(list.length / 4)))).bands[3]!;
  const tail = mean(list.slice(-Math.max(1, Math.floor(list.length / 4)))).bands[3]!;
  return tail - head;
}

interface Part {
  units: Unit[];
  group: number;
  loud: number;
  bass: number;
  label?: SectionLabel;
  dropStrength?: number;
}

function label(parts: Part[]): void {
  const loudest = Math.max(...parts.map((p) => p.loud));
  const counts = new Map<number, number>();
  for (const p of parts) counts.set(p.group, (counts.get(p.group) ?? 0) + 1);
  const groupLoud = (g: number) => {
    const of = parts.filter((p) => p.group === g);
    return of.reduce((s, p) => s + p.loud, 0) / of.length;
  };
  const repeating = [...counts].filter(([, c]) => c >= 2).map(([g]) => g);
  const sortedLoud = [...parts.map((p) => p.loud)].sort((a, b) => a - b);
  const median = sortedLoud[Math.floor(sortedLoud.length / 2)]!;
  let chorus: number | null = repeating.length > 0 ? repeating.sort((a, b) => groupLoud(b) - groupLoud(a))[0]! : null;
  // A part heard once but clearly louder than everything that repeats is the chorus of a cut-down song.
  const top = parts.find((p) => p.loud === loudest)!;
  if (parts.length > 1 && (chorus === null ? loudest >= median + 3 : top.group !== chorus && loudest >= groupLoud(chorus) + 3)) chorus = top.group;
  // Drops: the bass slams into one of the loudest parts out of a stretch that had next to none (a build, a breakdown).
  const loudestBass = Math.max(...parts.map((p) => p.bass));
  parts.forEach((p, i) => {
    if (i === 0) return;
    const before = parts[i - 1]!;
    const rise = p.bass - before.bass;
    if (rise >= DROP_BASS_DB && before.bass <= loudestBass - 12 && p.loud >= loudest - 3) p.dropStrength = Math.min(1, Math.round((rise / 18) * 100) / 100);
  });
  for (const p of parts) if (p.group === chorus) p.label = "chorus";
  for (const p of parts) if (p.dropStrength !== undefined) p.label = "drop";
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const chorusLoud = chorus !== null ? groupLoud(chorus) : loudest;
  if (parts.length > 1 && !first.label && first.loud < chorusLoud - 6) first.label = "intro";
  if (parts.length > 2 && !last.label && last.loud < chorusLoud - 6) last.label = "outro";
  const firstHit = parts.findIndex((p) => p.label === "chorus" || p.label === "drop");
  parts.forEach((p, i) => {
    if (p.label) return;
    const next = parts[i + 1];
    if (next?.label === "drop") p.label = "build";
    else if (i > 0 && next?.label === "chorus" && slope(p.units) >= 2) p.label = "pre_chorus";
    else if (firstHit >= 0 && i > firstHit && (counts.get(p.group) ?? 0) === 1 && p.loud < chorusLoud - 2) p.label = p.bass < Math.max(...parts.map((q) => q.bass)) - DROP_BASS_DB ? "breakdown" : "bridge";
    else p.label = "verse";
  });
}

/** Stretches of at least `minSeconds` where the mids sit 9 dB or more under their median over the 3 s around. */
function midDips(frames: Frames, minSeconds = 0.2): { start: number; end: number }[] {
  const n = frames.times.length;
  if (n === 0) return [];
  const step = frames.times.length > 1 ? frames.times[1]! - frames.times[0]! : HOP / BEAT_SAMPLE_RATE;
  const radius = Math.max(1, Math.round(1.5 / step));
  const mids = frames.bands.map((b) => b[1]!);
  const out: { start: number; end: number }[] = [];
  let open = -1;
  for (let f = 0; f <= n; f += 1) {
    let dip = false;
    if (f < n) {
      const around = mids.slice(Math.max(0, f - radius), Math.min(n, f + radius + 1)).sort((a, b) => a - b);
      dip = mids[f]! < around[Math.floor(around.length / 2)]! - 9;
    }
    if (dip && open < 0) open = f;
    if (!dip && open >= 0) {
      const start = frames.times[open]! - step / 2;
      const end = frames.times[f - 1]! + step / 2;
      if (end - start >= minSeconds - 1e-9) out.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
      open = -1;
    }
  }
  return out;
}

/**
 * Bar lines from 0 to the end: the tracked downbeats, carried on at the bar
 * period through stretches the tracker found no beat in (a drumless intro, a
 * riser), so every part of the song is cut into bars. A pickup shorter than
 * a quarter bar joins the first bar.
 */
function barLines(downbeats: readonly number[], bar: number, duration: number): number[] {
  const lines: number[] = [0];
  const lead: number[] = [];
  for (let t = downbeats[0]! - bar; t > 0.25 * bar; t -= bar) lead.unshift(t);
  lines.push(...lead);
  downbeats.forEach((d, i) => {
    lines.push(d);
    const next = downbeats[i + 1];
    if (next !== undefined && next - d > 1.5 * bar) {
      const k = Math.round((next - d) / bar);
      for (let j = 1; j < k; j += 1) lines.push(d + (j * (next - d)) / k);
    }
  });
  for (let e = downbeats[downbeats.length - 1]! + bar; e < duration - 0.25 * bar; e += bar) lines.push(e);
  // A first downbeat within a quarter bar of the start is the start.
  if (lines.length > 1 && lines[1]! <= 0.25 * bar) lines.splice(1, 1);
  return [...lines, duration];
}

/** Sections, drops, phrases and dips of a song. A track too short for two sections is one section. */
export function detectStructure(pcm: Float32Array, sampleRate: number, options: BeatOptions = {}): MusicStructure {
  const duration = pcm.length / sampleRate;
  const beats = detectBeats(pcm, sampleRate, options);
  const frames = frameFeatures(pcm, sampleRate);
  const downbeats = beats.downbeats.map((d) => d.timeSec);
  const gridded = beats.bpm > 0 && downbeats.length >= 2 * MIN_SECTION_BARS;
  const barSeconds = gridded ? (60 / beats.bpm) * beats.beatsPerBar : 0;
  let edges: number[];
  if (gridded) {
    edges = barLines(downbeats, barSeconds, duration);
  } else {
    edges = [];
    for (let t = 0; t < duration; t += 2) edges.push(t);
    edges.push(duration);
  }
  if (edges.length >= 3 && edges[edges.length - 1]! - edges[edges.length - 2]! < 0.25 * (barSeconds || 2)) edges.splice(edges.length - 2, 1);
  const list = units(frames, edges);
  // A band that is absent (no bass under a pad) reads -100 dB: floor it 40 dB under its loudest bar, so absence counts as quiet, not as infinitely different.
  for (let k = 0; k < 4; k += 1) {
    const top = Math.max(...list.map((u) => u.bands[k]!));
    for (const u of list) u.bands[k] = Math.max(u.bands[k]!, top - 40);
  }
  if (list.length === 0) return { bpm: beats.bpm, beatsPerBar: beats.beatsPerBar, barSeconds, sections: [], drops: [], phrases: [], dips: [], confidence: 0 };

  const starts = boundaries(list, 0);
  const parts: Part[] = starts.map((s, i) => {
    const own = list.slice(s, starts[i + 1] ?? list.length);
    const m = mean(own);
    return { units: own, group: -1, loud: m.bands[3]!, bass: m.bands[0]! };
  });
  // Same part of the song: harmony and levels close to a section already grouped.
  const heads: { group: number; features: ReturnType<typeof mean> }[] = [];
  for (const p of parts) {
    const features = mean(p.units);
    const match = heads.find((h) => distance(h.features, features) < 0.6);
    if (match) p.group = match.group;
    else {
      p.group = heads.length;
      heads.push({ group: heads.length, features });
    }
  }
  label(parts);
  const loudest = Math.max(...parts.map((p) => p.loud));
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const sections: MusicSection[] = parts.map((p) => ({
    start: r3(p.units[0]!.start),
    end: r3(p.units[p.units.length - 1]!.end),
    label: p.label!,
    group: String.fromCharCode(65 + (p.group % 26)),
    bars: p.units.length,
    levelDb: Math.round((p.loud - loudest) * 10) / 10,
  }));
  const phrases: number[] = [];
  for (const p of parts) for (let k = 0; k < p.units.length; k += PHRASE_BARS) phrases.push(r3(p.units[k]!.start));
  const repeats = parts.length > 1 && heads.length < parts.length;
  return {
    bpm: beats.bpm,
    beatsPerBar: beats.beatsPerBar,
    barSeconds: Math.round(barSeconds * 1000) / 1000,
    sections,
    drops: parts.filter((p) => p.dropStrength !== undefined).map((p) => ({ timeSec: r3(p.units[0]!.start), strength: p.dropStrength! })),
    phrases,
    dips: midDips(frames),
    confidence: Math.round((gridded ? beats.confidence : 0.3) * (repeats ? 1 : 0.7) * 100) / 100,
  };
}
