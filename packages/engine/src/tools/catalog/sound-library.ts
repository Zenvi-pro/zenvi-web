/**
 * Library sound effects and sound kits (the procedural ones are in
 * sound-design.ts):
 *
 *   search_sfx_tool         the recipes, Openverse (openly licensed audio, no key) and Freesound
 *                           (through the Zenvi backend), filtered by licence and length
 *   list_credits_tool       the attribution lines the project's library sounds need
 *   create_sound_kit_tool   one palette for the project (whoosh, swish, whip, hit, boom, sub,
 *                           riser, click, pop, glitch): synthesised at one tone, library sounds,
 *                           or both; auto_sound_design_tool plays every cue through it
 *
 * add_sfx_tool places one library result (sfx-library.ts makes it).
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { KIT_SLOTS, KIT_SLOT_SPECS, KIT_SOURCES, KIT_TONES, SOUND_KIT_KEY, fitsSlot, kitFileIds, librarySlots, proceduralKit, readSoundKit, slotRecipe, type KitSlot, type SoundKit } from "../../sfx/kit.js";
import { SFX_LICENSE_FILTERS, searchRecipes, type SfxCredit, type SfxLibraryResult, type SfxLicenseFilter, type SfxSearchFilters } from "../../sfx/library.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, refused, unchanged } from "../receipt.js";
import { searchFreesoundSfx, searchOpenverse, prepareLibrarySfx, type LibraryResult, type SearchOutcome } from "../sfx-library.js";
import { addSfxFile, removeUnusedSfxFiles, type PreparedSfx } from "../sfx-media.js";

const SEARCH = "search_sfx_tool";
const CREDITS = "list_credits_tool";
const KIT = "create_sound_kit_tool";

const LICENSE_HELP =
  "cc0: public domain only (CC0, Public Domain Mark; no credit needed). commercial-ok (default): may be used in a paid video — CC0, CC BY, CC BY-SA (credit required). " +
  "any: also CC BY-ND and Sampling+. Non-commercial licences only with include_noncommercial.";

const searchInput = z.strictObject({
  query: z.string().trim().min(1).max(100).describe("What it should sound like: 'whoosh', 'glass impact', 'camera shutter', 'cinematic riser'…"),
  provider: z
    .enum(["procedural", "openverse", "freesound", "auto"])
    .optional()
    .describe("procedural: Zenvi's synthesised recipes (no licence). openverse: openly licensed audio (no key). freesound: through the Zenvi backend (sign in). auto (default): the recipes that fit, then Openverse (Freesound when Openverse cannot answer)."),
  license: z.enum(SFX_LICENSE_FILTERS).optional().describe(LICENSE_HELP),
  include_noncommercial: z.boolean().optional().describe("With license=any: also non-commercial licences (CC BY-NC…). Default false."),
  min_seconds: z.number().min(0).max(60).optional().describe("Shortest, seconds (default 0)."),
  max_seconds: z.number().positive().max(120).optional().describe("Longest, seconds (default 10: sound effects, not music)."),
  count: z.number().int().min(1).max(20).optional().describe("Most results (default 8)."),
});

const creditsInput = z.strictObject({
  include_unused: z.boolean().optional().describe("Also library sounds in the bin that no clip plays (default false)."),
});

const kitInput = z.strictObject({
  name: z.string().trim().min(1).max(80).optional().describe("The kit's name (default 'Sound kit')."),
  source: z
    .enum(KIT_SOURCES)
    .optional()
    .describe("procedural (default): every sound synthesised at the kit's tone. library: Openverse (or Freesound) sounds for every role. mixed: library whooshes, swishes, hits, booms and risers; synthesised whips, subs, clicks, pops and glitches."),
  tone: z.enum(KIT_TONES).optional().describe("The palette's colour: dark (lower, duller), neutral (default), bright (higher, crisper). Procedural sounds only."),
  pitch: z.number().min(-12).max(12).optional().describe("Semitones, overrides the tone's (procedural sounds)."),
  brightness: z.number().min(0).max(1).optional().describe("0..1, overrides the tone's (procedural sounds)."),
  seed: z.number().int().optional().describe("Another kit of the same tone (default 1): other recipes and variations."),
  style: z.string().trim().max(40).optional().describe("Library kits: a word added to every search so the sounds match ('cinematic', 'cartoon', 'digital', 'organic')."),
  license: z.enum(SFX_LICENSE_FILTERS).optional().describe(`Library kits: ${LICENSE_HELP.replace(" Non-commercial licences only with include_noncommercial.", " Never non-commercial.")}`),
  variants: z.number().int().min(1).max(3).optional().describe("Library kits: sounds per role, taken in turn (default 2)."),
});

type SearchInput = z.infer<typeof searchInput>;
type KitInput = z.infer<typeof kitInput>;

/** Library results as the model reads them: one line each. */
function resultLine(r: SfxLibraryResult): string {
  const licence = r.provider === "procedural" ? "generated (no licence)" : `${r.license_name}${r.attribution_required ? " (credit required)" : " (no credit needed)"}`;
  return (
    `  provider=${r.provider}  id=${r.id}  "${r.title}"  ${r.duration > 0 ? `${r.duration.toFixed(2)} s` : "length unknown"}  ${licence}` +
    (r.creator ? `  by ${r.creator}` : "") +
    (r.preview_url ? `  preview=${r.preview_url}` : "")
  );
}

