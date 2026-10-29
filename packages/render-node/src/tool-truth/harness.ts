/**
 * Tool truth harness: one case is one tool parameter, called with its
 * default and with a clearly different value on the same tiny project, and
 * the render-node frame (or mix) must move — and move the way the case says.
 * With the libopenshot oracle (full mode, maintainer machines) the same two
 * projects are rendered by the desktop's own Timeline, which must read the
 * parameter too.
 */

import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addClip, addFile, createProject, ProjectDocument, type MixPcm, type Project, type RgbaImage } from "@zenvi/engine";
import { runTool } from "@zenvi/engine/tools";
import { createNodeHost, type NodeHost } from "../host/node-host.js";
import { probe } from "../probe/probe.js";
import { renderFrameImage } from "../render/render-frame.js";
import { fixture, FIXTURE_HEIGHT, FIXTURE_WIDTH, RENDER_WIDTH, type FixtureName } from "./fixtures.js";
import { libopenshotOracle, type OracleRender } from "./libopenshot.js";
import {
  changeCorrelation,
  pictureChanged,
  pictureDiff,
  pictureMetrics,
  soundChanged,
  soundMetrics,
  soundResidualDb,
  type PictureMetric,
  type SoundMetric,
} from "./metrics.js";

export type Args = Record<string, unknown>;

export interface TruthClip {
  fixture: FixtureName;
  /** Fixed id so cases can name it ("A", "B" … become CLIPA00001 …). */
  id: string;
  position?: number;
  /** Track number (1 = bottom). */
  track?: number;
  start?: number;
  end?: number;
}

export interface ToolStep {
  tool: string;
  args: Args;
}

export type Probe = { kind: "picture"; at: number } | { kind: "sound" };

export interface Expectation {
  metric: PictureMetric | SoundMetric;
  direction: "up" | "down";
}

export interface TruthCase {
  /** Unique and stable: `<tool> <param>` or `<tool> <param>=<value>`. */
  id: string;
  tool: string;
  /** The tool argument this case proves (ledger key); `properties.alpha` for a nested key. */
  param: string;
  clips: TruthClip[];
  /** Fixtures added to Project Files (not the timeline): files the arguments name by path (fixturePath). */
  files?: FixtureName[];
  /** Tool calls both runs share, before the tool under test (context the parameter needs to show). */
  setup?: ToolStep[];
  /** Arguments with the parameter at its default; null runs nothing (the parameter's absence is the default). */
  base: Args | null;
  variant: Args;
  probe: Probe;
  expect?: Expectation[];
  /** libopenshot renders this natively: full mode checks the desktop reads it too (default true). */
  desktop?: boolean;
  /**
   * Why this parameter shows nothing on these fixtures. The case then pins
   * that: render-node must not change (and, in full mode, neither may
   * libopenshot), so the day either renderer starts drawing it the case
   * fails and is moved to a real expectation.
   */
  inert?: string;
}

export interface CaseOutcome {
  /** Empty when the parameter provably did what it says. */
  failures: string[];
  /** Render-node change: mean absolute RGB difference, or the mix residual in dB. */
  change: number;
  metrics: { base: Record<string, number>; variant: Record<string, number> };
  frames?: { base: RgbaImage; variant: RgbaImage };
  desktop?: { checked: boolean; change?: number; correlation?: number; propertiesChanged?: string[]; warnings?: string[] };
}

export const FPS = 30;


/** `A` → `CLIPA00001` (10-character ids like the desktop's). */
export function clipId(short: string): string {
  return `CLIP${short}`.padEnd(10, "0").slice(0, 10);
}

export function fullMode(): boolean {
  return process.env.ZENVI_TOOL_TRUTH_FULL === "1";
}

export interface TruthSession {
  dir: string;
}

export async function openSession(): Promise<TruthSession> {
  const dir = await mkdtemp(path.join(tmpdir(), "zenvi-tool-truth-"));
  return { dir };
}

let runs = 0;

/** A host on a fresh project folder: runs in parallel never write the same generated file. */
async function runHost(session: TruthSession): Promise<NodeHost> {
  const folder = path.join(session.dir, `run-${(runs += 1)}`);
  await mkdir(folder, { recursive: true });
  // desktopDir: custom profiles (set_project_setting_tool sizes no built-in profile has) are saved there.
  return createNodeHost({ projectFile: path.join(folder, "truth.zvn"), desktopDir: path.join(folder, "desktop"), scenes3d: false, mattes: false });
}

const projects = new Map<string, Promise<Project>>();

