/**
 * Mixing tools by number, each one undo step, each writing only what
 * libopenshot already plays so the desktop hears the same mix:
 *
 *   set_track_role_tool   file a track under a stem (voice / music / sfx / ambience)
 *   set_audio_gain_tool   dB on clips, a track or a stem (volume curve + Compressor makeup)
 *   automate_volume_tool  dB keyframes: points with curves, or a shape (dip, ramp, swell,
 *                         suck_out, pre_hit_duck, swell_between_lines, fade_in, fade_out)
 *   duck_tool             beds under the voice or under hero hits, to a voice-over-bed target
 *   eq_tool               ParametricEQ bands (high/low pass, shelves, peaks) or presets
 *   compress_tool         Compressor (voice, glue, punch, limit, or by number)
 *   space_tool            a short room / slap / hall from chained Echo effects
 *
 * Numbers come from zenvi-motion sound/CRAFT.md and DEPLOY.md S3; the
 * effect semantics are libopenshot's (src/audio_effects/*.cpp, ported in
 * render/audio/). Every call names its clips the same way (clip_ids, track,
 * role: ../mix-roles.ts), validates before it opens the transaction, and
 * returns an `unchanged` receipt with no undo step when it would change nothing.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { speechWindowsOf } from "../../mastering/score.js";
import { createEffect } from "../../effects/registry.js";
import { loudnessSeries, measureLoudness } from "../../mastering/loudness.js";
import { median, percentile } from "../../mastering/analysis.js";
import { setClipKeyframes } from "../../ops/clips.js";
import { setClipEffects } from "../../ops/effects.js";
import { TRACK_AUDIO_ROLES, setTrackAudioRole } from "../../ops/tracks.js";
import { idFactory } from "../../model/ids.js";
import type { Effect, KeyframePoint, Project } from "../../model/types.js";
import { buildDuckPoints, clampWindows, clipTimelineExtent, curvePoints, duckedWindows, mergeWindows, type Window } from "../audio-mix.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, unchanged, type ToolReceipt } from "../receipt.js";
import { normalizeTrackOrLayerArg, lockedTrackError, formatTrackLabelForLlm } from "../tracks.js";
import { applyClipGain } from "./mastering.js";
import { sameCurve, shapeVolume, type GainPoint } from "../mix-curves.js";
import { cuesOf, mixEntries, resolveTargets, targetShape, type MixEntry, type MixRole } from "../mix-roles.js";
import { fpsFloatOf, idList } from "./common.js";

const ADJUST = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const signed = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
const names = (entries: readonly MixEntry[]): string => {
  const shown = entries.slice(0, 6).map((e) => e.id).join(", ");
  return entries.length > 6 ? `${shown} +${entries.length - 6} more` : shown;
};

function writeVolume(tx: Transaction, clipId: string, points: readonly KeyframePoint[]): void {
  setClipKeyframes(tx, clipId, "volume", points.map((p) => ({ frame: p.co.X, value: p.co.Y, interpolation: p.interpolation })), { mode: "replace" });
}

// ---------------------------------------------------------------------------
// set_track_role_tool
// ---------------------------------------------------------------------------

const roleInput = z.strictObject({
  track: z.union([z.string(), z.number()]).describe("Track: layer_number, track id, exact label, or ui_track counted from the bottom."),
  role: z.enum([...TRACK_AUDIO_ROLES, "none"]).describe("The stem its clips play in: voice, music, sfx, ambience; none clears it (clips fall back to what their media says)."),
});

const setTrackRole = directTool({
  name: "set_track_role_tool",
  title: "Set track audio role",
  description:
    "File a track's clips under a mix stem (voice, music, sfx, ambience), so analyze_mix_tool scores them as that stem and the mixing tools (role=...) and master_audio_tool treat them so. " +
    "Use it when a track's role is guessed wrong: a VO recorded as video, a music bed shorter than 8 s, room tone. One undo step.",
  input: roleInput,
  annotations: ADJUST,
  run: (call, args: z.output<typeof roleInput>): ToolReceipt | string => {
    const tool = "set_track_role_tool";
    const project = call.doc.project;
    const r = normalizeTrackOrLayerArg(args.track, project.layers);
    if (r.error) return r.error;
    const layer = r.layer!;
    const role = args.role === "none" ? null : args.role;
    const current = project.layers.find((l) => Number(l.number) === layer)?.zenvi_audio_role ?? null;
    const label = formatTrackLabelForLlm(layer, project.layers);
    if (current === role) return unchanged(tool, `Track ${label} is already ${role ?? "without a role"}.`);
    call.commit((tx) => setTrackAudioRole(tx, layer, role), "Set track role");
    const clips = mixEntries(call.doc.project).filter((e) => e.layer === layer);
    return applied(tool, `Track ${label} now plays in the ${role ?? "default"} stem (${clips.length} clip(s) with sound).`, { data: { track: layer, role, clips: clips.map((c) => ({ id: c.id, role: c.mixRole })) } });
  },
});

// ---------------------------------------------------------------------------
// set_audio_gain_tool
// ---------------------------------------------------------------------------

const gainInput = z.strictObject({
  ...targetShape,
  gain_db: z.number().min(-60).max(24).describe("Gain to add, dB (negative = quieter). Cuts scale the volume curve, keeping its automation; boosts past the volume range go through Compressor makeup (ratio 1, a pure gain)."),
});

const setAudioGain = directTool({
  name: "set_audio_gain_tool",
  title: "Set audio gain",
  description:
    "Turn clips up or down by dB, keeping their volume automation (ducks, fades) in shape: a clip, every clip on a track ('lower track SFX by 3 dB'), or a whole stem (role=music). " +
    "The fix analyze_mix_tool names for levels (B2, B4, B5, L2, L4). One undo step for all the clips.",
  input: gainInput,
  annotations: ADJUST,
  run: (call, args: z.output<typeof gainInput>): ToolReceipt | string => {
    const tool = "set_audio_gain_tool";
    const targets = resolveTargets(call.doc.project, args);
    if (typeof targets === "string") return targets;
    if (Math.abs(args.gain_db) < 0.05) return unchanged(tool, `A ${args.gain_db} dB change is no change: nothing written.`);
    const results = call.commit((tx) => targets.map((e) => ({ entry: e, result: applyClipGain(tx, e.id, args.gain_db) })), "Set audio gain");
    const short = results.filter(({ result }) => Math.abs(result.appliedDb - args.gain_db) > 0.25);
    return applied(tool, `${signed(args.gain_db)} dB on ${targets.length} clip(s): ${names(targets)}.`, {
      data: { clips: results.map(({ entry, result }) => ({ id: entry.id, role: entry.mixRole, gainDb: r2(result.appliedDb) })) },
      warnings: short.length ? [`${short.length} clip(s) took less (the volume range tops out at +2.3 dB, makeup at +48 dB): ${short.slice(0, 5).map((s) => s.entry.id).join(", ")}.`] : [],
    });
  },
});

// ---------------------------------------------------------------------------
// automate_volume_tool
// ---------------------------------------------------------------------------

const SHAPES = ["points", "dip", "ramp", "swell", "suck_out", "pre_hit_duck", "swell_between_lines", "fade_in", "fade_out"] as const;
type Shape = (typeof SHAPES)[number];

const curveArg = z.enum(["linear", "bezier", "constant"]);

const automateInput = z.strictObject({
  ...targetShape,
  shape: z
    .enum(SHAPES)
    .describe(
      "points: your (t, db) keyframes. dip: db (default -6) from start to end with fade_ms ramps. ramp: 0 dB at start to db at end, held to the clip's end. swell: up db (default +2) and back over start-end. " +
        "suck_out: the bed drops db (default -18) for length_ms (200) before the at_seconds / hit_times hit(s), 20 ms fall, 10 ms return. pre_hit_duck: db (-10) for length_ms (120) before each hit (default: every hero cue). " +
        "swell_between_lines: +db (default +2) on the bed between voice lines at least 600 ms apart. fade_in / fade_out: from / to silence over length_ms at the clip's start / end.",
    ),
  points: z
    .array(z.strictObject({ t: z.number().min(0).describe("Timeline seconds."), db: z.number().min(-60).max(12).describe("dB (relative: over the current level)."), curve: curveArg.optional().describe("Segment into this point: linear (even in dB), bezier (eased), constant (step).") }))
    .min(1)
    .max(64)
    .optional()
    .describe("shape=points: the keyframes, timeline seconds."),
  start_seconds: z.number().min(0).optional().describe("dip / ramp / swell: timeline start."),
  end_seconds: z.number().min(0).optional().describe("dip / ramp / swell: timeline end."),
  at_seconds: z.number().min(0).optional().describe("suck_out / pre_hit_duck: the hit time, timeline seconds."),
  hit_times: z.array(z.number().min(0)).min(1).max(64).optional().describe("suck_out / pre_hit_duck: several hit times, timeline seconds."),
  db: z.number().min(-60).max(12).optional().describe("The shape's depth or height, dB."),
  length_ms: z.number().min(10).max(10000).optional().describe("suck_out / pre_hit_duck / fade_in / fade_out: how long, ms."),
  fade_ms: z.number().min(0).max(5000).optional().describe("dip / swell_between_lines: ramp time at each edge, ms (default 50 / 150)."),
  curve: curveArg.optional().describe("Segment shape for the generated points (default linear; swell defaults to bezier)."),
  mode: z.enum(["relative", "absolute"]).default("relative").describe("relative (default): dB over the current curve, keeping ducks and fades; absolute: dB re unity replace the curve inside the span."),
});
type AutomateArgs = z.output<typeof automateInput>;

function hitsOf(args: AutomateArgs, project: Project): number[] | string {
  if (args.at_seconds !== undefined || args.hit_times !== undefined) return [...(args.at_seconds !== undefined ? [args.at_seconds] : []), ...(args.hit_times ?? [])];
  if (args.shape === "pre_hit_duck") {
    const heroes = cuesOf(project).filter((c) => c.role === "hero").map((c) => c.t);
    return heroes.length ? heroes : "Error: pre_hit_duck needs at_seconds: the timeline has no hero cues (impacts, risers) to duck before.";
  }
  return `Error: ${args.shape} needs at_seconds (the hit time).`;
}

/** The shape's points for one clip, or an error string. */
function shapePoints(args: AutomateArgs, entry: MixEntry, project: Project, voiceWindows: readonly Window[]): GainPoint[][] | string {
  const [cs, ce] = [entry.start, entry.end];
  const curve = args.curve;
  const need = (key: "start_seconds" | "end_seconds"): number | string => (args[key] === undefined ? `Error: ${args.shape} needs ${key}.` : args[key]!);
  switch (args.shape as Shape) {
    case "points":
      if (!args.points) return "Error: shape=points needs points: [{t, db}].";
      return [args.points.map((p) => ({ t: p.t, db: p.db, curve: p.curve ?? curve }))];
    case "dip":
    case "swell": {
      const s = need("start_seconds");
      const e = need("end_seconds");
      if (typeof s === "string") return s;
      if (typeof e === "string") return e;
      if (e <= s) return "Error: end_seconds must be after start_seconds.";
      if (args.shape === "dip") {
        const fade = (args.fade_ms ?? 50) / 1000;
        const db = args.db ?? -6;
        return [[{ t: s - fade, db: 0 }, { t: s, db, curve }, { t: e, db, curve }, { t: e + fade, db: 0, curve }]];
      }
      return [[{ t: s, db: 0 }, { t: (s + e) / 2, db: args.db ?? 2, curve: curve ?? "bezier" }, { t: e, db: 0, curve: curve ?? "bezier" }]];
    }
    case "ramp": {
      const s = need("start_seconds");
      const e = need("end_seconds");
      if (typeof s === "string") return s;
      if (typeof e === "string") return e;
      if (e <= s) return "Error: end_seconds must be after start_seconds.";
      const db = args.db ?? -12;
      return [[{ t: s, db: 0 }, { t: e, db, curve }, ...(ce > e ? [{ t: ce, db, curve: "constant" as const }] : [])]];
    }
    case "suck_out":
    case "pre_hit_duck": {
      const hits = hitsOf(args, project);
      if (typeof hits === "string") return hits;
      const suck = args.shape === "suck_out";
      const len = (args.length_ms ?? (suck ? 200 : 120)) / 1000;
      const db = args.db ?? (suck ? -18 : -10);
      const fall = suck ? 0.02 : 0.015;
      const rise = suck ? 0.01 : 0.005;
      return hits.map((t) => [{ t: t - len - fall, db: 0 }, { t: t - len, db, curve }, { t: t - rise, db, curve }, { t, db: 0, curve }]);
    }
    case "swell_between_lines": {
      const fade = (args.fade_ms ?? 150) / 1000;
      const gaps: Window[] = [];
      const lines = mergeWindows(voiceWindows);
      for (let i = 1; i < lines.length; i += 1) if (lines[i]![0] - lines[i - 1]![1] >= 0.6) gaps.push([lines[i - 1]![1], lines[i]![0]]);
      if (lines.length === 0) return "Error: swell_between_lines found no voice lines (no clips in the voice stem with known speech).";
      const db = args.db ?? 2;
      return gaps.map(([s, e]) => [{ t: s, db: 0 }, { t: s + fade, db, curve }, { t: e - fade, db, curve }, { t: e, db: 0, curve }]);
    }
    case "fade_in":
    case "fade_out": {
      const len = (args.length_ms ?? 1000) / 1000;
      if (args.shape === "fade_in") return [[{ t: cs, db: -60 }, { t: Math.min(ce, cs + len), db: 0, curve }]];
      return [[{ t: Math.max(cs, ce - len), db: 0 }, { t: ce, db: -60, curve }]];
    }
  }
  return "Error: unknown shape.";
}

