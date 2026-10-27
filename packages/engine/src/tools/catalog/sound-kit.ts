/**
 * Zenvi's recorded sound library and the generator for what it lacks:
 *
 *   search_sound_library_tool   the recorded CC0 kit (sfx/recorded.ts, ~500 sounds in 24
 *                               categories) by category, words, brightness, length and
 *                               energy, with the next pick the variety rules allow at a moment
 *   generate_sfx_tool           a sound effect made from a text prompt (AudioHost.generateSfx,
 *                               ElevenLabs on a paid plan), cached by prompt, conditioned like
 *                               a library sound and placed; refused with the reason where no
 *                               generator is configured
 *
 * add_sfx_tool places a kit sound by id (provider=kit).
 */

import { z } from "zod";
import { KIT_SLOTS, guessSlot, slotRecipe, type KitSlot } from "../../sfx/kit.js";
import { DEFAULT_PROMPT_INFLUENCE, SFX_GENERATION_SECONDS, sfxGenerationRefusal } from "../../sfx/generate.js";
import { KIT_BRIGHTNESS, KIT_ENERGIES, KIT_LENGTHS, pickVaried, searchKit, soundSeconds, type KitMatch } from "../../sfx/kit-search.js";
import { attributionLine, type SfxCredit } from "../../sfx/library.js";
import { sfxRecipe } from "../../sfx/recipes.js";
import { RECORDED_GROUPS, RECORDED_GROUP_SPECS, recordedSamples } from "../../sfx/recorded.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import { cachedSfx, conditionedSfxFile } from "../sfx-library.js";
import { kitUsesOf, recordedKitAvailable } from "../sfx-recorded.js";
import { addSfxFile, pictureEnd, placeSfx, snapToFrame } from "../sfx-media.js";

const SEARCH = "search_sound_library_tool";
const GENERATE = "generate_sfx_tool";

/** What each category holds, for the model. */
const CATEGORY_HELP: Readonly<Record<(typeof RECORDED_GROUPS)[number], string>> = {
  whoosh: "air moving past: transitions, whips, fast moves (peak on the cut)",
  swish: "short blade, cloth or stick swings",
  whip: "whip cracks",
  punch: "punches and slaps: body hits",
  hit: "claps, snaps, stick, wood and metal hits: snappy accents",
  thud: "drops, falls, door slams: heavy and dull",
  boom: "explosions, cinematic impacts, thunder",
  sub: "bass drums, timpani, taiko: the low end of a hit",
  riser: "builds into a moment (end on it)",
  reverse: "reverse cymbals and swells (end on the hit)",
  click: "mouse, button and pen clicks: UI",
  toggle: "switches and latches: UI on/off",
  tap: "finger, glass and table taps: soft UI touches",
  key: "single key presses",
  typing: "typing runs",
  shutter: "camera shutters",
  pop: "bubble, cork and mouth pops: things appearing",
  glitch: "electric crackles, static bursts: digital errors",
  sparkle: "chimes, bell trees, glockenspiel: glints and reveals",
  notify: "dings and single bell or mallet notes: notifications",
  paper: "page turns, crumples, slides",
  cloth: "fabric and clothes movement",
  scratch: "record scratches",
  ambience: "room tones and beds (city, office, nature, rain): loop under a scene",
};

const searchInput = z.strictObject({
  category: z.enum(RECORDED_GROUPS).optional().describe("The kind of sound (no category and no query: the categories and how many sounds each has)."),
  query: z.string().trim().min(1).max(100).optional().describe("Words matched against names and tags ('glass', 'metal', 'bamboo', 'rain'); more matches rank first."),
  brightness: z.enum(KIT_BRIGHTNESS).optional().describe("dark, mid or bright: the darkest, middle or brightest third of the category (by spectral centroid)."),
  length: z.enum(KIT_LENGTHS).optional().describe("short, medium or long: thirds of the category by sounding length."),
  energy: z.enum(KIT_ENERGIES).optional().describe("soft (slow attack, low crest), medium or hard (fast attack, high crest): thirds of the category."),
  stereo: z.boolean().optional().describe("true: real stereo recordings only; false: mono only."),
  min_seconds: z.number().min(0).max(120).optional().describe("Shortest sounding length, seconds."),
  max_seconds: z.number().positive().max(120).optional().describe("Longest sounding length, seconds."),
  near_seconds: z
    .number()
    .min(0)
    .optional()
    .describe("Timeline seconds where the sound will go: the pick then follows the variety rules against the kit sounds already there (never the one just before or after, at most 3 times in 30 s, least used first)."),
  count: z.number().int().min(1).max(20).optional().describe("Most results (default 8)."),
});