/** The case's starting project (cached per clip layout; callers copy it). */
function startingProject(clips: readonly TruthClip[], extraFiles: readonly FixtureName[]): Promise<Project> {
  const key = JSON.stringify([clips, extraFiles]);
  let job = projects.get(key);
  if (!job) {
    job = (async () => {
      const doc = new ProjectDocument({ ...createProject({ id: "TOOLTRUTH1" }), width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT });
      const files = await Promise.all(clips.map(async (c) => ({ clip: c, path: await fixture(c.fixture) })));
      const infos = await Promise.all(files.map((f) => probe(f.path)));
      const extras = await Promise.all(extraFiles.map(async (name) => ({ path: await fixture(name) })));
      const extraInfos = await Promise.all(extras.map((f) => probe(f.path)));
      doc.transaction("fixture", (tx) => {
        extras.forEach((f, i) => addFile(tx, { path: f.path, info: extraInfos[i]! }));
        files.forEach(({ clip, path: file }, i) => {
          const added = addFile(tx, { path: file, info: infos[i]! });
          addClip(tx, {
            fileId: added.id,
            position: clip.position ?? 0,
            layer: tx.project.layers[(clip.track ?? 1) - 1]?.number ?? (clip.track ?? 1) * 1000000,
            start: clip.start,
            end: clip.end,
            id: clipId(clip.id),
          });
        });
      });
      return { ...doc.project, history: { undo: [], redo: [] } };
    })();
    projects.set(key, job);
  }
  return job;
}

/** Run `steps` on a copy of the case's project; the first refusal is returned as an error. */
async function edited(
  session: TruthSession,
  clips: readonly TruthClip[],
  files: readonly FixtureName[],
  steps: readonly ToolStep[],
): Promise<{ project: Project; host: NodeHost } | string> {
  const doc = new ProjectDocument(structuredClone(await startingProject(clips, files)));
  const host = await runHost(session);
  for (const step of steps) {
    const result = await runTool({ doc, host }, step.tool, resolveRefs(doc.project, step.args));
    if (!result.ok) return `${step.tool} refused ${JSON.stringify(step.args)}: ${result.text.slice(0, 300)}`;
  }
  return { project: doc.project, host };
}

/**
 * Generated ids the cases cannot know: `"@effect:Blur"` → the id of the
 * first Blur effect in the project, `"@file:bars.mp4"` → the id of that
 * fixture in Project Files. Arrays are resolved item by item.
 */
function resolveRefs(project: Project, args: Args): Args {
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
    if (typeof value !== "string") return value;
    if (value.startsWith("@effect:")) {
      const type = value.slice("@effect:".length);
      return project.clips.flatMap((clip) => clip.effects ?? []).find((e) => e.type === type)?.id ?? value;
    }
    if (value.startsWith("@file:")) {
      const name = value.slice("@file:".length);
      return project.files.find((f) => path.basename(String(f.path)) === name)?.id ?? value;
    }
    return value;
  };
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, resolve(value)]));
}

type Rendered = { kind: "picture"; image: RgbaImage } | { kind: "sound"; mix: MixPcm };

async function render(host: NodeHost, project: Project, probeAt: Probe): Promise<Rendered> {
  if (probeAt.kind === "picture") {
    const image = await renderFrameImage(project, probeAt.at, { resolveMedia: host.resolveMedia, width: RENDER_WIDTH });
    return { kind: "picture", image };
  }
  const mix = await host.audio!.mixPcm!(project);
  return { kind: "sound", mix };
}

/**
 * The project as the desktop hands it to libopenshot: zenvi-core resolves
 * its aliased paths (`@transitions/…`, `@colors/…`, project-relative assets)
 * to files before Timeline::SetJson; the engine's assets are the same files.
 */
function desktopPaths(project: Project, resolveMedia: (value: string) => string): Project {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if ((key === "path" || key === "lut_path") && typeof v === "string" && v !== "" && !path.isAbsolute(v)) {
        try {
          out[key] = resolveMedia(v);
        } catch {
          out[key] = v;
        }
      } else out[key] = visit(v);
    }
    return out;
  };
  return visit(project) as Project;
}

interface Run {
  project: Project;
  /** `project` with the paths the desktop resolves before libopenshot reads it. */
  desktopProject: Project;
  rendered: Rendered;
}

const renders = new Map<string, Promise<Run | string>>();

/** Base runs are shared by every case with the same layout, setup and default call. */
function runOnce(session: TruthSession, c: TruthCase, steps: readonly ToolStep[]): Promise<Run | string> {
  const files = c.files ?? [];
  const key = JSON.stringify([c.clips, files, steps, c.probe]);
  let job = renders.get(key);
  if (!job) {
    job = (async () => {
      const run = await edited(session, c.clips, files, steps);
      if (typeof run === "string") return run;
      return { project: run.project, desktopProject: desktopPaths(run.project, run.host.resolveMedia), rendered: await render(run.host, run.project, c.probe) };
    })();
    renders.set(key, job);
  }
  return job;
}

const EPSILON: Record<string, number> = { balance: 0.5, rms: 0.3, rms_left: 0.3, rms_right: 0.3, tail: 0.01, onset: 0.005 };

