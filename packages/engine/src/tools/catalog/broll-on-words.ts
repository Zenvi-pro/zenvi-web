/**
 * insert_broll_on_words_tool: transcript-keyed B-roll. Cutaways of 0.8-1.5 s
 * land on the words a viewer wants to see (broll-words.ts, or the keywords
 * given), one every 5-8 s, each from a different source: media-bin footage
 * (a file whose name, tags or summary mention the word first, then, with
 * the shot model installed, the file whose picture best shows it, from that
 * moment), or stock found for each word (gather_stock_footage_tool). The inserts go on a free
 * track above the speaker, muted, so the speaker's sound runs under them.
 * One undo step for the imports and the inserts.
 */

import { z } from "zod";
import { wordKey } from "../../analysis/align.js";
import { ProjectDocument } from "../../history/document.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { patchClip } from "../../ops/internal.js";
import { addTrack } from "../../ops/tracks.js";
import { pickBrollWords } from "../broll-words.js";
import { findShotMoments, installedEmbeddings, type ShotMoment } from "../shots.js";
import { directTool, type CatalogTool } from "../define.js";
import { projectFps, toFrame, toSeconds } from "../frame-time.js";
import { applied, refused, type ToolReceipt } from "../receipt.js";
// A cycle (the registry lists this tool), safe because runTool is only called while a tool runs.
import { runTool } from "../registry.js";
import { constantKeyframe, isLocked, uiTrackNumber } from "../titles-text.js";
import { findPhrase, speakingClips, timelineWords, type TimelineWord } from "../timeline-words.js";
import { fileOfClip, isTalkingFootage } from "../transcripts.js";
import { applyProjectState } from "./master-loop.js";

const TOOL = "insert_broll_on_words_tool";
const MAX_INSERTS = 20;
/** Cutaways skip the first second of a source: stock takes often start with a camera move settling. */
const SOURCE_LEAD = 1;

const input = z.strictObject({
  timeline_clip_ids: z.array(z.string().min(1)).min(1).max(20).optional().describe("The speaker's clips (A-roll) to cut away from (default: every clip with picture and sound)."),
  keywords: z.array(z.string().min(1).max(80)).min(1).max(MAX_INSERTS).optional().describe("Words or short phrases to cut away on, each at its first time said (default: picked from the speech: names, places, things, numbers)."),
  file_ids: z.array(z.string().min(1)).min(1).max(60).optional().describe("B-roll files from the media bin (default: the bin's footage and stills that are not the speaker's)."),
  stock: z.boolean().optional().describe("Find stock footage for each word instead (gather_stock_footage_tool: one Pexels search per word)."),
  count: z.number().int().min(1).max(MAX_INSERTS).optional().describe("Most inserts (default: one per 6.5 s of speech)."),
  duration_seconds: z.number().min(0.4).max(4).optional().describe("Each cutaway's length (default 1.2; 0.8-1.5 reads as a cutaway, longer as a scene)."),
  min_gap_seconds: z.number().min(1).max(30).optional().describe("Seconds between inserts (default 5; the next lands within 3 s more when a word allows)."),
  language: z.string().max(16).optional().describe("Speech language when a clip has to be transcribed (auto by default)."),
});
type Input = z.output<typeof input>;

function isPicture(file: ProjectFile): boolean {
  const type = String(file.media_type ?? "").toLowerCase();
  return type === "video" || type === "image" || (type !== "audio" && file.has_video === true);
}

/** Words a file is known by: its name, tags and summary. */
function fileWords(file: ProjectFile): Set<string> {
  const ai = (file.ai_metadata ?? {}) as Record<string, unknown>;
  const text = [file.name, file.path, ai.tags, ai.short_summary].filter((v) => typeof v === "string").join(" ");
  return new Set(text.split(/[^\p{L}\p{N}]+/u).map(wordKey).filter(Boolean));
}

/** Seconds a file's picture lasts (stills: as long as asked). */
function fileSeconds(file: ProjectFile): number {
  if (String(file.media_type ?? "").toLowerCase() === "image") return Number.POSITIVE_INFINITY;
  return Number(file.duration) || 0;
}

/** A track above `layer` with nothing over any of `spans`, else undefined. */
function freeTrackAbove(project: Project, layer: number, spans: readonly [number, number][]): number | undefined {
  const above = project.layers.filter((l) => l.number > layer && !isLocked(project, l.number)).sort((a, b) => a.number - b.number);
  return above.find((l) => {
    const clips = project.clips.filter((c) => c.layer === l.number);
    return spans.every(([s, e]) => clips.every((c) => {
      const cs = Number(c.position) || 0;
      const ce = cs + (Number(c.end) || 0) - (Number(c.start) || 0);
      return ce <= s + 1e-6 || cs >= e - 1e-6;
    }));
  })?.number;
}