/** Openverse first, Freesound when it cannot answer and the backend is there. */
async function searchLibraries(call: ToolCall, query: string, filters: SfxSearchFilters, limit: number): Promise<SearchOutcome & { notes: string[] }> {
  const notes: string[] = [];
  const openverse = await searchOpenverse(call, query, filters, limit);
  if (!("error" in openverse) || !call.host.backend) return { ...openverse, notes };
  notes.push(`Openverse: ${openverse.error} Searched Freesound instead.`);
  return { ...(await searchFreesoundSfx(call, query, filters, limit)), notes };
}

export interface FilledSlots {
  /** Downloads not in the bin yet, by the placeholder file id the kit names them with. */
  pending: Map<string, PreparedSfx>;
  warnings: string[];
}

const PENDING = "pending:";

/**
 * Fill `slots` of `kit` with library sounds (in place): a search per slot,
 * the best results that download and decode (CC0 first among the most
 * relevant), `variants` each. A slot without one stays synthesised, with a
 * warning. Sounds not in the bin yet are named `pending:…` until
 * `commitPending` adds them.
 */
export async function fillLibrarySlots(call: ToolCall, kit: SoundKit, slots: readonly KitSlot[], options: { license: SfxLicenseFilter; variants: number; style: string }): Promise<FilledSlots> {
  const pending = new Map<string, PreparedSfx>();
  const warnings: string[] = [];
  const queries = slots.map((slot) => `${options.style} ${KIT_SLOT_SPECS[slot].query}`.trim());
  // The searches at once (a kit is at most ten, under Openverse's 20 a minute): an uncached one can take most of a minute.
  const searches = await Promise.all(
    slots.map((slot, i) => {
      const spec = KIT_SLOT_SPECS[slot];
      // Silence is trimmed, so a file may run a little longer than the role.
      const filters: SfxSearchFilters = { license: options.license, noncommercial: false, minSeconds: spec.seconds[0], maxSeconds: spec.seconds[1] + 1 };
      return searchLibraries(call, queries[i]!, filters, 8);
    }),
  );
  for (const [i, slot] of slots.entries()) {
    const spec = KIT_SLOT_SPECS[slot];
    const query = queries[i]!;
    const found = searches[i]!;
    if ("error" in found) {
      warnings.push(`No library ${slot}: ${found.error} It is synthesised.`);
      continue;
    }
    for (const note of found.notes) if (!warnings.includes(note)) warnings.push(note);
    const ranked = found.results
      .filter((r) => fitsSlot(slot, r.title, r.tags))
      .map((r, i) => ({ r, i }))
      .sort((a, b) => Number(a.r.attribution_required) - Number(b.r.attribution_required) || a.i - b.i);
    const made: { result: LibraryResult; sound: PreparedSfx }[] = [];
    for (const { r } of ranked.slice(0, options.variants + 2)) {
      if (made.length >= options.variants) break;
      try {
        made.push({ result: r, sound: await prepareLibrarySfx(call, r, slotRecipe(slot), spec.seconds[1]) });
      } catch (error) {
        call.host.log?.(`sound kit: ${r.provider} ${r.id} skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (made.length === 0) {
      warnings.push(`No usable library ${slot} for '${query}' (${found.results.length} found, ${ranked.length} named like one): it is synthesised.`);
      continue;
    }
    kit.slots[slot] = {
      source: "library",
      recipe: slotRecipe(slot),
      sounds: made.map(({ result, sound }, i) => {
        const fileId = sound.fileId ?? `${PENDING}${slot}:${i}`;
        if (!sound.fileId) pending.set(fileId, sound);
        return { file_id: fileId, provider: result.provider, id: result.id, title: sound.title ?? result.title, license: result.license };
      }),
    };
  }
  return { pending, warnings };
}

/** Add the kit's pending downloads to the bin and name them by their file ids. */
function commitPending(tx: Transaction, kit: SoundKit, pending: ReadonlyMap<string, PreparedSfx>): void {
  for (const entry of Object.values(kit.slots)) {
    if (entry?.source !== "library") continue;
    for (const s of entry.sounds) {
      const sound = pending.get(s.file_id);
      if (sound) s.file_id = sound.fileId ?? (sound.fileId = addSfxFile(tx, sound));
    }
  }
}

function slotLine(slot: KitSlot, kit: SoundKit): string {
  const entry = kit.slots[slot];
  if (!entry) return `  ${slot}: —`;
  if (entry.source === "procedural") return `  ${slot}: ${entry.recipe} (pitch ${entry.pitch}, brightness ${entry.brightness})`;
  return `  ${slot}: ${entry.sounds.map((s) => `'${s.title}' (${s.provider}, ${s.license})`).join(", ")}`;
}

export const soundLibraryTools: CatalogTool[] = [
  directTool({
    name: SEARCH,
    title: "Search sound effects",
    description:
      "Find sound effects: Zenvi's procedural recipes, Openverse (millions of openly licensed sounds, no key needed) and Freesound (through the Zenvi backend). " +
      "Each result has provider, id, title, licence, attribution, duration and a preview URL. Commercial-use licences only by default; non-commercial ones never unless asked. " +
      "Place one with add_sfx_tool (provider + sound_id). Openverse allows 20 searches a minute and 200 a day without a key: search with intent.",
    input: searchInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (call, args: SearchInput) => {
      const provider = args.provider ?? "auto";
      const count = args.count ?? 8;
      const filters: SfxSearchFilters = { license: args.license ?? "commercial-ok", noncommercial: args.include_noncommercial === true, minSeconds: args.min_seconds ?? 0, maxSeconds: args.max_seconds ?? 10 };
      if (filters.minSeconds > filters.maxSeconds) return refused(SEARCH, "Error: min_seconds is more than max_seconds.");
      if (filters.noncommercial && filters.license !== "any") return refused(SEARCH, "Error: include_noncommercial goes with license=any.");
      const results: SfxLibraryResult[] = [];
      const notes: string[] = [];
      let total: number | undefined;
      if (provider === "procedural" || provider === "auto") results.push(...searchRecipes(args.query, filters, provider === "auto" ? Math.min(3, count) : count));
      if (provider !== "procedural") {
        const room = count - results.length;
        let found: SearchOutcome & { notes?: string[] };
        if (provider === "openverse") found = await searchOpenverse(call, args.query, filters, room);
        else if (provider === "freesound") found = await searchFreesoundSfx(call, args.query, filters, room);
        else found = await searchLibraries(call, args.query, filters, room);
        notes.push(...(found.notes ?? []));
        if ("error" in found) {
          if (provider !== "auto") return refused(SEARCH, `Error: ${provider === "openverse" ? "Openverse" : "Freesound"} search failed: ${found.error}`);
          notes.push(`Library search failed: ${found.error} Only procedural sounds are listed.`);
        } else {
          results.push(...found.results);
          total = found.total;
        }
      }
      const data = { query: args.query, provider, license: filters.license, total: total ?? results.length, results, ...(notes.length ? { notes } : {}) };
      if (results.length === 0) {
        return applied(SEARCH, `No sound effects for '${args.query}' (${filters.license}, ${filters.minSeconds}-${filters.maxSeconds} s).${notes.length ? ` ${notes.join(" ")}` : ""} Try other words or a wider length.`, { data }, 0);
      }
      const lines = [`${results.length} sound effects for '${args.query}' (${filters.license}):`, ...results.map(resultLine), ...notes, "Add one with add_sfx_tool provider=<provider> sound_id=<id> (Freesound: also title)."];
      return applied(SEARCH, lines.join("\n"), { data }, 0);
    },
  }),

  directTool({
    name: CREDITS,
    title: "List credits",
    description:
      "The attribution lines the project's library sounds need (for the video's description or end credits): title, creator, licence and link of every Openverse or Freesound sound the timeline plays, " +
      "the ones whose licence requires credit first. Procedural sounds need none.",
    input: creditsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (call, args) => {
      const project = call.doc.project;
      const clipsOf = new Map<string, string[]>();
      for (const clip of project.clips) clipsOf.set(String(clip.file_id), [...(clipsOf.get(String(clip.file_id)) ?? []), clip.id]);
      const credits = project.files
        .filter((f) => typeof f.zenvi_credit === "object" && f.zenvi_credit !== null)
        .map((f) => ({ file_id: String(f.id), clip_ids: clipsOf.get(String(f.id)) ?? [], ...(f.zenvi_credit as SfxCredit) }))
        .filter((c) => args.include_unused || c.clip_ids.length > 0)
        .sort((a, b) => Number(b.attribution_required) - Number(a.attribution_required));
      // One line per sound, however many clips play it.
      const required = credits.filter((c) => c.attribution_required);
      const optional = credits.filter((c) => !c.attribution_required);
      const data = { credits, required: required.length, lines: required.map((c) => c.attribution) };
      if (credits.length === 0) return applied(CREDITS, "No library sounds on the timeline: nothing to credit.", { data }, 0);
      const text = [
        required.length > 0 ? `${required.length} ${required.length === 1 ? "sound needs" : "sounds need"} credit (put these lines in the video's description or credits):` : "No sound needs credit.",
        ...required.map((c) => `  ${c.attribution}`),
        ...(optional.length > 0 ? [`${optional.length} public-domain ${optional.length === 1 ? "sound" : "sounds"} (credit optional):`, ...optional.map((c) => `  ${c.attribution}`)] : []),
      ];
      return applied(CREDITS, text.join("\n"), { data }, 0);
    },
  }),

  directTool({
    name: KIT,
    title: "Create a sound kit",
    description:
      "Give the project one consistent palette of sound effects — whoosh, swish, whip, hit, boom, sub, riser, click, pop, glitch — so every whoosh of the edit sounds like the same family. " +
      "procedural: synthesised at one tone (dark, neutral, bright) from one seed; library: Openverse/Freesound sounds (commercial-use licences, credits recorded); mixed: both. " +
      "Stored on the project: auto_sound_design_tool plays every cue through it by default (run it again after changing the kit). Replaces the previous kit. One undo step.",
    input: kitInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (call, args: KitInput) => {
      const source = args.source ?? "procedural";
      const procedural = source === "procedural";
      const libraryOnly = (["style", "license", "variants"] as const).filter((k) => args[k] !== undefined);
      if (procedural && libraryOnly.length > 0) return refused(KIT, `Error: ${libraryOnly.join(", ")} ${libraryOnly.length === 1 ? "goes" : "go"} with source=library or mixed.`);
      const media = call.host.media;
      if (!procedural && (!media?.importUrl || !media.writeGenerated || !call.host.audio?.decodePcm || (!call.host.library && !call.host.backend))) {
        return refused(KIT, `Error: source=${source} is not available in this Zenvi surface: it cannot search, download and decode library sounds. Use source=procedural.`);
      }
      const settings = call.doc.project.settings;
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return refused(KIT, "Error: this project has no settings object to keep a sound kit in.");
      const before = readSoundKit(call.doc.project);
      const kit = proceduralKit({ name: args.name ?? "Sound kit", seed: args.seed ?? 1, source, tone: args.tone ?? "neutral", pitch: args.pitch, brightness: args.brightness });
      const filled = procedural ? { pending: new Map<string, PreparedSfx>(), warnings: [] } : await fillLibrarySlots(call, kit, librarySlots(source), { license: args.license ?? "commercial-ok", variants: args.variants ?? 2, style: args.style ?? "" });
      const libraryRoles = KIT_SLOTS.filter((s) => kit.slots[s]?.source === "library");
      if (!procedural && libraryRoles.length === 0) return refused(KIT, `Error: no library sound could be used for any role, so no kit was made. ${filled.warnings.join(" ")}`.trim());
      if (before && filled.pending.size === 0 && JSON.stringify(before) === JSON.stringify(kit)) {
        return unchanged(KIT, `The project already has this sound kit ('${kit.name}').`, { data: { kit } });
      }
      const removed = call.commit((tx) => {
        commitPending(tx, kit, filled.pending);
        tx.update(["settings"], { [SOUND_KIT_KEY]: kit });
        // The previous kit's library sounds no clip plays go with it.
        return removeUnusedSfxFiles(tx, kitFileIds(kit));
      }, `Create sound kit '${kit.name}'`);
      const credits = new Set(libraryRoles.flatMap((s) => (kit.slots[s]?.source === "library" ? kit.slots[s].sounds.filter((x) => x.license !== "cc0" && x.license !== "pdm").map((x) => x.file_id) : [])));
      const text = [
        `${before ? "Replaced the sound kit with" : "Created sound kit"} '${kit.name}' (${source}${procedural || source === "mixed" ? `, ${kit.tone}` : ""}):`,
        ...KIT_SLOTS.map((s) => slotLine(s, kit)),
        `auto_sound_design_tool now plays every cue through it${call.doc.project.clips.some((c) => (c.zenvi_sfx as { auto?: boolean } | undefined)?.auto) ? ": run it again to hear the kit on this edit" : ""}.` +
          (credits.size > 0 ? ` ${credits.size} library ${credits.size === 1 ? "sound needs" : "sounds need"} credit once used (list_credits_tool).` : ""),
      ];
      return applied(KIT, text.join("\n"), {
        warnings: filled.warnings,
        data: { kit, library_roles: libraryRoles, file_ids: [...kitFileIds(kit)], removed_file_ids: removed, replaced: before !== null },
      });
    },
  }),
];