/** Voice lines on the timeline: the voice stem's speech windows (transcripts / cues / waveform). */
function voiceLines(entries: readonly MixEntry[]): Window[] {
  return mergeWindows(entries.filter((e) => e.mixRole === "voice").flatMap((e) => e.windows));
}

const automateVolume = directTool({
  name: "automate_volume_tool",
  title: "Automate volume",
  description:
    "Volume automation in dB on clips, a track or a stem: your own (t, db) keyframes with linear / bezier / constant curves, or a shape with the measured defaults: " +
    "dip, ramp, swell, suck_out (-18 dB for 200 ms before the climax hit), pre_hit_duck (-10 dB for 120 ms before every hero hit), swell_between_lines (+2 dB on the bed between VO lines), fade_in, fade_out. " +
    "Relative by default (rides on top of existing ducks and fades). suck_out / pre_hit_duck / swell_between_lines default to the music and ambience stems. Writes clip volume keyframes; one undo step.",
  input: automateInput,
  annotations: ADJUST,
  run: (call, args: AutomateArgs): ToolReceipt | string => {
    const tool = "automate_volume_tool";
    const project = call.doc.project;
    const bedShapes: Shape[] = ["suck_out", "pre_hit_duck", "swell_between_lines"];
    const named = args.clip_ids !== undefined || args.track !== undefined || args.role !== undefined;
    let targets: MixEntry[] | string;
    if (!named && bedShapes.includes(args.shape)) {
      const beds = mixEntries(project).filter((e) => e.mixRole === "music" || e.mixRole === "ambience");
      targets = beds.length ? beds : `Error: ${args.shape} rides the music / ambience bed, and the timeline has none: name the clips (clip_ids, track or role).`;
      const locked = beds.find((e) => e.locked);
      if (typeof targets !== "string" && locked) targets = lockedTrackError(locked.layer, project.layers);
    } else targets = resolveTargets(project, args);
    if (typeof targets === "string") return targets;
    const fps = fpsFloatOf(project);
    const lines = voiceLines(mixEntries(project));
    const plans: { entry: MixEntry; points: KeyframePoint[]; clamped: number }[] = [];
    for (const entry of targets) {
      const shapes = shapePoints(args, entry, project, lines);
      if (typeof shapes === "string") return shapes;
      let clip = entry.clip;
      let clamped = 0;
      for (const shape of shapes) {
        const [s, e] = clipTimelineExtent(clip);
        if (shape.every((p) => p.t < s - 1e-6) || shape.every((p) => p.t > e + 1e-6)) continue;
        const out = shapeVolume(clip, fps, shape, args.mode);
        clamped += out.clamped;
        clip = { ...clip, volume: { ...(clip.volume ?? {}), Points: out.points } };
      }
      const points = curvePoints(clip);
      if (!sameCurve(points, curvePoints(entry.clip))) plans.push({ entry, points, clamped });
    }
    if (plans.length === 0) return unchanged(tool, `The ${args.shape} does not reach any of the clips (${names(targets)}) or changes nothing: nothing written.`);
    call.commit((tx) => {
      for (const p of plans) writeVolume(tx, p.entry.id, p.points);
    }, "Automate volume");
    const clamped = plans.filter((p) => p.clamped > 0);
    return applied(tool, `${args.shape} on ${plans.length} clip(s): ${names(plans.map((p) => p.entry))}.`, {
      data: { shape: args.shape, clips: plans.map((p) => ({ id: p.entry.id, role: p.entry.mixRole, points: p.points.length })) },
      warnings: clamped.length ? [`${clamped.length} clip(s) hit the volume ceiling (+2.3 dB) and were clipped there: turn them down first (set_audio_gain_tool) to leave room for a swell.`] : [],
    });
  },
});

