/**
 * build_trailer_tool: a three-act trailer in one call (builders/trailer.ts
 * plans it): the world in long faded shots, the trouble at half that, a
 * climax whose every shot is shorter than the last, a riser into a beat of
 * silence on black, the title on a braam, the end card. Title cards on black
 * between the acts; braams (a low boom and a sub drop together) open act two,
 * the climax and the title. The cinematic look and slow push-ins of
 * build_reel_tool's cinematic style on every shot. One undo step; the receipt
 * lists every decision.
 */

import { z } from "zod";
import { planTrailer } from "../../../builders/trailer.js";
import { Interpolation } from "../../../model/types.js";
import { setClipKeyframes } from "../../../ops/clips.js";
import { applyLookPreset } from "../../../ops/look.js";
import { applyClipPreset } from "../../../ops/presets.js";
import { REEL_STYLES } from "../../../reels/styles.js";
import { directTool, type CatalogTool } from "../../define.js";
import { FINISH_HINT } from "../../director-card.js";
import { refused } from "../../receipt.js";
import { displayName, usableRange, visualKind } from "../reels.js";
import { binPictures, musicGrid, occupied, pickMusic, pictureProblem, replaceArg } from "./common.js";
import { Composer, binOf, builderTracks, clearTimeline, placeBed, placeShot, round3 } from "./compose.js";

const TOOL = "build_trailer_tool";
/** Act one dips each shot to black: the world, unhurried. */
const ACT1_DIP = 0.3;

const input = z.strictObject({
  file_ids: z.array(z.string().min(1)).min(1).max(80).optional().describe("Bin videos and images in story order. Default: every video and image in the bin."),
  title: z.string().min(1).max(60).describe("The title card after the silence (the film, the product, the event)."),
  act_cards: z.array(z.string().min(1).max(60)).max(2).optional().describe("Up to two cards on black between the acts (e.g. 'THIS SUMMER', 'ONE CHANCE')."),
  end_card: z.string().max(80).optional().describe("The last card: a date, a URL, 'coming soon'."),
  duration_seconds: z.number().min(15).max(120).optional().describe("Target length, seconds (default 40)."),
  music_file_id: z.string().min(1).optional().describe("Score in the bin. Default: the longest audio file; none when there is none."),
  braams: z.boolean().optional().describe("Braams on act two, the climax and the title, a riser into the silence (default true)."),
  look: z.enum(["cinematic", "none"]).optional().describe("cinematic (default): lifted shadows, 35mm grain and slow push-ins on every shot; none: the footage as it is."),
  replace: replaceArg,
});
type Input = z.infer<typeof input>;

