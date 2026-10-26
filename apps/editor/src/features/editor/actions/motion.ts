/**
 * Gestures for the motion capabilities (clip menu, command palette, panels),
 * each the tool call an agent would make. What a gesture adds is choosing
 * the target from the selection; the edit itself is the tool's.
 */
import { findClip, type Clip, type MotionDirection, type MotionPresetInfo, type MotionTransitionStyle } from "@zenvi/engine";
import { toast } from "@/ui/Toast";
import { targetCut, tinyGapTrack } from "../cuts";
import { runEditorTool, runToolWithToast } from "../editorTools";
import type { EditorSession } from "../session/EditorSession";
import { snappyTrack } from "../snappy";

export type DirectionChoice = "auto" | Extract<MotionDirection, "left" | "right" | "up" | "down">;

export type SpeedRampPreset = "ramp_in" | "ramp_out" | "hero" | "velocity";

export const SPEED_RAMPS: readonly { preset: SpeedRampPreset; label: string }[] = [
  { preset: "ramp_in", label: "Ramp in (slow → normal)" },
  { preset: "ramp_out", label: "Ramp out (normal → slow)" },
  { preset: "hero", label: "Hero slow-mo" },
  { preset: "velocity", label: "Velocity (rush, freeze, rush)" },
];

function selected(session: EditorSession): string[] {
  return session.ui.getState().selection.clips;
}

/** A preset's direction from the panel's choice: the choice when the preset moves that way, else the track's current. */
function directionFor(info: MotionPresetInfo, choice: DirectionChoice): MotionDirection | "auto" {
  return choice !== "auto" && info.directions.includes(choice) ? choice : "auto";
}

/** No cut to work on: say why, and offer to close one-frame gaps when those are what is in the way. */
function noCut(session: EditorSession): void {
  const gaps = tinyGapTrack(session.project);
  if (!gaps) {
    toast.info("No cut to put it on", { description: "Put two clips back to back on a track first." });
    return;
  }
  toast.info("The clips do not touch", {
    description: `${gaps.gaps} gap${gaps.gaps === 1 ? "" : "s"} of a frame between clips. Close them, then add the transition.`,
    action: {
      label: "Close gaps",
      onClick: () => void runToolWithToast(session, "remove_gaps_tool", { track: String(gaps.layer), from_seconds: gaps.from }, { done: "Gaps closed", failed: "Could not close the gaps" }),
    },
  });
}

/** One motion transition on the cut the person points at (the selected clip's, else the one nearest the playhead). */
export async function applyMotionTransition(session: EditorSession, info: MotionPresetInfo, choice: DirectionChoice, clipIds: readonly string[] = selected(session)): Promise<void> {
  const cut = targetCut(session.project, clipIds, session.playback.getState().time);
  if (!cut) return noCut(session);
  await runToolWithToast(
    session,
    "apply_motion_transition_tool",
    { preset: info.id, clip1_id: cut.outClip.id, clip2_id: cut.inClip.id, direction: directionFor(info, choice) },
    { done: info.title, failed: `Could not add ${info.title}` },
  );
}

/** A style mix on every cut of the pointed-at track (else the main sequence). */
export async function applyMotionStyle(session: EditorSession, style: MotionTransitionStyle, choice: DirectionChoice = "auto"): Promise<void> {
  const cut = targetCut(session.project, selected(session), session.playback.getState().time);
  const layer = cut?.layer ?? snappyTrack(session.project)?.layer;
  if (layer === undefined) return noCut(session);
  await runToolWithToast(
    session,
    "apply_motion_transitions_tool",
    { track: String(layer), style, direction: choice },
    { done: `${style === "hype" ? "Hype" : "Cinematic"} transitions on every cut`, failed: "Could not add the transitions", unchanged: "No cuts on that track" },
  );
}

export async function removeMotionTransitions(session: EditorSession, clipId: string): Promise<void> {
  await runToolWithToast(session, "remove_motion_transition_tool", { clip_id: clipId }, { done: "Motion transitions removed", failed: "Could not remove the motion transitions" });
}

export async function speedRamp(session: EditorSession, clipId: string, preset: SpeedRampPreset): Promise<void> {
  const label = SPEED_RAMPS.find((r) => r.preset === preset)?.label ?? preset;
  // A ramp changes the clip's length: later clips on its track move with it, as a ripple trim would.
  await runToolWithToast(session, "speed_ramp_tool", { clip_id: clipId, preset, ripple: true }, { done: `Speed ramp: ${label}`, failed: "Could not ramp the speed" });
}

function inCutOrder(session: EditorSession, clipIds: readonly string[]): Clip[] {
  return clipIds
    .map((id) => findClip(session.project, id))
    .filter((c): c is Clip => c !== undefined && c.reader?.has_video !== false)
    .sort((a, b) => a.position - b.position || a.layer - b.layer);
}

/** Match cut: find the round subject in each clip's first frame, then line them up (two tools; only the align edits). */
export async function matchCut(session: EditorSession, clipIds: readonly string[]): Promise<void> {
  const clips = inCutOrder(session, clipIds);
  if (clips.length < 2) {
    toast.info("Select two or more clips", { description: "Shots that share a round subject: an eye, the moon, a cup rim." });
    return;
  }
  const subjects: { clip_id: string; box: unknown }[] = [];
  for (const clip of clips) {
    const found = await runEditorTool(session, "detect_subject_tool", { clip_id: clip.id });
    const best = (found.data.subjects as { box?: unknown }[] | undefined)?.[0]?.box;
    if (!found.ok || !best) {
      toast.info("No round subject found", { description: found.ok ? `Nothing round in the first frame of ${clip.title || clip.id}.` : found.summary });
      return;
    }
    subjects.push({ clip_id: clip.id, box: best });
  }
  await runToolWithToast(session, "align_match_cut_tool", { clips: subjects }, { done: "Match cut aligned", failed: "Could not align the match cut" });
}

/** A beat-filled grid montage of the selected clips' media, starting where the first one starts. */
export async function gridMontage(session: EditorSession, clipIds: readonly string[]): Promise<void> {
  const clips = inCutOrder(session, clipIds);
  const fileIds = [...new Set(clips.map((c) => c.file_id).filter((id): id is string => typeof id === "string" && id !== ""))];
  if (fileIds.length < 2) {
    toast.info("Select two or more clips", { description: "Each tile shows one of their files." });
    return;
  }
  await runToolWithToast(session, "add_motion_template_tool", { template: "grid", file_ids: fileIds, position_seconds: clips[0]!.position }, { done: "Grid montage added", failed: "Could not build the grid" });
}
