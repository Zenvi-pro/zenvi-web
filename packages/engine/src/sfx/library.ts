/**
 * Sound-effect libraries search_sfx_tool and add_sfx_tool reach: the
 * procedural recipes (sfx/recipes.ts), Openverse (openly licensed audio,
 * https://api.openverse.org/v1/, no key needed: 20 requests a minute and
 * 200 a day anonymously) and Freesound (through the Zenvi backend's
 * `/api/v1/freesound/search`). Pure: requests are built and answers read
 * here, the host only moves bytes (tools/sfx-library.ts).
 *
 * Licences are Openverse's codes. Non-commercial licences are never
 * offered unless asked for, and the attribution line every result needs
 * travels with it onto the project file (list_credits_tool).
 */

import { z } from "zod";
import { SFX_RECIPES, type SfxRecipe } from "./recipes.js";

export const SFX_PROVIDERS = ["procedural", "openverse", "freesound"] as const;
export type SfxProvider = (typeof SFX_PROVIDERS)[number];
export type SfxLibraryProvider = Exclude<SfxProvider, "procedural">;

/** cc0: public domain only. commercial-ok: may be used in a paid video (with attribution where the licence asks). any: every licence but non-commercial ones. */
export const SFX_LICENSE_FILTERS = ["cc0", "commercial-ok", "any"] as const;
export type SfxLicenseFilter = (typeof SFX_LICENSE_FILTERS)[number];

const PUBLIC_DOMAIN = ["cc0", "pdm"];
// BY-ND forbids adaptations: a trimmed, normalised effect synced to picture is one.
const COMMERCIAL = [...PUBLIC_DOMAIN, "by", "by-sa"];
const OPEN = [...COMMERCIAL, "by-nd", "sampling+"];
const NONCOMMERCIAL = ["by-nc", "by-nc-sa", "by-nc-nd", "nc-sampling+"];

/** Licence codes a filter allows (Openverse `license=`). */
export function allowedLicenses(filter: SfxLicenseFilter, noncommercial = false): string[] {
  const base = filter === "cc0" ? PUBLIC_DOMAIN : filter === "commercial-ok" ? COMMERCIAL : OPEN;
  return noncommercial && filter === "any" ? [...base, ...NONCOMMERCIAL] : [...base];
}

/** The licence code of a Creative Commons URL or name ("http://creativecommons.org/licenses/by/4.0/" → "by"). */
export function licenseCode(text: string | undefined): string | null {
  const t = (text ?? "").toLowerCase();
  if (/publicdomain\/zero|\bcc0\b|creative commons 0/.test(t)) return "cc0";
  if (/publicdomain\/mark|\bpdm\b/.test(t)) return "pdm";
  if (/nc-sampling\+/.test(t)) return "nc-sampling+";
  if (/sampling\+/.test(t)) return "sampling+";
  const m = /licenses\/(by(?:-nc)?(?:-sa|-nd)?)\//.exec(t) ?? /^cc[ -](by(?:-nc)?(?:-sa|-nd)?)\b/.exec(t);
  return m ? m[1]! : null;
}

/** "CC BY 4.0", "CC0 1.0", "Public Domain Mark 1.0". */
export function licenseName(code: string, version?: string): string {
  const v = version ? ` ${version}` : "";
  if (code === "cc0") return `CC0${v}`;
  if (code === "pdm") return `Public Domain Mark${v}`;
  if (code.includes("sampling")) return `${code === "sampling+" ? "Sampling+" : "NC Sampling+"}${v}`;
  return `CC ${code.toUpperCase()}${v}`;
}

export function needsAttribution(code: string): boolean {
  return !PUBLIC_DOMAIN.includes(code);
}

export function allowsCommercialUse(code: string): boolean {
  return !NONCOMMERCIAL.includes(code);
}

/** One sound a library offers. Times in seconds. */
export interface SfxLibraryResult {
  provider: SfxProvider;
  /** Openverse: its UUID; Freesound: the sound's number; procedural: the recipe id. */
  id: string;
  title: string;
  creator?: string;
  /** Licence code ("cc0", "by", "by-sa"…); "zenvi" for procedural sounds. */
  license: string;
  license_name: string;
  license_url?: string;
  /** The credit line to publish with the video ("" when none is needed). */
  attribution: string;
  attribution_required: boolean;
  commercial_use: boolean;
  duration: number;
  /** Where the audio downloads from (and can be listened to). */
  preview_url?: string;
  /** The sound's page. */
  landing_url?: string;
  tags: string[];
  /** Openverse: the collection it comes from (freesound, wikimedia_audio, jamendo…). */
  source?: string;
  /** Openverse: bytes of the file at preview_url, when known. */
  filesize?: number;
}

export interface SfxSearchFilters {
  license: SfxLicenseFilter;
  noncommercial: boolean;
  minSeconds: number;
  maxSeconds: number;
}

