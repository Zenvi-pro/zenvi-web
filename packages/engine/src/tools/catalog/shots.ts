/**
 * Shot understanding: embed_media_tool, find_shots_tool,
 * shot_similarity_tool. Agents pick and order shots from file names and
 * text metadata; these let them see what is in the picture: a text query
 * finds the moments that show it ("close-up of hands typing"), and shot
 * similarity says which shots continue each other (match cuts) and which
 * are the same shot twice.
 *
 * All three are read-only: embeddings live in the host's cache, keyed by
 * file content, never in the project, so no call makes an undo step.
 */

import { z } from "zod";
import type { Clip, ProjectFile } from "../../model/types.js";
import { findMoments, type Moment } from "../../shots/moments.js";
import { chainOrder, chainScore } from "../../shots/order.js";
import { cosine, matchProbability, NEAR_DUPLICATE, type Vector } from "../../shots/vectors.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { fileLabel } from "../mattes.js";
import { applied, unchanged } from "../receipt.js";
import { embeddableFiles, embeddableProblem, embeddingsOf, isStill, shotInterval, shotVectors, type ShotWindow } from "../shots.js";
import { guarded, toolError } from "../titles-text.js";
import type { ShotEmbeddings, ShotHost } from "../types.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const EMBED = "embed_media_tool";
const FIND = "find_shots_tool";
const SIMILAR = "shot_similarity_tool";
/** Seconds of embedding one call starts before it stops and asks to be called again. */
const DEFAULT_BUDGET_SECONDS = 120;
/** A keyframe stays in its peak's moment while its text cosine is within this of the peak (about 3x lower odds). */
const MOMENT_DROP = 0.012;
/** Below this match probability nothing in the bin clearly shows the query. */
const WEAK_MATCH = 0.02;

const fileIds = z.array(z.string().min(1)).min(1).max(200).optional().describe("Bin file ids to look at (default: every video and image in the bin).");

const round = (x: number, digits = 3): number => Number(x.toFixed(digits));

/** The shot host, ready to embed: with `download`, the one-time model download runs first (the person agreed). */
async function readyHost(call: ToolCall, download: boolean | undefined): Promise<ShotHost> {
  const host = call.host.shots!;
  const status = await host.status();
  if (status.ready) return host;
  if (!download || !host.setup) toolError(status.detail);
  const after = await host.setup(call.signal);
  if (!after.ready) toolError(after.detail);
  return host;
}

/** The files `ids` names (in that order), or every embeddable bin file; files without picture are refused by name. */
function pickFiles(call: ToolCall, ids: readonly string[] | undefined): ProjectFile[] {
  const files = call.doc.project.files ?? [];
  if (!ids) return embeddableFiles(files);
  return ids.map((id) => {
    const file = files.find((f) => f.id === id);
    if (!file) toolError(`no project file with id='${id}'`);
    const problem = embeddableProblem(file);
    if (problem) toolError(problem);
    return file;
  });
}

interface EmbedPass {
  done: Map<string, ShotEmbeddings>;
  computed: string[];
  /** Files not started because the time budget ran out. */
  remaining: string[];
  failed: { file_id: string; reason: string }[];
}

