/**
 * build_explainer_tool: an explainer led by its voice-over in one call. The
 * voice plays whole; the picture is B-roll from start to end, cut on the
 * keywords that name a bin picture and at the pauses (builders/explainer.ts);
 * a hook title opens it, chapter cards sit in the pauses, spoken numbers and
 * the caller's data become counters and charts (Zenvi Motion blocks, or a
 * kinetic title where blocks cannot render), captions follow the voice, the
 * music sits under it. One undo step; the receipt lists every decision.
 */

import { z } from "zod";
import { CAPTION_STYLE_IDS } from "../../../captions/styles.js";
import type { CaptionWord } from "../../../captions/words.js";
import { EXPLAINER_PACES, numberSlots, planChapters, planExplainerShots, type ExplainerPace } from "../../../builders/explainer.js";
import { planKeywordBroll } from "../../../builders/keywords.js";
import { addClip } from "../../../ops/clips.js";
import { applyClipPreset } from "../../../ops/presets.js";
import { directTool, type CatalogTool } from "../../define.js";
import { FINISH_HINT } from "../../director-card.js";
import { refused } from "../../receipt.js";
import { displayName, visualKind } from "../reels.js";
import { binPictures, givenKeywords, keywordFileProblem, keywordMedia, keywordsArg, occupied, pickMusic, pickVoice, pictureProblem, replaceArg, voiceActivity, voiceWords } from "./common.js";
import { Composer, binOf, builderTracks, clearTimeline, placeBed, placeShot, round3 } from "./compose.js";

const TOOL = "build_explainer_tool";
/** Reading pace of a script with no voice, seconds per word (about 150 words a minute). */
const SCRIPT_WORD_SECONDS = 0.4;
const CHAPTER_SECONDS = 1.6;
const DATA_SECONDS = 3.5;

const dataSlot = z.strictObject({
  kind: z.enum(["counter", "chart", "map"]).describe("counter: a number counting up; chart: a bar chart that builds; map: a place (no map block in this build: a place title stands in)."),
  at_seconds: z.number().min(0).optional().describe("Timeline time it appears (default: when at_word is said, else spread over the edit)."),
  at_word: z.string().min(1).max(40).optional().describe("Appear when the voice says this word (its first use)."),
  title: z.string().max(80).optional().describe("The chart's title, the counter's label, or the place name."),
  values: z.array(z.string().max(16)).max(12).optional().describe("chart: the bar values; counter: the value to count to (or from, to)."),
  labels: z.array(z.string().max(24)).max(12).optional().describe("chart: the bar labels."),
  prefix: z.string().max(4).optional(),
  suffix: z.string().max(4).optional(),
});

const input = z.strictObject({
  voice_file_id: z.string().min(1).optional().describe("The voice-over in the media bin (audio, or footage whose sound is the voice). Default: the audio named like a voice (vo, voiceover, narration, tts), else the only audio that is not the music."),
  script: z.string().max(6000).optional().describe("No voice-over yet: the script; the edit is timed at reading pace (about 150 words a minute) and the captions show it."),
  duration_seconds: z.number().min(4).max(600).optional().describe("Use only the start of the voice: it ends at the last pause before this many seconds (default: the whole voice)."),
  broll_file_ids: z.array(z.string().min(1)).max(60).optional().describe("Bin videos and images for the picture, in story order. Default: every video and image in the bin but the voice's."),
  keywords: keywordsArg,
  pace: z
    .enum(Object.keys(EXPLAINER_PACES) as [ExplainerPace, ...ExplainerPace[]])
    .optional()
    .describe("documentary (default): a new shot every 0.6-1.6 s on the phrases (the documentary references); essay: 2-4.5 s holds for a calmer video essay."),
  grade: z.string().min(1).optional().describe("A look over every shot, laid on matched plates (unify_grade_tool look at 0.6): a list_looks_tool id, default elegant_dark_cinema; none keeps the footage as it is."),
  hook: z.string().max(80).optional().describe("Opening title over the first sentence: the question or promise, 2-8 words."),
  chapters: z.array(z.string().min(1).max(60)).max(8).optional().describe("Chapter titles in order: each card sits in the pause nearest where its chapter should start."),
  data: z.array(dataSlot).max(6).optional().describe("Counters, charts and places to show while the voice talks about them."),
  auto_numbers: z.boolean().optional().describe("Turn spoken numbers (40%, 2,400) into counters when no data slot is near (default true; at most two)."),
  captions: z.enum([...CAPTION_STYLE_IDS, "none"]).optional().describe("Caption style for the voice (default documentary: a phrase at a time on the lower safe line), or none."),
  music_file_id: z.string().min(1).optional().describe("Music bed under the voice. Default: the longest other audio file in the bin; none when there is none."),
  music_level: z.number().min(0).max(1).optional().describe("The bed's level under the voice, linear (default 0.18, about -15 dB)."),
  replace: replaceArg,
});
type Input = z.infer<typeof input>;

