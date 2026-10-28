/**
 * The finish of an edit, read from the project alone: grade continuity,
 * transitions, sound design and mastering. Every recipe of the director
 * (plugins/zenvi/skills/zenvi-motion-director) ends with them, but in bench
 * round 5 a third of the agents never opened the recipe and shipped without
 * them; render receipts and review_render_tool list what is missing, with the
 * calls that finish it, so an agent that acts on receipts finishes the edit
 * whether or not it read the skill.
 *
 * Mastering leaves a marker (`settings.zenvi_master`) holding a fingerprint
 * of what the mix is made of; an audio edit after it changes the fingerprint,
 * so a stale master reads as unmastered.
 */

import type { ProjectDocument } from "../history/document.js";
import { isAudioOnlyMedia } from "../model/media.js";
import type { Clip, Project } from "../model/types.js";
import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import { supportedAudioEffects } from "../render/audio/registry.js";
import { isSfxClip } from "../sfx/moments.js";
import { isColorGradeEffect } from "../tools/color-agent.js";
import { reviewTimeline } from "./timeline.js";

/** The `settings` key master_audio_tool writes. */
export const MASTER_KEY = "zenvi_master";

export interface MasterMark {
  preset: string;
  /** Integrated loudness the master measured, LUFS (null: silent). */
  lufs: number | null;
  /** `audioFingerprint` of the project the master left. */
  fingerprint: string;
}

export type FinishGapKind = "grade" | "transitions" | "sound" | "master";

export interface FinishCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface FinishGap {
  kind: FinishGapKind;
  message: string;
  /** The calls that close it, in order. */
  next: FinishCall[];
}

/** Below this many cuts an edit is one or two shots: no transition is owed. */
const MIN_CUTS = 2;

const AUDIO_EFFECTS = new Set(supportedAudioEffects());

function fileOf(project: Project, clip: Clip): Record<string, unknown> | undefined {
  return project.files.find((f) => String(f.id) === String(clip.file_id)) as Record<string, unknown> | undefined;
}

/**
 * Camera footage and photos, the clips a grade must match: picture, not a
 * generated card (SVG/HTML titles, flashes) and not a rendered layer (motion
 * blocks and 3D scenes are linked clips with their own colours).
 */
function isGradedFootage(project: Project, clip: Clip): boolean {
  const file = fileOf(project, clip);
  if (!file || isAudioOnlyMedia(file as never) || file.zenvi_link) return false;
  if (clip.reader?.has_video === false) return false;
  return !/\.(svg|html?)$/i.test(String(clip.reader?.path ?? file.path ?? ""));
}

/** FNV-1a, 32 bits, hex: enough to tell one mix from the next. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * What the mix is made of: every clip that can sound, where it plays, its
 * gain curves and audio effects, and the tracks' mutes. Picture edits
 * (grades, transforms, titles) leave it alone.
 */
export function audioFingerprint(project: Project): string {
  const clips = project.clips
    .filter((c) => c.reader?.has_audio !== false)
    .map((c) => [
      c.id,
      c.file_id,
      c.layer,
      c.position,
      c.start,
      c.end,
      c.volume,
      c.has_audio,
      c.time,
      (c.effects ?? []).filter((e) => AUDIO_EFFECTS.has(String(e.class_name))).map(({ id: _id, ...rest }) => rest),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const muted = project.layers.filter((l) => (l as { mute?: unknown }).mute).map((l) => l.number);
  return fnv(JSON.stringify({ clips, muted }));
}

export function masterMark(project: Project): MasterMark | null {
  const raw = (project.settings as Record<string, unknown> | undefined)?.[MASTER_KEY];
  if (!raw || typeof raw !== "object" || typeof (raw as MasterMark).fingerprint !== "string") return null;
  return raw as MasterMark;
}

/**
 * Record that the mix as it is now is mastered. Outside the undo history,
 * like a kept transcript: undoing the master changes the fingerprint back, so
 * the mark goes stale by itself.
 */
export function markMastered(doc: ProjectDocument, preset: string, lufs: number | null | undefined): void {
  const settings = (doc.project.settings ?? {}) as Record<string, unknown>;
  const mark: MasterMark = { preset, lufs: typeof lufs === "number" && Number.isFinite(lufs) ? Math.round(lufs * 10) / 10 : null, fingerprint: audioFingerprint(doc.project) };
  doc.setUntracked(["settings"], { ...settings, [MASTER_KEY]: mark });
}

/** What is missing from the finish, in the order the director runs it; empty when the edit is finished. */
export function finishGaps(project: Project): FinishGap[] {
  const gaps: FinishGap[] = [];
  const review = reviewTimeline(project);

  const footage = project.clips.filter((c) => isGradedFootage(project, c));
  const sources = new Set(footage.map((c) => String(c.file_id)));
  if (sources.size >= 2 && !footage.some((c) => (c.effects ?? []).some(isColorGradeEffect))) {
    gaps.push({
      kind: "grade",
      message: `No grade continuity: ${sources.size} footage sources and none carries a grade, so the look jumps on the cut (unify_grade_tool saying every clip is already in band is fine).`,
      next: [{ tool: "unify_grade_tool", args: {} }],
    });
  }

  const cuts = review.cuts.length;
  if (cuts >= MIN_CUTS && listProjectMotionTransitions(project).length === 0 && review.colorFlashes.length === 0 && (project.effects ?? []).length === 0) {
    gaps.push({
      kind: "transitions",
      message: `Hard cuts only: ${cuts} cuts and no transition (fine for a match cut or editorial type; every other genre moves between shots).`,
      next: [{ tool: "apply_motion_transitions_tool", args: { style: "hype", direction: "left" } }],
    });
  }

  if (!project.clips.some(isSfxClip)) {
    gaps.push({
      kind: "sound",
      message: "No sound design: no effect on any cut, so the cuts do not land (the references put a whoosh, hit or click on nearly every one).",
      next: [
        { tool: "spot_sound_tool", args: {} },
        { tool: "auto_sound_design_tool", args: {} },
      ],
    });
  }

  if (project.clips.length > 0) {
    const mark = masterMark(project);
    const fresh = mark !== null && mark.fingerprint === audioFingerprint(project);
    if (!fresh) {
      gaps.push({
        kind: "master",
        message: mark ? "Unmastered: the audio changed after master_audio_tool, so the delivered loudness is off again." : "Unmastered: master_audio_tool has not run, so the mix arrives too quiet or clipping on the platforms.",
        next: [{ tool: "master_audio_tool", args: { preset: "social", iterate: true } }],
      });
    }
  }
  return gaps;
}

/** The gaps as receipt lines: what is missing and the exact next calls. */
export function finishLines(gaps: readonly FinishGap[]): string[] {
  return gaps.map((g) => `${g.message} Next: ${g.next.map((c) => `${c.tool} ${JSON.stringify(c.args)}`).join(", then ")}.`);
}
