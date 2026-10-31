/**
 * Captions: add_captions_tool, list_captions_tool, edit_captions_tool,
 * remove_captions_tool.
 *
 * Ports of zenvi-core develop src/classes/editor_tools/titles_text_captions.py.
 * A caption track is a libopenshot Caption effect on the clip it captions;
 * its cues are in that clip's source time (tools/caption-cues.ts), so they
 * stay on the words when the clip moves or is trimmed. Captions not tied to
 * one clip sit on a transparent "Captions" overlay clip (`zenvi_role`
 * "captions"). Every renderer draws the Caption effect (render/kernels/caption.ts).
 *
 * Transcript captions: the desktop captions from the media index's transcript
 * cues. The web surfaces read a clip's words where the speech tools do
 * (../transcripts.ts): a speech recognition result kept on the file, the
 * index cues, or a new transcription through the Zenvi backend. Index cues are
 * phrased like the desktop's (`splitCue`); recognized words keep their own
 * timings (`phraseTimedWords`). Without a target, clips with a picture and
 * sound are transcribed (audio-only beds only when the timeline has no such
 * footage), the way the other speech tools choose.
 *
 * The desktop also picks the Caption effect selected in its Properties panel
 * when no target is given; the web editor has no effect selection, so the
 * project's only caption track is used, else the call asks which one.
 * Subtitle files are read through the host (`StorageHost.readText`): a path
 * on disk for the CLI, a file in the project for Zenvi Cloud and the editor.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { idFactory } from "../../model/ids.js";
import type { Clip, Effect, Project } from "../../model/types.js";
import { placeOverlayClip, replaceClipEffects } from "../../ops/overlays.js";
import { contractTool, unavailable, type ToolCall } from "../define.js";
import { pyFixed, pyFloat, pyReprString } from "../pyfmt.js";
import { applied, failed } from "../receipt.js";
import {
  buildCaptionText,
  displayText,
  parseCaptionText,
  parseSubtitles,
  phraseTimedWords,
  safeText,
  splitCue,
  type Cue,
} from "../caption-cues.js";
import { CaptionStyle, restyleRequested, styleFromEffect, type CaptionStyleArgs } from "../caption-style.js";
import {
  carrierFile,
  clipExtent,
  guarded,
  isLocked,
  planOverlayTrack,
  prepareOverlayCarrier,
  pyRoundTo,
  summaryLine,
  toolError,
  trackInfo,
  uiTrackNumber,
  type OverlayCarrier,
} from "../titles-text.js";
import { buildTrackStack } from "../tracks.js";
import { TTS_SCRIPT_SOURCE } from "../tts-words.js";
import { clipTarget, isWordSource, mediaPathOf, untargetedTranscription, wordsFor, type WordSourceFailure } from "../transcripts.js";
import { resolveClip } from "./common.js";

/** `zenvi_role` of the transparent clip that carries captions not tied to one clip. */
export const CAPTION_ROLE = "captions";

/** `caption_effects`: the Caption effects of a clip, in stack order. */
export function captionEffects(clip: Pick<Clip, "effects">): Effect[] {
  return (clip.effects ?? []).filter((e) => typeof e === "object" && e !== null && (e.class_name === "Caption" || e.type === "Caption"));
}

/** (position, source start, source end) of a clip. */
function clipWindow(clip: Clip): [number, number, number] {
  return [Number(clip.position) || 0, Number(clip.start) || 0, Number(clip.end) || 0];
}

function timelineToCaption(clip: Clip, t: number): number {
  const [position, start] = clipWindow(clip);
  return t - position + start;
}

function captionToTimeline(clip: Clip, t: number): number {
  const [position, start] = clipWindow(clip);
  return position + t - start;
}

function clipLabel(clip: Clip): string {
  return String(clip.title || clip.id);
}

export interface CueRow {
  index: number;
  start: number;
  end: number;
  source_start: number;
  source_end: number;
  text: string;
  visible: boolean;
}

