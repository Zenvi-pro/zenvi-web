/**
 * produce_video_tool: the director as code. One call takes a request (and
 * the media bin) to a finished, reviewed render: the brief (compiled from
 * the request when the project has none), the style of the styles index and
 * the one-call builder that cuts it (director/route.ts), the footage and
 * music it needs, the finish its recipe asks for (grade continuity, motion
 * transitions by the style's rules, sound design, master), the render, and
 * review_render_tool / watch_render_tool on it. Its report is the review's
 * findings with the exact next calls, so an agent's turns go to fixing what
 * the review names instead of assembling the edit by hand.
 *
 * Bench rounds 6-7 (zenvi-motion fleet w61): agents read the director recipe
 * in 6 of 52 runs, called a builder once and a review tool never; the
 * library existed and went unused.
 *
 * The brief is the auto brief every surface saves (brief/auto.ts ensureBrief,
 * outside the undo history), drawn from what the director read of the whole
 * request. Every other stage is an ordinary tool call on the project, so
 * each one is its own undo step (one user intent a stage: undoing the sound
 * design keeps the cut), each receipt is summarised in the report, and every
 * stage can be skipped by parameter. A stage that fails is recorded and the rest go on
 * where they still make sense; nothing is refused after the first change.
 */

import { z } from "zod";
import { ensureBrief, nearestAspect } from "../../brief/auto.js";
import { houseStyle } from "../../brief/house.js";
import { briefSummary, readBrief, type Brief, type BriefAspect } from "../../brief/brief.js";
import { inventoryEntry, inventoryFiles } from "../../brief/inventory.js";
import { readRequest } from "../../director/request.js";
import { binFacts, fallbackFor, routeRequest, STYLE_RULES, type BuilderPlan, type Route, type SoundGenre } from "../../director/route.js";
import { finishGaps } from "../../review/finish.js";
import { STYLE_FILES } from "../../styles/index.js";
import type { Problem } from "../../review/render.js";
import type { ShotSwap } from "../../review/swaps.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import { applied, refused, type ToolReceipt } from "../receipt.js";
// A cycle (the registry lists this tool), safe because runTool is only called while a tool runs (master-loop.ts does the same).
import { runTool } from "../registry.js";
import type { ToolImage } from "../types.js";

const TOOL = "produce_video_tool";

export const PRODUCE_STAGES = ["brief", "format", "footage", "music", "build", "grade", "transitions", "sound", "master", "render", "review", "watch"] as const;
type Stage = (typeof PRODUCE_STAGES)[number];

/** Picture files a style wants in the bin before it cuts: montages need variety, the others a set. */
const MONTAGE_PICTURES = 10;
const SET_PICTURES = 6;
/** Fewer missing than this is not worth a stock search. */
const MIN_GATHER = 2;
const MAX_GATHER = 12;
const SUMMARY_CHARS = 220;
/** The styles index, as the auto brief and the router match it. */
const STYLES = STYLE_FILES.filter((f) => f.kind === "style");
/** A brief's longest goal and line (brief.ts). */
const GOAL_CHARS = 300;
/** The lengths the builders cut (build_reel_tool's duration_seconds). */
const MIN_SECONDS = 4;
const MAX_SECONDS = 120;
/** Frame sizes for an aspect the request names without a size. */
const FRAME: Record<BriefAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};
/** master_audio_tool's Sound Score bands for each sound palette. */
const MASTER_GENRE: Record<SoundGenre, string> = {
  hype: "hype",
  flash_montage: "flash_montage",
  saas_ui: "saas_ui",
  talking_head: "talking_head",
  match_cut: "match_cut",
  product_3d: "product_3d",
  video_essay: "video_essay",
  documentary: "video_essay",
  editorial: "editorial",
  multiplicity: "multiplicity",
};

const feature = z.union([z.string().trim().min(1).max(100), z.strictObject({ title: z.string().min(1).max(40), detail: z.string().max(60).optional() })]);

