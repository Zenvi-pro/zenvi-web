/**
 * Mix stems for the mixing tools and analyze_mix_tool: which stem (voice,
 * music, sfx, ambience) each clip with sound plays in, how a call names the
 * clips it changes (ids, a track, a role), the placed sound-effect cues and
 * the hit points of the edit, and the stem renders the Sound Score reads.
 *
 * A clip's stem is, in order: its own `zenvi_audio_role`, its track's
 * (set_track_role_tool), a sound-design clip's "sfx", the indexer's role,
 * a text-to-speech file's "voice", what its track's name says, then its shape (master_audio_tool's rule: sound without picture is music
 * from MUSIC_MIN_DURATION seconds, an effect below; footage is the bed).
 */

import { z } from "zod";
import type { StemRole } from "../mastering/gain-stage.js";
import type { HitPoint, MixCue, CueRole, StemName } from "../mastering/score.js";
import type { Clip, Project } from "../model/types.js";
import { TRACK_AUDIO_ROLES, type TrackAudioRole } from "../ops/tracks.js";
import { isAutoSfxClip, isSfxClip } from "../sfx/moments.js";
import { sfxRecipe } from "../sfx/recipes.js";
import { MUSIC_MIN_DURATION, hasVideoStream, type AudioRole } from "./audio-mix.js";
import { collectTimelineAudio, type AudioEntry } from "./catalog/audio.js";
import { fileById, idList } from "./catalog/common.js";
import type { ToolCall } from "./define.js";
import { markOf } from "./sfx-media.js";
import { lockedTrackError, normalizeTrackOrLayerArg } from "./tracks.js";
import type { MixPcm } from "./types.js";

export type MixRole = TrackAudioRole;
export const MIX_ROLES = TRACK_AUDIO_ROLES;

/** The master_audio_tool / gain-stage name of each stem. */
export const STEM_ROLE_OF: Record<MixRole, StemRole> = { voice: "speech", music: "music", sfx: "sfx", ambience: "ambient" };

const ROLE_OF_ANALYSIS: Partial<Record<AudioRole, MixRole>> = { speech: "voice", music: "music", sfx: "sfx", ambient: "ambience" };

/** Files the text-to-speech tool writes (generation.ts). */
const TTS_FILE = /(^|[\\/])zenvi_tts_[^\\/]*$/;
/** Track names that say what a track carries ("Voice", "VO 2", "Music", "SFX", "Room tone"). */
const TRACK_LABELS: readonly [RegExp, MixRole][] = [
  [/^(voice|vo|narration|narrator|dialog(ue)?|speech)\b/i, "voice"],
  [/^(music|score|song|bed)\b/i, "music"],
  [/^(sfx|sound ?fx|sound effects?|foley|fx audio)\b/i, "sfx"],
  [/^(ambien(ce|t)|room ?tone|atmos|amb)\b/i, "ambience"],
];

export interface MixEntry extends AudioEntry {
  mixRole: MixRole;
  locked: boolean;
}

function isMixRole(value: unknown): value is MixRole {
  return typeof value === "string" && (MIX_ROLES as readonly string[]).includes(value);
}

/** The stem a timeline clip with sound plays in (module comment). */
export function mixRoleOf(project: Project, entry: AudioEntry): MixRole {
  const own = (entry.clip as { zenvi_audio_role?: unknown }).zenvi_audio_role;
  if (isMixRole(own)) return own;
  const track = project.layers.find((l) => Number(l.number) === entry.layer)?.zenvi_audio_role;
  if (isMixRole(track)) return track;
  if (isSfxClip(entry.clip)) return "sfx";
  const analysed = ROLE_OF_ANALYSIS[entry.role];
  if (analysed) return analysed;
  if (TTS_FILE.test(String(entry.file?.path ?? ""))) return "voice";
  const label = String(project.layers.find((l) => Number(l.number) === entry.layer)?.label ?? "");
  const named = TRACK_LABELS.find(([re]) => re.test(label));
  if (named) return named[1];
  if (hasVideoStream(entry.clip, entry.file)) return "music";
  return entry.end - entry.start >= MUSIC_MIN_DURATION ? "music" : "sfx";
}

/** Every timeline clip with sound, with its stem and whether its track is locked. */
export function mixEntries(project: Project): MixEntry[] {
  return collectTimelineAudio(project).map((entry) => ({
    ...entry,
    mixRole: mixRoleOf(project, entry),
    locked: Boolean(lockedTrackError(entry.layer, project.layers)),
  }));
}

/** A clip at volume 0 the whole way (muted footage): a role names the clips you hear, so it is in none. */
export function isMuted(entry: MixEntry): boolean {
  return entry.level === 0;
}

const roleArg = z.enum(MIX_ROLES);

/** How a mixing tool names the clips it changes; any mix of the three, at least one. */
export const targetShape = {
  clip_ids: z.union([z.string(), z.array(z.string())]).optional().describe("Timeline clip ids (from analyze_mix_tool, list_clips_tool or a receipt)."),
  track: z.union([z.string(), z.number()]).optional().describe("Every clip with sound on this track: layer_number, track id, exact label (e.g. 'SFX'), or ui_track."),
  role: roleArg.optional().describe("Every clip of this stem: voice, music, sfx, ambience (analyze_mix_tool lists each clip's; set_track_role_tool sets a track's)."),
};