/** `_cue_rows`: numbered cues in timeline and source seconds, and whether the trimmed clip shows them. */
function cueRows(clip: Clip, cues: readonly Cue[]): CueRow[] {
  const [, start, end] = clipWindow(clip);
  return [...cues]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((cue, i) => ({
      index: i + 1,
      start: pyRoundTo(captionToTimeline(clip, cue.start), 3),
      end: pyRoundTo(captionToTimeline(clip, cue.end), 3),
      source_start: pyRoundTo(cue.start, 3),
      source_end: pyRoundTo(cue.end, 3),
      text: displayText(cue.text),
      visible: cue.end > start && cue.start < end,
    }));
}

/** `_given_cues`: {start, end, text} objects, validated. */
function givenCues(cues: readonly unknown[] | undefined, what = "cues"): Cue[] {
  const out: Cue[] = [];
  (cues ?? []).forEach((c, i) => {
    const n = i + 1;
    if (typeof c !== "object" || c === null || Array.isArray(c)) toolError(`${what}[${n}] must be an object with start, end and text`);
    const item = c as Record<string, unknown>;
    const text = String(item.text ?? "").trim();
    const start = Number(item.start);
    const end = Number(item.end);
    if (item.start === null || item.end === null || !Number.isFinite(start) || !Number.isFinite(end)) {
      toolError(`${what}[${n}] needs numeric start and end seconds`);
    }
    if (!text) toolError(`${what}[${n}] has no text`);
    if (start < 0 || end <= start) toolError(`${what}[${n}] must have 0 <= start < end (got ${pyFloat(start)}-${pyFloat(end)})`);
    out.push({ start, end, text });
  });
  return out;
}

/** `_prepare`: cue text made drawable (blank cues dropped). */
function prepareCues(cues: readonly Cue[], uppercase: boolean): [Cue[], number] {
  const out: Cue[] = [];
  let changed = 0;
  for (const cue of cues) {
    const [safe, wasChanged] = safeText(uppercase ? cue.text.toUpperCase() : cue.text);
    if (!safe) continue;
    if (wasChanged) changed += 1;
    out.push({ start: cue.start, end: cue.end, text: safe });
  }
  return [out, changed];
}

async function clipByQuery(call: ToolCall, clipQuery: string): Promise<Clip> {
  const res = await resolveClip(call, { clip_query: clipQuery });
  if (!res.ok) return toolError(res.error || "could not resolve the timeline clip");
  return res.clip;
}

function clipById(project: Project, id: string): Clip | undefined {
  return project.clips.find((c) => c.id === id);
}

/** `_find_effect`: the clip and Caption effect to change. */
async function findCaptionEffect(call: ToolCall, effectId: string, clipId: string, clipQuery: string): Promise<[Clip, Effect]> {
  const project = call.doc.project;
  const candidates: [Clip, Effect][] = [];
  for (const clip of project.clips) for (const effect of captionEffects(clip)) candidates.push([clip, effect]);
  if (effectId) {
    const hit = candidates.find(([, e]) => e.id === effectId);
    if (hit) return hit;
    return toolError(`no Caption effect with id=${pyReprString(effectId)}`);
  }
  if (clipId || clipQuery) {
    const clip = clipId ? clipById(project, clipId) : await clipByQuery(call, clipQuery);
    if (!clip) return toolError(`no timeline clip with id=${pyReprString(clipId)}`);
    const effects = captionEffects(clip);
    if (effects.length === 0) toolError(`clip ${clip.id} (${clipLabel(clip)}) has no captions; add them with add_captions_tool`);
    if (effects.length > 1) toolError(`clip ${clip.id} has ${effects.length} Caption effects; pass effect_id (${effects.map((e) => e.id).join(", ")})`);
    return [clip, effects[0]!];
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) return toolError("there are no captions in the project; add them with add_captions_tool");
  return toolError(
    "which captions? pass effect_id or timeline_clip_id: " +
      candidates
        .slice(0, 6)
        .map(([c, e]) => `${e.id} on ${c.id} (${clipLabel(c)})`)
        .join(", "),
  );
}

const LOOK_KEYS = ["text_size", "font", "text_color", "stroke_color", "stroke_width", "background_color", "background_opacity", "position", "fade"] as const;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Python `str.count` / `str.replace` for a non-empty literal. */
function countOf(text: string, find: string): number {
  return text.split(find).length - 1;
}