export async function runCase(session: TruthSession, c: TruthCase): Promise<CaseOutcome> {
  const setup = c.setup ?? [];
  const baseSteps = c.base === null ? setup : [...setup, { tool: c.tool, args: c.base }];
  const variantSteps = [...setup, { tool: c.tool, args: c.variant }];
  const [base, variant] = await Promise.all([runOnce(session, c, baseSteps), runOnce(session, c, variantSteps)]);
  const failures: string[] = [];
  if (typeof base === "string") failures.push(`default call: ${base}`);
  if (typeof variant === "string") failures.push(`changed call: ${variant}`);
  if (typeof base === "string" || typeof variant === "string") return { failures, change: 0, metrics: { base: {}, variant: {} } };

  let change: number;
  let metrics: CaseOutcome["metrics"];
  let frames: CaseOutcome["frames"];
  if (base.rendered.kind === "picture" && variant.rendered.kind === "picture") {
    const diff = pictureDiff(base.rendered.image, variant.rendered.image);
    change = diff.meanAbs;
    frames = { base: base.rendered.image, variant: variant.rendered.image };
    metrics = { base: pictureMetrics(base.rendered.image), variant: pictureMetrics(variant.rendered.image) };
    if (pictureChanged(diff) === Boolean(c.inert)) failures.push(c.inert ? `render-node frame changed (mean |ΔRGB| ${diff.meanAbs.toFixed(3)}) although the case says: ${c.inert}` : `render-node frame did not change (mean |ΔRGB| ${diff.meanAbs.toFixed(3)}, ${(diff.changed * 100).toFixed(2)}% of pixels)`);
  } else if (base.rendered.kind === "sound" && variant.rendered.kind === "sound") {
    change = soundResidualDb(base.rendered.mix, variant.rendered.mix);
    metrics = { base: soundMetrics(base.rendered.mix), variant: soundMetrics(variant.rendered.mix) };
    if (soundChanged(change) === Boolean(c.inert)) failures.push(c.inert ? `render-node mix changed (residual ${change.toFixed(1)} dB) although the case says: ${c.inert}` : `render-node mix did not change (residual ${change.toFixed(1)} dB)`);
  } else {
    throw new Error(`${c.id}: probe kinds differ`);
  }
  for (const e of c.expect ?? []) {
    const delta = (metrics.variant[e.metric] ?? 0) - (metrics.base[e.metric] ?? 0);
    const eps = EPSILON[e.metric] ?? 0.002 * Math.max(1, Math.abs(metrics.base[e.metric] ?? 0));
    const ok = e.direction === "up" ? delta > eps : delta < -eps;
    if (!ok) failures.push(`${e.metric} should go ${e.direction}: ${fmt(metrics.base[e.metric])} → ${fmt(metrics.variant[e.metric])}`);
  }
  const outcome: CaseOutcome = { failures, change, metrics, frames };
  if (fullMode() && c.desktop !== false) outcome.desktop = await desktopCheck(c, base.desktopProject, variant.desktopProject, frames, failures);
  return outcome;
}

const fmt = (v: number | undefined): string => (v === undefined ? "?" : Number(v.toFixed(4)).toString());

async function desktopCheck(
  c: TruthCase,
  base: Project,
  variant: Project,
  frames: CaseOutcome["frames"],
  failures: string[],
): Promise<CaseOutcome["desktop"]> {
  const frame = c.probe.kind === "picture" ? Math.floor(c.probe.at * FPS) + 1 : 1;
  const result = await libopenshotOracle([base, variant], { frame, picture: c.probe.kind === "picture", sound: c.probe.kind === "sound" });
  if (!result) return { checked: false };
  const [b, v] = result as [OracleRender, OracleRender];
  if (b.error || v.error) {
    failures.push(`libopenshot could not load the project: ${b.error ?? v.error}`);
    return { checked: true };
  }
  const propertiesChanged = changedProperties(b.properties, v.properties);
  const out: NonNullable<CaseOutcome["desktop"]> = { checked: true, propertiesChanged };
  if (c.probe.kind === "picture" && b.image && v.image && frames) {
    const diff = pictureDiff(b.image, v.image);
    out.change = diff.meanAbs;
    if (c.inert) {
      if (pictureChanged(diff)) failures.push(`libopenshot frame changed (mean |ΔRGB| ${diff.meanAbs.toFixed(3)}) but render-node draws nothing`);
    } else if (!pictureChanged(diff)) failures.push(`libopenshot frame did not change (mean |ΔRGB| ${diff.meanAbs.toFixed(3)}): the desktop does not read this value`);
    else {
      out.correlation = changeCorrelation(frames.base, frames.variant, b.image, v.image);
      // Advisory: generative effects (visualizers, grain) legitimately differ pixel for pixel.
      if (out.correlation < 0.3) out.warnings = [`render-node and libopenshot change different pixels (correlation ${out.correlation.toFixed(2)})`];
    }
  }
  if (c.probe.kind === "sound" && b.sound && v.sound) {
    const moved = Object.keys(b.sound).filter((k) => Math.abs((b.sound![k] ?? 0) - (v.sound![k] ?? 0)) > 0.05);
    out.change = moved.length;
    if (c.inert) {
      if (moved.length > 0) failures.push(`libopenshot mix changed (${moved.join(", ")}) but render-node plays nothing different`);
    } else if (moved.length === 0) failures.push(`libopenshot mix did not change (${JSON.stringify(b.sound)}): the desktop does not read this value`);
  }
  return out;
}

function changedProperties(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): string[] {
  if (!a || !b) return [];
  return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