/** Credit line in Openverse's wording. */
export function attributionLine(r: { title: string; creator?: string; landing_url?: string; license: string; license_name: string; license_url?: string }): string {
  const work = `"${r.title}"${r.creator ? ` by ${r.creator}` : ""}${r.landing_url ? ` (${r.landing_url})` : ""}`;
  const terms = r.license_url ? ` To view the terms, visit ${r.license_url}.` : "";
  return needsAttribution(r.license) ? `${work} is licensed under ${r.license_name}.${terms}` : `${work} is marked with ${r.license_name}.${terms}`;
}

// ---------------------------------------------------------------------------
// Openverse
// ---------------------------------------------------------------------------

export const OPENVERSE_API = "https://api.openverse.org/v1";
/** Most results an anonymous Openverse search returns per page. */
export const OPENVERSE_PAGE_SIZE = 20;
const OPENVERSE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOpenverseId(id: string): boolean {
  return OPENVERSE_ID.test(id);
}

/** GET url of an Openverse audio search (durations are filtered on the answer: its `length` buckets are too coarse for effects). */
export function openverseSearchUrl(query: string, filters: Pick<SfxSearchFilters, "license" | "noncommercial">, pageSize = OPENVERSE_PAGE_SIZE): string {
  const params = new URLSearchParams({ q: query, license: allowedLicenses(filters.license, filters.noncommercial).join(","), page_size: String(Math.min(OPENVERSE_PAGE_SIZE, pageSize)), mature: "false" });
  return `${OPENVERSE_API}/audio/?${params.toString()}`;
}

/** GET url of one Openverse sound. Throws for an id that is not a UUID (tools check first). */
export function openverseDetailUrl(id: string): string {
  if (!isOpenverseId(id)) throw new Error(`not an Openverse id: ${id}`);
  return `${OPENVERSE_API}/audio/${id.toLowerCase()}/`;
}