export const trailerTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Build a trailer",
    description:
      "Cut a finished three-act trailer in one step: the world in long faded shots, the trouble at half that, a climax whose cuts get faster and faster, a riser into a beat of silence on black, " +
      "the title on a braam, act cards on black between the acts, an end card, the score under it falling silent before the title. Cuts in acts two and three land on the music's beats when it can be tracked. One undo step; " +
      "data.decisions lists every step and every fallback. " +
      FINISH_HINT,
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const files = binOf(project);
      const busy = occupied(project, args.replace);
      if (busy) return refused(TOOL, busy);
      const ids = args.file_ids ?? binPictures(project).map((f) => String(f.id));
      const problem = pictureProblem(project, ids, "file_ids");
      if (problem) return refused(TOOL, problem);
      if (ids.length === 0) return refused(TOOL, "Error: the bin has no videos or images to cut. Import footage first.");
      const music = pickMusic(project, args.music_file_id);
      if (typeof music === "string") return refused(TOOL, music);
      const fps = Number(project.fps?.num) / Number(project.fps?.den || 1) || 30;
      const seconds = args.duration_seconds ?? 40;
      const grid = await musicGrid(call, music, 100, seconds);

      const plan = planTrailer({ media: ids.length, seconds, fps, title: args.title, actCards: args.act_cards ?? [], ...(args.end_card ? { endCard: args.end_card } : {}), beats: music && grid.source.startsWith("the music") ? grid.beats : [] });
      const notes: string[] = [];
      if (music && Number(music.duration) < plan.duration) notes.push(`The score (${round3(Number(music.duration))} s) is shorter than the trailer (${round3(plan.duration)} s): the end plays without it.`);
      if (ids.length < plan.shots.length / 2) notes.push(`${plan.shots.length} shots from ${ids.length} file(s): files come back with later footage each time; import more for a richer climax.`);

      const style = REEL_STYLES.cinematic;
      const c = new Composer(call, TOOL);
      const placed = c.edit("three acts", `${plan.shots.length} shots: act one ${plan.shots.filter((s) => s.act === 1).length}, act two ${plan.shots.filter((s) => s.act === 2).length}, the climax ${plan.shots.filter((s) => s.act === 3).length} getting faster`, (tx) => {
        if (args.replace) clearTimeline(tx);
        const [musicTrack, pictureTrack] = builderTracks(tx, 2) as [number, number];
        const uses = new Map<number, number>();
        const clips = plan.shots.map((s) => {
          const file = files.get(ids[s.media]!)!;
          const length = s.end - s.start;
          const n = uses.get(s.media) ?? 0;
          uses.set(s.media, n + 1);
          // A file used again plays later footage (wrapping inside its usable range).
          const [lo, hi] = visualKind(file) === "video" ? usableRange(file) : [0, 0];
          const span = Math.max(0, hi - lo - length);
          const from = span > 0 ? lo + ((n * 1.7 + s.act * 0.9) % span) : lo;
          const id = placeShot(tx, file, { position: s.start, length: visualKind(file) === "video" ? Math.min(length, Math.max(1 / fps, hi - from)) : length, sourceStart: from, layer: pictureTrack });
          if (args.look !== "none") {
            applyClipPreset(tx, id, visualKind(file) === "image" ? style.motion.image! : style.motion.video!);
            for (const preset of style.looks) applyLookPreset(tx, id, preset);
          }
          if (s.act === 1) {
            const dip = Math.min(ACT1_DIP, length / 4);
            setClipKeyframes(
              tx,
              id,
              "alpha",
              [
                { time: s.start, value: 0, interpolation: Interpolation.LINEAR },
                { time: s.start + dip, value: 1, interpolation: Interpolation.LINEAR },
                { time: s.end - dip, value: 1, interpolation: Interpolation.LINEAR },
                { time: s.end, value: 0, interpolation: Interpolation.LINEAR },
              ],
              { mode: "merge" },
            );
          }
          return id;
        });
        const bed = music ? placeBed(tx, String(music.id), Math.min(plan.duration, Number(music.duration) || plan.duration), musicTrack, 0.9, [plan.silence], displayName(music)) : null;
        return { clips, bed, tracks: { music: musicTrack, picture: pictureTrack } };
      });
      if (!music) c.skip("score", "no music in the bin: the trailer has only its braams and risers");

      for (const card of plan.cards) {
        const step = card.kind === "act" ? `act card "${card.text}"` : card.kind === "title" ? "title" : "end card";
        await c.run(
          step,
          "add_kinetic_title_tool",
          {
            text: card.text,
            position_seconds: round3(card.start),
            duration_seconds: round3(card.end - card.start),
            style: card.kind === "end" ? "documentary" : "stack",
            animation: card.kind === "title" ? "slam" : "fade",
            background: "#000000",
            ...(card.kind === "act" ? { emphasis: "none" } : {}),
          },
          card.kind === "title" ? "the title lands on the braam after the silence" : card.kind === "act" ? "a card on black between the acts" : "the last card",
        );
      }

      if (args.braams === false) c.skip("braams", "braams=false");
      else {
        for (const [i, at] of plan.braams.entries()) {
          const what = i === plan.braams.length - 1 ? "title" : i === 0 ? "act two" : "the climax";
          await c.run(`braam ${what}`, "add_sfx_tool", { recipe: "impact_boom", at_seconds: round3(at), pitch: -7, brightness: 0.2, intensity: 0.95, seed: i + 1 }, `the low hit that opens ${what}`);
          await c.run(`braam ${what} (sub)`, "add_sfx_tool", { recipe: "sub_drop", at_seconds: round3(at), seed: i + 1 }, "the sub under the braam");
        }
        const [from, to] = plan.riser;
        if (to - from >= 1) await c.run("riser", "add_sfx_tool", { recipe: "riser_tonal", at_seconds: round3(to), duration: round3(Math.min(8, to - from)) }, "the climax rises into the silence and stops dead");
      }

      c.suggest("auto_sound_design_tool", { genre: "hype", climax_seconds: round3(plan.silence[0]) }, "whooshes and hits on the climax's cuts (the braams are placed)");
      c.suggest("master_audio_tool", { preset: "social", iterate: true }, "the loudness set last");
      return c.finish(
        "Build trailer",
        `Built a trailer: ${round3(plan.duration)} s, ${plan.shots.length} shots in three acts, the climax from ${round3(plan.shots.find((s) => s.act === 3)!.end - plan.shots.find((s) => s.act === 3)!.start)} s shots down to ${round3(Math.min(...plan.shots.filter((s) => s.act === 3).map((s) => s.end - s.start)))} s, silence at ${round3(plan.silence[0])} s, the title at ${round3(plan.silence[1])} s.`,
        {
          category: "trailer",
          duration: plan.duration,
          beat_source: grid.source,
          tracks: placed.tracks,
          acts: plan.acts.map((a) => ({ ...a, shots: plan.shots.filter((s) => s.act === a.act).length })),
          shots: plan.shots.map((s, i) => ({ clip_id: placed.clips[i], file_id: ids[s.media], act: s.act, start: s.start, end: s.end })),
          cards: plan.cards,
          silence: plan.silence,
          braams: plan.braams,
          music_file_id: music ? String(music.id) : null,
        },
        { notes },
      );
    },
  }),
];