export const explainerTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Build an explainer",
    description:
      "Cut a finished explainer, documentary or video essay led by its voice-over in one step: the voice whole, B-roll cut on the keywords that name a picture and at the pauses (slow push-ins), " +
      "a hook title, chapter cards in the pauses, counters and charts for the numbers (Zenvi Motion blocks; a kinetic title where blocks cannot render), captions, a music bed under the voice. One undo step; " +
      "data.decisions lists every step, its arguments and why, and every fallback. Put the voice, the B-roll and the music in the bin first. " +
      FINISH_HINT,
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const files = binOf(project);
      const busy = occupied(project, args.replace);
      if (busy) return refused(TOOL, busy);
      if (args.voice_file_id && !files.has(args.voice_file_id)) return refused(TOOL, `Error: unknown voice_file_id ${args.voice_file_id}.`);
      // Without a script the voice leads, so it is found first (a lone narration not named like one is the voice, not the bed); a script means there may be no voice yet, so the music is.
      const voiceFirst = args.voice_file_id ? files.get(args.voice_file_id) : args.script?.trim() ? undefined : pickVoice(project, args.music_file_id);
      const music0 = pickMusic(project, args.music_file_id, voiceFirst ? String(voiceFirst.id) : undefined);
      if (typeof music0 === "string") return refused(TOOL, music0);
      const voice = voiceFirst ?? (args.voice_file_id ? undefined : pickVoice(project, music0 ? String(music0.id) : undefined));
      const music = music0 && voice && String(music0.id) === String(voice.id) ? undefined : music0;
      if (voice && !voice.has_audio) return refused(TOOL, `Error: ${voice.id} has no sound to lead the explainer.`);
      if (!voice && !args.script?.trim()) {
        return refused(TOOL, "Error: no voice-over: pass voice_file_id (a bin audio file), or a script to time the edit at reading pace.");
      }
      const brollIds = args.broll_file_ids ?? binPictures(project, new Set(voice ? [String(voice.id)] : [])).map((f) => String(f.id));
      const problem = pictureProblem(project, brollIds, "broll_file_ids");
      if (problem) return refused(TOOL, problem);
      if (brollIds.length === 0) return refused(TOOL, "Error: the bin has no videos or images for the picture. Import B-roll first.");
      const keywordProblem = keywordFileProblem(project, args.keywords);
      if (keywordProblem) return refused(TOOL, keywordProblem);
      const fps = Number(project.fps?.num) / Number(project.fps?.den || 1) || 30;

      // The words: the voice's (kept, indexed or transcribed), else the script at reading pace.
      const notes: string[] = [];
      let words: CaptionWord[] = [];
      let wordSource = "script";
      if (voice) {
        const got = await voiceWords(call, voice);
        if ("error" in got) {
          const spoken = args.script?.trim() ? null : await voiceActivity(call, voice);
          if (spoken) {
            words = spoken.map((w) => ({ text: w.text, start: w.startSec, end: w.endSec }));
            wordSource = "voice activity (no words)";
            notes.push(`The voice's words could not be read (${got.error}): the cuts follow its pauses, with no keyword B-roll, spoken numbers or captions. Pass the script for those.`);
          } else if (!args.script?.trim()) {
            return refused(TOOL, `Error: the voice's words are needed to cut on its keywords and pauses: ${got.error}. Pass the script to time it by length.`);
          } else notes.push(`The voice's words could not be read (${got.error}): the script is spread over the voice by length.`);
        } else {
          words = got.words.map((w) => ({ text: w.text, start: w.startSec, end: w.endSec }));
          wordSource = got.exact ? got.source : `${got.source} (estimated timings)`;
        }
      }
      const voiceLength = voice ? Number(voice.duration) || 0 : 0;
      if (words.length === 0) {
        const tokens = args.script!.trim().split(/\s+/);
        const per = voice && voiceLength > 0 ? voiceLength / tokens.length : SCRIPT_WORD_SECONDS;
        words = tokens.map((text, i) => ({ text, start: round3(i * per), end: round3(i * per + per * 0.9) }));
      }
      if (args.duration_seconds !== undefined) {
        // The voice ends on a pause: the last word that ends before the limit with a gap (or the end) after it.
        const limit = args.duration_seconds - 0.4;
        let keep = words.findLastIndex((w, i) => w.end <= limit && (i + 1 === words.length || words[i + 1]!.start - w.end >= 0.25));
        if (keep < 0) keep = words.findLastIndex((w) => w.end <= limit);
        if (keep >= 0 && words[keep]!.end >= args.duration_seconds * 0.75 && keep + 1 < words.length) {
          notes.push(`The voice is cut after "${words[keep]!.text || "a phrase"}" at ${round3(words[keep]!.end)} s, the last pause before ${args.duration_seconds} s.`);
          words = words.slice(0, keep + 1);
        } else if (words[words.length - 1]!.end > args.duration_seconds) {
          // No pause late enough (a long phrase, or loudness-only phrases): cut at the length asked, mid-phrase.
          notes.push(`No pause in the voice near ${args.duration_seconds} s: it is cut there, mid-phrase.`);
          words = words.filter((w) => w.start < args.duration_seconds! - 0.2).map((w) => ({ ...w, end: Math.min(w.end, args.duration_seconds!) }));
        }
      }
      if (words.length === 0) return refused(TOOL, `Error: the voice says nothing in its first ${args.duration_seconds} s: pass a longer duration_seconds.`);
      const duration = Math.round(Math.min(voice ? voiceLength : Infinity, words[words.length - 1]!.end + 0.8, args.duration_seconds ?? Infinity) * fps) / fps;

      const pictures = brollIds.map((id) => files.get(id)!);
      const pace = EXPLAINER_PACES[args.pace ?? "documentary"];
      // A keyword only places its cut: the shot holds as the pace allows, so the hits keep apart by the pace too.
      const hits = planKeywordBroll(words, keywordMedia(pictures), givenKeywords(args.keywords), { minStart: 0, minGap: 0.2, minHold: pace.min, maxHold: pace.max, until: duration });
      const matched = new Set(hits.map((h) => h.fileId));
      const fill = brollIds.filter((id) => !matched.has(id));
      const shots = planExplainerShots(duration, words, hits, fill.length > 0 ? fill : brollIds, fps, args.pace ?? "documentary");

      const c = new Composer(call, TOOL);
      const placed = c.edit("picture", `${shots.length} B-roll shots over the ${round3(duration)} s voice: ${hits.length} on keywords, the rest at pauses`, (tx) => {
        if (args.replace) clearTimeline(tx);
        const [voiceTrack, musicTrack, pictureTrack] = builderTracks(tx, 3) as [number, number, number];
        const voiceClip = voice ? addClip(tx, { fileId: String(voice.id), position: 0, layer: voiceTrack, start: 0, end: duration, title: displayName(voice) }).id : null;
        const bed = music ? placeBed(tx, String(music.id), Math.min(duration, Number(music.duration) || duration), musicTrack, args.music_level ?? 0.18, [], displayName(music)) : null;
        const uses = new Map<string, number>();
        const clips = shots.map((s) => {
          const file = files.get(s.fileId)!;
          const n = uses.get(s.fileId) ?? 0;
          uses.set(s.fileId, n + 1);
          const length = s.end - s.start;
          // A picture shown again plays on from where it stopped (wrapping), not the same frames.
          const media = Number(file.duration) || 0;
          const from = visualKind(file) === "video" && media > length ? ((n * length) % Math.max(1e-6, media - length)) : 0;
          const id = placeShot(tx, file, { position: s.start, length: visualKind(file) === "video" ? Math.min(length, media || length) : length, sourceStart: from, layer: pictureTrack });
          applyClipPreset(tx, id, visualKind(file) === "image" ? "animate.ken_burns_in" : "animate.cam_push_in");
          return id;
        });
        return { voiceClip, bed, clips, tracks: { voice: voiceTrack, music: musicTrack, picture: pictureTrack } };
      });
      if (!music) c.skip("music", "no music in the bin: the voice plays alone");

      const firstPause = words.findIndex((w, i) => i > 0 && w.start - words[i - 1]!.end > 0.3);
      const hookHold = args.hook?.trim() ? Math.max(2, Math.min(3.5, firstPause > 0 ? words[firstPause]!.start : 3)) : 0;
      const chapters = planChapters(args.chapters ?? [], words, duration, hookHold > 0 ? hookHold + 0.2 : 0);
      if (args.hook?.trim()) {
        const hold = hookHold;
        await c.run("hook", "add_kinetic_title_tool", { text: args.hook, position_seconds: 0.2, duration_seconds: round3(hold), style: "editorial" }, "the promise over the first sentence, before the first cut");
      }

      for (const [i, slot] of chapters.entries()) {
        await c.run(`chapter ${i + 1}`, "add_kinetic_title_tool", { text: slot.title, position_seconds: round3(slot.at), duration_seconds: CHAPTER_SECONDS, style: "editorial", animation: "rise", y: 0.2 }, `chapter card in the pause at ${round3(slot.at)} s`);
        // A topic change lands on a low hit (the documentary references).
        await c.run(`chapter ${i + 1} hit`, "add_sfx_tool", { recipe: "impact_thud", at_seconds: round3(slot.at), gain_db: -14, seed: i + 1 }, "a low impact on the topic change");
      }

      // Data: the caller's slots, then spoken numbers nowhere near one.
      const wordAt = (word: string | undefined) => {
        if (!word) return undefined;
        const bare = word.toLowerCase();
        return words.find((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "") === bare.replace(/[^\p{L}\p{N}%]/gu, ""))?.start;
      };
      const given = args.data ?? [];
      const slots = given.map((d, i) => ({ ...d, at: d.at_seconds ?? wordAt(d.at_word) ?? round3(((i + 1) * duration) / (given.length + 1)) }));
      if (args.auto_numbers !== false) {
        for (const n of numberSlots(words)) {
          if (slots.some((s) => Math.abs(s.at - n.at) < 6)) continue;
          slots.push({ kind: "counter", at: n.at, values: ["0", n.value], prefix: n.prefix, suffix: n.suffix, title: "" });
        }
      }
      for (const [i, slot] of slots.entries()) {
        const at = round3(Math.min(Math.max(0, slot.at), Math.max(0, duration - DATA_SECONDS)));
        const step = `data ${i + 1} (${slot.kind})`;
        const label = slot.title ?? "";
        const stand = `${slot.prefix ?? ""}${slot.values?.[slot.values.length - 1] ?? ""}${slot.suffix ?? ""}`;
        if (slot.kind === "map") {
          c.skip(step, "this build has no map block");
          await c.fallback(step, "a map of the place", "add_kinetic_title_tool", { text: label || "here", position_seconds: at, duration_seconds: DATA_SECONDS, style: "editorial" }, "the place named in type while the voice talks about it");
          continue;
        }
        const params =
          slot.kind === "chart"
            ? { kind: "bar", title: label, values: slot.values ?? [], labels: slot.labels ?? [], prefix: slot.prefix ?? "", suffix: slot.suffix ?? "" }
            : { values: slot.values && slot.values.length > 0 ? slot.values : ["0"], prefix: slot.prefix ?? "", suffix: slot.suffix ?? "", label };
        const block = await c.run(step, "add_motion_block_tool", { block: slot.kind === "chart" ? "chart_build" : "counter", params, position_seconds: at, duration_seconds: DATA_SECONDS, placement: "over_video" }, `the number on screen while it is said (${round3(at)} s)`);
        if (!block && (stand || label)) {
          await c.fallback(step, `a ${slot.kind === "chart" ? "chart_build" : "counter"} motion block`, "add_kinetic_title_tool", { text: [stand, label].filter(Boolean).join(" "), position_seconds: at, duration_seconds: DATA_SECONDS, style: "creator" }, "the number in kinetic type instead");
        }
      }

      const captionStyle = args.captions ?? "documentary";
      if (captionStyle === "none") c.skip("captions", "captions=none");
      else if (wordSource.startsWith("voice activity")) c.skip("captions", "no words to show: speech recognition is not available here and no script was given");
      else if (placed.voiceClip) {
        const got = await c.run("captions", "kinetic_captions_tool", { timeline_clip_ids: [placed.voiceClip], style: captionStyle, animation: "rise", placement: "style" }, "the voice's words on the lower safe line");
        if (!got && args.script?.trim()) {
          await c.fallback("captions", "captions from the voice", "kinetic_captions_tool", { cues: words.map((w) => ({ text: w.text, start: w.start, end: w.end })), style: captionStyle, placement: "style" }, "the script, timed by length over the voice");
        }
      } else {
        await c.run("captions", "kinetic_captions_tool", { cues: words.map((w) => ({ text: w.text, start: w.start, end: w.end })), style: captionStyle, placement: "style" }, "no voice yet: the script at reading pace");
      }

      const look = args.grade?.trim() || "elegant_dark_cinema";
      if (look === "none") c.skip("grade", "grade=none");
      else await c.run("grade", "unify_grade_tool", { timeline_clip_ids: placed.clips, look, look_intensity: 0.6 }, "the B-roll matched to one plate, then a dark slightly desaturated look over it");

      c.suggest("auto_sound_design_tool", { genre: "documentary" }, "soft whooshes on the cuts and hits under the cards and counters");
      c.suggest("master_audio_tool", { preset: "social", iterate: true }, "the voice on top, the bed under it, the loudness set last");
      c.followStyle("video-essay-explainer");
      if (c.call.signal?.aborted) return c.abandon("cancelled; nothing changed");
      return c.finish(
        "Build explainer",
        `Built an explainer: ${round3(duration)} s on the ${voice ? "voice-over" : "script"}, ${shots.length} B-roll shots (${hits.length} on keywords), ${(args.chapters ?? []).length} chapter card(s), ${slots.length} data slot(s).`,
        {
          category: "explainer",
          duration,
          word_source: wordSource,
          voice_file_id: voice ? String(voice.id) : null,
          music_file_id: music ? String(music.id) : null,
          tracks: placed.tracks,
          voice_clip_id: placed.voiceClip,
          shots: shots.map((s, i) => ({ clip_id: placed.clips[i], file_id: s.fileId, start: s.start, end: s.end, cue: s.cue, ...(s.keyword ? { keyword: s.keyword } : {}) })),
          keywords: hits.map((h) => ({ word: h.text, at: round3(h.start), file_id: h.fileId, source: h.source })),
          chapters: chapters.map((s) => ({ title: s.title, at: round3(s.at) })),
        },
        { notes },
      );
    },
  }),
];
