/**
 * kinetic_captions_tool: animated word captions from what is said, as
 * native outlined-SVG title clips with clip keyframes on "Captions" tracks
 * (captions/build.ts), so they play the same on every surface, stay
 * editable clip by clip, and the desktop needs no font.
 *
 * Words come from where the speech tools read them (../transcripts.ts: a
 * kept transcription, the media index's cues, or a new transcription). The
 * clips and drawing files it makes are tagged `zenvi_kinetic_captions` with
 * the footage clips whose words they show and when those words start.
 * Running it again replaces, in the same undo step, the earlier captions
 * wholly inside the new run (all their words from the clips and range
 * given); captions only partly inside are kept, and the receipt says so.
 *
 * behind_subject: the footage's subject matte (a bin file whose
 * `zenvi_matte.source_file_id` is the footage's file, made by the subject
 * matte tools) keys a copy of the footage above the captions: libopenshot's
 * Mask with the matte as `mask_reader`, inverted so white (the subject)
 * stays. Without a matte the option is refused.
 */

import { z } from "zod";
import { buildKineticCaptions, type AvoidBox, type KineticCaptionPlan } from "../../captions/build.js";
import { CAPTION_STYLES, CAPTION_STYLE_IDS, type CaptionStyleId } from "../../captions/styles.js";
import type { CaptionWord } from "../../captions/words.js";
import { defaultEffectJson } from "../../effects/registry.js";
import type { Transaction } from "../../history/document.js";
import { idFactory } from "../../model/ids.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { deleteClips, duplicateClip } from "../../ops/clips.js";
import { removeFile, updateFile } from "../../ops/files.js";
import { patchClip } from "../../ops/internal.js";
import { ensureTrack } from "../../ops/overlays.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { loadFamilies } from "../fonts.js";
import { applied, failed, refused } from "../receipt.js";
import { colorHexAlpha, constantKeyframe, isLocked, projectSize, trackInfo } from "../titles-text.js";
import { clipTarget, isTalkingFootage, isWordSource, wordsFor, wordsForClip } from "../transcripts.js";
import { projectFps } from "../frame-time.js";
import { commitDrawn, placeMotionPlan, planOverlayStack, writeDrawings } from "./motion-templates.js";

const TOOL = "kinetic_captions_tool";
const TRACK_LABEL = "Captions";
/** Tag on the clips and drawing files this tool makes. */
export const KINETIC_KEY = "zenvi_kinetic_captions";
/** `zenvi_matte` on a subject matte file (the subject matte tools' record). */
const MATTE_KEY = "zenvi_matte";

export interface KineticTag {
  /** The footage clips whose words it shows (a cut-out: the clip it copies). */
  source_clip_ids: string[];
  style: CaptionStyleId;
  role: "caption" | "cutout";
  /** A caption: timeline seconds its first and last words start. */
  said?: [number, number];
}

/** What a new run covers: its footage clips, its range, and whether it remakes their cut-outs. */
interface Scope {
  ids: ReadonlySet<string>;
  from: number;
  to: number;
  cutouts: boolean;
}

const STYLE_LINES = CAPTION_STYLE_IDS.map((id) => `${id}: ${CAPTION_STYLES[id].summary}.`).join(" ");
const unit = z.number().min(0).max(1);

const input = z.strictObject({
  timeline_clip_ids: z.array(z.string().min(1)).min(1).max(20).optional().describe("Footage clips whose speech to caption (default: every clip with picture and sound)."),
  start_seconds: z.number().min(0).optional().describe("Only words from this timeline time on."),
  end_seconds: z.number().min(0).optional().describe("Only words before this timeline time."),
  style: z.enum(CAPTION_STYLE_IDS).optional().describe(`Look and motion (default creator). ${STYLE_LINES}`),
  emphasis: z
    .union([z.string().max(600), z.array(z.string().min(1).max(40)).max(60)])
    .optional()
    .describe("Words to emphasise: auto (default: numbers, stressed and long content words, never stopwords), none, or a list of words (an array, or one string separated by commas)."),
  avoid: z
    .array(z.strictObject({ x: unit, y: unit, w: unit.gt(0), h: unit.gt(0) }))
    .max(8)
    .optional()
    .describe("Boxes to keep captions off, 0-1 of the frame (centre x, y and size w, h): the speaker's face first (split puts its words either side of it)."),
  accent: z.string().max(40).optional().describe("Emphasis / marker colour (#rrggbb or a name). Default per style (creator red, karaoke yellow)."),
  ink: z.string().max(40).optional().describe("Colour of the other words (default white)."),
  behind_subject: z.boolean().optional().describe("Put a cut-out of the speaker above the captions so the words pass behind them. Needs the footage's subject matte."),
  language: z.string().max(16).optional().describe("Speech language when the clip has to be transcribed (auto by default)."),
});

