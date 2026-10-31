/**
 * build_talking_head_tool: a creator talking head in one call. The takes
 * lose their pauses (jump cuts) and every jump cut changes the framing
 * (builders/speaker.ts); the strongest words get a hard punch-in; B-roll cuts
 * in on the words that name a bin picture (builders/keywords.ts); the hook
 * sits behind the speaker (a subject matte) or, without one, over them;
 * kinetic captions with emphasis words follow the speech. One undo step; the
 * receipt lists every decision and fallback.
 */

import { z } from "zod";
import { CAPTION_STYLE_IDS } from "../../../captions/styles.js";
import { planKeywordBroll, punchWords } from "../../../builders/keywords.js";
import { planSpeakerCut, type SpeakerTake } from "../../../builders/speaker.js";
import { Interpolation } from "../../../model/types.js";
import { setClipKeyframes } from "../../../ops/clips.js";
import { applyClipPreset } from "../../../ops/presets.js";
import { directTool, type CatalogTool } from "../../define.js";
import { FINISH_HINT } from "../../director-card.js";
import { refused } from "../../receipt.js";
import { isTalkingFootage } from "../../transcripts.js";
import { displayName, visualKind } from "../reels.js";
import { binPictures, givenKeywords, keywordFileProblem, keywordMedia, keywordsArg, occupied, pickMusic, pictureProblem, replaceArg, voiceActivity, voiceWords } from "./common.js";
import { Composer, binOf, builderTracks, clearTimeline, placeBed, placeShot, round3 } from "./compose.js";

const TOOL = "build_talking_head_tool";
/** The alternate framing: a second camera 1.4x tighter (the creator talking-head references: 1.4-1.5x every other piece). */
const PUNCH = 1.4;

const input = z.strictObject({
  speaker_file_ids: z.array(z.string().min(1)).min(1).max(12).optional().describe("The takes of the speaker, in order. Default: every bin video with sound."),
  broll_file_ids: z.array(z.string().min(1)).max(40).optional().describe("Bin videos and images to cut to on keywords. Default: every other video and image in the bin."),
  keywords: keywordsArg,
  hook: z.string().max(40).optional().describe("One to three huge words for the opening, set behind the speaker (needs a subject matte; else over them)."),
  caption_style: z.enum([...CAPTION_STYLE_IDS, "none"]).optional().describe("Caption style (default creator: word by word, emphasis words huge in the accent), or none."),
  emphasis: z.union([z.string(), z.array(z.string())]).optional().describe("Caption emphasis: auto (default), none, or the words to emphasise."),
  remove_pauses: z.boolean().optional().describe("Jump-cut the pauses longer than 0.45 s out of each take (default true)."),
  punch_in: z.number().min(1).max(1.6).optional().describe("Scale of the alternate framing on every jump cut, a second camera (default 1.4; 1: no alternation)."),
  word_punch: z.boolean().optional().describe("A hard punch-in on numbers and strongly stressed words said on the wide framing, at most one every 4 s (default true)."),
  music_file_id: z.string().min(1).optional().describe("Music bed under the speech. Default: the longest audio file in the bin; none when there is none."),
  music_level: z.number().min(0).max(1).optional().describe("The bed's level under the speech, linear (default 0.12, about -18 dB)."),
  replace: replaceArg,
});
type Input = z.infer<typeof input>;

