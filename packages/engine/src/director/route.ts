/**
 * The director's router: from the person's request and the media bin to ONE
 * style of the styles index (plugins/zenvi/skills/zenvi-styles/SKILL.md), the
 * one-call builder that cuts it and the finish its recipe asks for. Bench
 * rounds 6-7: agents read a recipe in 6 of 52 runs and called a builder once,
 * so produce_video_tool makes these choices itself and says which it made.
 *
 * Deterministic: words of the request score the styles (the index's "use
 * when" column, as keywords), what the bin holds breaks ties (a speaker, a
 * voice-over), and a builder whose ingredients are missing falls back to the
 * reel builder with the reason recorded.
 */

import type { InventoryEntry } from "../brief/inventory.js";

/** The builders the router picks from, with the arguments that make them this style. */
export type BuilderPlan =
  | { tool: "build_reel_tool"; style: "hype" | "cinematic" | "highlight" | "editorial" | "ui_promo" | "editorial_motion" | "product_callout" | "tutorial" }
  | { tool: "match_cut_montage_tool"; transitions: "punch" | "flash" }
  | { tool: "build_trailer_tool" }
  | { tool: "build_explainer_tool"; pace: "documentary" | "essay" }
  | { tool: "build_talking_head_tool" }
  | { tool: "build_product_launch_tool" };

export type SoundGenre = "hype" | "flash_montage" | "saas_ui" | "talking_head" | "match_cut" | "product_3d" | "video_essay" | "documentary" | "editorial" | "multiplicity";

/** Transitions the style's recipe puts on its cuts: a style mix, one preset, or none (match cuts and type stay hard). */
export type TransitionPlan = { style: "hype" | "cinematic" } | { preset: "whip" | "zoom_through" | "blur_dissolve" | "flash_white" | "glitch" } | "none";

export interface StyleRule {
  /** The styles index id (recipe or style file). */
  id: string;
  /** Request words that pick it. */
  words: RegExp;
  builder: BuilderPlan;
  sound: SoundGenre;
  /** auto_sound_design_tool intensity. */
  intensity: "subtle" | "normal" | "hype";
  transitions: TransitionPlan;
  /** unify_grade_tool look (list_looks_tool id), or null for the footage's own colour. */
  look: string | null;
  /** Length when the request names none, seconds. */
  seconds: number;
  /** Music the style cuts to when the bin has none. */
  music: { query: string; bpm: number; energy: "low" | "medium" | "high" };
  /** Stock gathered as one shoot (product, brand, explainer) rather than the most varied clips (montages). */
  coherent: boolean;
  /** The beats of the brief, as shares of the length: [name, from, to, what it does]. */
  beats: readonly (readonly [string, number, number, string])[];
}

const MONTAGE_BEATS = [
  ["hook", 0, 0.12, "the strongest image and the first hit at 0.0 s"],
  ["build", 0.12, 0.7, "shots on the beat, rising pace"],
  ["peak", 0.7, 0.9, "the drop: the fastest cuts and the hero shot"],
  ["end", 0.9, 1, "a held last shot or end card"],
] as const;
const STORY_BEATS = [
  ["hook", 0, 0.15, "the question or promise in the first 2 s"],
  ["body", 0.15, 0.8, "the story, one idea per beat"],
  ["turn", 0.8, 0.92, "the one heaviest moment"],
  ["end card", 0.92, 1, "the name, the line, the call to action"],
] as const;
const LAUNCH_BEATS = [
  ["problem", 0, 0.15, "the pain, one line"],
  ["reveal", 0.15, 0.35, "the product named on a hit"],
  ["features", 0.35, 0.8, "one feature per bar"],
  ["end card", 0.8, 1, "logo, line and URL"],
] as const;