/** targetShape's values; `role` may be several when a tool resolves for itself. */
export interface TargetArgs {
  clip_ids?: string | string[];
  track?: string | number;
  role?: MixRole | MixRole[];
}

/** The clips a call names, in timeline order, or an "Error: ..." string. Locked tracks are an error: nothing is changed. */
export function resolveTargets(project: Project, args: TargetArgs): MixEntry[] | string {
  const ids = idList(args.clip_ids ?? []);
  const roles = args.role === undefined ? [] : Array.isArray(args.role) ? args.role : [args.role];
  if (ids.length === 0 && roles.length === 0 && (args.track === undefined || args.track === "")) {
    return "Error: name the clips to change: clip_ids, track or role.";
  }
  const entries = mixEntries(project);
  const picked = new Set<string>();
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of ids) {
    if (!byId.has(id)) {
      const clip = project.clips.find((c) => String(c.id) === id);
      return clip ? `Error: timeline clip ${id} has no audio.` : `Error: no timeline clip with id ${id}.`;
    }
    picked.add(id);
  }
  if (args.track !== undefined && args.track !== "") {
    const r = normalizeTrackOrLayerArg(args.track, project.layers);
    if (r.error) return r.error;
    const onTrack = entries.filter((e) => e.layer === r.layer);
    if (onTrack.length === 0) return `Error: track ${String(args.track)} has no clips with sound.`;
    for (const e of onTrack) picked.add(e.id);
  }
  for (const role of roles) {
    const ofRole = entries.filter((e) => e.mixRole === role && !isMuted(e));
    if (ofRole.length === 0) return `Error: no clips play in the ${role} stem (analyze_mix_tool lists each clip's stem; set_track_role_tool files a track under one).`;
    for (const e of ofRole) picked.add(e.id);
  }
  const out = entries.filter((e) => picked.has(e.id));
  const locked = out.find((e) => e.locked);
  if (locked) return lockedTrackError(locked.layer, project.layers);
  return out;
}

const CUE_ROLE_OF_FAMILY: Record<string, CueRole> = { impact: "hero", riser: "hero", transition: "hero", whoosh: "sweetener", texture: "sweetener", click: "micro", ui: "micro" };

/** The sound-design cues on the timeline: each SFX clip's hit point, kind and mix role (hero / sweetener / micro). */
export function cuesOf(project: Project): MixCue[] {
  const cues: MixCue[] = [];
  for (const clip of project.clips) {
    if (!isSfxClip(clip)) continue;
    const file = clip.file_id ? fileById(project, String(clip.file_id)) : undefined;
    const fileMark = file ? markOf(file) : undefined;
    const clipMark = (clip.zenvi_sfx ?? {}) as { recipe?: string; role?: unknown; library?: string; cue?: unknown };
    const recipe = clipMark.recipe ?? fileMark?.recipe ?? "";
    const family = sfxRecipe(recipe)?.family ?? "impact";
    const role = clipMark.role === "hero" || clipMark.role === "sweetener" || clipMark.role === "micro" ? clipMark.role : (CUE_ROLE_OF_FAMILY[family] ?? "hero");
    const hit = typeof fileMark?.hit === "number" ? fileMark.hit : 0;
    const position = Number(clip.position) || 0;
    cues.push({
      id: String(clip.id),
      t: position + hit - (Number(clip.start) || 0),
      kind: family,
      role,
      sample: clipMark.library ?? (fileMark?.library ? `${fileMark.library.provider}:${fileMark.library.id}` : fileMark?.key ?? String(clip.file_id ?? "")),
      position,
      auto: isAutoSfxClip(clip),
      ...(typeof clipMark.cue === "string" ? { group: clipMark.cue } : {}),
    });
  }
  return cues.sort((a, b) => a.t - b.t);
}

/** The caller's hit times (analyze_mix_tool hit_times), each wanting a sound. */
export function hitPointsAt(times: readonly number[]): HitPoint[] {
  return [...times].sort((a, b) => a - b).map((t) => ({ t, kind: "hit", needsCue: true }));
}

export interface StemRenders {
  sampleRate: number;
  mix: Float32Array[];
  stems: Partial<Record<StemName, Float32Array[]>>;
}

/** Render the whole mix and each stem that has clips, the way an export mixes them. */
export async function renderStems(call: ToolCall, project: Project, entries: readonly MixEntry[]): Promise<StemRenders> {
  const render = (clipIds?: readonly string[]): Promise<MixPcm> => call.host.audio!.mixPcm!(project, { clipIds, signal: call.signal });
  const mix = await render();
  const stems: StemRenders["stems"] = {};
  for (const role of MIX_ROLES) {
    const ids = entries.filter((e) => e.mixRole === role).map((e) => e.id);
    if (ids.length > 0) stems[role] = (await render(ids)).channels;
  }
  return { sampleRate: mix.sampleRate, mix: mix.channels, stems };
}

/** A clip by id (the caller resolved it). */
export function clipOf(project: Project, id: string): Clip {
  return project.clips.find((c) => String(c.id) === id)!;
}
