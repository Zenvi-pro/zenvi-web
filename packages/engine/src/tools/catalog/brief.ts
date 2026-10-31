/**
 * The brief compiler's tools (plugins/zenvi/skills/zenvi-styles/BRIEF.md):
 * inspect_media_bin_tool (what the person gave us, one line a file),
 * save_brief_tool (the creative brief on the project, one undo step) and
 * get_brief_tool (the brief and how the edit measures against it).
 */

import { z } from "zod";
import { BRIEF_KEY, briefSchema, briefShape, briefSummary, readBrief, type Brief } from "../../brief/brief.js";
import { checkBrief } from "../../brief/check.js";
import { coverageLines, footageCoverage } from "../../brief/coverage.js";
import { houseDraw, houseStyle } from "../../brief/house.js";
import { methodProblems } from "../../brief/method.js";
import {
  brightnessOf,
  dominantColors,
  frameChange,
  inventoryEntry,
  inventoryFiles,
  inventoryLine,
  meanLuma,
  motionLevel,
  soundLevel,
  type InventoryEntry,
} from "../../brief/inventory.js";
import { decodePngBase64 } from "../../io/png.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import type { ProjectFile } from "../../model/types.js";
import type { RgbaImage } from "../../render/types.js";
import { musicSearchFromText } from "../../stock/music.js";
import { MUSIC_MIN_DURATION } from "../audio-mix.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { fitSize, singleFileProject } from "../media-frames.js";
import { applied, refused, unchanged } from "../receipt.js";
import { mediaPathOf } from "../transcripts.js";

const INSPECT = "inspect_media_bin_tool";
const SAVE = "save_brief_tool";
const GET = "get_brief_tool";
/** Frames are measured this small: colours and motion need no detail. */
const MEASURE_EDGE = 48;
/** The second frame of the motion pair, seconds after the first. */
const MOTION_GAP = 0.4;

const inspectInput = z.strictObject({
  measure: z
    .boolean()
    .optional()
    .describe("false lists only what the project already knows (default true: one or two 48 px frames per picture file for colours and motion, and an RMS pass per sound file for energy, where this surface can)."),
  max_files: z.number().int().min(1).max(200).optional().describe("Most files listed (default 60), newest import last."),
});
type InspectInput = z.output<typeof inspectInput>;

