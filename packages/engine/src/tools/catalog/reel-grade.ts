/**
 * build_reel_tool's grade-continuity pass: every clip measured as the reel
 * will show it (the style's looks on, cropped to the frame), one look chosen
 * (reels/grade.ts), each clip corrected toward the look's target the way
 * unify_grade_tool does it (catalog/color-unify.ts unifyClip), and the
 * corrections handed back as ColorGrade patches the reel's own transaction
 * writes on every shot, with the look's LUT. Nothing here touches the
 * project: the clips are measured in a scratch document.
 */

import { ProjectDocument } from "../../history/document.js";
import type { Clip, Project } from "../../model/types.js";
import { ScaleMode } from "../../model/types.js";
import { addClip, setClipProperty } from "../../ops/clips.js";
import { applyLookPreset } from "../../ops/look.js";
import { addTrack } from "../../ops/tracks.js";
import { chooseReelLook, lookTarget, REEL_LOOKS, type LookChoice, type ReelLook } from "../../reels/grade.js";
import type { ReelMedia } from "../../reels/plan.js";
import type { ReelStyle } from "../../reels/styles.js";
import { ColorValueError, resolveLookId } from "../color-agent.js";
import { gradeSpread, unifyStats } from "../color-unify.js";
import type { ToolCall } from "../define.js";
import { FrameRenderError } from "../color-frames.js";
import { effectFactory, profileClipDense, resolveLutFile, type ProfilePack } from "./color-agent.js";
import { knobsOf, unifyClip, type ClipOutcome } from "./color-unify.js";

type Json = Record<string, unknown>;

/** Frames per clip and passes per clip: a 20-clip bin grades in a few hundred small renders. */
const SAMPLES = 3;
const MAX_PASSES = 3;
/** An image shot measured over this long (its motion preset moves; the picture does not change). */
const IMAGE_SECONDS = 1;

export interface FootageMeasure {
  /** Per file: the clip as the reel shows it, and its measured LookProfile. */
  clips: Map<string, { clip: Clip; pack: ProfilePack }>;
  profiles: Map<string, Json>;
  doc: ProjectDocument;
}

/** Measure every media item as the style will show it. Null when this host renders no frames. */
export async function measureFootage(call: ToolCall, project: Project, media: readonly ReelMedia[], style: ReelStyle): Promise<FootageMeasure | null> {
  if (!call.host.frames) return null;
  const doc = new ProjectDocument({ ...structuredClone(project), clips: [], effects: [] }, { historyLimit: 0 });
  const ids = new Map<string, string>();
  doc.transaction("measure", (tx) => {
    if (tx.project.layers.length === 0) addTrack(tx, {});
    const layer = Number(tx.project.layers[0]!.number);
    let at = 0;
    for (const m of media) {
      const length = m.kind === "video" ? m.end - m.start : IMAGE_SECONDS;
      if (!(length > 0)) continue;
      const clip = addClip(tx, { fileId: m.fileId, position: at, layer, start: m.kind === "video" ? m.start : 0, end: m.kind === "video" ? m.end : length });
      setClipProperty(tx, clip.id, "scale", ScaleMode.CROP);
      for (const look of style.looks) applyLookPreset(tx, clip.id, look);
      ids.set(m.fileId, clip.id);
      at += length;
    }
  });
  const clips = new Map<string, { clip: Clip; pack: ProfilePack }>();
  const profiles = new Map<string, Json>();
  for (const [fileId, clipId] of ids) {
    if (call.signal?.aborted) break;
    const clip = doc.project.clips.find((c) => c.id === clipId)!;
    const pack = await profileClipDense({ ...call, doc } as ToolCall, clip, SAMPLES);
    clips.set(fileId, { clip, pack });
    profiles.set(fileId, pack.profile);
  }
  return { clips, profiles, doc };
}

/** What the reel writes on a file's shots, and what the receipt says about it. */
export interface FileGrade {
  /** ColorGrade knobs (absolute values) the correction changed; empty when the clip already fit. */
  knobs: Json;
  status: ClipOutcome["status"];
  before: Json;
  after: Json;
}

export interface ReelGrade {
  choice: LookChoice;
  /** The LUT id given (a named look) or the look's own. */
  lut: string;
  lutPath: string;
  intensity: number;
  target: Json;
  files: Map<string, FileGrade>;
}

/** The look for `grade`: "auto" chooses from the titles and the footage, a LUT id names one. Throws ColorValueError for an unknown LUT. */
export async function resolveReelLook(
  call: ToolCall,
  grade: string,
  texts: readonly (string | undefined)[],
  profiles: readonly Json[],
): Promise<{ choice: LookChoice; lut: string; lutPath: string }> {
  if (grade === "auto") {
    const choice = chooseReelLook(texts, profiles);
    return { choice, lut: choice.look.lut, lutPath: await resolveLutFile(call, choice.look.lut) };
  }
  const resolved = resolveLookId(grade);
  if (resolved.kind !== "lut") throw new ColorValueError(`grade '${grade}' is a ${resolved.kind} look, not a LUT; use "auto", "none" or a LUT id from list_looks_tool`);
  // A named LUT corrects toward the neutral band: the LUT carries the look.
  const look: ReelLook = { ...REEL_LOOKS.teal_orange, lut: grade, intensity: 1 };
  return { choice: { look, why: `the ${grade} LUT was asked for`, fromWords: false }, lut: grade, lutPath: await resolveLutFile(call, grade) };
}

/** Correct each used file toward the look's target. */
export async function gradeFootage(
  call: ToolCall,
  measured: FootageMeasure,
  usedFileIds: readonly string[],
  look: { choice: LookChoice; lut: string; lutPath: string },
): Promise<ReelGrade> {
  const target = lookTarget(look.choice.look, [...measured.profiles.values()]);
  const scratch = { ...call, doc: measured.doc } as ToolCall;
  const create = effectFactory(measured.doc.project);
  const files = new Map<string, FileGrade>();
  for (const fileId of usedFileIds) {
    const entry = measured.clips.get(fileId);
    if (!entry || call.signal?.aborted) continue;
    let outcome: ClipOutcome;
    try {
      outcome = await unifyClip(scratch, entry.clip, entry.pack, target, { strength: 1, samples: SAMPLES, maxIterations: MAX_PASSES, create });
    } catch (error) {
      if (error instanceof FrameRenderError) continue;
      throw error;
    }
    const from = knobsOf(entry.clip.effects ?? []);
    const to = knobsOf(outcome.effects);
    const knobs: Json = {};
    for (const key of Object.keys(to) as (keyof typeof to)[]) if (to[key] !== from[key]) knobs[key] = to[key];
    files.set(fileId, { knobs, status: outcome.status, before: outcome.before, after: outcome.after });
  }
  return { choice: look.choice, lut: look.lut, lutPath: look.lutPath, intensity: look.choice.look.intensity, target, files };
}

/** The receipt's account of the pass. */
export function gradeReport(grade: ReelGrade, names: ReadonlyMap<string, string>): Json {
  const rows = [...grade.files];
  return {
    look: grade.choice.look.id,
    lut: grade.lut,
    lut_path: grade.lutPath,
    intensity: grade.intensity,
    why: grade.choice.why,
    target: unifyStats(grade.target),
    spread_before: gradeSpread(rows.map(([, g]) => g.before)),
    spread_after: gradeSpread(rows.map(([, g]) => g.after)),
    clips: rows.map(([fileId, g]) => ({ file_id: fileId, name: names.get(fileId) ?? fileId, status: g.status, before: unifyStats(g.before), after: unifyStats(g.after), grade: g.knobs })),
  };
}