const generateInput = z.strictObject({
  prompt: z.string().trim().min(1).max(450).describe("The sound itself: material, motion, pitch, length ('deep cinematic boom with a long metallic tail'). No brand, artist, film or game names."),
  duration_seconds: z.number().min(SFX_GENERATION_SECONDS[0]).max(SFX_GENERATION_SECONDS[1]).describe("Length to make, seconds (0.5-30): always set, so the cost and the cue's fit are known."),
  role: z
    .enum(KIT_SLOTS)
    .optional()
    .describe("What it plays; its hit point and level follow (whoosh, swish, whip peak on the moment; hit, boom, sub, click, pop, glitch start on it; riser ends on it). Default: from the prompt."),
  at_seconds: z.number().min(0).optional().describe("Timeline seconds to place it (its hit point lands there). Without it the sound only goes into the media bin."),
  align: z.enum(["peak", "start"]).optional().describe("peak (default): the hit point lands on at_seconds. start: the sound starts there."),
  gain_db: z.number().min(-60).max(12).optional().describe("Clip gain, dB (default: the role's mix level)."),
  prompt_influence: z.number().min(0).max(1).optional().describe(`0..1: how literally the prompt is followed (default ${DEFAULT_PROMPT_INFLUENCE}; 0.6-0.8 repeats best).`),
  loop: z.boolean().optional().describe("Make a seamless loop (ambience beds). Default false."),
});

type SearchInput = z.infer<typeof searchInput>;
type GenerateInput = z.infer<typeof generateInput>;

const r2 = (x: number) => Math.round(x * 100) / 100;

function resultRow(m: KitMatch) {
  const s = m.sample;
  return {
    provider: "kit" as const,
    id: String(s.id),
    category: s.group,
    title: s.name,
    seconds: r2(soundSeconds(s)),
    onset_ms: s.onsetMs,
    peak_ms: s.peakMs,
    end_ms: s.endMs,
    lufs: s.lufs,
    centroid_hz: s.centroidHz,
    low_share: s.lowShare,
    ...m.traits,
    stereo: s.stereo,
    tags: s.tags,
    creator: s.username,
    license: "CC0 1.0",
    preview_url: s.url,
  };
}

function resultLine(m: KitMatch): string {
  const s = m.sample;
  const t = m.traits;
  return (
    `  kit:${s.id}  ${s.group}  "${s.name}"  ${soundSeconds(s).toFixed(2)} s (peak at ${((s.peakMs - s.onsetMs) / 1000).toFixed(2)} s)  ${t.brightness}/${t.length}/${t.energy}` +
    `  ${Math.round(s.centroidHz)} Hz${s.lowShare >= 0.3 ? `, ${Math.round(s.lowShare * 100)} % sub` : ""}  ${s.stereo ? "stereo" : "mono"}  by ${s.username}`
  );
}

/** A generated sound's credit: no licence to cite, but where it came from and on what terms stays on the file. */
function generatedCredit(prompt: string, gen: { provider: string; model: string; key: string; licence: string; termsUrl: string }): SfxCredit {
  const credit = {
    provider: "generated" as const,
    id: gen.key.slice(0, 16),
    title: prompt.slice(0, 120),
    creator: `${gen.provider} ${gen.model}`,
    license: "generated",
    license_name: "generated sound (provider terms)",
    license_url: gen.termsUrl,
    attribution_required: false,
    source: gen.provider,
  };
  return { ...credit, attribution: `${attributionLine(credit)} ${gen.licence}` };
}