/** Embed `files` (cached ones cost nothing) until `budgetSeconds` of work has gone by. */
async function embedAll(call: ToolCall, host: ShotHost, files: readonly ProjectFile[], budgetSeconds: number): Promise<EmbedPass> {
  const pass: EmbedPass = { done: new Map(), computed: [], remaining: [], failed: [] };
  const started = performance.now();
  for (const file of files) {
    const cached = await embeddingsOf(host, file, false, call.signal).catch(() => null);
    if (cached) {
      pass.done.set(file.id, cached);
      continue;
    }
    if (call.signal?.aborted || (performance.now() - started) / 1000 > budgetSeconds) {
      pass.remaining.push(file.id);
      continue;
    }
    try {
      const made = await embeddingsOf(host, file, true, call.signal);
      if (made) {
        pass.done.set(file.id, made);
        pass.computed.push(file.id);
      }
    } catch (error) {
      pass.failed.push({ file_id: file.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return pass;
}

function passWarnings(pass: EmbedPass): string[] {
  const out = pass.failed.map((f) => `${f.file_id} could not be embedded: ${f.reason}`);
  if (pass.remaining.length > 0) out.push(`${pass.remaining.length} file(s) are not embedded yet (time budget): call embed_media_tool to finish, then search again`);
  return out;
}

function modelData(host: ShotHost): Record<string, unknown> {
  return { name: host.model.name, version: host.model.version, license: host.model.license };
}

/** A timeline clip's source window as a shot. */
function clipWindow(call: ToolCall, clip: Clip): ShotWindow {
  const file = (call.doc.project.files ?? []).find((f) => f.id === clip.file_id);
  if (!file) toolError(`clip ${clip.id} plays no file in the bin`);
  const problem = embeddableProblem(file);
  if (problem) toolError(`clip ${clip.id}: ${problem}`);
  return { file, start: Number(clip.start) || 0, end: Number(clip.end) || 0 };
}

export const shotTools: CatalogTool[] = [
  directTool({
    name: EMBED,
    title: "Embed media",
    description:
      "Look at the bin's videos and images once so find_shots_tool, shot_similarity_tool, review_edit_tool's near-duplicate check and match_cut_montage_tool order=look can see them: " +
      "a SigLIP image embedding of a frame every 0.5 s (every 1 s past two minutes), cached on this computer by file content (a file is embedded once, a second call is free). " +
      "Changes nothing in the project. About 40 ms a keyframe. The model (SigLIP base, Apache-2.0, about 213 MB) is a one-time download: when it is missing, ask the person, then call with download=true.",
    input: z.strictObject({
      file_ids: fileIds,
      download: z.boolean().optional().describe("true = the person agreed to the one-time model download when it is missing."),
      max_seconds: z.number().min(5).max(900).optional().describe(`Stop starting new files after this many seconds (default ${DEFAULT_BUDGET_SECONDS}); call again to continue.`),
    }),
    annotations: READ,
    requires: ["shots"],
    run: (call, input) =>
      guarded(EMBED, async () => {
        const files = pickFiles(call, input.file_ids);
        if (files.length === 0) toolError("the bin has no video or image files to embed; import footage first");
        const host = await readyHost(call, input.download);
        const pass = await embedAll(call, host, files, input.max_seconds ?? DEFAULT_BUDGET_SECONDS);
        const embedded = files
          .filter((f) => pass.done.has(f.id))
          .map((f) => ({ file_id: f.id, name: fileLabel(f), keyframes: pass.done.get(f.id)!.times.length, interval_seconds: isStill(f) ? 0 : shotInterval(f), cached: !pass.computed.includes(f.id) }));
        const data = { model: modelData(host), embedded, remaining: pass.remaining, failed: pass.failed };
        const keyframes = embedded.reduce((n, e) => n + e.keyframes, 0);
        const summary =
          `${embedded.length} of ${files.length} file(s) embedded (${keyframes} keyframes; ${pass.computed.length} new, ${embedded.length - pass.computed.length} from the cache)` +
          (pass.remaining.length > 0 ? `; ${pass.remaining.length} left: call again to continue.` : ".");
        const fields = { data, warnings: passWarnings(pass) };
        return pass.computed.length > 0 ? applied(EMBED, summary, fields, 0) : unchanged(EMBED, summary, fields);
      }),
  }),

  directTool({
    name: FIND,
    title: "Find shots",
    description:
      "Find the moments in the bin that show something, from a description of the picture (\"close-up of hands typing\", \"wide aerial of a city at night\", \"a person running toward camera\"): " +
      "the best windows of the bin's videos and images, best first, with source start/end/peak seconds ready for add_clip_to_timeline_tool or a montage's file list. " +
      "Embeds files that are not embedded yet (embed_media_tool; same one-time model download). Describe what is seen, not story or sound. Changes nothing.",
    input: z.strictObject({
      query: z.string().trim().min(1).max(300).describe("What the shot shows, in plain words."),
      file_ids: fileIds,
      limit: z.number().int().min(1).max(30).optional().describe("Moments to return (default 5)."),
      per_file: z.number().int().min(1).max(10).optional().describe("At most this many moments from one file (default 1: different shots)."),
      download: z.boolean().optional().describe("true = the person agreed to the one-time model download when it is missing."),
    }),
    annotations: READ,
    requires: ["shots"],
    run: (call, input) =>
      guarded(FIND, async () => {
        const files = pickFiles(call, input.file_ids);
        if (files.length === 0) toolError("the bin has no video or image files to search; import footage first");
        const host = await readyHost(call, input.download);
        const pass = await embedAll(call, host, files, DEFAULT_BUDGET_SECONDS);
        const [query] = await host.embedText([input.query], call.signal);
        const limit = input.limit ?? 5;
        const perFile = input.per_file ?? 1;
        const found: (Moment & { file: ProjectFile })[] = [];
        for (const file of files) {
          const e = pass.done.get(file.id);
          if (!e) continue;
          const scores = e.vectors.map((v) => cosine(v, query!));
          const duration = isStill(file) ? 0 : Number(file.duration) || 0;
          for (const m of findMoments(e.times, scores, { interval: isStill(file) ? 0 : shotInterval(file), duration, drop: MOMENT_DROP, max: perFile })) found.push({ ...m, file });
        }
        found.sort((a, b) => b.score - a.score);
        const moments = found.slice(0, limit).map((m) => ({
          file_id: m.file.id,
          name: fileLabel(m.file),
          start_seconds: round(m.start),
          end_seconds: round(m.end),
          peak_seconds: round(m.peak),
          score: round(m.score),
          match: round(matchProbability(m.score, host.model), 3),
          ...(isStill(m.file) ? { still: true } : {}),
        }));
        const warnings = passWarnings(pass);
        if (moments.length > 0 && moments[0]!.match < WEAK_MATCH) warnings.push(`nothing in the bin clearly shows "${input.query}" (best match ${moments[0]!.match}); the closest moments are listed anyway`);
        const data = { query: input.query, model: modelData(host), moments, searched: pass.done.size };
        const summary =
          moments.length === 0
            ? `No embedded files to search for "${input.query}".`
            : `Best moments for "${input.query}": ` +
              moments.map((m) => `${m.file_id} ${m.name} ${m.start_seconds}-${m.end_seconds} s (match ${m.match})`).join("; ") + ".";
        return unchanged(FIND, summary, { data, warnings });
      }),
  }),

  directTool({
    name: SIMILAR,
    title: "Shot similarity",
    description:
      "How alike shots look (SigLIP embeddings; 1 = the same picture): pairwise similarity of timeline clips (their source windows) or bin files, the pairs that are near-duplicates (the same shot twice: avoid them back to back), " +
      "and the order in which each shot looks most like the one before (first kept first): the chain for a match-cut montage or a smooth sequence. Embeds what is not embedded yet. Changes nothing.",
    input: z.strictObject({
      clip_ids: z.array(z.string().min(1)).min(2).max(60).optional().describe("Timeline clips to compare (instead of file_ids)."),
      file_ids: z.array(z.string().min(1)).min(2).max(60).optional().describe("Bin files to compare, whole file each (instead of clip_ids)."),
      download: z.boolean().optional().describe("true = the person agreed to the one-time model download when it is missing."),
    }),
    annotations: READ,
    requires: ["shots"],
    run: (call, input) =>
      guarded(SIMILAR, async () => {
        if (!input.clip_ids === !input.file_ids) toolError("pass clip_ids or file_ids (one of them)");
        const project = call.doc.project;
        const windows: ShotWindow[] = input.clip_ids
          ? input.clip_ids.map((id) => {
              const clip = project.clips.find((c) => c.id === id);
              if (!clip) toolError(`no timeline clip with id='${id}'`);
              return clipWindow(call, clip);
            })
          : pickFiles(call, input.file_ids).map((file) => ({ file, start: 0, end: isStill(file) ? 0 : Number(file.duration) || 0 }));
        const ids = input.clip_ids ?? input.file_ids!;
        const host = await readyHost(call, input.download);
        const vectors = await shotVectors(call, host, windows, true);
        const unread = vectors.flatMap((v, i) => (v ? [] : [ids[i]!]));
        if (unread.length > 0) toolError(`could not read the picture of ${unread.join(", ")}`);
        const vs = vectors as Vector[];
        const sim = vs.map((a) => vs.map((b) => cosine(a, b)));
        const near: { a: string; b: string; similarity: number }[] = [];
        for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) if (sim[i]![j]! >= NEAR_DUPLICATE) near.push({ a: ids[i]!, b: ids[j]!, similarity: round(sim[i]![j]!, 2) });
        const order = chainOrder(sim, { fixFirst: true });
        const given = ids.map((_, i) => i);
        const data = {
          ids,
          similarity: sim.map((row) => row.map((x) => round(x, 2))),
          near_duplicates: near,
          look_order: order.map((i) => ids[i]!),
          neighbour_similarity: { given: round(chainScore(sim, given) / (ids.length - 1), 3), look_order: round(chainScore(sim, order) / (ids.length - 1), 3) },
          near_duplicate_threshold: NEAR_DUPLICATE,
          model: modelData(host),
        };
        const summary =
          `${ids.length} shots; mean neighbour similarity ${data.neighbour_similarity.given} as given, ${data.neighbour_similarity.look_order} in look_order (${data.look_order.join(", ")}). ` +
          (near.length > 0 ? `Near-duplicates: ${near.map((p) => `${p.a}~${p.b} (${p.similarity})`).join(", ")}.` : "No near-duplicates.");
        return unchanged(SIMILAR, summary, { data });
      }),
  }),
];