/** In priority order: on a tie the earlier rule wins. */
export const STYLE_RULES: readonly StyleRule[] = [
  {
    id: "match-cut-montage",
    words: /\bmatch[- ]?cuts?\b|\bfull[- ]circle\b|\bshape match|\bsame (shape|pose)\b|\bcircles?\b/g,
    builder: { tool: "match_cut_montage_tool", transitions: "punch" },
    sound: "match_cut",
    intensity: "normal",
    transitions: "none",
    look: null,
    seconds: 15,
    music: { query: "cinematic percussion build", bpm: 120, energy: "high" },
    coherent: false,
    beats: MONTAGE_BEATS,
  },
  {
    id: "flash-montage",
    words: /\bflash(es|ing)?\b|\bflash[- ]?(cut|montage|frames?)\b|\bevolution of\b|\bstrobe\b|\b\d[- ]frames?\b/g,
    builder: { tool: "match_cut_montage_tool", transitions: "flash" },
    sound: "flash_montage",
    intensity: "hype",
    transitions: "none",
    look: null,
    seconds: 15,
    music: { query: "intense electronic build", bpm: 140, energy: "high" },
    coherent: false,
    beats: MONTAGE_BEATS,
  },
  {
    id: "movie-game-trailer",
    words: /\btrailers?\b|\bteaser\b|\bcoming soon\b|\bbraams?\b/g,
    builder: { tool: "build_trailer_tool" },
    sound: "hype",
    intensity: "normal",
    transitions: "none",
    look: "teal_cinema",
    seconds: 40,
    music: { query: "epic cinematic trailer", bpm: 90, energy: "medium" },
    coherent: true,
    beats: STORY_BEATS,
  },
  {
    id: "kinetic-captions",
    words: /\btalking[- ]head\b|\btalking to (the )?camera\b|\bcaptions?\b|\bpodcast\b|\binterview\b|\btestimonial\b|\bcreator\b|\bspeaker\b/g,
    builder: { tool: "build_talking_head_tool" },
    sound: "talking_head",
    intensity: "normal",
    transitions: { preset: "whip" },
    look: null,
    seconds: 30,
    music: { query: "lofi hip hop beat", bpm: 90, energy: "low" },
    coherent: true,
    beats: STORY_BEATS,
  },
  {
    id: "documentary",
    words: /\bdocumentary\b|\bvoice[- ]?over\b|\bnarrat(ion|ed|or)\b|\bvideo[- ]essay\b|\btrue story\b|\bexplainer\b|\bexplains?\b|\btts\b/gi,
    builder: { tool: "build_explainer_tool", pace: "documentary" },
    sound: "documentary",
    intensity: "subtle",
    transitions: { style: "cinematic" },
    look: "elegant_dark_cinema",
    seconds: 30,
    music: { query: "ambient cinematic documentary", bpm: 80, energy: "low" },
    coherent: true,
    beats: STORY_BEATS,
  },
  {
    id: "saas-ui-promo",
    words: /\bsaas\b|\bapp\b|\bai (tool|platform|agent)s?\b|\bplatform\b|\bsoftware\b|\bdashboard\b|\bui\b|\bglass\b|\bstartup\b/gi,
    builder: { tool: "build_product_launch_tool" },
    sound: "saas_ui",
    intensity: "normal",
    transitions: { preset: "blur_dissolve" },
    look: null,
    seconds: 20,
    music: { query: "corporate minimal tech", bpm: 120, energy: "medium" },
    coherent: true,
    beats: LAUNCH_BEATS,
  },
  {
    id: "3d-product-ad",
    words: /\b3d\b|\bproduct (ad|shot|render|spot)\b|\b(earbuds|headphones|bottle|sneaker|watch|device|phone)\b|\bcgi\b|\bspins?\b/gi,
    builder: { tool: "build_product_launch_tool" },
    sound: "product_3d",
    intensity: "normal",
    transitions: { preset: "zoom_through" },
    look: null,
    seconds: 15,
    music: { query: "minimal electronic product", bpm: 110, energy: "medium" },
    coherent: true,
    beats: LAUNCH_BEATS,
  },
  {
    id: "product-launch-film",
    words: /\blaunch(es|ing)?\b|\bproduct\b|\bpromo\b|\bads?\b|\bcommercial\b/gi,
    builder: { tool: "build_product_launch_tool" },
    sound: "saas_ui",
    intensity: "normal",
    transitions: { style: "hype" },
    look: null,
    seconds: 20,
    music: { query: "uplifting electronic launch", bpm: 120, energy: "high" },
    coherent: true,
    beats: LAUNCH_BEATS,
  },
  {
    id: "editorial-type",
    words: /\beditorial\b|\btypograph(y|ic)\b|\bkinetic type\b|\btype[- ]led\b|\bmanifesto\b|\bletters?\b|\bfashion\b|\bdesign study\b/gi,
    builder: { tool: "build_reel_tool", style: "editorial" },
    sound: "editorial",
    intensity: "normal",
    transitions: "none",
    look: null,
    seconds: 15,
    music: { query: "minimal techno", bpm: 124, energy: "medium" },
    coherent: false,
    beats: MONTAGE_BEATS,
  },
  {
    id: "tutorial",
    words: /\btutorial\b|\bhow[- ]to\b|\btips\b|\bsteps?\b|\brecipe\b|\bbreakdown\b/gi,
    builder: { tool: "build_reel_tool", style: "tutorial" },
    sound: "saas_ui",
    intensity: "normal",
    transitions: { preset: "whip" },
    look: null,
    seconds: 30,
    music: { query: "upbeat lofi", bpm: 100, energy: "medium" },
    coherent: true,
    beats: STORY_BEATS,
  },
  {
    id: "travel-cinematic-montage",
    words: /\btravel\b|\btrip\b|\bcity\b|\bdestination\b|\bcinematic\b|\bmoody\b|\bwedding\b|\breal estate\b|\bbrand (film|story)\b/gi,
    builder: { tool: "build_reel_tool", style: "cinematic" },
    sound: "documentary",
    intensity: "subtle",
    transitions: { style: "cinematic" },
    look: "warm_cinema",
    seconds: 20,
    music: { query: "cinematic ambient piano", bpm: 90, energy: "low" },
    coherent: false,
    beats: MONTAGE_BEATS,
  },
  {
    id: "hype-reel",
    words: /\bhype\b|\bsports?\b|\bhighlights?\b|\bgaming\b|\bevent\b|\bcars?\b|\bedit to\b|\benergetic\b|\bfast cuts?\b|\bmontage\b|\bgrid\b|\bsplit[- ]screen\b/gi,
    builder: { tool: "build_reel_tool", style: "hype" },
    sound: "hype",
    intensity: "hype",
    transitions: { style: "hype" },
    look: null,
    seconds: 15,
    music: { query: "energetic electronic trap", bpm: 140, energy: "high" },
    coherent: false,
    beats: MONTAGE_BEATS,
  },
];

