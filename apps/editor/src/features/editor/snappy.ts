/**
 * "Make it snappy": the finishing pass editors do on a cut, as a chain of
 * the agents' own tools, each its own undo step: (one-frame gaps closed
 * when that is all that keeps the clips from cutting,) motion transitions on the
 * main sequence's cuts (in the direction it already moves), sound design
 * that lands on them, then the mix mastered for social. A step that cannot
 * run is reported and the rest still run.
 */
import type { MotionTransitionStyle, Project, SfxIntensity } from "@zenvi/engine";
import { toast } from "@/ui/Toast";
import { mainSequence, tinyGapTrack } from "./cuts";
import { editorToolRunner, editorToolState, type ToolRunner } from "./editorTools";
import type { EditorSession } from "./session/EditorSession";

export type SnappyStepId = "gaps" | "transitions" | "sound" | "master";

export interface SnappyOutcome {
  step: SnappyStepId;
  label: string;
  status: "done" | "unchanged" | "skipped" | "failed";
  detail: string;
  undoSteps: number;
}

export interface SnappyOptions {
  style?: MotionTransitionStyle;
  intensity?: SfxIntensity;
}

const MASTER_TOOL = "master_audio_tool";

export async function makeItSnappy(project: () => Project, run: ToolRunner, options: SnappyOptions = {}): Promise<SnappyOutcome[]> {
  const outcomes: SnappyOutcome[] = [];
  const step = async (id: SnappyStepId, label: string, tool: string, args: Record<string, unknown>) => {
    const r = await run(tool, args);
    outcomes.push({ step: id, label, status: !r.ok ? "failed" : r.status === "unchanged" ? "unchanged" : "done", detail: r.summary, undoSteps: r.undoSteps });
  };

  let track = mainSequence(project());
  const gaps = track ? null : tinyGapTrack(project());
  if (gaps) {
    await step("gaps", "Close frame gaps", "remove_gaps_tool", { track: String(gaps.layer), from_seconds: gaps.from });
    track = mainSequence(project());
  }
  if (track) await step("transitions", "Motion transitions", "apply_motion_transitions_tool", { track: String(track.layer), style: options.style ?? "hype", direction: "auto" });
  else outcomes.push({ step: "transitions", label: "Motion transitions", status: "skipped", detail: "No clips play back to back, so there is no cut to move.", undoSteps: 0 });

  await step("sound", "Sound design", "auto_sound_design_tool", { intensity: options.intensity ?? "normal" });

  const master = editorToolState(MASTER_TOOL);
  if (master.kind === "ready") await step("master", "Master audio", MASTER_TOOL, { preset: "social" });
  else outcomes.push({ step: "master", label: "Master audio", status: "skipped", detail: master.kind === "missing" ? "Mastering is not in this build yet." : `Mastering ${master.note}.`, undoSteps: 0 });

  return outcomes;
}

/** Undo steps the chain added (steps that changed nothing add none). */
export function snappyUndoSteps(outcomes: readonly SnappyOutcome[]): number {
  return outcomes.reduce((n, o) => n + o.undoSteps, 0);
}

/**
 * "Undo all" for a chain that just added `steps` undo steps: undoes them only
 * while nothing else went into history since (no edit, undo or redo; untracked
 * writes such as a finished cloud upload do not count), so the person's own
 * edits are never undone. An undo-depth check alone is not enough: undo one
 * step and make a new edit, and the depth is back where it was.
 */
export function snappyUndoAll(session: Pick<EditorSession, "doc" | "undo">, steps: number): () => boolean {
  const depth = session.doc.undoLabels.length;
  let touched = false;
  const stop = session.doc.subscribe((event) => {
    if (event.source === "untracked") return;
    touched = true;
    stop();
  });
  return () => {
    if (touched || session.doc.undoLabels.length !== depth) return false;
    touched = true;
    stop();
    for (let i = 0; i < steps; i += 1) session.undo();
    return true;
  };
}

const MARK: Record<SnappyOutcome["status"], string> = { done: "✓", unchanged: "–", skipped: "–", failed: "✕" };

/** The palette / toolbar action: run the chain, then one toast with a line per step and "Undo all". */
export async function runMakeItSnappy(session: EditorSession, options: SnappyOptions = {}): Promise<SnappyOutcome[]> {
  const busy = toast.info("Making it snappy…", { duration: 60_000 });
  const outcomes = await makeItSnappy(() => session.project, editorToolRunner(session), options);
  toast.dismiss(busy);
  const steps = snappyUndoSteps(outcomes);
  const description = outcomes.map((o) => `${MARK[o.status]} ${o.label}: ${o.detail}`).join("\n");
  if (steps === 0) {
    toast.warning("Nothing to make snappy", { description });
    return outcomes;
  }
  const undoAll = snappyUndoAll(session, steps);
  const title = `Made it snappy: ${steps} undo step${steps === 1 ? "" : "s"}`;
  const undoAllAction = {
    label: "Undo all",
    onClick: () => {
      if (!undoAll()) toast.info("Edited since: undo step by step (Ctrl+Z)");
    },
  };
  const failed = outcomes.some((o) => o.status === "failed");
  (failed ? toast.warning : toast.success)(title, { description, action: undoAllAction, duration: 10_000 });
  return outcomes;
}