export const soundKitTools: CatalogTool[] = [
  directTool({
    name: SEARCH,
    title: "Search Zenvi's sound library",
    description:
      "Search Zenvi's recorded sound library: about 500 real CC0 recordings (no credit needed) in 24 categories — whooshes, swishes, punches, hits, subs, booms, risers, reverse swells, " +
      "UI clicks/taps/toggles, keys, typing, shutters, pops, glitches, sparkles, notifications, paper, cloth, scratches, ambience beds — each measured: sounding length, onset/peak (ms), loudness, " +
      "brightness, sub share, stereo. Ask by category and brightness/length/energy (thirds of the category) and words. With near_seconds the first result is the pick the variety rules allow there. " +
      "Place one with add_sfx_tool provider=kit sound_id=<id>. Search here before generate_sfx_tool.",
    input: searchInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (call, args: SearchInput) => {
      if (args.min_seconds !== undefined && args.max_seconds !== undefined && args.min_seconds > args.max_seconds) return refused(SEARCH, "Error: min_seconds is more than max_seconds.");
      const fetchable = recordedKitAvailable(call.host);
      const note = fetchable ? [] : ["This surface cannot fetch the recorded kit: add_sfx_tool provider=kit is refused here (the zenvi CLI and local MCP fetch and cache it)."];
      if (!args.category && !args.query) {
        const categories = RECORDED_GROUPS.map((g) => ({ category: g, sounds: recordedSamples(g).length, holds: CATEGORY_HELP[g], plays_recipes: RECORDED_GROUP_SPECS[g].recipes }));
        const total = categories.reduce((n, c) => n + c.sounds, 0);
        const lines = [`Zenvi's sound library: ${total} recorded CC0 sounds in ${categories.length} categories.`, ...categories.map((c) => `  ${c.category} (${c.sounds}): ${c.holds}`), ...note, "Search one with category=<name> (and brightness, length, energy, query)."];
        return applied(SEARCH, lines.join("\n"), { data: { total, categories } }, 0);
      }
      const matches = searchKit({ group: args.category, text: args.query, brightness: args.brightness, length: args.length, energy: args.energy, stereo: args.stereo, minSeconds: args.min_seconds, maxSeconds: args.max_seconds });
      const count = args.count ?? 8;
      let ordered = matches;
      if (args.near_seconds !== undefined && matches.length > 0) {
        const pick = pickVaried(matches.map((m) => m.sample), kitUsesOf(call.doc.project), args.near_seconds);
        ordered = [...matches.filter((m) => m.sample.id === pick?.id), ...matches.filter((m) => m.sample.id !== pick?.id)];
      }
      const shown = ordered.slice(0, count);
      const asked = [args.category, args.query && `'${args.query}'`, args.brightness, args.length, args.energy].filter(Boolean).join(", ");
      const data = { total: matches.length, results: shown.map(resultRow), ...(args.near_seconds !== undefined && shown[0] ? { pick: String(shown[0].sample.id) } : {}), ...(note.length ? { notes: note } : {}) };
      if (shown.length === 0) return applied(SEARCH, `No kit sounds for ${asked}. Try another category or fewer filters, or generate_sfx_tool.`, { data }, 0);
      const lines = [
        `${matches.length} kit sounds for ${asked}${matches.length > shown.length ? ` (best ${shown.length})` : ""}:`,
        ...shown.map(resultLine),
        ...note,
        `Place one with add_sfx_tool provider=kit sound_id=<id>${args.near_seconds !== undefined ? ` (the first, kit:${shown[0]!.sample.id}, is the varied pick at ${args.near_seconds} s)` : ""}.`,
      ];
      return applied(SEARCH, lines.join("\n"), { data }, 0);
    },
  }),

  directTool({
    name: GENERATE,
    title: "Generate a sound effect",
    description:
      "Make a sound effect from a text prompt when Zenvi's recorded library (search_sound_library_tool) has nothing that fits: a braam, a specific creature, a sci-fi door. " +
      "Generated with a commercial-use provider (ElevenLabs on a paid plan), cached by prompt (the same request is free the second time), trimmed and levelled like a library sound, " +
      "and placed with its hit point on at_seconds (or only added to the bin). Costs about $0.007 a second. One undo step.",
    input: generateInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requires: ["media"],
    run: async (call, args: GenerateInput) => {
      const why = sfxGenerationRefusal({ prompt: args.prompt, seconds: args.duration_seconds, promptInfluence: args.prompt_influence });
      if (why) return refused(GENERATE, why);
      if ((args.align !== undefined || args.gain_db !== undefined) && args.at_seconds === undefined) return refused(GENERATE, "Error: align and gain_db go with at_seconds.");
      const generate = call.host.audio?.generateSfx;
      if (!generate) {
        return unavailable(
          GENERATE,
          "no sound generator is configured on this surface (the zenvi CLI and local MCP generate with ELEVENLABS_API_KEY set to a key on a paid ElevenLabs plan); search_sound_library_tool's recorded sounds and add_sfx_tool's recipes work everywhere",
        );
      }
      if (!call.host.media?.writeGenerated || !call.host.audio?.decodePcm) return unavailable(GENERATE, "this surface cannot decode and store generated audio");
      const project = call.doc.project;
      const until = pictureEnd(project) ?? undefined;
      const at = args.at_seconds === undefined ? undefined : snapToFrame(project, args.at_seconds);
      if (at !== undefined && until !== undefined && at >= until - 1e-6) return refused(GENERATE, `Error: ${at.toFixed(2)} s is at or after the end of the picture (${until.toFixed(2)} s). Pick an earlier moment.`);
      const role: KitSlot = args.role ?? guessSlot(args.prompt, []);
      const recipe = sfxRecipe(slotRecipe(role))!;
      const align = args.align ?? "peak";
      if (at !== undefined && align === "peak" && recipe.hit === "end" && at < 0.05) return refused(GENERATE, "Error: a riser ends on its moment, so at 0 s nothing of it would play; pick a later moment or align=start.");

      let gen: Awaited<ReturnType<typeof generate>>;
      try {
        gen = await generate({ prompt: args.prompt, durationSeconds: args.duration_seconds, promptInfluence: args.prompt_influence ?? DEFAULT_PROMPT_INFLUENCE, loop: args.loop ?? false }, { signal: call.signal });
      } catch (error) {
        return failed(GENERATE, `Error: the sound could not be generated: ${error instanceof Error ? error.message : String(error)}`);
      }
      const credit = generatedCredit(args.prompt, gen);
      const key = `gen-${gen.key}-${recipe.id}`;
      const title = args.prompt.slice(0, 80);
      let sound;
      try {
        sound = cachedSfx(project, key, title, credit) ?? (await conditionedSfxFile(call, gen.path, { key, recipeId: recipe.id, maxSeconds: args.duration_seconds + 0.5, stem: `gen_${gen.key.slice(0, 12)}`, title, credit, what: "the generated sound" }));
      } catch (error) {
        return failed(GENERATE, `Error: the generated sound could not be used: ${error instanceof Error ? error.message : String(error)}`);
      }
      const generated = { provider: gen.provider, model: gen.model, key: gen.key, cached: gen.cached, ...(gen.costUsd !== undefined ? { cost_usd: gen.costUsd } : {}), licence: gen.licence, terms_url: gen.termsUrl };
      const cost = gen.cached ? "from the cache (nothing paid)" : gen.costUsd !== undefined ? `for about $${gen.costUsd.toFixed(3)}` : "";
      if (at === undefined) {
        const fileId = sound.fileId ?? call.commit((tx) => addSfxFile(tx, sound), `Generate sound '${title}'`);
        return applied(GENERATE, `Generated '${title}' (${role}, ${args.duration_seconds} s) ${cost}; it is in the media bin as file ${fileId}. ${gen.licence}`, { data: { file_id: fileId, role, recipe: recipe.id, generated } });
      }
      const gainDb = args.gain_db ?? recipe.mixDb;
      const hitAt = align === "peak" ? at : at + sound.hit;
      if (until !== undefined && (recipe.hit === "end" ? hitAt > until + 1e-6 : hitAt >= until - 1e-6)) return refused(GENERATE, `Error: the sound's hit at ${hitAt.toFixed(2)} s would be past the picture's end (${until.toFixed(2)} s).`);
      const placed = call.commit((tx) => placeSfx(tx, sound, { at, align, gainDb, auto: false, until }), `Generate sound '${title}'`);
      if (!placed) return refused(GENERATE, "Error: nothing of the sound is left on the timeline at that moment.");
      return applied(GENERATE, `Generated '${title}' (${role}) ${cost} and placed it with its ${recipe.hit === "onset" ? "transient" : recipe.hit} on ${at.toFixed(2)} s (${gainDb} dB). ${gen.licence}`, {
        data: { clip_id: placed.clip.id, file_id: placed.clip.file_id, role, recipe: recipe.id, hit_seconds: hitAt, gain_db: gainDb, generated },
      });
    },
  }),
];

