/**
 * build_product_launch_tool: a launch film in one call, problem → reveal →
 * features → proof → end card, each section on the bar (builders/launch.ts).
 * The reveal is a 3D title (Zenvi 3D), else a kinetic headline block (Zenvi
 * Motion), else a native kinetic title, on a hit with a rise into it; the
 * features are glass cards over the product (a block), else one kinetic
 * title per feature; the proof a counter, else type; the end card the logo
 * reveal block, else the native end card template. One undo step; the
 * receipt says which of each it got and why.
 */

import { z } from "zod";
import { planLaunch, type LaunchSection } from "../../../builders/launch.js";
import { applyClipPreset } from "../../../ops/presets.js";
import { directTool, type CatalogTool } from "../../define.js";
import { FINISH_HINT } from "../../director-card.js";
import { refused } from "../../receipt.js";
import { displayName, visualKind } from "../reels.js";
import { binPictures, musicGrid, occupied, pickMusic, pictureProblem, replaceArg } from "./common.js";
import { Composer, binOf, builderTracks, clearTimeline, placeBed, placeShot, round3 } from "./compose.js";

const TOOL = "build_product_launch_tool";
/** The card colour under type when there is no footage. */
const BACKDROP = "#0b0b10";

const feature = z.union([
  z.string().min(1).max(60),
  z.strictObject({ title: z.string().min(1).max(40), detail: z.string().max(60).optional() }),
]);

const input = z.strictObject({
  product: z.string().min(1).max(40).describe("The product's name: the reveal and the end card."),
  problem: z.string().max(80).optional().describe("The pain it solves, one line (the opening). Default: no problem section."),
  tagline: z.string().max(80).optional().describe("The line under the reveal."),
  features: z.array(feature).min(1).max(5).describe("One per bar: a title, or {title, detail}, or 'Title: detail'."),
  proof: z
    .strictObject({ stat: z.string().max(12).optional(), label: z.string().max(60).optional(), quote: z.string().max(140).optional() })
    .optional()
    .describe("The proof: a stat that counts up (stat '2400', label 'teams'), or a short quote."),
  cta: z.string().max(60).optional().describe("End card call to action."),
  url: z.string().max(60).optional().describe("End card URL."),
  file_ids: z.array(z.string().min(1)).max(30).optional().describe("Product footage, screens and photos in order: the problem, the reveal, then one per feature and the proof. Default: every video and image in the bin."),
  logo_file_id: z.string().min(1).optional().describe("The logo (a bin image) for the end card."),
  three_d: z.enum(["auto", "title_3d", "logo_extrude", "device_mockup", "none"]).optional().describe("The reveal in 3D (Zenvi 3D, needs Blender): auto = title_3d with the product name; device_mockup shows the reveal's footage on a phone; none = no 3D."),
  music_file_id: z.string().min(1).optional().describe("Music to cut to. Default: the longest audio file in the bin; without music the sections follow 120 BPM."),
  replace: replaceArg,
});
type Input = z.infer<typeof input>;

function featureParts(f: z.infer<typeof feature>): { title: string; detail: string } {
  if (typeof f !== "string") return { title: f.title, detail: f.detail ?? "" };
  const [title, ...rest] = f.split(":");
  return { title: title!.trim(), detail: rest.join(":").trim() };
}

