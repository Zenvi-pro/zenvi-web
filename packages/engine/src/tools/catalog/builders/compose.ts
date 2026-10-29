/**
 * The category builders' composer (build_explainer_tool,
 * build_product_launch_tool, build_talking_head_tool, build_trailer_tool):
 * a whole edit made of the same tools an agent would call, one after the
 * other, on a scratch copy of the project, and landed in the real project as
 * ONE transaction (the master_audio_tool iterate pattern, master-loop.ts).
 * The craft stays in those tools (kinetic captions, motion blocks, 3D
 * scenes, sound effects); a builder decides what to call, where and why.
 *
 * Every step is recorded as a decision: what was called with which
 * arguments and why, or what was skipped and why. An optional step that
 * cannot run on this surface (no motion host, no Blender, no matte) falls
 * back to a native one and the receipt says so; nothing is silently
 * dropped. A refused build discards the media its steps wrote.
 */

import { ProjectDocument, type Transaction } from "../../../history/document.js";
import type { Project, ProjectFile } from "../../../model/types.js";
import { Interpolation, ScaleMode } from "../../../model/types.js";
import { addClip, deleteClips, setClipKeyframes, setClipProperty } from "../../../ops/clips.js";
import { addTrack } from "../../../ops/tracks.js";
import { removeTransition } from "../../../ops/transitions.js";
import type { ToolCall } from "../../define.js";
import { applied, refused, type ReceiptFields, type ToolReceipt } from "../../receipt.js";
// A cycle (the registry lists the builders), safe because runTool is only called while a builder runs (master-loop.ts does the same).
import { runTool } from "../../registry.js";
import { applyProjectState, orphanedPaths } from "../master-loop.js";
import { aspectOf, visualKind } from "../reels.js";

/** One thing the builder did or chose not to do. */
export interface BuildDecision {
  /** The part of the edit: "hook", "captions", "chapter 2", "braam act 3"… */
  step: string;
  /** The tool called, or "edit" for the builder's own placement. */
  tool: string;
  /** applied: done; fallback: a stand-in was used instead (see `instead_of`); skipped: not done. */
  outcome: "applied" | "fallback" | "skipped";
  why: string;
  args?: Record<string, unknown>;
  /** What the step wanted and could not do (the fallback's reason is in `why`). */
  instead_of?: string;
  /** The sub-tool's own summary. */
  summary?: string;
}

/** A call the agent can make next (the receipt's `next_calls`). */
export interface NextCall {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

export class Composer {
  readonly scratch: ProjectDocument;
  readonly decisions: BuildDecision[] = [];
  readonly warnings: string[] = [];
  readonly next: NextCall[] = [];

  constructor(
    readonly call: ToolCall,
    readonly tool: string,
  ) {
    this.scratch = new ProjectDocument(structuredClone(call.doc.project));
  }

  get project(): Project {
    return this.scratch.project;
  }

  /**
   * Run one tool on the scratch project. Returns its receipt when it
   * applied (or changed nothing), else null with the failure recorded as a
   * skip; the caller then records its fallback with `fallback`.
   */
  async run(step: string, tool: string, args: Record<string, unknown>, why: string): Promise<ToolReceipt | null> {
    if (this.call.signal?.aborted) return null;
    const result = await runTool({ doc: this.scratch, host: this.call.host, signal: this.call.signal }, tool, args);
    const receipt = result.data;
    const ok = receipt && (receipt.status === "applied" || receipt.status === "unchanged");
    this.decisions.push({
      step,
      tool,
      outcome: ok ? "applied" : "skipped",
      why: ok ? why : `${why}; it did not run: ${(receipt?.summary ?? result.text).replace(/^Error:\s*/, "")}`,
      args,
      ...(ok && receipt.summary ? { summary: receipt.summary } : {}),
    });
    if (ok && receipt.warnings.length > 0) this.warnings.push(...receipt.warnings.map((w) => `${step}: ${w}`));
    return ok ? receipt : null;
  }

  /** Run a stand-in for a step that did not run (the step's own record says why). */
  async fallback(step: string, insteadOf: string, tool: string, args: Record<string, unknown>, why: string): Promise<ToolReceipt | null> {
    const receipt = await this.run(step, tool, args, why);
    const last = this.decisions[this.decisions.length - 1]!;
    if (receipt) {
      last.outcome = "fallback";
      last.instead_of = insteadOf;
    }
    return receipt;
  }