// ---------------------------------------------------------------------------
// add_captions_tool
// ---------------------------------------------------------------------------

/** Subtitle files above this are refused (`MAX_SUBTITLE_BYTES`). */
const MAX_SUBTITLE_CHARS = 5 * 1024 * 1024;

/** `_has_time_curve`: the clip plays through a time curve (more than one point). */
function hasTimeCurve(clip: Clip): boolean {
  const time = (clip as { time?: unknown }).time;
  const points = typeof time === "object" && time !== null ? (time as { Points?: unknown }).Points : undefined;
  return Array.isArray(points) && points.length > 1;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** `_read_subtitle_file`, through the host. */
async function readSubtitleFile(call: ToolCall, path: string): Promise<Cue[]> {
  let raw: string;
  try {
    raw = await call.host.storage!.readText!(path);
  } catch {
    return toolError(`subtitle file not found: ${path}`);
  }
  if (raw.length > MAX_SUBTITLE_CHARS) toolError("subtitle file is larger than 5 MB");
  const cues = parseSubtitles(raw);
  if (cues.length === 0) {
    toolError(`no cues found in ${basename(path)} (expected SRT or WebVTT timings like 00:00:01,000 --> 00:00:03,000)`);
  }
  return cues;
}

/** `_resolve_targets`: the clips to caption, in timeline order. */
async function resolveTargets(call: ToolCall, clipId: string, query: string, trackIndex: number, needClip: boolean): Promise<Clip[]> {
  const project = call.doc.project;
  if (clipId) {
    const clip = clipById(project, clipId);
    if (!clip) return toolError(`no timeline clip with id=${pyReprString(clipId)}`);
    return [clip];
  }
  if (query) return [await clipByQuery(call, query)];
  if (trackIndex) {
    const layer = buildTrackStack(project.layers)[trackIndex - 1]?.layer_number;
    if (!layer) return toolError(`there is no track ${trackIndex} (UI track 1 = bottom)`);
    const clips = project.clips.filter((c) => Math.trunc(Number(c.layer) || 0) === layer);
    if (clips.length === 0) toolError(`track ${trackIndex} has no clips`);
    return clips.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  }
  if (needClip) {
    return [...project.clips].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || (Number(a.layer) || 0) - (Number(b.layer) || 0));
  }
  return [];
}

/** A clip's index transcript cues in its source seconds (`_transcript_cues`). */
function indexCues(clip: Clip, cues: readonly unknown[]): Cue[] {
  const start = Number(clip.start) || 0;
  const out: Cue[] = [];
  for (const raw of cues) {
    if (typeof raw !== "object" || raw === null) continue;
    const c = raw as Record<string, unknown>;
    const text = String(c.text ?? "").trim();
    if (!text) continue;
    let s: number;
    let e: number;
    if (c.source_start !== undefined && c.source_start !== null) {
      s = Number(c.source_start);
      e = c.source_end !== undefined && c.source_end !== null ? Number(c.source_end) : s;
    } else {
      s = (Number(c.start) || 0) + start;
      e = (Number(c.end) || 0) + start;
    }
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ start: s, end: e, text });
  }
  return out;
}

interface Plan {
  clip: Clip | null;
  cues: Cue[];
}