const text = (max: number) => z.string().max(max);
const httpsUrl = z.string().max(2048).regex(/^https?:\/\//);

const openverseAudio = z.object({
  id: z.string().regex(OPENVERSE_ID),
  title: text(500).nullish(),
  creator: text(300).nullish(),
  license: text(40),
  license_version: text(20).nullish(),
  license_url: httpsUrl.nullish(),
  url: httpsUrl.nullish(),
  foreign_landing_url: httpsUrl.nullish(),
  attribution: text(2000).nullish(),
  duration: z.number().nonnegative().nullish(),
  filesize: z.number().nonnegative().nullish(),
  source: text(100).nullish(),
  tags: z.array(z.object({ name: text(100) })).max(200).nullish(),
});

const openversePage = z.object({ result_count: z.number().nonnegative().optional(), results: z.array(z.unknown()).max(500) });

/** One Openverse audio record as a result; null when it is unusable (no file, no known licence). */
export function readOpenverseAudio(json: unknown): SfxLibraryResult | null {
  const parsed = openverseAudio.safeParse(json);
  if (!parsed.success || !parsed.data.url) return null;
  const a = parsed.data;
  const license = a.license.toLowerCase();
  if (![...OPEN, ...NONCOMMERCIAL].includes(license)) return null;
  const base = {
    title: (a.title ?? "").trim() || "Untitled",
    creator: a.creator?.trim() || undefined,
    landing_url: a.foreign_landing_url ?? undefined,
    license,
    license_name: licenseName(license, a.license_version ?? undefined),
    license_url: a.license_url ?? undefined,
  };
  return {
    provider: "openverse",
    id: a.id.toLowerCase(),
    ...base,
    attribution: a.attribution?.trim() || attributionLine(base),
    attribution_required: needsAttribution(license),
    commercial_use: allowsCommercialUse(license),
    duration: (a.duration ?? 0) / 1000,
    preview_url: a.url ?? undefined,
    tags: (a.tags ?? []).map((t) => t.name).slice(0, 12),
    source: a.source || undefined,
    filesize: a.filesize ?? undefined,
  };
}

/** The results of an Openverse search page; throws when the answer is not one. */
export function readOpenverseSearch(json: unknown): { results: SfxLibraryResult[]; total: number } {
  const page = openversePage.safeParse(json);
  if (!page.success) throw new Error("Openverse answered with something that is not a search result.");
  const results = page.data.results.map(readOpenverseAudio).filter((r): r is SfxLibraryResult => r !== null);
  return { results, total: page.data.result_count ?? results.length };
}

// ---------------------------------------------------------------------------
// Freesound (as the Zenvi backend returns it, stock/stock.ts FreesoundSound)
// ---------------------------------------------------------------------------

const freesoundSound = z.object({
  id: z.number().int().positive(),
  name: text(500).nullish(),
  duration: z.number().nonnegative().nullish(),
  username: text(300).nullish(),
  license: text(300).nullish(),
  tags: z.array(text(100)).max(200).nullish(),
  previews: z.object({ hq_mp3: z.string().max(2048).nullish(), lq_mp3: z.string().max(2048).nullish() }).nullish(),
});

/** A Freesound sound as a result; null without a preview or a known licence. */
export function readFreesoundSound(json: unknown): SfxLibraryResult | null {
  const parsed = freesoundSound.safeParse(json);
  if (!parsed.success) return null;
  const s = parsed.data;
  const preview = s.previews?.hq_mp3 || s.previews?.lq_mp3;
  const license = licenseCode(s.license ?? undefined);
  if (!preview || !/^https?:\/\//.test(preview) || !license) return null;
  const version = /\/(\d(?:\.\d)?)\/?$/.exec(s.license ?? "")?.[1];
  const base = {
    title: (s.name ?? "").trim() || `Freesound ${s.id}`,
    creator: s.username?.trim() || undefined,
    landing_url: `https://freesound.org/s/${s.id}/`,
    license,
    license_name: licenseName(license, version),
    license_url: /^https?:\/\//.test(s.license ?? "") ? s.license! : undefined,
  };
  return {
    provider: "freesound",
    id: String(s.id),
    ...base,
    attribution: attributionLine(base),
    attribution_required: needsAttribution(license),
    commercial_use: allowsCommercialUse(license),
    duration: s.duration ?? 0,
    preview_url: preview,
    tags: (s.tags ?? []).slice(0, 12),
  };
}

// ---------------------------------------------------------------------------
// Filtering and the procedural "library"
// ---------------------------------------------------------------------------

/** Results a filter keeps, in the library's order, without repeats of one sound. */
export function filterResults(results: readonly SfxLibraryResult[], filters: SfxSearchFilters): SfxLibraryResult[] {
  const allowed = new Set(allowedLicenses(filters.license, filters.noncommercial));
  const seen = new Set<string>();
  return results.filter((r) => {
    if (r.provider !== "procedural" && !allowed.has(r.license)) return false;
    if (r.duration > 0 && (r.duration < filters.minSeconds || r.duration > filters.maxSeconds)) return false;
    const key = `${r.title.toLowerCase()}|${(r.creator ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Words that mean a recipe's family when searching. */
const FAMILY_WORDS: Record<string, string[]> = {
  whoosh: ["whoosh", "swoosh", "swish", "woosh", "swipe", "whip", "transition", "pass", "fly"],
  impact: ["impact", "hit", "boom", "punch", "thud", "slam", "drop", "bass", "sub", "kick"],
  riser: ["riser", "rise", "build", "swell", "tension", "uplifter", "reverse"],
  click: ["click", "tap", "key", "keyboard", "typing", "toggle", "button", "mouse"],
  ui: ["ui", "pop", "blip", "notification", "shutter", "camera", "bubble"],
  texture: ["glitch", "static", "noise", "sparkle", "shimmer", "digital", "error"],
  transition: ["transition", "swoosh", "hit", "whoosh"],
};

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
}

/** How well a recipe answers a query (0: not at all). */
function recipeScore(recipe: SfxRecipe, query: string): number {
  const own = new Set([...words(recipe.id.replace(/_/g, " ")), ...words(recipe.title)]);
  const use = new Set(words(recipe.use));
  const family = new Set(FAMILY_WORDS[recipe.family] ?? []);
  return words(query).reduce((s, w) => s + (own.has(w) ? 3 : 0) + (family.has(w) ? 2 : 0) + (use.has(w) ? 1 : 0), 0);
}

/** The procedural recipes that answer a query, best first. */
export function searchRecipes(query: string, filters: Pick<SfxSearchFilters, "minSeconds" | "maxSeconds">, limit: number): SfxLibraryResult[] {
  return SFX_RECIPES.map((recipe) => ({ recipe, score: recipeScore(recipe, query) }))
    .filter(({ recipe, score }) => score > 0 && recipe.duration.max >= filters.minSeconds && recipe.duration.min <= filters.maxSeconds)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ recipe }) => ({
      provider: "procedural" as const,
      id: recipe.id,
      title: recipe.title,
      license: "zenvi",
      license_name: "generated by Zenvi (no licence needed)",
      attribution: "",
      attribution_required: false,
      commercial_use: true,
      duration: Math.min(Math.max(recipe.duration.default, filters.minSeconds), filters.maxSeconds),
      tags: [recipe.family],
    }));
}

/** What a library sound's project file records about where it came from (`file.zenvi_credit`): list_credits_tool reads it. */
export interface SfxCredit {
  provider: SfxLibraryProvider;
  id: string;
  title: string;
  creator?: string;
  license: string;
  license_name: string;
  license_url?: string;
  attribution: string;
  attribution_required: boolean;
  landing_url?: string;
  source?: string;
}

export function creditOf(result: SfxLibraryResult & { provider: SfxLibraryProvider }): SfxCredit {
  const { provider, id, title, creator, license, license_name, license_url, attribution, attribution_required, landing_url, source } = result;
  return { provider, id, title, creator, license, license_name, license_url, attribution, attribution_required, landing_url, source };
}