const RULES_BY_ID = new Map(STYLE_RULES.map((r) => [r.id, r]));
/** Nothing in the request names a style: a beat-cut reel is the most common ask. */
const DEFAULT_STYLE = "hype-reel";

/** What the bin offers the builders. */
export interface BinFacts {
  pictures: number;
  /** Footage files with sound that someone may be speaking in. */
  speakers: string[];
  voices: string[];
  music: string[];
}

export function binFacts(entries: readonly InventoryEntry[]): BinFacts {
  return {
    pictures: entries.filter((e) => e.kind === "video" || e.kind === "image").length,
    speakers: entries.filter((e) => e.kind === "video" && e.speech === "yes").map((e) => e.id),
    voices: entries.filter((e) => e.kind === "voice").map((e) => e.id),
    music: entries.filter((e) => e.kind === "music").map((e) => e.id),
  };
}

export interface RouteInput {
  request: string;
  /** A style id the caller chose (the index's id). */
  style?: string;
  bin: BinFacts;
  /** Facts the builder needs that the request may hold. */
  product?: string;
  features?: number;
  script?: boolean;
}

export interface Route {
  rule: StyleRule;
  builder: BuilderPlan;
  /** Why this style: the words that matched, or the caller's choice. */
  why: string;
  /** Set when the style's own builder could not run: what it was and why not. */
  fallback?: { wanted: BuilderPlan["tool"]; why: string };
  /** Other styles that scored, best first. */
  runnersUp: string[];
}