export const brollOnWordsTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Insert B-roll on words",
    description:
      "Cut away from a speaker to B-roll on the words a viewer wants to see (names, places, things, numbers; or the keywords you give), one cutaway every 5-8 s, 0.8-1.5 s each, never the same source twice: " +
      "footage from the media bin (a file whose name or tags mention the word goes there; with the shot model installed, the file whose picture shows it best, from that moment), or stock found for each word (stock=true). " +
      "The inserts go muted on a free track above the speaker, so the speaker keeps talking under them. Transcribes footage that has no transcript. One undo step.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (call, args: Input): Promise<ToolReceipt> => {
      const project = call.doc.project;
      let aroll: Clip[];
      if (args.timeline_clip_ids) {
        const unknown = args.timeline_clip_ids.find((id) => !project.clips.some((c) => c.id === id));
        if (unknown) return refused(TOOL, `Error: unknown timeline clip ${unknown}.`);
        aroll = project.clips.filter((c) => args.timeline_clip_ids!.includes(c.id));
      } else {
        // Footage whose speech is known (a transcript, index cues) is the speaker; other footage with sound may be B-roll.
        const talking = (clips: Clip[]): Clip[] =>
          clips.filter((c) => {
            const file = fileOfClip(project, c);
            return file !== undefined && isTalkingFootage(file);
          });
        aroll = talking(speakingClips(project));
        if (aroll.length === 0) aroll = talking(project.clips);
      }
      if (aroll.length === 0) return refused(TOOL, "Error: no clip on the timeline has picture and sound; pass timeline_clip_ids (the speaker's clips).");
      const speakerFiles = new Set(aroll.map((c) => String(c.file_id ?? "")));
      let pool: ProjectFile[] = [];
      if (!args.stock) {
        pool = args.file_ids ? project.files.filter((f) => args.file_ids!.includes(String(f.id))) : project.files.filter((f) => isPicture(f) && !speakerFiles.has(String(f.id)));
        const missing = args.file_ids?.find((id) => !project.files.some((f) => String(f.id) === id));
        if (missing) return refused(TOOL, `Error: unknown file ${missing}.`);
        pool = pool.filter((f) => isPicture(f) && !speakerFiles.has(String(f.id)));
        if (pool.length === 0) return refused(TOOL, "Error: the media bin has no B-roll (footage or stills other than the speaker's); import some, pass file_ids, or pass stock=true.");
      }

      const heard = await timelineWords(call, aroll, args.language);
      if (heard.words.length === 0) {
        const why = heard.failures[0]?.message;
        return refused(TOOL, `Error: no spoken words found in the speaker's clips${why ? ` (${why})` : ""}.`);
      }
      const fps = projectFps(project);
      const duration = args.duration_seconds ?? 1.2;
      const speechStart = heard.words[0]!.start;
      const speechEnd = heard.words[heard.words.length - 1]!.end;
      const minGap = Math.max(args.min_gap_seconds ?? 5, duration + 0.5);
      const warnings = [...new Set(heard.warnings)];
      let words: TimelineWord[];
      if (args.keywords) {
        words = [];
        for (const k of args.keywords) {
          const hit = findPhrase(heard.words, k).find((h) => words.every((w) => Math.abs(w.start - h.start) >= duration));
          if (hit) words.push(heard.words[hit.index]!);
          else warnings.push(`"${k}" is not said in the speaker's clips`);
        }
        words.sort((a, b) => a.start - b.start);
      } else {
        const count = args.count ?? Math.max(1, Math.round((speechEnd - speechStart) / 6.5));
        words = pickBrollWords(heard.words, { minGap, maxGap: minGap + 3, notBefore: speechStart + 1.5, maxCount: Math.min(count, MAX_INSERTS) });
      }
      if (args.count) words = words.slice(0, args.count);
      if (!args.stock && words.length > pool.length) {
        warnings.push(`${words.length - pool.length} cutaway(s) dropped: only ${pool.length} B-roll source(s), and none repeats`);
        words = words.slice(0, pool.length);
      }
      if (words.length === 0) return refused(TOOL, "Error: no word to cut away on; pass keywords.");

      // From the project as it is now: transcribing kept the words heard on their files (outside the history).
      const scratch = new ProjectDocument(structuredClone(call.doc.project));
      // Stock: one search per word, each word gets its own clip.
      const byWord = new Map<TimelineWord, ProjectFile>();
      // The moment of a file that shows the word (shot model): the cutaway plays from there.
      const shown = new Map<TimelineWord, ShotMoment>();
      if (args.stock) {
        const queries = words.map((w) => w.text.replace(/[^\p{L}\p{N}' -]/gu, ""));
        const got = (await runTool({ doc: scratch, host: call.host, signal: call.signal }, "gather_stock_footage_tool", { queries, count: words.length, min_seconds: duration + SOURCE_LEAD })).data;
        if (got?.status !== "applied") return refused(TOOL, `Error: no stock footage: ${(got?.summary ?? "the stock search failed").replace(/^Error:\s*/, "")}`);
        const rows = ((got.data as { files?: { file_id: string; query: string }[] }).files ?? []).slice();
        for (const [i, w] of words.entries()) {
          const at = rows.findIndex((r) => r.query === queries[i]);
          const row = at >= 0 ? rows.splice(at, 1)[0]! : rows.shift();
          const file = row ? scratch.project.files.find((f) => String(f.id) === row.file_id) : undefined;
          if (file) byWord.set(w, file);
        }
      } else {
        const left = [...pool];
        const seen = await installedEmbeddings(call, pool);
        for (const w of words) {
          // A file that mentions the word, else the one whose picture shows it best (shot model), else the next unused one.
          let at = left.findIndex((f) => fileWords(f).has(w.key));
          if (at < 0 && seen && seen.size > 0) {
            const [best] = await findShotMoments(call, call.host.shots!, left, seen, `a photo of ${w.text}`, { limit: 1, perFile: 1 });
            if (best) {
              at = left.indexOf(best.file);
              shown.set(w, best);
            }
          }
          const file = left.splice(at >= 0 ? at : 0, 1)[0];
          if (file) byWord.set(w, file);
        }
      }

      const plan = words.flatMap((w) => {
        const file = byWord.get(w);
        if (!file) return [];
        const speaker = aroll.find((c) => c.id === w.clipId)!;
        const speakerEnd = (Number(speaker.position) || 0) + (Number(speaker.end) || 0) - (Number(speaker.start) || 0);
        const start = toSeconds(toFrame(w.start, fps), fps);
        const moment = shown.get(w);
        let lead = fileSeconds(file) >= duration + SOURCE_LEAD ? SOURCE_LEAD : 0;
        let length = Math.min(duration, speakerEnd - start, fileSeconds(file) - lead);
        if (moment) {
          // Centred on the moment that shows the word, inside the file.
          length = Math.min(duration, speakerEnd - start, fileSeconds(file));
          lead = Math.max(0, Math.min(moment.peak - length / 2, fileSeconds(file) - length));
        }
        if (!(length >= 0.2)) return [];
        return [{ word: w, file, start, length: toSeconds(toFrame(length, fps), fps), lead, layer: speaker.layer }];
      });
      if (plan.length === 0) return refused(TOOL, "Error: no cutaway fits: the sources are too short or the words fall at the speaker clips' ends.");

      const inserted = scratch.transaction("insert B-roll", (tx) => {
        const lowest = Math.max(...plan.map((p) => p.layer));
        let track = freeTrackAbove(tx.project, lowest, plan.map((p) => [p.start, p.start + p.length]));
        if (track === undefined) track = addTrack(tx, { above: lowest, label: "B-roll" }).number;
        return plan.map((p) => {
          const clip = addClip(tx, { fileId: String(p.file.id), position: p.start, layer: track!, start: p.lead, end: p.lead + p.length });
          patchClip(tx, clip.id, { volume: constantKeyframe(0), has_audio: constantKeyframe(0) });
          return { clipId: clip.id, track: track!, ...p };
        });
      });
      call.commit((tx) => applyProjectState(tx, scratch.project), `Insert B-roll on words (${inserted.length})`);
      const trackNumber = uiTrackNumber(call.doc.project, inserted[0]!.track) ?? inserted[0]!.track;
      const rows = inserted.map((p) => ({
        clip_id: p.clipId,
        word: p.word.text,
        at: Math.round(p.start * 1000) / 1000,
        seconds: Math.round(p.length * 1000) / 1000,
        file_id: String(p.file.id),
        source: p.file.name ?? p.file.path,
        source_in: Math.round(p.lead * 1000) / 1000,
        ...(shown.has(p.word) ? { picked_by: "picture", match: Math.round(shown.get(p.word)!.match * 1000) / 1000 } : {}),
      }));
      return applied(
        TOOL,
        [`Inserted ${rows.length} B-roll cutaway(s) on track ${trackNumber}, muted:`, ...rows.map((r) => `  ${r.at.toFixed(2)}s "${r.word}" ${r.seconds}s  file_id=${r.file_id}  clip_id=${r.clip_id}`)].join("\n"),
        { warnings, data: { inserts: rows, track: trackNumber, created: rows.map((r) => r.clip_id) } },
      );
    },
  }),
];
