/**
 * A small editable project for the timeline-edit tool tests (used only by
 * `*.test.ts`), shaped like zenvi-core's tests/editor_tools_harness.py: the
 * builders record their setup and move the mark, so a test counts only the
 * undo steps its own tool calls made (`stepsSinceMark`).
 */

import { expect } from "vitest";
import { ProjectDocument, type Transaction } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Clip, Fraction, Transition } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addEffect } from "../../ops/effects.js";
import { addFile } from "../../ops/files.js";
import { addTransition } from "../../ops/transitions.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "./fake-host.js";
import { L1, audioInfo, imageInfo, videoInfo } from "./fixture.js";

export interface FileOptions {
  duration?: number;
  name?: string;
  hasAudio?: boolean;
  channels?: number;
}

let files = 0;
let transactions = 0;

export class EditHarness {
  readonly doc: ProjectDocument;
  readonly host: FakeHost;
  private markAt = 0;

  constructor(opts: { fps?: Fraction; playhead?: number } = {}) {
    const project = createProject({ id: "PROJECT001" });
    if (opts.fps) project.fps = { ...opts.fps };
    this.doc = new ProjectDocument(project, { newTransactionId: () => `tx-${(transactions += 1)}` });
    this.host = fakeHost({ playhead: opts.playhead ?? 0 });
  }

  private setup<T>(body: (tx: Transaction) => T): T {
    const result = this.doc.transaction("setup", body);
    this.mark();
    return result;
  }

  /** A project file like an import: video (no sound unless `hasAudio`), audio (stereo) or a still image. */
  addFile(kind: "video" | "audio" | "image", opts: FileOptions = {}): string {
    files += 1;
    const name = opts.name ?? `${kind}-${files}.${kind === "audio" ? "mp3" : kind === "image" ? "png" : "mp4"}`;
    const path = `/media/${name}`;
    const info =
      kind === "image"
        ? imageInfo(path)
        : kind === "audio"
          ? audioInfo(path, opts.duration ?? 30)
          : videoInfo(path, opts.duration ?? 10, { has_audio: opts.hasAudio ?? false, channels: opts.hasAudio ? (opts.channels ?? 2) : 0 });
    return this.setup((tx) => addFile(tx, { path, info, name }, { dedupe: false }).id);
  }

  /** A timeline clip of `fileId` (an image lasts 10 s by default, like the desktop's preference). */
  addClip(fileId: string, opts: { position?: number; layer?: number; start?: number; end?: number } = {}): string {
    return this.setup(
      (tx) =>
        addClip(tx, {
          fileId,
          position: opts.position ?? 0,
          layer: opts.layer ?? L1,
          start: opts.start ?? 0,
          ...(opts.end !== undefined ? { end: opts.end } : {}),
        }).id,
    );
  }

  addTransition(layer: number, position: number, duration: number): string {
    return this.setup((tx) => addTransition(tx, { layer, position, duration, maskId: "common/fade", direction: "in" }).id);
  }

  addEffect(clipId: string, className: string): string {
    return this.setup((tx) => addEffect(tx, clipId, className).id);
  }

  lockTrack(layer: number, lock = true): void {
    this.doc.setUntracked(["layers", { number: layer }, "lock"], lock);
  }

  selectIds(ids: string[]): void {
    this.host.ui!.selectedIds = () => ids;
  }

  mark(): void {
    this.markAt = this.doc.undoLabels.length;
  }

  stepsSinceMark(): number {
    return this.doc.undoLabels.length - this.markAt;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolReceipt> {
    return (await runTool({ doc: this.doc, host: this.host }, name, args)).data!;
  }

  /** A successful call's receipt object (the desktop's JSON after the summary line). */
  async receipt(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const receipt = await this.call(name, args);
    expect(receipt.summary, receipt.summary).not.toMatch(/^Error/);
    return (receipt.data ?? {}) as Record<string, unknown>;
  }

  /** A refused call: "Error…" with these fragments, and no undo step. */
  async refused(name: string, args: Record<string, unknown>, ...fragments: string[]): Promise<ToolReceipt> {
    const receipt = await this.call(name, args);
    expect(receipt.summary).toMatch(/^Error/);
    for (const fragment of fragments) expect(receipt.summary).toContain(fragment);
    expect(this.stepsSinceMark()).toBe(0);
    return receipt;
  }

  clip(id: string): Clip | undefined {
    return this.doc.project.clips.find((c) => c.id === id);
  }

  transition(id: string): Transition | undefined {
    return this.doc.project.effects.find((t) => t.id === id);
  }

  pos(id: string): number {
    return Math.round(this.clip(id)!.position * 1000) / 1000;
  }

  dur(id: string): number {
    const c = this.clip(id)!;
    return Math.round((c.end - c.start) * 1000) / 1000;
  }
}