const input = z.strictObject({
  request: z
    .string()
    .trim()
    .min(1)
    .max(6000)
    .optional()
    .describe("The person's request as they wrote it (a brief, a reference to recreate, 'a reel of my trip'). Its length, frame, tempo, quoted names, headline, URL and suggested searches are read from it. Optional once a brief is saved (re-runs: its goal and style)."),
  style: z
    .enum(STYLE_RULES.map((r) => r.id) as [string, ...string[]])
    .optional()
    .describe("A style of the styles index instead of the one the request reads as."),
  length_seconds: z.coerce.number().min(MIN_SECONDS).max(MAX_SECONDS).optional().describe("Target length, seconds (default: the request's, else the style's)."),
  title: z.string().trim().min(1).max(80).optional().describe("The product, film or brand name (product launch, trailer); default: the name the request quotes after 'called' / 'named'."),
  hook: z.string().trim().min(1).max(120).optional().describe("The opening line (default: a quoted headline in the request)."),
  features: z.array(feature).min(1).max(5).optional().describe("Product launch / SaaS promo: one feature per bar ('Title: detail' or {title, detail}). Without them a launch is cut as a motion reel."),
  script: z.string().trim().min(1).max(4000).optional().describe("Voice-led styles with no voice-over in the bin: the narration, timed at reading pace and captioned."),
  end_card: z.string().trim().min(1).max(80).optional().describe("The closing card (default: a URL in the request)."),
  stock_queries: z.array(z.string().trim().min(1).max(200)).max(24).optional().describe("Stock searches when the bin is short of footage, one per shot idea (the first 12 are searched; default: the searches the request suggests, else its subject)."),
  music_query: z.string().trim().min(1).max(80).optional().describe("Freesound search for the music when the bin has none (default: the request's, else the style's)."),
  bpm: z.coerce.number().min(40).max(220).optional().describe("Music tempo wanted (default: the request's, else the style's)."),
  output: z.string().trim().min(1).max(400).optional().describe("Render path (default produce.mp4 in the project's folder)."),
  replace: z.boolean().optional().describe("Clear the timeline first when it already has clips (the builder does it in its own undo step)."),
  skip: z.array(z.enum(PRODUCE_STAGES)).max(PRODUCE_STAGES.length).optional().describe("Stages not to run: brief, format, footage, music, build, grade, transitions, sound, master, render, review, watch."),
});
type Input = z.output<typeof input>;
type Request = Input & { request: string };

interface StageRecord {
  stage: Stage;
  tool: string;
  outcome: "applied" | "unchanged" | "skipped" | "failed";
  summary: string;
  undo_steps: number;
}

interface Finding {
  from: "review_render_tool" | "watch_render_tool" | "finish";
  severity: string;
  at?: number;
  message: string;
  tools?: string[];
}

