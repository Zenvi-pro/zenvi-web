/**
 * "Make it snappy": the finishing pass editors do on a cut, as a chain of
 * the agents' own tools, each its own undo step: motion transitions on the
 * main sequence's cuts (in the direction it already moves), sound design
 * that lands on them, then the mix mastered for social. A step that cannot
 * run is reported and the rest still run.
 */
import { trackCuts, type Clip, type MotionTransitionStyle, type Project, type SfxIntensity } from "@zenvi/engine";
import { toast } from "@/ui/Toast";
import { editorToolRunner, editorToolState, type ToolRunner } from "./editorTools";
import type { EditorSession } from "./session/EditorSession";

export type SnappyStepId = "transitions" | "sound" | "master";

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

function hasPicture(clip: Clip): boolean {
  return clip.reader?.has_video !== false;
}

/** The main sequence: the picture track with the most back-to-back cuts (the lower one on a tie, like the desktop's V1). */
export function snappyTrack(project: Project): { layer: number; cuts: number } | null {
  let best: { layer: number; cuts: number } | null = null;
  for (const layer of [...project.layers].sort((a, b) => a.number - b.number)) {
    const cuts = trackCuts(project, layer.number).filter((c) => hasPicture(c.outClip) && hasPicture(c.inClip)).length;
    if (cuts > 0 && (!best || cuts > best.cuts)) best = { layer: layer.number, cuts };
  }
  return best;
}

export async function makeItSnappy(project: () => Project, run: ToolRunner, options: SnappyOptions = {}): Promise<SnappyOutcome[]> {
  const outcomes: SnappyOutcome[] = [];
  const step = async (id: SnappyStepId, label: string, tool: string, args: Record<string, unknown>) => {
    const r = await run(tool, args);
    outcomes.push({ step: id, label, status: !r.ok ? "failed" : r.status === "unchanged" ? "unchanged" : "done", detail: r.summary, undoSteps: r.undoSteps });
  };

  const track = snappyTrack(project());
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
  const depth = session.doc.undoLabels.length;
  const title = `Made it snappy: ${steps} undo step${steps === 1 ? "" : "s"}`;
  const undoAll = {
    label: "Undo all",
    onClick: () => {
      // Only while nothing else was edited after the chain: never undo the person's own edits.
      if (session.doc.undoLabels.length !== depth) return void toast.info("Edited since: undo step by step (Ctrl+Z)");
      for (let i = 0; i < steps; i += 1) session.undo();
    },
  };
  const failed = outcomes.some((o) => o.status === "failed");
  (failed ? toast.warning : toast.success)(title, { description, action: undoAll, duration: 10_000 });
  return outcomes;
}
