/**
 * "Make it snappy": the finishing pass editors do on a cut, as a chain of
 * the agents' own tools, each its own undo step: (one-frame gaps closed
 * when that is all that keeps the clips from cutting,) motion transitions on the
 * main sequence's cuts (in the direction it already moves), sound design
 * that lands on them (as dense as the transitions are loud), then the mix
 * mastered for social. A step that cannot run is reported and the rest still run.
 */
import type { MotionTransitionStyle, Project, SfxIntensity } from "@zenvi/engine";
import { toast } from "@/ui/Toast";
import { mainSequence, tinyGapTrack } from "./cuts";
import { editorToolRunner, editorToolState, type ToolRun, type ToolRunner } from "./editorTools";
import type { EditorSession } from "./session/EditorSession";

export type SnappyStepId = "gaps" | "transitions" | "sound" | "master";

export interface SnappyOutcome {
  step: SnappyStepId;
  label: string;
  status: "done" | "unchanged" | "skipped" | "failed";
  detail: string;
  /** What the step did in a few words for the summary's first line ("23 transitions"), when it did something. */
  brief?: string;
  undoSteps: number;
}

export interface SnappyOptions {
  style?: MotionTransitionStyle;
}

const MASTER_TOOL = "master_audio_tool";

/** Sound design as dense as the transitions are loud: hype cuts get a sound on almost every cut, as in the reference reels. */
const SOUND_FOR_STYLE: Record<MotionTransitionStyle, SfxIntensity> = { hype: "hype", cinematic: "normal" };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** LUFS the way a meter shows it, with a real minus sign. */
const lufs = (value: number): string => `${Math.round(value) < 0 ? "−" : ""}${Math.abs(Math.round(value))} LUFS`;

function count(data: Record<string, unknown>, key: string): number | null {
  const list = data[key];
  return Array.isArray(list) ? list.length : null;
}

function briefOf(step: SnappyStepId, r: ToolRun): string | undefined {
  if (!r.ok || r.status === "unchanged") return undefined;
  switch (step) {
    case "gaps":
      return "frame gaps closed";
    case "transitions": {
      const n = count(r.data, "transitions");
      return n === null ? "motion transitions" : plural(n, "transition");
    }
    case "sound": {
      const n = count(r.data, "cues");
      return n === null ? "sound design" : plural(n, "sound");
    }
    case "master": {
      const after = (r.data.after as { integratedLufs?: unknown } | undefined)?.integratedLufs;
      return typeof after === "number" && Number.isFinite(after) ? `mastered to ${lufs(after)}` : "mastered";
    }
  }
}

export async function makeItSnappy(project: () => Project, run: ToolRunner, options: SnappyOptions = {}): Promise<SnappyOutcome[]> {
  const outcomes: SnappyOutcome[] = [];
  const step = async (id: SnappyStepId, label: string, tool: string, args: Record<string, unknown>) => {
    const r = await run(tool, args);
    outcomes.push({ step: id, label, status: !r.ok ? "failed" : r.status === "unchanged" ? "unchanged" : "done", detail: r.summary, brief: briefOf(id, r), undoSteps: r.undoSteps });
  };

  let track = mainSequence(project());
  const gaps = track ? null : tinyGapTrack(project());
  if (gaps) {
    await step("gaps", "Close frame gaps", "remove_gaps_tool", { track: String(gaps.layer), from_seconds: gaps.from });
    track = mainSequence(project());
  }
  const style = options.style ?? "hype";
  if (track) await step("transitions", "Motion transitions", "apply_motion_transitions_tool", { track: String(track.layer), style, direction: "auto" });
  else outcomes.push({ step: "transitions", label: "Motion transitions", status: "skipped", detail: "No clips play back to back, so there is no cut to move.", undoSteps: 0 });

  await step("sound", "Sound design", "auto_sound_design_tool", { intensity: SOUND_FOR_STYLE[style] });

  const master = editorToolState(MASTER_TOOL);
  if (master.kind === "ready") await step("master", "Master audio", MASTER_TOOL, { preset: "social" });
  else outcomes.push({ step: "master", label: "Master audio", status: "skipped", detail: master.kind === "missing" ? "Not mastered: mastering is not in this build yet." : `Not mastered: mastering runs on the ${master.where}, not in the browser.`, undoSteps: 0 });

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

/** A tool's summary cut to its first sentence, for a line people read at a glance. */
function oneLine(text: string): string {
  const first = text.split(/(?<=[.:;])\s/)[0]!.replace(/[.:;]$/, "");
  return first.length > 120 ? `${first.slice(0, 119)}…` : first;
}

export interface SnappySummary {
  /** "23 transitions · 18 sounds · mastered to −14 LUFS", plus mastering's absence said once. */
  description: string;
  /** One line per failed step. */
  issues: string[];
  /** Every step's full summary and the undo count, for "Details". */
  details: string;
}

/** The toast's text: one line of what changed first, failures called out, the rest collapsed. */
export function snappySummary(outcomes: readonly SnappyOutcome[]): SnappySummary {
  const briefs = outcomes.flatMap((o) => (o.brief ? [o.brief] : []));
  const master = outcomes.find((o) => o.step === "master" && o.status === "skipped");
  const lines = [briefs.join(" · ") || "Nothing changed", ...(master ? [master.detail] : [])];
  const steps = snappyUndoSteps(outcomes);
  return {
    description: lines.join("\n"),
    issues: outcomes.filter((o) => o.status === "failed").map((o) => `${o.label} failed: ${oneLine(o.detail)}`),
    details: [...outcomes.filter((o) => o !== master).map((o) => `${MARK[o.status]} ${o.label}: ${o.detail}`), `${plural(steps, "undo step")}; Undo all takes them back.`].join("\n"),
  };
}

/** The palette / toolbar action: run the chain, then one toast that leads with what changed, and "Undo all". */
export async function runMakeItSnappy(session: EditorSession, options: SnappyOptions = {}): Promise<SnappyOutcome[]> {
  const busy = toast.info("Making it snappy…", { duration: 60_000 });
  const outcomes = await makeItSnappy(() => session.project, editorToolRunner(session), options);
  toast.dismiss(busy);
  const steps = snappyUndoSteps(outcomes);
  const summary = snappySummary(outcomes);
  if (steps === 0) {
    toast.warning("Nothing to make snappy", summary);
    return outcomes;
  }
  const undoAll = snappyUndoAll(session, steps);
  const undoAllAction = {
    label: "Undo all",
    onClick: () => {
      if (!undoAll()) toast.info("Edited since: undo step by step (Ctrl+Z)");
    },
  };
  (summary.issues.length > 0 ? toast.warning : toast.success)("Made it snappy", { ...summary, action: undoAllAction, duration: 10_000 });
  return outcomes;
}
