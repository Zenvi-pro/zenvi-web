/**
 * detect_music_structure_tool: a song's form as snap points (TECHNIQUES2
 * T073 cutting on phrases and chorus beat 1, T076 starting the track on its
 * drop). The analysis is analysis/structure.ts on audio the host decodes;
 * add_markers=true writes one timeline marker per section start (native
 * markers: the desktop shows them too).
 */

import { z } from "zod";
import type { MusicSection, MusicStructure, SectionLabel } from "../../analysis/structure.js";
import type { Clip, ProjectFile } from "../../model/types.js";
import { addMarker, type MarkerColor } from "../../ops/markers.js";
import { structureOfFile } from "../beats.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import { isRetimed } from "../speech.js";
import { fileById } from "./common.js";
import { clipTitle, gridOf, r3 } from "./timeline-edit-common.js";

const TOOL = "detect_music_structure_tool";

const MARKER_COLOR: Record<SectionLabel, MarkerColor> = {
  intro: "white",
  verse: "blue",
  pre_chorus: "yellow",
  chorus: "red",
  build: "yellow",
  drop: "orange",
  bridge: "purple",
  breakdown: "purple",
  outro: "white",
};

const input = z.strictObject({
  clip_id: z.string().min(1).optional().describe("Timeline music clip: times are timeline seconds, only the part the clip plays."),
  file_id: z.string().min(1).optional().describe("Media-bin music file: times are seconds into the file (where to trim it so it starts on the drop)."),
  bpm: z.number().min(40).max(240).optional().describe("The tempo when you know it (detect_beats_tool's other octave, or the song's BPM); the bars follow it."),
  add_markers: z.boolean().optional().describe("clip_id only: add a timeline marker at each section start, named by its label and part letter (one undo step; markers already there are kept)."),
});

type Input = z.infer<typeof input>;

interface Shown {
  sections: MusicSection[];
  drops: MusicStructure["drops"];
  phrases: number[];
  dips: MusicStructure["dips"];
}

/** The structure on the timeline clock, cut to what `clip` plays. */
function onTimeline(found: MusicStructure, clip: Clip): Shown {
  const shift = clip.position - clip.start;
  const from = clip.position;
  const to = clip.position + clip.end - clip.start;
  const inside = (t: number) => t >= from - 1e-6 && t < to - 1e-6;
  return {
    sections: found.sections
      .map((s) => ({ ...s, start: r3(Math.max(from, s.start + shift)), end: r3(Math.min(to, s.end + shift)) }))
      .filter((s) => s.end - s.start > 1e-6),
    drops: found.drops.map((d) => ({ ...d, timeSec: r3(d.timeSec + shift) })).filter((d) => inside(d.timeSec)),
    phrases: found.phrases.map((t) => r3(t + shift)).filter(inside),
    dips: found.dips.map((d) => ({ start: r3(Math.max(from, d.start + shift)), end: r3(Math.min(to, d.end + shift)) })).filter((d) => d.end > d.start),
  };
}

export const musicStructureTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Detect music structure",
    description:
      "A song's form as snap points: sections (intro, verse, pre_chorus, chorus, build, drop, bridge, breakdown, outro) on bar lines with a part letter (same letter = the same part repeating) and level, " +
      "drops (where the bass slams back in: start a withheld track there on a hard cut, T076), phrase starts every four bars (cut on phrases and chorus beat 1, T073) and dips (vocal rests and stops: where a reset lands). " +
      "Labels are a reading of harmony and levels; trust the letters when a label looks wrong. clip_id gives timeline seconds; file_id gives file seconds. add_markers=true marks each section start on the timeline (one undo step). " +
      "For the beat grid use detect_beats_tool; for transients detect_onsets_tool.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call, args: Input) => {
      const project = call.doc.project;
      if (!args.clip_id === !args.file_id) return refused(TOOL, "Error: give clip_id or file_id (one of them).");
      if (args.add_markers && !args.clip_id) return refused(TOOL, "Error: add_markers needs clip_id: markers sit on the timeline.");
      let clip: Clip | undefined;
      let file: ProjectFile | undefined;
      if (args.clip_id) {
        clip = project.clips.find((c) => String(c.id) === args.clip_id);
        if (!clip) return refused(TOOL, `Error: No timeline clip with id='${args.clip_id}'.`);
        if (isRetimed(clip as unknown as Record<string, unknown>)) return refused(TOOL, `Error: ${clipTitle(clip)} is retimed; read its file instead (file_id=${String(clip.file_id)}).`);
        file = fileById(project, String(clip.file_id ?? ""));
        if (!file) return refused(TOOL, `Error: ${clipTitle(clip)} has no media file.`);
      } else {
        file = fileById(project, args.file_id!);
        if (!file) return refused(TOOL, `Error: Unknown file_id '${args.file_id}'.`);
      }
      if (!call.host.audio?.decodePcm) return unavailable(TOOL, "this surface cannot decode audio (the CLI, zenvi mcp and Zenvi Cloud can).");
      const found = await structureOfFile(call, file, args.bpm ? { bpm: args.bpm } : {});
      if (typeof found === "string") return failed(TOOL, found);
      if (found.sections.length === 0) return failed(TOOL, `Error: ${String(file.name ?? file.id)} has no music to read (silent or too short).`);
      const shown: Shown = clip ? onTimeline(found, clip) : found;
      const warnings: string[] = [];
      if (found.barSeconds === 0) warnings.push("No steady beat: sections are read in 2 s blocks, not bars, and phrases are not musical phrases.");
      if (found.confidence < 0.4) warnings.push(`Low confidence (${found.confidence}): listen before cutting to these sections.`);
      const form = shown.sections.map((s) => `${s.label} ${s.group} ${s.start.toFixed(1)}`).join(", ");
      const where = clip ? `${clipTitle(clip)} (timeline seconds)` : `${String(file.name ?? file.id)} (file seconds)`;
      const summary =
        `${shown.sections.length} section(s) in ${where}: ${form}` +
        (shown.drops.length ? `; drop(s) at ${shown.drops.map((d) => d.timeSec.toFixed(2)).join(", ")} s` : "") +
        `; ${found.bpm} BPM, ${shown.phrases.length} phrase start(s).`;
      const data = {
        ...(clip ? { timeline_clip_id: clip.id } : { file_id: file.id }),
        clock: clip ? "timeline" : "file",
        bpm: found.bpm,
        beats_per_bar: found.beatsPerBar,
        bar_seconds: found.barSeconds,
        confidence: found.confidence,
        sections: shown.sections.map((s) => ({ ...s, frame: Math.round(s.start * gridOf(project).fps) })),
        drops: shown.drops,
        phrases: shown.phrases,
        dips: shown.dips,
      };
      if (!args.add_markers) return applied(TOOL, summary, { warnings, data }, 0);

      const g = gridOf(project);
      const name = (s: MusicSection) => `${s.label.replace("_", " ")} ${s.group}`;
      const missing = shown.sections.filter((s) => !project.markers.some((m) => Math.abs(Number(m.position) - g.snap(s.start)) < g.tol && m.label === name(s)));
      if (missing.length === 0) return unchanged(TOOL, `${summary} The section markers are already there.`, { warnings, data: { ...data, markerIds: [] } });
      const markerIds = call.commit(
        (tx) => missing.map((s) => addMarker(tx, g.snap(s.start), name(s), { vector: MARKER_COLOR[s.label], icon: `${MARKER_COLOR[s.label]}.png` }).id),
        "Mark music sections",
      );
      return applied(TOOL, `${summary} Marked ${markerIds.length} section start(s).`, { warnings, data: { ...data, markerIds } });
    },
  }),
];