// ---------------------------------------------------------------------------
// duck_tool
// ---------------------------------------------------------------------------

const duckInput = z.strictObject({
  bed: z
    .union([z.string(), z.array(z.string())])
    .default(["music", "ambience"])
    .describe("What ducks: stems (music, ambience, sfx) and/or timeline clip ids. Default music + ambience."),
  under: z
    .string()
    .min(1)
    .default("voice")
    .describe("What it ducks under: voice (the voice stem's speech), heroes (every hero cue: impacts, risers), or timeline clip ids (comma-separated) whose sound it clears room for."),
  target_vbr_db: z.number().min(3).max(24).optional().describe("Voice only: duck each line just enough that the voice sits this many dB over the bed (measured per line; default 10 when depth_db is not given)."),
  depth_db: z.number().min(-40).max(-0.5).optional().describe("A fixed duck, dB (default under heroes: -6)."),
  attack_ms: z.number().min(0).max(2000).optional().describe("Ramp down before the window, ms (default voice 40, heroes 10)."),
  hold_ms: z.number().min(0).max(2000).optional().describe("Stay down after the sound ends, ms (default voice 200, heroes 120)."),
  release_ms: z.number().min(0).max(4000).optional().describe("Ramp back up, ms (default voice 400, heroes 250)."),
  lookahead_ms: z.number().min(0).max(1000).optional().describe("Start the duck this early, ms (default voice 50, heroes 10)."),
  dry_run: z.boolean().default(false).describe("Measure and plan only."),
});
type DuckArgs = z.output<typeof duckInput>;