export const productLaunchTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Build a product launch",
    description:
      "Cut a finished product launch or SaaS promo in one step: the problem, the reveal (a 3D title, else a kinetic headline block, else kinetic type) on a hit, one feature per bar (glass cards over the product, else kinetic titles), " +
      "the proof (a counter, else type), the end card (logo reveal block, else the native end card), every section on the music's bar lines. One undo step; data.decisions lists what each section got and every fallback. " +
      FINISH_HINT,
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const files = binOf(project);
      const busy = occupied(project, args.replace);
      if (busy) return refused(TOOL, busy);
      if (args.logo_file_id && !files.has(args.logo_file_id)) return refused(TOOL, `Error: unknown logo_file_id ${args.logo_file_id}.`);
      const ids = args.file_ids ?? binPictures(project, new Set(args.logo_file_id ? [args.logo_file_id] : [])).map((f) => String(f.id));
      const problem = pictureProblem(project, ids, "file_ids");
      if (problem) return refused(TOOL, problem);
      const music = pickMusic(project, args.music_file_id);
      if (typeof music === "string") return refused(TOOL, music);
      const fps = Number(project.fps?.num) / Number(project.fps?.den || 1) || 30;
      const features = args.features.map(featureParts);
      const grid = await musicGrid(call, music, 120, 60);
      const plan = planLaunch({ features: features.length, hasProblem: Boolean(args.problem?.trim()), hasProof: Boolean(args.proof?.stat || args.proof?.quote), downbeats: grid.downbeats, fps });
      const notes: string[] = [];
      if (ids.length === 0) notes.push("No footage in the bin: every section is type and motion on a dark card.");

      // Which picture each section shows: the files in order, the end card has none (its block or template draws it).
      const shown = new Map<LaunchSection, string>();
      let next = 0;
      for (const s of plan.sections) if (s.kind !== "end" && ids.length > 0) shown.set(s, ids[next++ % ids.length]!);

      const c = new Composer(call, TOOL);
      const placed = c.edit("sections", plan.sections.map((s) => `${s.kind}${s.index !== undefined ? ` ${s.index + 1}` : ""} ${round3(s.start)}-${round3(s.end)} s`).join(", "), (tx) => {
        if (args.replace) clearTimeline(tx);
        const [musicTrack, pictureTrack] = builderTracks(tx, 2) as [number, number];
        const clips = new Map<LaunchSection, string>();
        for (const s of plan.sections) {
          const id = shown.get(s);
          if (!id) continue;
          const file = files.get(id)!;
          const length = s.end - s.start;
          const media = Number(file.duration) || 0;
          const clip = placeShot(tx, file, { position: s.start, length: visualKind(file) === "video" && media > 0 ? Math.min(length, media) : length, sourceStart: 0, layer: pictureTrack });
          applyClipPreset(tx, clip, visualKind(file) === "image" ? "animate.ken_burns_in" : "animate.cam_push_in");
          clips.set(s, clip);
        }
        const bed = music ? placeBed(tx, String(music.id), Math.min(plan.duration, Number(music.duration) || plan.duration), musicTrack, 0.9, [], displayName(music)) : null;
        return { clips, bed, tracks: { music: musicTrack, picture: pictureTrack } };
      });
      if (!music) c.skip("music", "no music in the bin: the sections follow 120 BPM in silence");
      const backdrop = (s: LaunchSection) => (shown.has(s) ? {} : { background: BACKDROP });
      const span = (s: LaunchSection) => ({ position_seconds: round3(s.start), duration_seconds: round3(s.end - s.start) });

      for (const s of plan.sections) {
        if (s.kind === "problem") {
          await c.run("problem", "add_kinetic_title_tool", { text: args.problem!, ...span(s), style: "documentary", ...backdrop(s) }, "the pain, quiet, before the reveal");
        } else if (s.kind === "reveal") {
          const mode = args.three_d ?? "auto";
          const revealFile = shown.get(s);
          let done = false;
          if (mode === "none") c.skip("reveal (3D)", "three_d=none");
          else {
            const scene = mode === "auto" ? "title_3d" : mode;
            const params =
              scene === "title_3d" ? { text: args.product } : scene === "logo_extrude" ? { text: args.product.slice(0, 24) } : { ...(revealFile && visualKind(files.get(revealFile)!) ? { file_id: revealFile } : {}), move: "hero" };
            done = Boolean(await c.run("reveal", "add_3d_scene_tool", { scene, params, ...span(s) }, `the product named in 3D (${scene}) on the reveal's downbeat`));
          }
          let headline = false;
          if (!done) {
            const insteadOf = mode === "none" ? "a 3D reveal (three_d=none)" : "a 3D reveal";
            headline = Boolean(
              await c.fallback("reveal", insteadOf, "add_motion_block_tool", { block: "kinetic_headline", params: { text: `*${args.product}*`, kicker: args.tagline ?? "", style: "rise" }, ...span(s), placement: shown.has(s) ? "over_video" : "full_frame" }, "the product name as a kinetic headline block"),
            );
            done = headline;
          }
          if (!done) await c.fallback("reveal", "a kinetic headline block", "add_kinetic_title_tool", { text: args.product, ...span(s), style: "stack", animation: "slam", ...backdrop(s) }, "the product name slams in (native type)");
          // The headline block sets the tagline as its kicker; otherwise it comes in on the reveal's second bar.
          if (!headline && args.tagline?.trim()) {
            const half = round3((s.start + s.end) / 2);
            await c.run("tagline", "add_kinetic_title_tool", { text: args.tagline, position_seconds: half, duration_seconds: round3(s.end - half), style: "editorial", y: 0.72 }, "the line under the name, on the reveal's second bar");
          }
          await c.run("reveal hit", "add_sfx_tool", { recipe: "impact_boom", at_seconds: round3(s.start), pitch: -3, intensity: 0.85 }, "the reveal lands on a hit");
          if (s.start >= 1) await c.run("reveal rise", "add_sfx_tool", { recipe: "whoosh_rise", at_seconds: round3(s.start) }, "a rise into the reveal");
        }
      }

      // The features: one glass-cards block over all of them, else a title per feature.
      const featureSections = plan.sections.filter((s) => s.kind === "feature");
      const first = featureSections[0]!;
      const last = featureSections[featureSections.length - 1]!;
      const background = shown.get(first);
      const cards = await c.run(
        "features",
        "add_motion_block_tool",
        {
          block: "glass_cards",
          params: { ...(background ? { background } : {}), headline: `*${args.product}*`, cards: features.map((f) => f.title).slice(0, 4), details: features.map((f) => f.detail).slice(0, 4) },
          position_seconds: round3(first.start),
          duration_seconds: round3(last.end - first.start),
          placement: "full_frame",
        },
        `${features.length} feature(s) as glass cards over the product, one entrance per bar`,
      );
      if (!cards || features.length > 4) {
        for (const s of cards ? featureSections.slice(4) : featureSections) {
          const f = features[s.index!]!;
          await c.fallback(`feature ${s.index! + 1}`, cards ? "a fifth glass card" : "glass cards (a motion block)", "add_kinetic_title_tool", { text: f.detail ? `${f.title}. ${f.detail}` : f.title, ...span(s), style: "creator", animation: "pop", ...backdrop(s) }, `feature ${s.index! + 1} on its bar`);
        }
      }

      const proof = plan.sections.find((s) => s.kind === "proof");
      if (proof && args.proof?.stat) {
        const m = /^([$€£]?)([\d.,]+)(.*)$/.exec(args.proof.stat.trim());
        const counter = m
          ? await c.run("proof", "add_motion_block_tool", { block: "counter", params: { values: ["0", m[2]!.replace(/,/g, "")], prefix: m[1]!, suffix: m[3]!.trim(), label: args.proof.label ?? "" }, ...span(proof), placement: shown.has(proof) ? "over_video" : "full_frame" }, "the proof counts up")
          : null;
        if (!counter) {
          await c.fallback("proof", "a counter block", "add_kinetic_title_tool", { text: [args.proof.stat, args.proof.label].filter(Boolean).join(" "), ...span(proof), style: "creator", ...backdrop(proof) }, "the stat in kinetic type");
        }
      } else if (proof && args.proof?.quote) {
        await c.run("proof", "add_kinetic_title_tool", { text: args.proof.quote, ...span(proof), style: "editorial", ...backdrop(proof) }, "the quote, set like an editorial pull quote");
      }

      const end = plan.sections.find((s) => s.kind === "end")!;
      const logo = await c.run(
        "end card",
        "add_motion_block_tool",
        { block: "logo_reveal_end", params: { brand: args.product, ...(args.logo_file_id ? { logo: args.logo_file_id } : {}), cta: args.cta ?? "", url: args.url ?? "" }, ...span(end), placement: "full_frame" },
        "the logo opens, the call to action and the URL land under it",
      );
      if (!logo) {
        await c.fallback(
          "end card",
          "the logo reveal block",
          "add_motion_template_tool",
          { template: "end_card", text: args.product, ...(args.cta || args.url ? { subtitle: [args.cta, args.url].filter(Boolean).join(" · ") } : {}), ...span(end), variant: "plain", backdrop: true },
          "the native end card",
        );
      }

      c.suggest("auto_sound_design_tool", { genre: "saas_ui" }, "clicks and pops on the cards' entrances, whooshes on the section changes");
      c.suggest("master_audio_tool", { preset: "social", iterate: true }, "the loudness set last");
      return c.finish(
        "Build product launch",
        `Built a product launch for ${args.product}: ${plan.sections.length} sections on ${Math.round(grid.bpm)} BPM bars, ${round3(plan.duration)} s.`,
        {
          category: "product_launch",
          duration: plan.duration,
          beat_source: grid.source,
          tracks: placed.tracks,
          sections: plan.sections.map((s) => ({ kind: s.kind, ...(s.index !== undefined ? { feature: features[s.index]!.title } : {}), start: s.start, end: s.end, file_id: shown.get(s) ?? null, clip_id: placed.clips.get(s) ?? null })),
          music_file_id: music ? String(music.id) : null,
        },
        { notes },
      );
    },
  }),
];