interface NextCall {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function firstLine(text: string): string {
  const line = (text.split("\n")[0] ?? "").replace(/^Error:\s*/, "").trim();
  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS - 1)}…` : line;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

class Director {
  readonly stages: StageRecord[] = [];
  readonly next: NextCall[] = [];
  readonly images: ToolImage[] = [];
  private readonly skip: Set<Stage>;

  constructor(
    readonly call: ToolCall,
    skip: readonly Stage[],
  ) {
    this.skip = new Set(skip);
  }

  wants(stage: Stage): boolean {
    if (this.call.signal?.aborted) return false;
    if (this.skip.has(stage)) {
      this.stages.push({ stage, tool: "-", outcome: "skipped", summary: "skipped as asked", undo_steps: 0 });
      return false;
    }
    return true;
  }

  pass(stage: Stage, why: string): void {
    this.stages.push({ stage, tool: "-", outcome: "skipped", summary: why, undo_steps: 0 });
  }

  /** One stage: one tool call on the project (its own undo step), summarised. */
  async run(stage: Stage, tool: string, args: Record<string, unknown>): Promise<ToolReceipt | null> {
    const before = this.call.doc.undoLabels.length;
    const result = await runTool({ doc: this.call.doc, host: this.call.host, signal: this.call.signal }, tool, args);
    const receipt = result.data;
    const ok = receipt !== undefined && (receipt.status === "applied" || receipt.status === "unchanged");
    this.stages.push({
      stage,
      tool,
      outcome: ok ? receipt.status as "applied" | "unchanged" : "failed",
      summary: firstLine(receipt?.summary ?? result.text),
      undo_steps: this.call.doc.undoLabels.length - before,
    });
    if (ok && result.images) this.images.push(...result.images);
    return ok ? receipt : null;
  }
}

/** The builder's arguments for this request. */
function builderArgs(plan: BuilderPlan, ctx: { args: Request; route: Route; seconds: number; name: string | null; hook: string | null; endCard: string | null; url: string | null; music: string | null; bpm: number | null; pictures: string[]; voices: string[]; speakers: string[]; replace: boolean }): Record<string, unknown> {
  const { args } = ctx;
  const common = { ...(ctx.music ? { music_file_id: ctx.music } : {}), ...(ctx.replace ? { replace: true } : {}) };
  switch (plan.tool) {
    case "build_reel_tool": {
      const words = (args.features ?? []).map((f) => (typeof f === "string" ? f : f.title));
      return {
        style: plan.style,
        duration_seconds: ctx.seconds,
        ...(ctx.hook ? { hook: ctx.hook } : {}),
        ...(ctx.endCard ? { end_card: ctx.endCard } : {}),
        ...(words.length > 0 ? { words } : {}),
        ...(ctx.bpm ? { bpm: ctx.bpm } : {}),
        ...common,
      };
    }
    case "match_cut_montage_tool":
      // Bench f1: the default zoom_all on a circle found in footage that has none blew shots up to 1.6-1.8 frames tall; moved, not resized, unless subjects are given.
      return { file_ids: ctx.pictures, fit: "position", cover: "zoom", transitions: plan.transitions, duration_seconds: Math.min(60, ctx.seconds), ...(plan.transitions === "flash" ? { min_frames: 2, max_frames: 6 } : {}), ...(ctx.bpm ? { bpm: ctx.bpm } : {}), ...common };
    case "build_trailer_tool":
      return { title: ctx.name, duration_seconds: Math.max(15, ctx.seconds), ...(ctx.endCard ? { end_card: ctx.endCard } : {}), ...common };
    case "build_explainer_tool":
      return {
        ...(ctx.voices[0] ? { voice_file_id: ctx.voices[0] } : args.script ? { script: args.script } : {}),
        pace: plan.pace,
        ...(args.length_seconds ? { duration_seconds: ctx.seconds } : {}),
        ...(ctx.hook ? { hook: ctx.hook } : {}),
        ...common,
      };
    case "build_talking_head_tool":
      return { speaker_file_ids: ctx.speakers, ...(ctx.hook && ctx.hook.split(/\s+/).length <= 3 ? { hook: ctx.hook } : {}), ...common };
    case "build_product_launch_tool":
      return {
        product: ctx.name,
        features: args.features,
        ...(ctx.hook ? { tagline: ctx.hook } : {}),
        ...(ctx.endCard && ctx.endCard !== ctx.url ? { cta: ctx.endCard } : {}),
        ...(ctx.url ? { url: ctx.url } : {}),
        duration_seconds: Math.max(6, ctx.seconds),
        ...common,
      };
  }
}

/** The beats a builder cut to (build_reel_tool and match_cut_montage_tool report them), for the sound design. */
function beatsOf(receipt: ToolReceipt | null): number[] | undefined {
  const beats = record(receipt?.data).beats;
  return Array.isArray(beats) && beats.length > 1 && beats.every((b) => typeof b === "number") ? (beats as number[]) : undefined;
}

function reviewFindings(receipt: ToolReceipt | null): Finding[] {
  const problems = record(receipt?.data).problems;
  if (!Array.isArray(problems)) return [];
  return (problems as Problem[]).map((p) => ({ from: "review_render_tool" as const, severity: p.severity, ...(p.at !== undefined ? { at: p.at } : {}), message: p.message }));
}

function watchFindings(receipt: ToolReceipt | null): Finding[] {
  const issues = record(receipt?.data).issues;
  if (!Array.isArray(issues)) return [];
  return issues.map((raw) => {
    const issue = record(raw);
    return {
      from: "watch_render_tool" as const,
      severity: String(issue.severity ?? "medium"),
      ...(typeof issue.start === "number" ? { at: issue.start } : {}),
      message: `${String(issue.dimension ?? "")}: ${String(issue.problem ?? "")} Fix: ${String(issue.fix ?? "")}`.trim(),
      tools: Array.isArray(issue.tools) ? issue.tools.map(String) : [],
    };
  });
}

async function produce(call: ToolCall, args: Request, requested: boolean): Promise<{ receipt: ToolReceipt; images?: ToolImage[] }> {
  const director = new Director(call, args.skip ?? []);
  const project = () => call.doc.project;
  const facts = readRequest(args.request);
  const entries = () => inventoryFiles(project()).map((f) => inventoryEntry(project(), f));
  // An auto brief saved earlier (the MCP server's, from one call's arguments) is redrawn from the whole request.
  const found = readBrief(project());
  const saved = found && (!found.auto || !requested) ? found : null;
  const name = args.title ?? facts.name;
  const hook = args.hook ?? facts.headline;
  const endCard = args.end_card ?? facts.url;
  // The saved brief's style leads when the index has it, with a builder of its own or not (route.ts ruleFor).
  const style = args.style ?? (saved && STYLES.some((s) => s.id === saved.style) ? saved.style : undefined);
  const route = (chosen: string | undefined): Route =>
    routeRequest({ request: `${args.request} ${saved && !chosen ? saved.style : ""}`, candidates: STYLES, style: chosen, bin: binFacts(entries()), product: name ?? undefined, features: args.features?.length, script: Boolean(args.script) });
  let plan = route(style);
  const rule = plan.rule;
  const seconds = args.length_seconds ?? facts.seconds ?? saved?.length_seconds ?? rule.seconds;
  // A length the builders cannot cut is refused before anything changes, not cut short.
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) return { receipt: refused(TOOL, `Error: the request asks for ${seconds} s; produce_video_tool cuts ${MIN_SECONDS}-${MAX_SECONDS} s, nothing changed. Pass length_seconds (${MIN_SECONDS}-${MAX_SECONDS}), or cut it in parts.`) };
  const projectAspect = nearestAspect(project());
  const aspect: BriefAspect = facts.aspect ?? (facts.size ? nearestAspect(facts.size) : null) ?? saved?.aspect ?? projectAspect;
  const missingFor = (route: Route): string[] => [
    ...(route.fallback ? [`${route.fallback.wanted}: ${route.fallback.why}`] : []),
    ...(!name && (rule.builder.tool === "build_product_launch_tool" || rule.builder.tool === "build_trailer_tool") ? ["the product or film name"] : []),
  ];
  let missing = missingFor(plan);

  // 1. The brief: the saved one leads; else the auto brief, drawn from the request (outside the undo history, as on every surface).
  let brief: Brief | null = saved;
  if (director.wants("brief")) {
    if (saved) director.pass("brief", `kept the saved brief (${saved.style}, ${saved.length_seconds}s)`);
    else {
      const firstSentence = args.request.split(/(?<=[.!?])\s|\n/)[0] ?? args.request;
      const bpm = args.bpm ?? facts.bpm ?? rule.music.bpm;
      // A house style draws its techniques away from what the last films on this host drew.
      const avoid = houseStyle(rule.id) && call.host.draws ? await call.host.draws.recent().catch(() => []) : [];
      brief = ensureBrief(call.doc, args.request, STYLES, {
        avoid,
        style: rule.id,
        aspect,
        length_seconds: seconds,
        goal: clipText(firstSentence, GOAL_CHARS),
        ...(facts.platform ? { platform: clipText(facts.platform, 60) } : {}),
        ...(hook ? { hook: clipText(`"${hook}" over the first shot, on the first hit at 0.0 s`, GOAL_CHARS) } : {}),
        music: clipText(`${args.music_query ?? facts.musicQuery ?? rule.music.query}, about ${bpm} BPM, ${rule.music.energy} energy`, GOAL_CHARS),
        sound: clipText(`${rule.sound} palette, ${rule.intensity}: a sound on the cuts and moves, mastered to -14 LUFS`, GOAL_CHARS),
        ...(endCard ? { end_card: clipText(endCard, GOAL_CHARS) } : {}),
        missing: missing.slice(0, 8).map((m) => clipText(m, 200)),
      });
      const auto = brief ?? readBrief(project());
      brief = auto;
      if (auto?.draw) await call.host.draws?.remember(auto.draw.picks.map((p) => p.technique), project().id).catch(() => undefined);
      director.stages.push({ stage: "brief", tool: TOOL, outcome: "applied", summary: auto ? `saved a minimal brief (auto): ${auto.style}, ${auto.aspect} ${auto.length_seconds}s` : "no brief saved", undo_steps: 0 });
    }
  }

  // 2. The frame the request names, while the timeline is empty.
  const frame = facts.size ?? FRAME[aspect];
  if (director.wants("format")) {
    const sameFrame = (project().width === frame.width && project().height === frame.height) || (!facts.size && aspect === projectAspect);
    const rate = projectFps(project());
    const sameRate = !facts.fps || Math.abs(rate.num / rate.den - facts.fps) < 0.01;
    if (sameFrame && sameRate) director.pass("format", `the project is already ${project().width}x${project().height}`);
    else if (project().clips.length > 0) director.pass("format", `the timeline has clips: the frame stays ${project().width}x${project().height}`);
    else await director.run("format", "set_project_setting_tool", { ...(sameFrame ? {} : { width: frame.width, height: frame.height }), ...(sameRate ? {} : { fps: facts.fps }) });
  }

  // 3. Footage: stock when the bin is short of pictures for the style.
  const montage = rule.builder.tool === "match_cut_montage_tool" || (rule.builder.tool === "build_reel_tool" && rule.builder.style === "hype");
  const wanted = montage ? MONTAGE_PICTURES : SET_PICTURES;
  const pictures = binFacts(entries()).pictures;
  const queries = (args.stock_queries ?? (facts.searches.length > 0 ? facts.searches : [facts.subject || rule.id.replace(/-/g, " ")])).slice(0, MAX_GATHER);
  if (director.wants("footage")) {
    // Searches the caller named are each worth a clip (round-robin), up to the most one call gathers.
    const needed = Math.min(MAX_GATHER, Math.max(wanted, args.stock_queries?.length ?? 0) - pictures);
    if (facts.noStock) director.pass("footage", "the request rules out stock: the bin's footage only");
    else if (needed < MIN_GATHER) director.pass("footage", `the bin has ${pictures} picture file(s)`);
    else {
      await director.run("footage", "gather_stock_footage_tool", {
        queries,
        count: needed,
        orientation: aspect === "9:16" || aspect === "4:5" ? "portrait" : aspect === "1:1" ? "any" : "landscape",
        min_seconds: 2,
        max_seconds: 30,
        ...(rule.coherent ? { coherence: "shoot" } : {}),
      });
    }
  }

  // 4. Music at the style's tempo when the bin has none.
  let music = binFacts(entries()).music[0] ?? null;
  const bpm = args.bpm ?? facts.bpm ?? null;
  if (director.wants("music")) {
    if (music) director.pass("music", `the bin has music (${music})`);
    else {
      const query = args.music_query ?? facts.musicQuery ?? rule.music.query;
      const found = await director.run("music", "search_freesound_music_tool", { query, bpm: bpm ?? rule.music.bpm, energy: rule.music.energy, min_seconds: Math.ceil(seconds), count: 4 });
      const data = record(found?.data);
      const pick = record((Array.isArray(data.results) && data.results[0]) || (Array.isArray(data.nearest) && data.nearest[0]));
      if (pick.sound_id !== undefined) {
        const known = new Set(project().files.map((f) => String(f.id)));
        await director.run("music", "import_stock_media_tool", { source: "freesound", sound_id: pick.sound_id, preview_url: pick.preview_url });
        music = project().files.map((f) => String(f.id)).find((id) => !known.has(id)) ?? null;
      } else if (found) director.pass("music", `no Freesound track for '${query}': the cut follows the style's own tempo`);
    }
  }

  // 5. The builder: the whole first cut in one undo step. Routed again: the bin may have grown.
  plan = { ...route(rule.id), why: plan.why, runnersUp: plan.runnersUp };
  missing = missingFor(plan);
  let built: ToolReceipt | null = null;
  // What the report states: the length the builder cut for (a trailer and a launch film have a floor, a match-cut montage a ceiling).
  let cutSeconds = seconds;
  if (director.wants("build")) {
    const bin = binFacts(entries());
    const pictureIds = entries().filter((e) => e.kind === "video" || e.kind === "image").map((e) => e.id);
    const replace = args.replace ?? false;
    const builderInput = { args, route: plan, seconds, name, hook, endCard, url: facts.url, music, bpm, pictures: pictureIds, voices: bin.voices, speakers: bin.speakers, replace };
    const build = async (builder: BuilderPlan): Promise<ToolReceipt | null> => {
      const input = builderArgs(builder, builderInput);
      const receipt = await director.run("build", builder.tool, input);
      if (receipt && typeof input.duration_seconds === "number") cutSeconds = input.duration_seconds;
      return receipt;
    };
    built = await build(plan.builder);
    if (!built && plan.builder.tool !== "build_reel_tool") {
      // The style's builder refused (no speech heard, too few files): the reel builder still makes a first cut.
      built = await build(fallbackFor(rule));
    }
    for (const next of Array.isArray(record(built?.data).next_calls) ? (record(built?.data).next_calls as NextCall[]) : []) director.next.push(next);
  }

  // 6-9. The finish the recipe ends with, only what the edit still owes (review/finish.ts).
  // A build that ran and cut nothing leaves the timeline as it was: the finish is the new edit's, not the old one's.
  const noEdit = project().clips.length === 0 ? "nothing on the timeline" : director.wants("build") && !built ? "the edit was not cut" : null;
  const hasEdit = noEdit === null;
  const owed = () => new Set(finishGaps(project()).map((g) => g.kind));
  if (director.wants("grade")) {
    if (!hasEdit) director.pass("grade", noEdit);
    else if (!owed().has("grade")) director.pass("grade", "the footage already carries a grade, or is one source");
    else await director.run("grade", "unify_grade_tool", rule.look ? { look: rule.look, look_intensity: 0.6 } : {});
  }
  if (director.wants("transitions")) {
    if (!hasEdit) director.pass("transitions", noEdit);
    else if (rule.transitions === "none") director.pass("transitions", `${rule.id} keeps its cuts hard (its builder put its own moves on them)`);
    else if (!owed().has("transitions")) director.pass("transitions", "the cuts already move");
    else await director.run("transitions", "apply_motion_transitions_tool", { ...rule.transitions });
  }
  if (director.wants("sound")) {
    if (!hasEdit) director.pass("sound", noEdit);
    else if (!owed().has("sound")) director.pass("sound", "the cuts already have sound design");
    else {
      const beats = beatsOf(built);
      await director.run("sound", "auto_sound_design_tool", { genre: rule.sound, intensity: rule.intensity, ...(rule.intensity === "hype" ? { density: "every_cut" } : {}), ...(beats ? { beats } : {}) });
    }
  }
  if (director.wants("master")) {
    if (!hasEdit) director.pass("master", noEdit);
    else if (!owed().has("master")) director.pass("master", "the mix is mastered");
    else await director.run("master", "master_audio_tool", { preset: "social", iterate: true, genre: MASTER_GENRE[rule.sound] });
  }

  // 10-12. Render, then look and listen.
  let rendered: { path: string; seconds: number | null } | null = null;
  if (director.wants("render")) {
    const exporter = call.host.exporter;
    if (!hasEdit) director.pass("render", noEdit);
    else if (!exporter) director.pass("render", "this surface has no renderer (render in the editor's Export dialog)");
    else {
      try {
        const fps = projectFps(project());
        const result = await exporter.export(project(), { format: "mp4", width: project().width, height: project().height, fps: { num: fps.num, den: fps.den }, quality: "high", output: args.output ?? "produce.mp4" });
        rendered = { path: result.location, seconds: result.durationSeconds ?? null };
        director.stages.push({ stage: "render", tool: "exporter", outcome: "applied", summary: `rendered ${result.location}${result.durationSeconds ? ` (${result.durationSeconds.toFixed(1)} s)` : ""}`, undo_steps: 0 });
      } catch (error) {
        director.stages.push({ stage: "render", tool: "exporter", outcome: "failed", summary: firstLine(error instanceof Error ? error.message : String(error)), undo_steps: 0 });
      }
    }
  }
  let review: ToolReceipt | null = null;
  let watch: ToolReceipt | null = null;
  if (rendered && director.wants("review")) review = await director.run("review", "review_render_tool", { path: rendered.path });
  if (rendered && director.wants("watch")) {
    if (!call.host.watch) director.pass("watch", "watching with sound needs the zenvi CLI or Zenvi Cloud, signed in");
    else watch = await director.run("watch", "watch_render_tool", { path: rendered.path, ...(brief ? { brief: brief.goal } : {}) });
  }

  // The report: what it made, the findings worst first, the exact next calls.
  const findings: Finding[] = [
    ...reviewFindings(review).filter((f) => f.severity === "problem"),
    ...watchFindings(watch).filter((f) => f.severity === "high"),
    ...watchFindings(watch).filter((f) => f.severity !== "high"),
    ...reviewFindings(review).filter((f) => f.severity !== "problem"),
  ];
  // The review's own remedies as calls: swaps for repeated shots, else more footage and a new cut.
  const reviewed = record(review?.data);
  const swaps = Array.isArray(reviewed.swaps) ? (reviewed.swaps as ShotSwap[]) : [];
  for (const swap of swaps.slice(0, 4)) director.next.push({ tool: "swap_shot_tool", args: { clip_id: swap.clip_id, file_id: swap.to_file_id, start_seconds: swap.start_seconds }, why: `${swap.name} repeats at ${swap.at}s` });
  if (Array.isArray(reviewed.repeats) && reviewed.repeats.length > 0 && swaps.length === 0) {
    director.next.push({ tool: "gather_stock_footage_tool", args: { queries, count: Math.min(MAX_GATHER, reviewed.repeats.length + MIN_GATHER) }, why: "shots repeat and nothing in the bin is unused: more footage first" });
    director.next.push({ tool: TOOL, args: { replace: true, skip: ["brief", "format", "footage", "music"] }, why: "then cut again with the new footage, finish, render and review" });
  }
  // What the finish still owes is the new edit's; with none cut, the old timeline's gaps are not this call's to report.
  for (const gap of hasEdit ? finishGaps(project()) : []) {
    findings.push({ from: "finish", severity: "problem", message: gap.message });
    for (const next of gap.next) director.next.push({ ...next, why: gap.kind });
  }
  if (findings.length > 0 && rendered) {
    director.next.push({ tool: TOOL, args: { skip: ["brief", "format", "footage", "music", "build"], output: rendered.path }, why: "after the fixes: finish what is still owed, render, review and watch again" });
  }
  const failedStages = director.stages.filter((s) => s.outcome === "failed");
  const undoSteps = director.stages.reduce((n, s) => n + s.undo_steps, 0);
  const builder = director.stages.filter((s) => s.stage === "build" && s.outcome !== "failed").pop();
  const made = builder
    ? `Produced a ${rule.id} edit (${aspect}, ~${cutSeconds}s${cutSeconds !== seconds ? `, ${seconds}s asked: ${builder.tool} cuts no ${cutSeconds > seconds ? "shorter" : "longer"}` : ""}) with ${builder.tool}: ${builder.summary}`
    : `Did not cut the edit (${rule.id}): ${director.stages.filter((s) => s.stage === "build").map((s) => s.summary.replace(/\.$/, "")).join("; ") || "build skipped"}.`;
  const lines = [
    made,
    `Style: ${rule.id} because ${plan.why}${plan.fallback ? `; ${plan.fallback.wanted} could not run (${plan.fallback.why})` : ""}.`,
    brief ? briefSummary(brief).split("\n")[0]! : "No brief.",
    ...(brief?.draw ? [`Drawn techniques (${brief.draw.format}, ${brief.draw.energy}): ${brief.draw.picks.map((p) => p.technique).join(", ")}. get_technique_tool each; build the ones the concept carries in the film's own objects, drop the rest with a reason.`] : []),
    `Stages (${undoSteps} undo step${undoSteps === 1 ? "" : "s"}, one per stage): ${director.stages.map((s) => `${s.stage} ${s.outcome === "applied" ? "ok" : s.outcome}${s.tool !== "-" && s.outcome !== "applied" ? ` (${s.tool}: ${s.summary})` : ""}`).join(" · ")}`,
    ...(rendered ? [`Render: ${rendered.path}${rendered.seconds ? ` (${rendered.seconds.toFixed(1)} s)` : ""}.`] : []),
    ...(findings.length > 0
      ? ["Findings, worst first (fix these, then render again and review_render_tool):", ...findings.slice(0, 10).map((f, i) => `${i + 1}. ${f.severity.toUpperCase()}${f.at !== undefined ? ` ${f.at.toFixed(1)}s` : ""} (${f.from}): ${f.message}${f.tools && f.tools.length > 0 ? ` Tools: ${f.tools.join(", ")}` : ""}`)]
      : rendered && review
        ? ["No problems found by the review."]
        : []),
    ...(director.next.length > 0 ? [`Next calls: ${director.next.slice(0, 8).map((n) => `${n.tool} ${JSON.stringify(n.args)}`).join("; ")}`] : []),
    ...(missing.length > 0 ? [`Missing from the person: ${missing.join("; ")}.`] : []),
  ];
  const data = {
    style: rule.id,
    builder: builder?.tool ?? null,
    why: plan.why,
    ...(plan.fallback ? { fallback: plan.fallback } : {}),
    brief,
    stages: director.stages,
    render: rendered,
    findings,
    next_calls: director.next,
    missing,
  };
  const warnings = failedStages.map((s) => `${s.stage} (${s.tool}) did not run: ${s.summary}`);
  const images = director.images.slice(-1);
  // The build failed and no other stage changed anything: a refusal, not a produced edit.
  if (director.wants("build") && !builder && undoSteps === 0) return { receipt: refused(TOOL, `Error: ${lines.join("\n")}`, { data, warnings }), images };
  return { receipt: applied(TOOL, lines.join("\n"), { data, warnings }), images };
}