/** The request words that pick `rule`; its own name ("hype reel", "flash montage") counts three times. */
function score(rule: StyleRule, request: string): string[] {
  const text = request.toLowerCase().replace(/[-_]/g, " ");
  const hits = [...text.matchAll(rule.words)].map((m) => m[0]);
  const own = rule.id.replace(/-/g, " ");
  return text.includes(own) ? [own, own, own, ...hits] : hits;
}

/** The style for `input`, its builder, and the fallback when the builder's ingredients are not there. */
export function routeRequest(input: RouteInput): Route {
  const request = input.request;
  let rule: StyleRule | undefined = input.style ? RULES_BY_ID.get(input.style) : undefined;
  let why = rule ? `style ${rule.id} as asked` : "";
  const scored = STYLE_RULES.map((r) => ({ r, hits: score(r, request) })).filter((s) => s.hits.length > 0);
  // The bin speaks too: someone talking on camera, or a voice-over, is the clock of the edit.
  for (const s of scored) {
    if (s.r.id === "kinetic-captions" && input.bin.speakers.length > 0) s.hits.push("a speaker in the bin");
    if (s.r.id === "documentary" && input.bin.voices.length > 0) s.hits.push("a voice-over in the bin");
  }
  const ranked = [...scored].sort((a, b) => b.hits.length - a.hits.length || STYLE_RULES.indexOf(a.r) - STYLE_RULES.indexOf(b.r));
  if (!rule) {
    const best = ranked[0];
    rule = best ? best.r : RULES_BY_ID.get(DEFAULT_STYLE)!;
    why = best ? `the request says ${[...new Set(best.hits)].slice(0, 4).map((h) => `"${h}"`).join(", ")}` : "nothing in the request names a style: a beat-cut reel";
  }
  const runnersUp = ranked.map((s) => s.r.id).filter((id) => id !== rule!.id).slice(0, 3);
  const missing = missingIngredient(rule.builder, input);
  if (!missing) return { rule, builder: rule.builder, why, runnersUp };
  const builder = fallbackFor(rule);
  return { rule, builder, why, fallback: { wanted: rule.builder.tool, why: missing }, runnersUp };
}

/** What `builder` needs that the bin and the request do not give, or null. */
function missingIngredient(builder: BuilderPlan, input: RouteInput): string | null {
  switch (builder.tool) {
    case "build_talking_head_tool":
      return input.bin.speakers.length > 0 ? null : "no footage of someone speaking in the bin (inspect_media_bin_tool: speech yes)";
    case "build_explainer_tool":
      return input.bin.voices.length > 0 || input.script ? null : "no voice-over in the bin and no script (pass script, or generate_tts_and_add_to_timeline_tool first)";
    case "build_product_launch_tool":
      if (!input.product) return "no product name (pass product, or name it in quotes in the request)";
      return (input.features ?? 0) > 0 ? null : "no features (pass features: one per bar)";
    case "match_cut_montage_tool":
      return input.bin.pictures >= 3 ? null : `${input.bin.pictures} picture file(s): a match-cut chain needs at least 3`;
    default:
      return input.bin.pictures > 0 || builder.tool !== "build_trailer_tool" ? null : "no footage for the trailer";
  }
}

/** The reel style that stands in for a builder that cannot run. */
export function fallbackFor(rule: StyleRule): BuilderPlan {
  switch (rule.builder.tool) {
    case "build_product_launch_tool":
      return { tool: "build_reel_tool", style: rule.id === "3d-product-ad" ? "product_callout" : "ui_promo" };
    case "build_explainer_tool":
    case "build_trailer_tool":
      return { tool: "build_reel_tool", style: "cinematic" };
    case "build_talking_head_tool":
      return { tool: "build_reel_tool", style: "editorial" };
    default:
      return { tool: "build_reel_tool", style: "hype" };
  }
}

export function styleRule(id: string): StyleRule | undefined {
  return RULES_BY_ID.get(id);
}