type Input = z.infer<typeof input>;

/** The emphasis argument as the builder takes it: auto, none, or the words listed. */
export function emphasisArg(value: string | readonly string[] | undefined): "auto" | "none" | string[] {
  if (value === undefined) return "auto";
  if (typeof value !== "string") return [...value];
  const v = value.trim().toLowerCase();
  if (v === "" || v === "auto") return "auto";
  if (v === "none") return "none";
  return value.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function kineticTag(item: Clip | ProjectFile): KineticTag | undefined {
  const t = (item as Record<string, unknown>)[KINETIC_KEY];
  return isRecord(t) && Array.isArray(t.source_clip_ids) ? (t as unknown as KineticTag) : undefined;
}

function matteOf(project: Project, clip: Clip): ProjectFile | undefined {
  const source = project.files.find((f) => f.id === clip.file_id);
  return project.files.filter((f) => {
    const m = (f as Record<string, unknown>)[MATTE_KEY];
    return isRecord(m) && m.source_file_id === clip.file_id && (!source || m.source_path === undefined || m.source_path === source.path);
  }).pop();
}

/**
 * How an earlier caption stands to a new run: inside it (every word it
 * shows is captioned again: replace it), partly inside, or apart. Words are
 * in a range by their start, as `wordsOf` takes them.
 */
function standing(tag: KineticTag, scope: Scope): "inside" | "partly" | "apart" {
  const mine = tag.source_clip_ids.filter((id) => scope.ids.has(id)).length;
  if (mine === 0) return "apart";
  if (tag.role === "cutout") return scope.cutouts ? "inside" : "apart";
  // Tags from before `said` give no times: inside only a run over all time.
  const [first, last] = tag.said ?? [-Infinity, Infinity];
  if (last < scope.from - 1e-6 || first >= scope.to) return "apart";
  return mine === tag.source_clip_ids.length && first >= scope.from - 1e-6 && last < scope.to ? "inside" : "partly";
}

/** Earlier kinetic captions inside `scope` (clips and drawing files), and the caption clips partly inside it. */
function previous(project: Project, scope: Scope): { clips: Clip[]; files: ProjectFile[]; partly: Clip[] } {
  const is = (item: Clip | ProjectFile, want: "inside" | "partly") => {
    const tag = kineticTag(item);
    return tag !== undefined && standing(tag, scope) === want;
  };
  const clips = project.clips.filter((c) => is(c, "inside"));
  const gone = new Set(clips.map((c) => c.id));
  // A drawing goes only when no clip that stays still shows it.
  const files = project.files.filter((f) => is(f, "inside") && !project.clips.some((c) => c.file_id === f.id && !gone.has(c.id)));
  return { clips, files, partly: project.clips.filter((c) => is(c, "partly")) };
}

function withoutPrevious(project: Project, old: { clips: Clip[]; files: ProjectFile[] }): Project {
  const clipIds = new Set(old.clips.map((c) => c.id));
  const fileIds = new Set(old.files.map((f) => f.id));
  return { ...project, clips: project.clips.filter((c) => !clipIds.has(c.id) && !fileIds.has(c.file_id)), files: project.files.filter((f) => !fileIds.has(f.id)) };
}

async function wordsOf(call: ToolCall, clips: readonly Clip[], args: Input, warnings: string[]): Promise<CaptionWord[] | string> {
  const project = call.doc.project;
  const fps = projectFps(project);
  const out: CaptionWord[] = [];
  const problems: string[] = [];
  for (const clip of clips) {
    const target = clipTarget(project, clip);
    if (!target) {
      problems.push(`clip ${clip.id} plays no file in the bin`);
      continue;
    }
    const got = await wordsFor(call, target, { language: args.language, estimatesOk: true, transcribe: true });
    if (!isWordSource(got)) {
      problems.push(`clip ${clip.id}: ${got.message}`);
      continue;
    }
    warnings.push(...got.warnings);
    if (!got.exact) warnings.push(`clip ${clip.id}: word times are estimated from the media index's phrases (transcribe it for exact timing)`);
    for (const w of wordsForClip(got.words, clip, fps, got.generation)) {
      const start = Number(w.timelineStartSec);
      const end = Number(w.timelineEndSec);
      if (args.start_seconds !== undefined && start < args.start_seconds - 1e-6) continue;
      if (args.end_seconds !== undefined && start >= args.end_seconds) continue;
      out.push({ text: String(w.text), start, end, source: clip.id });
    }
  }
  if (out.length === 0) return `Error: no words to caption${problems.length > 0 ? `: ${problems.join("; ")}` : " in the clips and range given"}.`;
  if (problems.length > 0) warnings.push(...problems);
  return out.sort((a, b) => a.start - b.start);
}

function cutoutOf(tx: Transaction, source: Clip, matte: ProjectFile, layer: number, tag: KineticTag): Clip {
  // The same picture as the footage (its keys, effects and speed: a copy), keyed by the matte last; silent.
  const copy = duplicateClip(tx, source.id, { position: Number(source.position), layer });
  const mask = { ...defaultEffectJson("Mask", idFactory(tx.project)()), mask_reader: structuredClone(matte), mask_invert: true };
  return patchClip(tx, copy.id, { title: `Captions cut-out ${source.title ?? source.id}`, effects: [...(copy.effects ?? []), mask], volume: constantKeyframe(0), has_audio: constantKeyframe(0), [KINETIC_KEY]: tag });
}

export const kineticCaptionTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Add kinetic captions",
    description:
      "Animated word-by-word captions from the speech in footage clips, timed to each word, styled after creator and editorial reels: emphasis words picked automatically (numbers, stressed words) " +
      "or given, laid out in the safe area for 9:16 or 16:9 and kept off the boxes you give (the speaker's face). Each word is an outlined SVG title clip with keyframes on Captions tracks: " +
      "native, editable and the same on every Zenvi surface. Running it again on the same clips (and range) replaces its captions there. One undo step. For plain subtitles use add_captions_tool.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      if (!call.host.media?.writeGenerated) return unavailable(TOOL, "it cannot store the captions' generated drawings.");
      if (!call.host.assets?.readBytes) return unavailable(TOOL, "it cannot read the bundled fonts the captions are set in.");
      const project = call.doc.project;
      const style = args.style ?? "creator";
      if (args.start_seconds !== undefined && args.end_seconds !== undefined && args.end_seconds <= args.start_seconds) return refused(TOOL, "Error: end_seconds must be after start_seconds.");

      let clips: Clip[];
      if (args.timeline_clip_ids) {
        clips = [];
        for (const id of args.timeline_clip_ids) {
          const clip = project.clips.find((c) => c.id === id);
          if (!clip) return refused(TOOL, `Error: unknown timeline clip ${id}.`);
          if (kineticTag(clip)) return refused(TOOL, `Error: clip ${id} is one of the kinetic captions; pass the footage clip (${kineticTag(clip)!.source_clip_ids.join(", ")}).`);
          if (!clips.includes(clip)) clips.push(clip);
        }
      } else {
        clips = project.clips.filter((c) => {
          const file = project.files.find((f) => f.id === c.file_id);
          return file !== undefined && isTalkingFootage(file) && !kineticTag(c);
        });
        if (clips.length === 0) return refused(TOOL, "Error: no clip on the timeline has picture and sound to caption; pass timeline_clip_ids.");
      }
      const colours: { ink?: string; accent?: string } = {};
      for (const key of ["ink", "accent"] as const) {
        if (args[key] === undefined) continue;
        try {
          colours[key] = colorHexAlpha(args[key], key)[0];
        } catch (error) {
          return refused(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}.`);
        }
      }
      const mattes = new Map<string, ProjectFile>();
      if (args.behind_subject) {
        for (const clip of clips) {
          const matte = matteOf(project, clip);
          if (!matte) return refused(TOOL, `Error: behind_subject needs a subject matte of clip ${clip.id}'s footage, and the bin has none; make one with the subject matte tools, or drop behind_subject.`);
          mattes.set(clip.id, matte);
        }
      }
      const ids = new Set(clips.map((c) => c.id));
      const ranged = args.start_seconds !== undefined || args.end_seconds !== undefined;
      const old = previous(project, { ids, from: args.start_seconds ?? -Infinity, to: args.end_seconds ?? Infinity, cutouts: !ranged || (args.behind_subject ?? false) });
      const locked = old.clips.filter((c) => isLocked(project, c.layer));
      if (locked.length > 0) return refused(TOOL, `Error: earlier captions of these clips are on a locked track (${locked.map((c) => c.id).join(", ")}); unlock it first.`);

      const warnings: string[] = [];
      const words = await wordsOf(call, clips, args, warnings);
      if (typeof words === "string") return refused(TOOL, words);
      const spec = CAPTION_STYLES[style];
      const lib = await loadFamilies(call, [spec.base.family, spec.emphasis.family]);
      if (typeof lib === "string") return refused(TOOL, lib);

      const [width, height] = projectSize(project);
      const fpsFraction = projectFps(project);
      const fps = fpsFraction.num / fpsFraction.den;
      let built: KineticCaptionPlan;
      try {
        built = buildKineticCaptions({ frame: { width, height, fps }, words, style, emphasis: emphasisArg(args.emphasis), avoid: (args.avoid ?? []) as AvoidBox[], ...colours, behind: args.behind_subject ?? false, lib });
      } catch (error) {
        return failed(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (built.missing.length > 0) warnings.push(`no bundled font draws ${built.missing.join(" ")}; those characters are left out`);
      if (old.partly.length > 0) {
        const shown = old.partly.slice(0, 8).map((c) => c.id).join(", ");
        warnings.push(`kept ${old.partly.length} earlier caption clip(s) that also show words outside the clips or range given (${shown}${old.partly.length > 8 ? ", …" : ""}); delete them if the new captions double them`);
      }
      const plan = built.plan;
      const end = built.start + plan.frames / fps;
      const clean = withoutPrevious(project, old);
      const stack = planOverlayStack(clean, built.start, end, plan.tracks + (args.behind_subject ? 1 : 0));
      const written = await writeDrawings(call, plan, `captions-${style}`);
      if (typeof written === "string") return failed(TOOL, written);
      const groupOf = (name: string) => built.groups[Number(/^g(\d+)/.exec(name)?.[1])]!;

      const result = await commitDrawn(call, written, (tx) => {
        for (const f of old.files) removeFile(tx, f.id);
        const leftover = old.clips.filter((c) => tx.project.clips.some((x) => x.id === c.id)).map((c) => c.id);
        if (leftover.length > 0) deleteClips(tx, leftover);
        const placed = placeMotionPlan(tx, plan, written, built.start, fps, stack.layers.slice(0, plan.tracks), `Captions ${style}`, TRACK_LABEL);
        const files = new Set<string>();
        for (const p of placed) {
          const group = groupOf(p.layer.name);
          const tag: KineticTag = { source_clip_ids: group.sources, style, role: "caption", said: group.said };
          patchClip(tx, p.clip.id, { [KINETIC_KEY]: tag });
          if (!files.has(p.fileId)) updateFile(tx, p.fileId, { [KINETIC_KEY]: tag } as Partial<ProjectFile>);
          files.add(p.fileId);
        }
        if (args.behind_subject) ensureTrack(tx, stack.layers[plan.tracks]!, TRACK_LABEL);
        // Free unnamed tracks the captions landed on are named for them.
        for (const number of stack.layers) {
          const layer = tx.project.layers.find((l) => Number(l.number) === number);
          if (layer && !String(layer.label ?? "").trim()) tx.update(["layers", { id: layer.id }], { label: TRACK_LABEL });
        }
        const cutouts = args.behind_subject ? clips.map((c) => cutoutOf(tx, c, mattes.get(c.id)!, stack.layers[plan.tracks]!, { source_clip_ids: [c.id], style, role: "cutout" })) : [];
        return { placed, cutouts, replaced: old.clips.length };
      }, `Add kinetic captions (${style})`);

      const doc = call.doc.project;
      const round = (t: number) => Math.round(t * 1000) / 1000;
      const emphasised = built.groups.flatMap((g) => g.words.filter((w) => w.emphasis).map((w) => w.text));
      return applied(
        TOOL,
        `Added ${built.groups.length} ${style} caption group(s) (${words.length} words) at ${built.start.toFixed(2)}-${end.toFixed(2)}s on ${plan.tracks} track(s)` +
          (result.replaced > 0 ? `, replacing ${result.replaced} earlier caption clip(s)` : "") +
          (result.cutouts.length > 0 ? ", with the speaker cut out above them" : "") +
          ".",
        {
          warnings,
          data: {
            style,
            start: round(built.start),
            end: round(end),
            words: words.length,
            emphasis: emphasised,
            replaced_clips: result.replaced,
            kept_clip_ids: old.partly.map((c) => c.id),
            tracks: stack.layers.map((layer) => trackInfo(doc, layer)),
            created_clip_ids: [...result.placed.map((p) => p.clip.id), ...result.cutouts.map((c) => c.id)],
            cutout_clip_ids: result.cutouts.map((c) => c.id),
            groups: built.groups.map((g) => ({
              text: g.text,
              start: round(g.start),
              end: round(g.stop),
              box: [g.box.x / width, g.box.y / height, g.box.width / width, g.box.height / height].map((v) => Math.round(v * 1000) / 1000),
              clear: g.overlap === 0,
              words: g.words.map((w) => ({ text: w.text, start: round(w.start), ...(w.emphasis ? { emphasis: true } : {}) })),
            })),
          },
        },
      );
    },
  }),
];