export const produceTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Produce a whole video",
    description:
      "Call this FIRST for any whole video (reel, ad, promo, trailer, explainer, montage, a reference to recreate), even from a detailed brief: request = the whole brief as written, output = the delivery file; do not search, import or set the frame before it. From the request and the media bin it saves a brief (when none is saved), picks ONE style of the styles index and its one-call builder " +
      "(build_reel_tool, match_cut_montage_tool, build_trailer_tool, build_explainer_tool, build_talking_head_tool, build_product_launch_tool), sets the frame the request names, gathers stock footage and music at the style's tempo when the bin is short, cuts the edit, " +
      "finishes it (unify_grade_tool, apply_motion_transitions_tool by the style's rules, auto_sound_design_tool, master_audio_tool iterate), renders it and runs review_render_tool and watch_render_tool. " +
      "Returns a compact report: what it made, the brief, every stage's outcome, and the review's findings with the exact next calls - then layer what the brief asks beyond its cut (motion blocks, titles) and fix the findings. " +
      "One undo step per stage; skip any stage with skip=[...]. Pass what only the person knows: title (the product or film), features (a launch), script (a voice-led video with no voice-over), hook, end_card.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    stages: true,
    run: async (call, args: Input) => {
      // replace=false on a full timeline is the same refusal: the builder would refuse after the brief, footage and music stages changed the project.
      if (call.doc.project.clips.length > 0 && args.replace !== true && !(args.skip ?? []).includes("build")) {
        return refused(TOOL, `Error: the timeline already has ${call.doc.project.clips.length} clip(s), nothing changed. Pass replace=true to cut a new edit over it, or skip=["brief","footage","music","build"] to only finish, render and review this one.`);
      }
      const brief = readBrief(call.doc.project);
      const request = args.request ?? (brief ? `${brief.goal} ${brief.style}` : undefined);
      if (!request) return refused(TOOL, "Error: request is required (the person's words: what the video is, its length and frame) while the project has no brief; nothing changed.");
      return produce(call, { ...args, request }, args.request !== undefined);
    },
  }),
];