async function frameAt(call: ToolCall, file: ProjectFile, seconds: number): Promise<RgbaImage | null> {
  const frames = call.host.frames;
  if (!frames) return null;
  try {
    const scratch = singleFileProject(call.doc.project, file);
    const [width] = fitSize(scratch.width, scratch.height, MEASURE_EDGE);
    const png = await frames.renderFrame(scratch, seconds, { width, format: "png" });
    return png.mimeType === "image/png" ? decodePngBase64(png.data) : null;
  } catch (error) {
    call.host.log?.(`${INSPECT}: frame ${seconds}s of ${String(file.id)} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Colours, brightness and energy the host can measure; the entry as it was where it cannot. */
async function measured(call: ToolCall, file: ProjectFile, entry: InventoryEntry): Promise<InventoryEntry> {
  const out = { ...entry };
  if (entry.kind === "video" || entry.kind === "image" || entry.kind === "motion" || entry.kind === "3d" || entry.kind === "fx") {
    const seconds = entry.seconds ?? 0;
    const at = seconds > 0 ? Math.max(0, seconds / 2 - MOTION_GAP / 2) : 0;
    const first = await frameAt(call, file, at);
    if (first) {
      if (out.colors.length === 0) out.colors = dominantColors(first);
      out.brightness = brightnessOf(meanLuma(first));
      if (seconds > MOTION_GAP * 2 && entry.kind !== "image") {
        const second = await frameAt(call, file, at + MOTION_GAP);
        if (second) out.energy = motionLevel(frameChange(first, second));
      }
    }
  } else if (entry.kind === "music" || entry.kind === "voice" || entry.kind === "sfx" || entry.kind === "audio") {
    const analyze = call.host.audio?.analyzeAudio;
    const path = mediaPathOf(file);
    if (analyze && path) {
      try {
        out.energy = soundLevel((await analyze.call(call.host.audio, path, { signal: call.signal })).rms);
      } catch (error) {
        call.host.log?.(`${INSPECT}: audio of ${String(file.id)} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return out;
}

/** What the bin says about the plan, in a few words each. */
function hints(entries: readonly InventoryEntry[]): string[] {
  const footage = entries.filter((e) => e.kind === "video" || e.kind === "image");
  const out: string[] = [];
  if (footage.length === 0) out.push("No footage or photos: every shot comes from stock, AI generation, motion blocks or 3D.");
  else {
    const portrait = footage.filter((e) => e.orientation === "portrait").length;
    const landscape = footage.filter((e) => e.orientation === "landscape").length;
    if (portrait > landscape) out.push(`${portrait} of ${footage.length} picture files are portrait: 9:16 fits them without crops.`);
    else if (landscape > portrait) out.push(`${landscape} of ${footage.length} picture files are landscape: 16:9 fits them; 9:16 crops to the subject.`);
  }
  if (!entries.some((e) => e.kind === "music")) out.push("No music in the bin: the brief picks a tempo and one track is fetched (search_freesound_music_tool).");
  if (entries.some((e) => e.speech === "yes")) out.push("Someone speaks: the voice is the clock, captions come from it.");
  return out;
}

const saveInput = z.strictObject({
  ...briefShape,
  check_method: z.boolean().optional().describe("true lists where the brief falls short of the motif method at any length (default: from 20 s)."),
});
type SaveInput = z.output<typeof saveInput>;
/** Beat ends may round past length_seconds by this much. */
const BEAT_SLACK = 0.05;

function sameBrief(a: Brief | null, b: Brief): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

/** The brief's check as receipt lines. */
function checkLines(call: ToolCall, brief: Brief): { lines: string[]; check: ReturnType<typeof checkBrief> } {
  const check = checkBrief(call.doc.project, brief);
  const lines: string[] = [];
  if (call.doc.project.clips.length === 0) return { lines, check };
  const used = check.techniques.filter((t) => t.status === "used").length;
  lines.push(`Against the edit: ${check.beats.filter((b) => b.hit).length}/${check.beats.length} beats start on a picture change, ${used}/${check.techniques.length} techniques on the timeline.`);
  for (const miss of check.misses) lines.push(`BRIEF: ${miss.message}`);
  return { lines, check };
}

export const briefTools: CatalogTool[] = [
  directTool({
    name: INSPECT,
    title: "Inspect the media bin",
    description:
      "Step 0 of a whole video, before the brief: one compact line per media-bin file - kind (video, image, music, voice, sfx, title, motion, 3d), seconds, orientation and size, speech yes/no/unknown, faces, dominant colours, brightness, energy, the indexer's summary and how often it is on the timeline - plus what the bin means for the plan (aspect, missing music, a voice to caption). " +
      "Reads what the project knows and measures colours and energy from tiny frames; costs a few hundred tokens. Changes nothing.",
    input: inspectInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call, args: InspectInput) => {
      const project = call.doc.project;
      const files = inventoryFiles(project);
      const limit = args.max_files ?? 60;
      const listed = files.slice(Math.max(0, files.length - limit));
      const entries: InventoryEntry[] = [];
      for (const file of listed) {
        if (call.signal?.aborted) break;
        const entry = inventoryEntry(project, file);
        entries.push(args.measure === false ? entry : await measured(call, file, entry));
      }
      const counts = new Map<string, number>();
      for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      const tally = [...counts].map(([kind, n]) => `${n} ${kind}`).join(", ");
      const advice = hints(entries);
      const text = [
        files.length === 0 ? "The media bin is empty." : `${files.length} file${files.length === 1 ? "" : "s"} in the bin (${tally})${listed.length < files.length ? `, the newest ${listed.length} listed` : ""}:`,
        ...entries.map((e) => `- ${inventoryLine(e)}`),
        ...advice,
        "Next: compile the brief (zenvi-styles BRIEF.md) and save it with save_brief_tool.",
      ].join("\n");
      return applied(INSPECT, text, { data: { files: entries, total: files.length, hints: advice } }, 0);
    },
  }),
  directTool({
    name: SAVE,
    title: "Save the creative brief",
    description:
      "Save the creative brief compiled from the person's prompt and the media inventory (zenvi-styles BRIEF.md): goal, platform, aspect, length, ONE style id from the styles index, up to 4 borrowed techniques with reasons and tools, the hook, the beats with timings, " +
      "8-12 motifs with one through-line, a storyboard (start, beats, picture, motif, source, composition, text_entrance, tone, transition, one climax) that does not repeat itself, the reskin test, a creative-direction draw of 3+ axes, type, palette, music, sound, captions, end card, the style's checklist and what the self-critique changed. " +
      "Only goal, platform, aspect, length_seconds, style, hook and beats are required (beats in order, each ending by length_seconds); the rest is advice: from 20 s, or with check_method=true, the receipt lists where the plan falls short of the motif method. " +
      "If you never save one, the first cut saves a minimal brief for you (auto). " +
      "Replaces the saved brief (one undo step); review_edit_tool, render receipts and get_brief_tool then check the edit against it. Never invent brand facts: list them in missing.",
    input: saveInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call, args: SaveInput) => {
      const { check_method: checkMethod, auto: _auto, ...fields } = args;
      let brief = briefSchema.parse(fields);
      // A house style keeps the draw it was given (the auto brief's, same style); else it draws now, away from recent films.
      let drawn = false;
      if (!brief.draw && houseStyle(brief.style)) {
        const before = readBrief(call.doc.project);
        const kept = before?.draw && before.style === brief.style ? before.draw : null;
        const draw = kept ?? houseDraw({ style: brief.style, aspect: brief.aspect, seconds: brief.length_seconds, text: `${brief.goal}\n${brief.hook}`, avoid: (await call.host.draws?.recent().catch(() => [])) ?? [], brand: brief.brand });
        if (draw) brief = { ...brief, draw };
        drawn = !kept && Boolean(draw);
      }
      let previous: { name: string; start: number } | undefined;
      for (const beat of brief.beats) {
        if (beat.end <= beat.start) return refused(SAVE, `Error: beat "${beat.name}" ends at ${beat.end} s, not after its start ${beat.start} s.`);
        if (beat.end > brief.length_seconds + BEAT_SLACK) return refused(SAVE, `Error: beat "${beat.name}" ends at ${beat.end} s, past the brief's ${brief.length_seconds} s: end every beat by length_seconds (or raise it).`);
        if (previous && beat.start < previous.start) return refused(SAVE, `Error: beat "${beat.name}" starts at ${beat.start} s, before "${previous.name}" (${previous.start} s): list the beats in order.`);
        previous = beat;
      }
      const problems = methodProblems(brief, { force: checkMethod === true });
      const project = call.doc.project;
      // No music yet: the search that measures tempo and energy (round 7: agents searched by words and took the first drone).
      // A re-save of the same brief (an agent resuming) still gets it.
      const hasMusic = project.files.some((f) => isAudioOnlyMedia(f) && (Number(f.duration) || 0) >= MUSIC_MIN_DURATION);
      const musicSearch = !hasMusic && brief.music ? musicSearchFromText(brief.music, brief.length_seconds) : null;
      const musicLine = musicSearch ? [`No music in the bin: fetch it measured, search_freesound_music_tool ${JSON.stringify(musicSearch)}, and pick by bpm and curve.`] : [];
      if (sameBrief(readBrief(project), brief)) {
        return unchanged(SAVE, ["The project already has this brief; nothing changed.", ...musicLine].join("\n"), { data: { brief, ...(musicSearch ? { music_search: musicSearch } : {}) } });
      }
      const known = new Set(project.files.map((f) => String(f.id)));
      const unknownFiles = [...brief.shots, ...brief.storyboard].filter((s) => s.file_id && !known.has(s.file_id)).map((s) => s.file_id!);
      const warnings = unknownFiles.length > 0 ? [`Shot plan names files not in the bin: ${[...new Set(unknownFiles)].join(", ")} (inspect_media_bin_tool lists the ids).`] : [];
      if (problems.length > 0) warnings.push(`Advice, the motif method (BRIEF.md 4-6; saved anyway): ${problems.join(" ")}`);
      call.commit((tx) => tx.update(["settings"], { [BRIEF_KEY]: brief }), "Save brief");
      if (drawn && brief.draw) await call.host.draws?.remember(brief.draw.picks.map((p) => p.technique), call.doc.project.id).catch(() => undefined);
      const { lines } = checkLines(call, brief);
      const footage = footageCoverage(call.doc.project, brief);
      return applied(SAVE, [briefSummary(brief), ...lines, ...coverageLines(footage, call.doc.project), ...musicLine].join("\n"), { data: { brief, footage, ...(musicSearch ? { music_search: musicSearch } : {}) }, warnings });
    },
  }),
  directTool({
    name: GET,
    title: "Get the creative brief",
    description:
      "The creative brief saved with save_brief_tool, and how the edit measures against it: the project's frame and length, a picture change at each beat, each borrowed technique on the timeline, the shot list against the bin (shots your media covers, shots still to fetch or generate, with the one call for each) and the style's finish checklist to look for. Read it before each stage of a long edit and before you say done. Changes nothing.",
    input: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call) => {
      const brief = readBrief(call.doc.project);
      if (!brief) {
        return unchanged(GET, "No brief saved: inspect_media_bin_tool, compile the brief (zenvi-styles BRIEF.md, the zenvi_brief prompt), then save_brief_tool.", { data: { brief: null } });
      }
      const { lines, check } = checkLines(call, brief);
      const checklist = brief.checklist.length > 0 ? [`Checklist: ${brief.checklist.join(" · ")}`] : [];
      const footage = footageCoverage(call.doc.project, brief);
      return applied(GET, [briefSummary(brief), ...lines, ...coverageLines(footage, call.doc.project), ...checklist].join("\n"), { data: { brief, check, footage } }, 0);
    },
  }),
];