export const captionTools = [
  contractTool("add_captions_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      guarded("add_captions_tool", async () => {
        const tool = "add_captions_tool";
        const clipIdArg = String(input.clipId ?? "").trim();
        const timelineArg = String(input.timeline_clip_id ?? "").trim();
        if (clipIdArg && timelineArg && clipIdArg !== timelineArg) toolError("clipId and timeline_clip_id name different clips; pass one");
        const clipId = clipIdArg || timelineArg;
        const given = givenCues(input.cues, "cues");
        const srtPath = String(input.srtPath ?? "").trim();
        if (given.length > 0 && srtPath) toolError("pass either cues or srtPath, not both");
        const source = given.length > 0 ? "cues" : srtPath ? "file" : "transcript";
        const trackIndex = Math.trunc(Number(input.trackIndex ?? 0)) || 0;
        if (source !== "transcript" && trackIndex) {
          toolError("trackIndex picks clips to caption from their transcript; with cues or srtPath pass timeline_clip_id (or nothing, for an overlay over the timeline)");
        }
        if (source === "file" && !call.host.storage?.readText) return unavailable(tool, "it cannot read subtitle files on this host.");
        const fileCues = source === "file" ? await readSubtitleFile(call, srtPath) : [];
        const styleName = input.style ?? "classic";
        const style = new CaptionStyle({
          style: styleName,
          font: input.font ?? "",
          text_size: input.text_size ?? 0,
          text_color: input.text_color ?? "",
          stroke_color: input.stroke_color ?? "",
          stroke_width: input.stroke_width ?? -1,
          background_color: input.background_color ?? "",
          background_opacity: input.background_opacity ?? -1,
          position: input.position ?? "",
          fade_seconds: input.fade_seconds ?? -1,
        });
        const query = String(input.clip_query ?? "").trim();
        const timeBase = input.time_base ?? "auto";
        const overlayMode = !(clipId || query || trackIndex) && source !== "transcript";
        if (overlayMode && timeBase === "source") toolError("time_base='source' needs the clip whose media the times refer to");
        const overlayTrack = String(input.overlay_track ?? "");
        const targets = await resolveTargets(call, clipId, query, trackIndex, source === "transcript");
        const raw = source === "file" ? fileCues : given;
        if (overlayMode) {
          planOverlayTrack(call.doc.project, Math.min(...raw.map((q) => q.start)), Math.max(...raw.map((q) => q.end)), overlayTrack);
        }
        style.resolveFont();
        const warnings: string[] = [];
        const plans: Plan[] = [];
        const sources = new Set<string>();

        if (source === "transcript") {
          if (timeBase === "timeline") toolError("transcript captions are always in the clip's media time; drop time_base");
          const project = call.doc.project;
          // Locked tracks refuse before anything is paid for.
          for (const c of targets) {
            if (isLocked(project, c.layer)) toolError(`clip ${c.id} is on locked track ${uiTrackNumber(project, c.layer)}; unlock it first`);
          }
          const pays = clipId || query || trackIndex ? () => true : untargetedTranscription(project, targets);
          const failures: WordSourceFailure[] = [];
          let silent = 0;
          for (const c of targets) {
            const target = clipTarget(call.doc.project, c);
            if (!target || !mediaPathOf(target.file, c)) continue;
            const paid = pays(c);
            const got = await wordsFor(call, target, { language: input.language, estimatesOk: true, transcribe: paid });
            if (!isWordSource(got)) {
              if (got.kind === "unavailable" && !paid) {
                warnings.push(`clip ${c.id} (${clipLabel(c)}) is audio only and was not transcribed; pass timeline_clip_id=${c.id} to caption it`);
              } else if (got.kind !== "no_audio") failures.push(got);
              continue;
            }
            warnings.push(...got.warnings);
            if (got.source === TTS_SCRIPT_SOURCE) warnings.push(`clip ${c.id}: word times are the TTS script laid over the voice's pauses`);
            const live = clipById(call.doc.project, c.id) ?? c;
            let cues: Cue[];
            // The index's phrases are cues already; a word list is phrased here, heard or not (a TTS script laid over its voice).
            if (got.cues === undefined) {
              const [, start, end] = clipWindow(live);
              cues = phraseTimedWords(got.words.filter((w) => w.endSec > start && w.startSec < end), input.maxWords ?? 8, input.maxChars ?? 42);
            } else {
              cues = indexCues(live, got.cues ?? []).flatMap((cue) => splitCue(cue, input.maxWords ?? 8, input.maxChars ?? 42));
            }
            if (cues.length === 0) {
              silent += 1;
              continue;
            }
            sources.add(got.source);
            plans.push({ clip: live, cues });
          }
          if (plans.length === 0) {
            const names = targets.slice(0, 5).map((c) => `${c.id} (${clipLabel(c)})`).join(", ") || "the timeline has no clips";
            const blocked = failures.find((f) => f.kind === "failed");
            if (blocked) return failed(tool, `Error: ${blocked.message[0]!.toUpperCase()}${blocked.message.slice(1).replace(/\.$/, "")}.`);
            const off = failures.find((f) => f.kind === "unavailable");
            if (off) return unavailable(tool, `${off.message}; ${names} have no indexed transcript either. Pass cues or srtPath to caption from text you have.`);
            if (silent > 0) toolError(`no speech was found to caption in ${names}; pass cues or srtPath instead`);
            toolError(
              "no transcript is available to caption from (" +
                names +
                "). Zenvi fills it when it indexes a file or transcribes the clip; check with get_transcript_tool, or pass cues / srtPath instead",
            );
          }
        } else if (targets.length > 0) {
          const c = targets[0]!;
          const base = timeBase !== "auto" ? timeBase : source === "file" ? "source" : "timeline";
          plans.push({
            clip: c,
            cues: raw.map((q) => (base === "timeline" ? { start: timelineToCaption(c, q.start), end: timelineToCaption(c, q.end), text: q.text } : { ...q })),
          });
        } else {
          plans.push({ clip: null, cues: raw });
        }

        // Keep what a clip can show; refuse locked clips before touching anything.
        const project = call.doc.project;
        const kept: Plan[] = [];
        for (const plan of plans) {
          const c = plan.clip;
          if (c === null) {
            kept.push(plan);
            continue;
          }
          if (isLocked(project, c.layer)) toolError(`clip ${c.id} is on locked track ${uiTrackNumber(project, c.layer)}; unlock it first`);
          const [, start, end] = clipWindow(c);
          const inside = plan.cues.filter((q) => q.end > start && q.start < end);
          const dropped = plan.cues.length - inside.length;
          if (dropped) warnings.push(`${dropped} cue(s) fall outside the visible part of clip ${c.id} and were skipped`);
          if (inside.length === 0) {
            toolError(
              `none of the ${plan.cues.length} cue(s) fall inside clip ${c.id}'s visible range ` +
                `(${pyFixed(captionToTimeline(c, start), 2)}-${pyFixed(captionToTimeline(c, end), 2)}s on the timeline); check time_base`,
            );
          }
          if (hasTimeCurve(c)) warnings.push(`clip ${c.id} is retimed; caption times assume normal speed`);
          kept.push({ clip: c, cues: inside });
        }

        const prepared: Plan[] = [];
        let adjusted = 0;
        for (const plan of kept) {
          const [ready, changed] = prepareCues([...plan.cues].sort((a, b) => a.start - b.start || a.end - b.end), input.uppercase ?? false);
          adjusted += changed;
          if (ready.length === 0) toolError("the captions have no text left to show");
          prepared.push({ clip: plan.clip, cues: ready });
        }
        if (adjusted) warnings.push(`${adjusted} caption(s) were adjusted so libopenshot draws them fully (':' between digits and one-letter lines)`);

        let carrier: OverlayCarrier | undefined;
        let span: [number, number] = [0, 0];
        if (prepared[0]!.clip === null) {
          const ready = prepared[0]!.cues;
          span = [Math.min(...ready.map((q) => q.start)), Math.max(...ready.map((q) => q.end))];
          carrier = await prepareOverlayCarrier(call);
        }
        const props = style.properties(call.doc.project, 2);
        const replaceExisting = input.replace_existing ?? true;

        const captioned = call.commit((tx) => {
          const newId = idFactory(tx.project);
          const results: Record<string, unknown>[] = [];
          for (const plan of prepared) {
            let targetId: string;
            let cues: Cue[];
            let entry: Record<string, unknown>;
            if (plan.clip === null) {
              const [spanStart, spanEnd] = span;
              const { layer, created, moved } = planOverlayTrack(tx.project, spanStart, spanEnd, overlayTrack);
              if (moved) warnings.push(moved);
              const file = carrierFile(tx, carrier!);
              const overlay = placeOverlayClip(tx, {
                fileId: file.id,
                position: spanStart,
                duration: spanEnd - spanStart,
                layer,
                newTrackLabel: "Captions",
                title: "Captions",
                props: { zenvi_role: CAPTION_ROLE },
              });
              targetId = overlay.id;
              cues = plan.cues.map((q) => ({ start: q.start - spanStart, end: q.end - spanStart, text: q.text }));
              entry = { timeline_clip_id: targetId, overlay: true, new_track: created, ...trackInfo(tx.project, layer) };
            } else {
              targetId = plan.clip.id;
              cues = plan.cues;
              entry = { timeline_clip_id: targetId, overlay: false, track: uiTrackNumber(tx.project, plan.clip.layer) };
            }
            const current = clipById(tx.project, targetId)!;
            const effects: Effect[] = structuredClone(current.effects ?? []);
            const existing = captionEffects({ effects });
            let effect: Effect;
            if (existing.length > 0 && replaceExisting) {
              effect = existing[0]!;
              Object.assign(effect, structuredClone(props), { caption_text: buildCaptionText(cues) });
              entry.replaced = true;
            } else {
              effect = { ...defaultEffectJson("Caption", newId()), ...structuredClone(props), caption_text: buildCaptionText(cues) };
              effects.push(effect);
              entry.replaced = false;
            }
            const after = replaceClipEffects(tx, targetId, effects);
            Object.assign(entry, {
              effect_id: effect.id,
              cues: cues.length,
              first: pyRoundTo(captionToTimeline(after, cues[0]!.start), 3),
              last: pyRoundTo(captionToTimeline(after, cues[cues.length - 1]!.end), 3),
            });
            results.push(entry);
          }
          return results;
        });

        const total = captioned.reduce((n, r) => n + Number(r.cues), 0);
        const first = captioned[0]!;
        const where = first.overlay ? `a Captions overlay on track ${String(first.track)}` : captioned.map((r) => String(r.timeline_clip_id)).join(", ");
        const from = source === "transcript" ? "the transcript" : source;
        const data: Record<string, unknown> = { source, captioned, style: styleName, look: style.summary() };
        if (sources.size > 0) data.transcriptionSource = [...sources].join(", ");
        if (warnings.length > 0) data.warnings = warnings;
        return applied(tool, summaryLine(`Added ${total} caption(s) from ${from} on ${where}.`), {
          data,
          warnings,
          watchSuggested: { clipId: String(first.timeline_clip_id), start: Number(first.first), end: Math.min(Number(first.last), Number(first.first) + 3) },
        });
      }),
  }),

  contractTool("list_captions_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      guarded("list_captions_tool", () => {
        const project = call.doc.project;
        const wanted = String(input.timeline_clip_id ?? "").trim();
        const tracks: Record<string, unknown>[] = [];
        for (const clip of project.clips) {
          if (wanted && clip.id !== wanted) continue;
          for (const effect of captionEffects(clip)) {
            const look = styleFromEffect(effect, project) as unknown as Record<string, unknown>;
            const [start, end] = clipExtent(clip);
            tracks.push({
              timeline_clip_id: clip.id,
              clip_title: clipLabel(clip),
              effect_id: effect.id,
              overlay: clip.zenvi_role === CAPTION_ROLE,
              track: uiTrackNumber(project, clip.layer),
              clip_start: pyRoundTo(start, 3),
              clip_end: pyRoundTo(end, 3),
              cues: cueRows(clip, parseCaptionText(String(effect.caption_text ?? ""))),
              look: Object.fromEntries(LOOK_KEYS.map((k) => [k, look[k]])),
            });
          }
        }
        if (wanted && tracks.length === 0 && !clipById(project, wanted)) toolError(`no timeline clip with id=${pyReprString(wanted)}`);
        const total = tracks.reduce((n, t) => n + (t.cues as unknown[]).length, 0);
        return applied("list_captions_tool", `${tracks.length} caption track(s), ${total} cue(s).`, { data: { caption_tracks: tracks } }, 0);
      }),
  }),

  contractTool("edit_captions_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      guarded("edit_captions_tool", async () => {
        const tool = "edit_captions_tool";
        const edits = input.cue_edits ?? [];
        const extra = givenCues(input.add_cues, "cues");
        const find = input.find ?? "";
        const replace = input.replace ?? "";
        const shift = input.shift_seconds ?? 0;
        const uppercase = input.uppercase ?? false;
        const styleArgs: CaptionStyleArgs = {
          style: input.style ?? "",
          font: input.font ?? "",
          text_size: input.text_size ?? 0,
          text_color: input.text_color ?? "",
          stroke_color: input.stroke_color ?? "",
          stroke_width: input.stroke_width ?? -1,
          background_color: input.background_color ?? "",
          background_opacity: input.background_opacity ?? -1,
          position: input.position ?? "",
          fade_seconds: input.fade_seconds ?? -1,
        };
        const restyle = restyleRequested(styleArgs);
        if (replace && !find) toolError("replace needs find (the text to replace)");
        if (!(edits.length > 0 || extra.length > 0 || find || shift || restyle || uppercase)) {
          toolError("nothing to change: pass cue_edits, add_cues, find/replace, shift_seconds, uppercase or style fields");
        }
        const [clip, effect] = await findCaptionEffect(call, String(input.effect_id ?? "").trim(), String(input.timeline_clip_id ?? "").trim(), String(input.clip_query ?? "").trim());
        if (isLocked(call.doc.project, clip.layer)) toolError(`clip ${clip.id} is on a locked track; unlock it first`);
        let cues = parseCaptionText(String(effect.caption_text ?? "")).sort((a, b) => a.start - b.start || a.end - b.end);
        const count = cues.length;
        const changes: string[] = [];

        const deleted = new Set<number>();
        edits.forEach((ed, i) => {
          const n = i + 1;
          const idx = Math.trunc(Number(ed.index) || 0);
          if (idx < 1 || idx > count) toolError(`cue_edits[${n}]: there is no cue ${idx} (the captions have ${count})`);
          const cue = cues[idx - 1]!;
          if (ed.delete) {
            deleted.add(idx - 1);
            changes.push(`deleted cue ${idx}`);
            return;
          }
          if (ed.text !== undefined) {
            const newText = String(ed.text ?? "").trim();
            if (!newText) toolError(`cue_edits[${n}]: empty text (use delete=true to remove the cue)`);
            cue.text = newText;
            changes.push(`cue ${idx} text`);
          }
          const start = ed.start !== undefined && ed.start !== null ? timelineToCaption(clip, Number(ed.start)) : cue.start;
          const end = ed.end !== undefined && ed.end !== null ? timelineToCaption(clip, Number(ed.end)) : cue.end;
          if (end <= start) toolError(`cue_edits[${n}]: end must be after start`);
          if (start !== cue.start || end !== cue.end) {
            cue.start = start;
            cue.end = end;
            changes.push(`cue ${idx} timing`);
          }
        });
        cues = cues.filter((_, i) => !deleted.has(i));

        const [, srcStart, srcEnd] = clipWindow(clip);
        for (const q of extra) {
          const s = timelineToCaption(clip, q.start);
          const e = timelineToCaption(clip, q.end);
          if (e <= srcStart || s >= srcEnd) {
            toolError(
              `the new cue at ${pyFixed(q.start, 2)}-${pyFixed(q.end, 2)}s is outside clip ${clip.id} ` +
                `(${pyFixed(captionToTimeline(clip, srcStart), 2)}-${pyFixed(captionToTimeline(clip, srcEnd), 2)}s)`,
            );
          }
          cues.push({ start: Math.max(s, srcStart), end: Math.min(e, srcEnd), text: q.text });
          changes.push("added a cue");
        }

        if (find) {
          let hits = 0;
          for (const q of cues) {
            const shown = displayText(q.text);
            if (shown.includes(find)) {
              hits += countOf(shown, find);
              q.text = shown.split(find).join(replace);
            }
          }
          if (!hits) toolError(`no caption contains ${pyReprString(find)}`);
          changes.push(`replaced ${hits} x ${pyReprString(find)}`);
        }
        if (shift) {
          for (const q of cues) {
            q.start += shift;
            q.end += shift;
          }
          cues = cues.filter((q) => q.end > 0);
          for (const q of cues) q.start = Math.max(0, q.start);
          changes.push(`shifted ${shift >= 0 ? "+" : ""}${pyFixed(shift, 2)}s`);
        }
        if (uppercase) {
          for (const q of cues) q.text = displayText(q.text).toUpperCase();
          changes.push("uppercase");
        }

        const [ready] = prepareCues(
          cues.map((q) => ({ start: q.start, end: q.end, text: displayText(q.text) })),
          false,
        );
        if (ready.length === 0) toolError("that would leave no captions; use remove_captions_tool to remove them");

        const newEffect: Effect = { ...structuredClone(effect), caption_text: buildCaptionText(ready) };
        let look: Record<string, unknown> | undefined;
        if (restyle) {
          const style = new CaptionStyle(styleArgs, styleFromEffect(effect, call.doc.project));
          style.resolveFont();
          Object.assign(newEffect, structuredClone(style.properties(call.doc.project, 2)));
          look = style.summary();
          changes.push("restyled");
        }
        if (sameJson(newEffect, effect)) toolError("the captions already look like that; nothing changed");

        const effects = (clip.effects ?? []).map((e) => (e.id === effect.id ? newEffect : e));
        const after = call.commit((tx) => replaceClipEffects(tx, clip.id, effects));
        const rows = cueRows(after, parseCaptionText(String(newEffect.caption_text)));
        const data: Record<string, unknown> = { timeline_clip_id: clip.id, effect_id: effect.id, changes, cues: rows };
        if (look) data.look = look;
        return applied(tool, summaryLine(`Updated captions on ${clip.id}: ${changes.join(", ")} (${rows.length} cue(s)).`), { data });
      }),
  }),

  contractTool("remove_captions_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, input) =>
      guarded("remove_captions_tool", async () => {
        const project = call.doc.project;
        const targets = new Map<string, [Clip, Set<string>]>();
        const effectId = String(input.effect_id ?? "").trim();
        const clipId = String(input.timeline_clip_id ?? "").trim();
        const clipQuery = String(input.clip_query ?? "").trim();
        if (input.all_captions) {
          for (const clip of project.clips) {
            const effects = captionEffects(clip);
            if (effects.length > 0) targets.set(clip.id, [clip, new Set(effects.map((e) => e.id))]);
          }
          if (targets.size === 0) toolError("there are no captions in the project");
        } else if (effectId) {
          const [clip, effect] = await findCaptionEffect(call, effectId, "", "");
          targets.set(clip.id, [clip, new Set([effect.id])]);
        } else if (clipId || clipQuery) {
          const clip = clipId ? clipById(project, clipId) : await clipByQuery(call, clipQuery);
          if (!clip) return toolError(`no timeline clip with id=${pyReprString(clipId)}`);
          const effects = captionEffects(clip);
          if (effects.length === 0) toolError(`clip ${clip.id} has no captions`);
          targets.set(clip.id, [clip, new Set(effects.map((e) => e.id))]);
        } else {
          const [clip, effect] = await findCaptionEffect(call, "", "", "");
          targets.set(clip.id, [clip, new Set([effect.id])]);
        }
        const locked = [...targets.values()].filter(([c]) => isLocked(project, c.layer)).map(([c]) => c.id);
        if (locked.length > 0) toolError(`clip(s) on locked tracks: ${locked.join(", ")}; unlock first`);

        const removed: string[] = [];
        const overlays: string[] = [];
        call.commit((tx) => {
          for (const [id, [clip, ids]] of targets) {
            replaceClipEffects(
              tx,
              id,
              (clip.effects ?? []).filter((e) => !ids.has(e.id)),
            );
            removed.push(...ids);
            if (clip.zenvi_role === CAPTION_ROLE) overlays.push(id);
          }
        });
        const data: Record<string, unknown> = { removed_effect_ids: [...removed].sort(), timeline_clip_ids: [...targets.keys()].sort() };
        let summary = `Removed ${removed.length} caption track(s) from ${targets.size} clip(s).`;
        if (overlays.length > 0) {
          data.empty_overlay_clip_ids = overlays;
          summary += " The transparent Captions overlay clip(s) remain; delete them with delete_from_timeline_tool.";
        }
        return applied("remove_captions_tool", summary, { data });
      }),
  }),
];