export const talkingHeadTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Build a talking head",
    description:
      "Cut a finished creator talking-head video in one step from the speaker's takes: pauses jump-cut out with the framing changing on every cut, hard punch-ins on the strongest words, " +
      "B-roll on the words that name a bin picture, the hook behind the speaker (with a subject matte; else over them), kinetic captions with emphasis words, a music bed under the speech. One undo step; " +
      "data.decisions lists every step, its arguments and why, and every fallback. " +
      FINISH_HINT,
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const files = binOf(project);
      const busy = occupied(project, args.replace);
      if (busy) return refused(TOOL, busy);
      const speakerIds = args.speaker_file_ids ?? project.files.filter((f) => isTalkingFootage(f) && visualKind(f) === "video" && !f.zenvi_role).map((f) => String(f.id));
      if (speakerIds.length === 0) return refused(TOOL, "Error: no speaker footage: import the talking-head takes (video with sound) or pass speaker_file_ids.");
      const problem = pictureProblem(project, speakerIds, "speaker_file_ids");
      if (problem) return refused(TOOL, problem);
      const silent = speakerIds.filter((id) => !files.get(id)!.has_audio);
      if (silent.length > 0) return refused(TOOL, `Error: these takes have no sound to cut on: ${silent.join(", ")}.`);
      const brollIds = args.broll_file_ids ?? binPictures(project, new Set(speakerIds)).map((f) => String(f.id));
      const brollProblem = pictureProblem(project, brollIds, "broll_file_ids");
      if (brollProblem) return refused(TOOL, brollProblem);
      const keywordProblem = keywordFileProblem(project, args.keywords);
      if (keywordProblem) return refused(TOOL, keywordProblem);
      const music = pickMusic(project, args.music_file_id);
      if (typeof music === "string") return refused(TOOL, music);
      const fps = Number(project.fps?.num) / Number(project.fps?.den || 1) || 30;

      // Each take's words, read before the scratch copy (a transcription kept now is in it).
      const notes: string[] = [];
      const takes: SpeakerTake[] = [];
      for (const id of speakerIds) {
        const file = files.get(id)!;
        const got = await voiceWords(call, file);
        // No words: the pauses still come from the take's loudness, so the jump cuts survive (captions, keywords and punch-ins do not).
        const spoken = "error" in got ? await voiceActivity(call, file) : null;
        if ("error" in got) notes.push(`${displayName(file)}: ${got.error}; ${spoken ? "its pauses are cut from its loudness, with no keyword B-roll, punch-ins or captions of its words" : "it plays whole, with no jump cuts, keyword B-roll or punch-ins"}.`);
        takes.push({ fileId: id, duration: Number(file.duration) || 0, words: "error" in got ? spoken ?? [] : got.words });
      }
      // Without pause removal each take is one window (its words still drive captions, B-roll and punch-ins).
      const keepAll = args.remove_pauses === false;
      const cut = planSpeakerCut(takes, keepAll ? { fps, maxPause: Infinity, pad: Infinity, punch: 1 } : { fps, punch: args.punch_in ?? PUNCH });
      const words = cut.words;
      const pictures = brollIds.map((id) => files.get(id)!);
      // A cutaway's phrase ends at the jump cut where its pause was.
      const breaks = cut.segments.slice(1).map((s) => s.position);
      // Inserts of 0.8-1.5 s, one every 5-8 s at most (the references: median 1.1 s, 14-20 % of the runtime).
      const hits = planKeywordBroll(words, keywordMedia(pictures), givenKeywords(args.keywords), { until: cut.duration, breaks, minHold: 0.8, maxHold: 1.5, minGap: 4 });
      const punches = args.word_punch === false ? [] : punchWords(words).filter((i) => !hits.some((h) => words[i]!.start >= h.start - 0.2 && words[i]!.start < h.end));

      const c = new Composer(call, TOOL);
      const placed = c.edit(
        "speaker cuts",
        `${cut.segments.length} segment(s) from ${takes.length} take(s), ${round3(cut.removed)} s of pauses and dead air cut, the framing alternating 1 / ${args.punch_in ?? PUNCH} on each jump cut`,
        (tx) => {
          if (args.replace) clearTimeline(tx);
          const [speakerTrack, brollTrack, musicTrack] = builderTracks(tx, 3) as [number, number, number];
          const clips = cut.segments.map((s) => {
            const id = placeShot(tx, files.get(s.fileId)!, { position: s.position, length: s.sourceEnd - s.sourceStart, sourceStart: s.sourceStart, layer: speakerTrack, volume: 1 });
            if (s.scale !== 1) {
              for (const prop of ["scale_x", "scale_y"]) setClipKeyframes(tx, id, prop, [{ time: s.position, value: s.scale, interpolation: Interpolation.CONSTANT }], { mode: "merge" });
            }
            return id;
          });
          // A hard punch on the word: a constant step, so it reads as a cut to a tighter shot.
          const punched = punches.flatMap((i) => {
            const w = words[i]!;
            const k = cut.segments.findIndex((s) => w.start >= s.position && w.start < s.position + (s.sourceEnd - s.sourceStart));
            if (k < 0) return [];
            const s = cut.segments[k]!;
            const at = Math.round(w.start * fps) / fps;
            // Only the wide framing cuts tighter on the word; a punched-in piece is already the close shot.
            if (at - s.position < 0.25 || s.scale !== 1) return [];
            for (const prop of ["scale_x", "scale_y"]) {
              setClipKeyframes(
                tx,
                clips[k]!,
                prop,
                [
                  { time: s.position, value: s.scale, interpolation: Interpolation.CONSTANT },
                  { time: at, value: args.punch_in ?? PUNCH, interpolation: Interpolation.CONSTANT },
                ],
                { mode: "merge" },
              );
            }
            return [{ word: w.text, at: round3(at), clip_id: clips[k]! }];
          });
          const broll = hits.map((h) => {
            const file = files.get(h.fileId)!;
            const media = Number(file.duration) || 0;
            const length = visualKind(file) === "video" && media > 0 ? Math.min(h.end - h.start, media) : h.end - h.start;
            const from = visualKind(file) === "video" && media > length + 0.4 ? 0.2 : 0;
            const id = placeShot(tx, file, { position: Math.round(h.start * fps) / fps, length: Math.round(length * fps) / fps, sourceStart: from, layer: brollTrack });
            applyClipPreset(tx, id, visualKind(file) === "image" ? "animate.ken_burns_in" : "animate.cam_push_in");
            return id;
          });
          const bed = music ? placeBed(tx, String(music.id), Math.min(cut.duration, Number(music.duration) || cut.duration), musicTrack, args.music_level ?? 0.12, [], displayName(music)) : null;
          return { clips, punched, broll, bed, tracks: { speaker: speakerTrack, broll: brollTrack, music: musicTrack } };
        },
      );
      if (hits.length === 0) c.skip("b-roll", brollIds.length === 0 ? "no B-roll in the bin" : "no spoken word names a B-roll picture (pass keywords to choose)");
      if (!music) c.skip("music", "no music in the bin: the speech plays alone");

      const first = placed.clips[0]!;
      const firstEnd = cut.segments[0] ? cut.segments[0].position + (cut.segments[0].sourceEnd - cut.segments[0].sourceStart) : 0;
      if (args.hook?.trim()) {
        const behind = await c.run("hook", "text_behind_subject_tool", { clip_id: first, text: args.hook.toUpperCase() }, "the hook set behind the speaker on the first shot");
        if (!behind) {
          await c.fallback("hook", "text behind the subject", "add_kinetic_title_tool", { text: args.hook, position_seconds: 0, duration_seconds: round3(Math.max(0.8, Math.min(2.5, firstEnd))), style: "stack", animation: "slam" }, "no subject matte here: the hook slams in over the speaker");
        }
      }

      // One whip up on the jump cut nearest two thirds in, clear of the B-roll (the creator references' one camera move).
      const cuts = cut.segments.slice(1).map((s, i) => ({ at: s.position, out: placed.clips[i]!, in: placed.clips[i + 1]! }));
      const clear = cuts.filter((k) => !hits.some((h) => k.at > h.start - 0.3 && k.at < h.end + 0.3));
      const whip = clear.sort((a, b) => Math.abs(a.at - cut.duration * 0.66) - Math.abs(b.at - cut.duration * 0.66))[0];
      if (whip) await c.run("whip", "apply_motion_transition_tool", { preset: "whip", clip1_id: whip.out, clip2_id: whip.in, direction: "up" }, `one whip up on the jump cut at ${round3(whip.at)} s`);
      else c.skip("whip", cuts.length === 0 ? "one segment: no jump cut to whip on" : "every jump cut is under a B-roll cutaway");

      const captionStyle = args.caption_style ?? "creator";
      if (captionStyle === "none") c.skip("captions", "caption_style=none");
      else {
        await c.run(
          "captions",
          "kinetic_captions_tool",
          { timeline_clip_ids: placed.clips, style: captionStyle, ...(args.emphasis !== undefined ? { emphasis: args.emphasis } : {}), ...(args.hook?.trim() ? { start_seconds: round3(Math.min(firstEnd, 2.5)) } : {}) },
          "the speech word by word, emphasis words huge, off the speaker's head",
        );
      }

      c.suggest("auto_sound_design_tool", { genre: "talking_head" }, "a whoosh into each B-roll cut and a hit under each punch-in");
      c.suggest("master_audio_tool", { preset: "social", iterate: true }, "the speech on top, the loudness set last");
      await c.followStyle("talking-head-captions");
      return c.finish(
        "Build talking head",
        `Built a talking head: ${round3(cut.duration)} s from ${takes.length} take(s), ${cut.segments.length} segment(s) (${round3(cut.removed)} s cut), ${placed.punched.length} word punch-in(s), ${placed.broll.length} B-roll cutaway(s).`,
        {
          category: "talking_head",
          duration: cut.duration,
          tracks: placed.tracks,
          segments: cut.segments.map((s, i) => ({ clip_id: placed.clips[i], file_id: s.fileId, start: s.position, source_start: s.sourceStart, source_end: s.sourceEnd, scale: s.scale })),
          punch_ins: placed.punched,
          broll: hits.map((h, i) => ({ clip_id: placed.broll[i], word: h.text, file_id: h.fileId, start: round3(h.start), end: round3(h.end), source: h.source })),
          music_file_id: music ? String(music.id) : null,
        },
        { notes },
      );
    },
  }),
];