const duck = directTool({
  name: "duck_tool",
  title: "Duck",
  description:
    "Duck music / ambience (or any clips) under the voice or under hero hits with an attack / hold / release envelope written as volume keyframes. " +
    "Under the voice it measures each line and ducks just enough to put the voice target_vbr_db (default 10) over the bed, so quiet lines are not over-ducked and loud beds are pulled further; " +
    "under heroes it clears depth_db (default -6) for each hit. Re-running it adds only what is still missing. One undo step. analyze_mix_tool's B1 fix calls it.",
  input: duckInput,
  annotations: ADJUST,
  run: async (call, args: DuckArgs): Promise<ToolReceipt | string> => {
    const tool = "duck_tool";
    const project = call.doc.project;
    const entries = mixEntries(project);
    const heroes = args.under === "heroes";
    const underIds = args.under === "voice" || heroes ? [] : idList(args.under);
    const bedNames = Array.isArray(args.bed) ? args.bed : [args.bed];
    const bedRoles = bedNames.filter((b): b is MixRole => (TRACK_AUDIO_ROLES as readonly string[]).includes(b));
    const bedIds = bedNames.filter((b) => !(TRACK_AUDIO_ROLES as readonly string[]).includes(b));
    const beds = resolveTargets(project, { role: bedRoles.filter((r) => entries.some((e) => e.mixRole === r)), clip_ids: bedIds });
    if (typeof beds === "string") return beds.includes("name the clips") ? `Error: nothing to duck: no clips in ${bedNames.join(", ")}.` : beds;

    // What it ducks under: windows of sound, timeline seconds.
    const env = heroes
      ? { attack: (args.attack_ms ?? 10) / 1000, padAfter: (args.hold_ms ?? 120) / 1000, release: (args.release_ms ?? 250) / 1000, padBefore: (args.lookahead_ms ?? 10) / 1000 }
      : { attack: (args.attack_ms ?? 40) / 1000, padAfter: (args.hold_ms ?? 200) / 1000, release: (args.release_ms ?? 400) / 1000, padBefore: (args.lookahead_ms ?? 50) / 1000 };
    let triggers: MixEntry[] = [];
    let windows: Window[] = [];
    const canRender = Boolean(call.host.audio?.mixPcm);
    if (heroes) {
      windows = cuesOf(project).filter((c) => c.role === "hero").map((c) => [c.t, c.t + 0.05] as Window);
      if (windows.length === 0) return "Error: no hero cues (impacts, risers) on the timeline to duck under.";
    } else {
      triggers = args.under === "voice" ? entries.filter((e) => e.mixRole === "voice") : entries.filter((e) => underIds.includes(e.id));
      if (triggers.length === 0) return args.under === "voice" ? "Error: no clips in the voice stem to duck under (set_track_role_tool track=... role=voice files a VO track)." : `Error: none of ${underIds.join(", ")} is a timeline clip with sound.`;
      windows = mergeWindows(triggers.flatMap((e) => e.windows));
    }
    const triggerIds = new Set(triggers.map((t) => t.id));
    const bedList = beds.filter((b) => !triggerIds.has(b.id));
    if (bedList.length === 0) return "Error: the bed and what it ducks under are the same clips.";

    const wantVbr = !heroes && args.depth_db === undefined ? (args.target_vbr_db ?? 10) : undefined;
    if (wantVbr !== undefined && !canRender) {
      if (args.target_vbr_db !== undefined) return unavailable(tool, "this host cannot render the mix to measure the voice over the bed; pass depth_db.");
    }
    let voicePcm: { channels: Float32Array[]; sampleRate: number } | undefined;
    let bedPcm: { channels: Float32Array[]; sampleRate: number } | undefined;
    if (canRender && !heroes) {
      try {
        voicePcm = await call.host.audio!.mixPcm!(project, { clipIds: triggers.map((t) => t.id), signal: call.signal });
        if (windows.length === 0) windows = speechWindowsOf(voicePcm.channels, voicePcm.sampleRate);
        if (wantVbr !== undefined) bedPcm = await call.host.audio!.mixPcm!(project, { clipIds: bedList.map((b) => b.id), signal: call.signal });
      } catch (error) {
        return `Error: could not render the mix to measure it: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (windows.length === 0) return "Error: found no speech in the voice clips (no transcript, and nothing loud enough in their sound).";

    const total = entries.reduce((m, e) => Math.max(m, e.end), 0);
    const held = duckedWindows({ position: 0, start: 0, end: total }, windows, env);
    // Depth per window: fixed, or what the measured voice-over-bed needs.
    const depths: { window: Window; db: number; vbr?: number }[] = held.map((w) => ({ window: w, db: args.depth_db ?? (heroes ? -6 : -10) }));
    if (wantVbr !== undefined && voicePcm && bedPcm) {
      const vM = loudnessSeries(voicePcm.channels, voicePcm.sampleRate);
      const bM = loudnessSeries(bedPcm.channels, bedPcm.sampleRate).momentary;
      const vI = measureLoudness(voicePcm.channels, voicePcm.sampleRate).integrated;
      for (const d of depths) {
        const diffs: number[] = [];
        for (let i = 0; i < vM.momentary.length; i += 1) {
          const t = i * vM.hop + 0.2;
          if (t < d.window[0] || t > d.window[1] || vM.momentary[i]! < vI - 8) continue;
          diffs.push(vM.momentary[i]! - (bM[i] ?? -120));
        }
        const vbr = diffs.length ? median(diffs) : Infinity;
        d.vbr = vbr;
        // METRICS.md B1 wants the median on target and the 10th percentile no more than 6 dB under it.
        const need = diffs.length ? Math.max(wantVbr - vbr, wantVbr - 6 - percentile(diffs, 10)) : 0;
        d.db = -Math.min(30, Math.max(0, need));
      }
    }
    const active = depths.filter((d) => d.db <= -0.5);
    const report = depths.map((d) => ({ start: r2(d.window[0]), end: r2(d.window[1]), duckDb: r1(d.db), ...(d.vbr !== undefined && Number.isFinite(d.vbr) ? { vbrBeforeDb: r1(d.vbr) } : {}) }));
    if (active.length === 0) {
      return unchanged(tool, wantVbr !== undefined ? `The voice already sits ${wantVbr} dB or more over the bed in every line: nothing to duck.` : "Nothing to duck.", { data: { windows: report } });
    }

    const fps = project.fps;
    const plans: { entry: MixEntry; points: KeyframePoint[] }[] = [];
    for (const bed of bedList) {
      let clip = bed.clip;
      for (const d of active) {
        const inside = clampWindows([d.window], bed.start, bed.end);
        if (inside.length === 0) continue;
        const points = buildDuckPoints(clip, fps, inside, 10 ** (d.db / 20), { attack: env.attack, release: env.release, padBefore: 0, padAfter: 0 });
        if (points.length > 0) clip = { ...clip, volume: { ...(clip.volume ?? {}), Points: points } };
      }
      const points = curvePoints(clip);
      if (!sameCurve(points, curvePoints(bed.clip))) plans.push({ entry: bed, points });
    }
    if (plans.length === 0) return unchanged(tool, "The beds do not overlap what they would duck under: nothing written.", { data: { windows: report } });
    const what = heroes ? "hero hits" : args.under === "voice" ? "the voice" : `${triggers.length} clip(s)`;
    const summary =
      `${args.dry_run ? "Would duck" : "Ducked"} ${names(plans.map((p) => p.entry))} under ${what} in ${active.length} window(s)` +
      (wantVbr !== undefined ? ` to ${wantVbr} dB voice over bed (${active.map((d) => `${d.window[0].toFixed(1)}-${d.window[1].toFixed(1)} s ${d.db.toFixed(1)} dB`).slice(0, 4).join(", ")})` : ` by ${active[0]!.db.toFixed(1)} dB`) +
      `; attack ${Math.round(env.attack * 1000)} ms, hold ${Math.round(env.padAfter * 1000)} ms, release ${Math.round(env.release * 1000)} ms.`;
    const data = { under: heroes ? "heroes" : args.under, target_vbr_db: wantVbr, windows: report, clips: plans.map((p) => ({ id: p.entry.id, role: p.entry.mixRole, points: p.points.length })) };
    if (args.dry_run) return unchanged(tool, `${summary} dry_run: nothing written.`, { data });
    call.commit((tx) => {
      for (const p of plans) writeVolume(tx, p.entry.id, p.points);
    }, "Duck");
    return applied(tool, summary, { data });
  },
});

// ---------------------------------------------------------------------------
// Effects written by these tools (eq_tool, compress_tool, space_tool)
// ---------------------------------------------------------------------------

type MixEffectKind = "eq" | "compressor" | "space";
/** The mark on an effect these tools wrote, so a new call replaces it instead of stacking. */
const MIX_MARK = "zenvi_mix";
const KIND_ORDER: MixEffectKind[] = ["eq", "compressor", "space"];

function markOf(effect: Effect): MixEffectKind | undefined {
  const mark = (effect as { [MIX_MARK]?: unknown })[MIX_MARK];
  return mark === "eq" || mark === "compressor" || mark === "space" ? mark : undefined;
}

/**
 * The clip's effect list with this tool's earlier effects of `kind` replaced
 * by `fresh`, in signal order: the clip's other effects, then EQ, dynamics,
 * space (libopenshot runs a clip's effects in list order).
 */
function withMixEffects(effects: readonly Effect[], kind: MixEffectKind, fresh: readonly Effect[]): Effect[] {
  const others = effects.filter((e) => markOf(e) === undefined);
  const ours = KIND_ORDER.flatMap((k) => (k === kind ? [...fresh] : effects.filter((e) => markOf(e) === k)));
  return [...others, ...ours];
}

function mixEffect(nextId: () => string, className: string, kind: MixEffectKind, params: Record<string, unknown>): Effect {
  const effect = createEffect(className, params, { id: nextId() }) as Effect & Record<string, unknown>;
  effect[MIX_MARK] = kind;
  return effect;
}

/** Write each clip's new effect list in one transaction; unchanged when no list changes. */
function commitEffects(call: ToolCall, tool: string, label: string, plans: { entry: MixEntry; effects: Effect[] }[], summary: string, data: unknown): ToolReceipt {
  const changed = plans.filter((p) => JSON.stringify(stripIds(p.effects)) !== JSON.stringify(stripIds(p.entry.clip.effects ?? [])));
  if (changed.length === 0) return unchanged(tool, `Already so on ${names(plans.map((p) => p.entry))}: nothing written.`, { data });
  call.commit((tx) => {
    for (const p of changed) setClipEffects(tx, p.entry.id, p.effects);
  }, label);
  return applied(tool, summary, { data });
}

function stripIds(effects: readonly Effect[]): unknown[] {
  return effects.map(({ id: _id, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// eq_tool
// ---------------------------------------------------------------------------

/** libopenshot ParametricEQ `filter_type` (ParametricEQ.h FilterType). */
const FILTER_TYPE = { low_pass: 0, high_pass: 1, low_shelf: 2, high_shelf: 3, band_pass: 4, notch: 5, peak: 6 } as const;
type BandType = keyof typeof FILTER_TYPE;

interface Band {
  type: BandType;
  freq: number;
  gain_db?: number;
  q?: number;
}

/** High-pass per stem (CRAFT.md section 5: voice 90, ambience 150, micro sounds 300, everything else 40 Hz). */
const ROLE_HIGH_PASS: Record<MixRole, number> = { voice: 90, music: 40, sfx: 40, ambience: 150 };

const EQ_PRESETS = ["clean_low", "voice_clarity", "voice_pocket", "presence", "air", "muffle", "phone", "none"] as const;
type EqPreset = (typeof EQ_PRESETS)[number];

function presetBands(preset: EqPreset, entry: MixEntry, project: Project): Band[] {
  switch (preset) {
    case "clean_low": {
      const micro = entry.mixRole === "sfx" && cuesOf(project).find((c) => c.id === entry.id)?.role === "micro";
      return [{ type: "high_pass", freq: micro ? 300 : ROLE_HIGH_PASS[entry.mixRole] }];
    }
    case "voice_clarity":
      return [{ type: "high_pass", freq: 90 }, { type: "peak", freq: 3500, gain_db: 2, q: 1 }];
    case "voice_pocket":
      return [{ type: "peak", freq: 3000, gain_db: -3, q: 1 }];
    case "presence":
      return [{ type: "peak", freq: 4000, gain_db: 3, q: 1 }];
    case "air":
      return [{ type: "high_shelf", freq: 8000, gain_db: 2.5 }];
    case "muffle":
      return [{ type: "low_pass", freq: 800 }];
    case "phone":
      return [{ type: "high_pass", freq: 300 }, { type: "low_pass", freq: 3400 }];
    case "none":
      return [];
  }
}

const bandArg = z.strictObject({
  type: z.enum(Object.keys(FILTER_TYPE) as [BandType, ...BandType[]]).describe("high_pass / low_pass (first order, 6 dB/oct), low_shelf / high_shelf, peak, band_pass, notch."),
  freq: z.number().min(20).max(20000).describe("Hz: the corner, shelf or centre frequency."),
  gain_db: z.number().min(-24).max(24).optional().describe("Shelves and peak: dB (default 0)."),
  q: z.number().min(0.1).max(20).optional().describe("peak / band_pass / notch: Q (default 1; higher = narrower)."),
});

const eqInput = z.strictObject({
  ...targetShape,
  bands: z.array(bandArg).min(1).max(4).optional().describe("Up to 4 bands."),
  preset: z
    .enum(EQ_PRESETS)
    .optional()
    .describe(
      "clean_low: high-pass by stem (voice 90, ambience 150, micro SFX 300, music / other SFX 40 Hz). voice_clarity: HPF 90 + 3.5 kHz +2 dB. voice_pocket: 3 kHz -3 dB, Q 1 (music under VO). " +
        "presence: 4 kHz +3 dB. air: high shelf +2.5 dB at 8 kHz. muffle: low-pass 800 Hz (through-the-wall). phone: 300 Hz-3.4 kHz. none: remove this tool's EQ.",
    ),
});

const eq = directTool({
  name: "eq_tool",
  title: "EQ",
  description:
    "Equalise clips, a track or a stem by number with libopenshot's Parametric EQ (one effect per band): high-pass rumble off, carve a 3 kHz pocket in the music for the voice, add air to the SFX, muffle a bed. " +
    "Up to 4 bands, or a preset (clean_low, voice_clarity, voice_pocket, presence, air, muffle, phone; none removes). A new call replaces this tool's earlier EQ on those clips instead of stacking. One undo step.",
  input: eqInput,
  annotations: ADJUST,
  run: (call, args: z.output<typeof eqInput>): ToolReceipt | string => {
    const tool = "eq_tool";
    if (!args.bands === !args.preset) return "Error: pass bands or a preset (one of them).";
    const project = call.doc.project;
    const targets = resolveTargets(project, args);
    if (typeof targets === "string") return targets;
    const nextId = idFactory(project);
    const plans = targets.map((entry) => {
      const bands: Band[] = args.bands ?? presetBands(args.preset!, entry, project);
      const fresh = bands.map((b) =>
        mixEffect(nextId, "ParametricEQ", "eq", { filter_type: FILTER_TYPE[b.type], frequency: b.freq, gain: b.gain_db ?? 0, q_factor: b.q ?? 1 }),
      );
      return { entry, bands, effects: withMixEffects(entry.clip.effects ?? [], "eq", fresh) };
    });
    const what = args.preset ? `preset ${args.preset}` : plans[0]!.bands.map((b) => `${b.type} ${b.freq} Hz${b.gain_db ? ` ${signed(b.gain_db)} dB` : ""}`).join(", ");
    return commitEffects(call, tool, "EQ", plans, `EQ (${what}) on ${targets.length} clip(s): ${names(targets)}.`, {
      clips: plans.map((p) => ({ id: p.entry.id, role: p.entry.mixRole, bands: p.bands })),
    });
  },
});

// ---------------------------------------------------------------------------
// compress_tool
// ---------------------------------------------------------------------------

interface Dynamics {
  threshold_db: number;
  ratio: number;
  attack_ms: number;
  release_ms: number;
  makeup_db: number;
}

/**
 * CRAFT.md section 4 starting points. limit is DEPLOY.md S3.6's timeline
 * limiter with a 0 ms attack instead of 0.1 ms: libopenshot's Compressor
 * has no look-ahead and reads the instantaneous sample level, so a 0.1 ms
 * attack lets a click's first cycles through 2-3 dB over the threshold.
 */
const COMPRESS_PRESETS: Record<"voice" | "glue" | "punch" | "limit", Dynamics> = {
  voice: { threshold_db: -20, ratio: 3, attack_ms: 5, release_ms: 120, makeup_db: 3 },
  glue: { threshold_db: -24, ratio: 2, attack_ms: 30, release_ms: 250, makeup_db: 2 },
  punch: { threshold_db: -18, ratio: 4, attack_ms: 15, release_ms: 120, makeup_db: 3 },
  limit: { threshold_db: -1.5, ratio: 100, attack_ms: 0, release_ms: 50, makeup_db: 0 },
};

const compressInput = z.strictObject({
  ...targetShape,
  preset: z.enum(["voice", "glue", "punch", "limit", "none"]).optional().describe("voice: -20 dB, 3:1, 5/120 ms, +3 dB. glue (beds): -24 dB, 2:1, 30/250 ms, +2. punch (SFX): -18 dB, 4:1, 15/120 ms, +3. limit: -1.5 dB, 100:1, 0/50 ms (sample-peak safety). none: remove."),
  threshold_db: z.number().min(-60).max(0).optional(),
  ratio: z.number().min(1).max(100).optional(),
  attack_ms: z.number().min(0).max(1000).optional(),
  release_ms: z.number().min(0).max(5000).optional(),
  makeup_db: z.number().min(-12).max(24).optional(),
});

const compress = directTool({
  name: "compress_tool",
  title: "Compress",
  description:
    "Compress or limit clips, a track or a stem with libopenshot's Compressor: even out a voice, glue a bed, punch up SFX, or catch peaks (limit). " +
    "A preset or your numbers (threshold_db, ratio, attack_ms, release_ms, makeup_db; numbers override the preset's). A new call replaces this tool's earlier compressor on those clips; preset none removes it. One undo step.",
  input: compressInput,
  annotations: ADJUST,
  run: (call, args: z.output<typeof compressInput>): ToolReceipt | string => {
    const tool = "compress_tool";
    const project = call.doc.project;
    const targets = resolveTargets(project, args);
    if (typeof targets === "string") return targets;
    const remove = args.preset === "none";
    const base = COMPRESS_PRESETS[args.preset && args.preset !== "none" ? args.preset : "voice"];
    if (!args.preset && args.threshold_db === undefined && args.ratio === undefined) return "Error: pass a preset or at least threshold_db and ratio.";
    const d: Dynamics = {
      threshold_db: args.threshold_db ?? base.threshold_db,
      ratio: args.ratio ?? base.ratio,
      attack_ms: args.attack_ms ?? base.attack_ms,
      release_ms: args.release_ms ?? base.release_ms,
      makeup_db: args.makeup_db ?? base.makeup_db,
    };
    const nextId = idFactory(project);
    const plans = targets.map((entry) => {
      // libopenshot Compressor's attack / release are seconds (render/audio/dynamics.ts).
      const fresh = remove ? [] : [mixEffect(nextId, "Compressor", "compressor", { threshold: d.threshold_db, ratio: d.ratio, attack: d.attack_ms / 1000, release: d.release_ms / 1000, makeup_gain: d.makeup_db })];
      return { entry, effects: withMixEffects(entry.clip.effects ?? [], "compressor", fresh) };
    });
    const what = remove ? "removed the compressor from" : `${args.preset && args.preset !== "none" ? `${args.preset}: ` : ""}${d.threshold_db} dB, ${d.ratio}:1, ${d.attack_ms}/${d.release_ms} ms, makeup ${signed(d.makeup_db)} dB on`;
    return commitEffects(call, tool, "Compress", plans, `Compressor ${what} ${targets.length} clip(s): ${names(targets)}.`, { dynamics: remove ? null : d, clips: targets.map((t) => t.id) });
  },
});

// ---------------------------------------------------------------------------
// space_tool
// ---------------------------------------------------------------------------

/**
 * libopenshot has no reverb, so a space is Echo effects in series with
 * mutually prime short delays (Echo.cpp: a feedback comb, `mix` wet): a
 * crude early-reflection cloud. Wet levels stay low; a long tail is not
 * possible past the clip's end (a clip's effects stop with it).
 */
const SPACES: Record<"room" | "slap" | "hall", { time: number; feedback: number }[]> = {
  room: [{ time: 0.011, feedback: 0.3 }, { time: 0.017, feedback: 0.3 }, { time: 0.023, feedback: 0.25 }],
  slap: [{ time: 0.09, feedback: 0.1 }],
  hall: [{ time: 0.029, feedback: 0.5 }, { time: 0.041, feedback: 0.45 }, { time: 0.053, feedback: 0.4 }],
};

const spaceInput = z.strictObject({
  ...targetShape,
  space: z.enum(["room", "slap", "hall", "none"]).describe("room: a small dry room (UI, micro sounds), slap: one 90 ms slapback, hall: a longer, denser cloud (heroes, tails). none removes."),
  mix: z.number().min(0.02).max(0.5).default(0.15).describe("Wet share per stage (default 0.15; above 0.3 sounds metallic)."),
});

const space = directTool({
  name: "space_tool",
  title: "Space",
  description:
    "Put clips, a track or a stem in a shared space so the sounds sound like one world: room, slap or hall, built from libopenshot Echo effects (no reverb in libopenshot: this is a short comb cloud, best on SFX at a low mix; keep the voice dry). " +
    "Use one or two spaces per project. A new call replaces this tool's earlier space; none removes it. One undo step.",
  input: spaceInput,
  annotations: ADJUST,
  run: (call, args: z.output<typeof spaceInput>): ToolReceipt | string => {
    const tool = "space_tool";
    const project = call.doc.project;
    const targets = resolveTargets(project, args);
    if (typeof targets === "string") return targets;
    const nextId = idFactory(project);
    const stages = args.space === "none" ? [] : SPACES[args.space];
    const plans = targets.map((entry) => ({
      entry,
      effects: withMixEffects(entry.clip.effects ?? [], "space", stages.map((s) => mixEffect(nextId, "Echo", "space", { echo_time: s.time, feedback: s.feedback, mix: args.mix }))),
    }));
    const voice = targets.filter((t) => t.mixRole === "voice");
    const receipt = commitEffects(call, tool, "Space", plans, args.space === "none" ? `Removed the space from ${targets.length} clip(s).` : `${args.space} (${stages.length} Echo stage(s), mix ${args.mix}) on ${targets.length} clip(s): ${names(targets)}.`, {
      space: args.space,
      clips: targets.map((t) => t.id),
    });
    if (voice.length && args.space !== "none") receipt.warnings.push(`${voice.length} voice clip(s) got the space too: a dry voice reads clearer on phones.`);
    return receipt;
  },
});

export const mixTools: CatalogTool[] = [setTrackRole, setAudioGain, automateVolume, duck, eq, compress, space];