  /** The builder's own placement on the scratch project (clips, keyframes), recorded as a decision. */
  edit<T>(step: string, why: string, body: (tx: Transaction) => T): T {
    const out = this.scratch.transaction(step, body);
    this.decisions.push({ step, tool: "edit", outcome: "applied", why });
    return out;
  }

  skip(step: string, why: string): void {
    this.decisions.push({ step, tool: "-", outcome: "skipped", why });
  }

  suggest(tool: string, args: Record<string, unknown>, why: string): void {
    this.next.push({ tool, args, why });
  }

  /** Nothing lands: the media the steps wrote (and no project keeps) is deleted. */
  async abandon(message: string): Promise<ToolReceipt> {
    const orphans = orphanedPaths(this.scratch.project, [this.call.doc.project]);
    if (orphans.length > 0) await this.call.host.media?.discardGenerated?.(orphans);
    return refused(this.tool, message.startsWith("Error") ? message : `Error: ${message}`, { data: { decisions: this.decisions } });
  }

  /** Land the scratch project in the real one as one undo step and write the receipt. */
  async finish(label: string, summary: string, data: Record<string, unknown>, fields: ReceiptFields = {}): Promise<ToolReceipt> {
    if (this.call.signal?.aborted) return this.abandon("cancelled; nothing changed");
    const target = this.scratch.project;
    this.call.commit((tx) => applyProjectState(tx, target), label);
    return applied(this.tool, summary, {
      ...fields,
      warnings: [...(fields.warnings ?? []), ...this.warnings],
      data: { ...data, decisions: this.decisions, fallbacks: this.decisions.filter((d) => d.outcome !== "applied").length, next_calls: this.next },
    });
  }
}

/** Clear the timeline (clips and transitions) on the scratch project: `replace=true`. */
export function clearTimeline(tx: Transaction): void {
  for (const t of [...tx.project.effects]) removeTransition(tx, String(t.id));
  if (tx.project.clips.length > 0) deleteClips(tx, tx.project.clips.map((c) => String(c.id)), { ripple: false });
}

/** The lowest `count` tracks, bottom to top, adding tracks when the project has fewer. */
export function builderTracks(tx: Transaction, count: number): number[] {
  while (tx.project.layers.length < count) addTrack(tx, {});
  return [...tx.project.layers].map((l) => Number(l.number)).sort((a, b) => a - b).slice(0, count);
}

/** A picture clip that fills the frame (cropped, never letterboxed), muted unless `volume` is given. */
export function placeShot(
  tx: Transaction,
  file: ProjectFile,
  shot: { position: number; length: number; sourceStart: number; layer: number; volume?: number },
): string {
  const image = visualKind(file) === "image";
  const clip = addClip(tx, {
    fileId: String(file.id),
    position: shot.position,
    layer: shot.layer,
    start: image ? 0 : shot.sourceStart,
    end: image ? shot.length : shot.sourceStart + shot.length,
  });
  if (aspectOf(file) !== null) setClipProperty(tx, clip.id, "scale", ScaleMode.CROP);
  if (file.has_audio) setClipProperty(tx, clip.id, "volume", shot.volume ?? 0);
  return clip.id;
}

/**
 * A music bed under the edit: from the song's start, at `level` (linear),
 * faded out at the end; `dips` are [from, to] timeline windows where it
 * falls silent (a trailer's beat of silence) and comes back on `to`.
 */
export function placeBed(tx: Transaction, musicId: string, duration: number, layer: number, level: number, dips: readonly [number, number][] = [], title?: string): string {
  const bed = addClip(tx, { fileId: musicId, position: 0, layer, start: 0, end: duration, ...(title ? { title } : {}) });
  const out = Math.min(1.5, duration / 4);
  const points = [{ time: 0, value: level }];
  for (const [from, to] of dips) {
    points.push({ time: Math.max(0, from - 0.12), value: level }, { time: from, value: 0 }, { time: Math.max(from, to - 0.02), value: 0 }, { time: to, value: level });
  }
  points.push({ time: duration - out, value: level }, { time: duration, value: 0 });
  setClipKeyframes(
    tx,
    bed.id,
    "volume",
    points.map((p) => ({ ...p, interpolation: Interpolation.LINEAR })),
  );
  return bed.id;
}

/** The bin's pictures and sounds, by id, with names an agent recognises. */
export function binOf(project: Project): Map<string, ProjectFile> {
  return new Map(project.files.map((f) => [String(f.id), f]));
}

export function round3(t: number): number {
  return Math.round(t * 1000) / 1000;
}
