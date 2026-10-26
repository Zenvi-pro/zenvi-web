/**
 * Subject matte tools: generate_subject_matte_tool and the composites that
 * need a matte — text_behind_subject_tool, replace_background_tool,
 * subject_glow_tool, pop_out_tool (references: words behind the head,
 * subject on flat colour, glowing / thermal silhouettes, a subject breaking
 * out of letterbox bars).
 *
 * Each composite is one call and one undo step: the matte (made by the host
 * when the file has none yet), generated layer files, and a stack of plain
 * clips above the footage (tools/mattes.ts). Nothing renders offline: the
 * timeline stays live and the desktop plays it with the same effects.
 */

import { z } from "zod";
import { defaultEffectJson } from "../../effects/registry.js";
import { gradientMapLut, solidLut, THERMAL_COLD_RAMP, THERMAL_RAMP } from "../../mattes/luts.js";
import { bigTextSvg, gradientSvg, letterboxBarHeight, letterboxSvg, solidSvg } from "../../mattes/svg.js";
import type { Clip, Effect, Project, ProjectFile } from "../../model/types.js";
import { directTool, unavailableMessage, type CatalogTool, type ToolCall, type ToolOutcome } from "../define.js";
import {
  addMatteFile,
  buildStack,
  cutoutMask,
  findMatte,
  generatedLut,
  generatedSvg,
  isTimeRemapped,
  matteableClipProblem,
  matteRecord,
  type CompositeTool,
  type PieceSpec,
  type StackResult,
} from "../mattes.js";
import { applied, unchanged } from "../receipt.js";
import { colorHexAlpha, colorKeyframes, constantKeyframe, guarded, isLocked, projectSize, toolError, uiTrackNumber } from "../titles-text.js";
import type { GeneratedMatte, MatteSubject } from "../types.js";

const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const clipId = z.string().min(1).describe("Footage clip to work on (timeline clip id from describe_project_tool or a receipt).");
const subject = z.enum(["person"]).optional().describe("What the matte keeps (default person).");
const color = (what: string, fallback: string) => z.string().optional().describe(`${what} as #rrggbb (default ${fallback}).`);

/** Mattes of footage larger than 720p are made at half size: about 1.5x faster, and the Mask effect scales them up smoothly. */
function autoScale(file: ProjectFile): 1 | 0.5 {
  return Math.max(Number(file.width) || 0, Number(file.height) || 0) > 1280 ? 0.5 : 1;
}

function hexOf(value: string | undefined, fallback: string, what: string): string {
  return colorHexAlpha(value ?? fallback, what)[0];
}

interface Subject {
  source: Clip;
  file: ProjectFile;
  subject: MatteSubject;
  /** A matte already in the bin, or one the host just made (added in the commit). */
  matte: ProjectFile | GeneratedMatte;
  scale: number;
  warnings: string[];
}

/** The footage clip and its matte, generating the matte through the host when the file has none. */
async function subjectOf(call: ToolCall, tool: string, id: string, which: MatteSubject | undefined, scaleArg?: 1 | 0.5): Promise<Subject> {
  const project = call.doc.project;
  const source = project.clips.find((c) => c.id === id);
  if (!source) toolError(`no timeline clip with id='${id}'`);
  const problem = matteableClipProblem(project, source);
  if (problem) toolError(problem);
  if (isLocked(project, source.layer)) toolError(`clip ${source.id} is on locked track ${uiTrackNumber(project, source.layer)}; unlock it first`);
  const file = project.files.find((f) => f.id === source.file_id)!;
  const kind = which ?? "person";
  const warnings = isTimeRemapped(source) ? [`clip ${source.id} has a time curve: the matte follows source frames before the remap, so it may slip; composite before retiming`] : [];
  const existing = findMatte(project, file.id, kind);
  if (existing) return { source, file, subject: kind, matte: existing, scale: matteRecord(existing)!.scale, warnings };
  const host = call.host.mattes;
  if (!host || !host.subjects.includes(kind)) {
    toolError(
      unavailableMessage(
        tool,
        `${file.name ?? file.path} has no ${kind} matte yet and this host cannot make one (subject matting runs in the zenvi CLI with onnxruntime-node: zenvi call generate_subject_matte_tool)`,
      ),
    );
  }
  const scale = scaleArg ?? autoScale(file);
  let matte: GeneratedMatte;
  try {
    matte = await host.generate(file.path, { subject: kind, scale, signal: call.signal });
  } catch (error) {
    return toolError(`matting ${file.name ?? file.path} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { source, file, subject: kind, matte, scale, warnings };
}

function isGenerated(matte: ProjectFile | GeneratedMatte): matte is GeneratedMatte {
  return "media" in matte && "model" in matte && !("id" in matte);
}

class NoChange extends Error {}

function stackData(subj: Subject, matteFile: ProjectFile, stack: StackResult): Record<string, unknown> {
  const record = matteRecord(matteFile)!;
  return {
    source_clip_id: subj.source.id,
    matte_file_id: matteFile.id,
    matte_generated: isGenerated(subj.matte),
    matte: {
      model: record.model,
      version: record.version,
      license: record.license,
      frames: record.frames,
      ...(isGenerated(subj.matte) ? { matting_fps: Math.round(subj.matte.fps * 10) / 10 } : {}),
    },
    layers: stack.pieces,
    created_clip_ids: stack.createdIds,
    updated_clip_ids: stack.updatedIds,
    removed_clip_ids: stack.removedIds,
    moved_clip_ids: stack.movedIds,
    removed_file_ids: stack.removedFileIds,
  };
}

/**
 * Commit a composite: the matte (when just made) and the stack, as one undo
 * step; a re-run that would change nothing records nothing.
 */
function commitStack(call: ToolCall, tool: CompositeTool, subj: Subject, specs: (matte: ProjectFile) => PieceSpec[], summary: (stack: StackResult) => string): ToolOutcome {
  const name = `${tool}_tool`;
  const before = JSON.stringify(call.doc.project);
  let out: { matteFile: ProjectFile; stack: StackResult };
  try {
    out = call.commit((tx) => {
      const matteFile = isGenerated(subj.matte) ? addMatteFile(tx, subj.file, subj.matte, subj.subject, subj.scale) : subj.matte;
      const source = tx.project.clips.find((c) => c.id === subj.source.id)!;
      const stack = buildStack(tx, tool, source, specs(matteFile));
      if (JSON.stringify(tx.project) === before) throw new NoChange();
      return { matteFile, stack };
    });
  } catch (error) {
    if (!(error instanceof NoChange)) throw error;
    const matteFile = subj.matte as ProjectFile;
    return unchanged(name, `The ${tool.replaceAll("_", " ")} stack on clip ${subj.source.id} already looks like this.`, {
      data: { source_clip_id: subj.source.id, matte_file_id: matteFile.id },
    });
  }
  return applied(name, summary(out.stack), { data: stackData(subj, out.matteFile, out.stack), warnings: subj.warnings });
}

/** The cut-out piece reading `matte`, with the source clip's own effects under the Mask. */
function cutoutPiece(source: Clip, matte: ProjectFile): PieceSpec {
  return { role: "cutout", title: `${String(source.title || source.id)} (subject)`, kind: "copy", sourceEffects: true, effects: (next) => [cutoutMask(next(), matte)] };
}

function trackOf(project: Project, stack: StackResult, role: string): string {
  const piece = stack.pieces.find((p) => p.role === role);
  return piece ? String(uiTrackNumber(project, piece.layer) ?? piece.layer) : "?";
}

export const matteTools: CatalogTool[] = [
  directTool({
    name: "generate_subject_matte_tool",
    title: "Generate subject matte",
    description:
      "Make a subject matte for a video file: a grayscale video the same length and frame rate as the footage, white where the person is, " +
      "added to the bin (tagged `matte`, linked to its source). Mattes are made once per file and reused by text_behind_subject_tool, " +
      "replace_background_tool, subject_glow_tool and pop_out_tool (which make one themselves when needed). Runs Robust Video Matting " +
      "(GPL-3.0) on this computer; the model downloads on first use. Takes about a second per 15 frames at 1080p.",
    input: z.strictObject({
      clip_id: clipId.optional(),
      file_id: z.string().min(1).optional().describe("Bin file id of the footage (instead of clip_id)."),
      subject,
      size: z.enum(["auto", "full", "half"]).optional().describe("Matte size: full, half (faster) or auto (half above 720p; default)."),
      regenerate: z.boolean().optional().describe("Make a new matte even when the file has one (stacks keep theirs until run again)."),
    }),
    annotations: ADD,
    requires: ["mattes"],
    run: (call, input) =>
      guarded("generate_subject_matte_tool", async () => {
        const tool = "generate_subject_matte_tool";
        const project = call.doc.project;
        if (!input.clip_id === !input.file_id) toolError("pass clip_id or file_id (one of them)");
        let fileId = input.file_id;
        if (input.clip_id) {
          const clip = project.clips.find((c) => c.id === input.clip_id);
          if (!clip) toolError(`no timeline clip with id='${input.clip_id}'`);
          const problem = matteableClipProblem(project, clip);
          if (problem) toolError(problem);
          fileId = clip.file_id;
        }
        const file = project.files.find((f) => f.id === fileId);
        if (!file) toolError(`no project file with id='${fileId}'`);
        const kind = input.subject ?? "person";
        const existing = findMatte(project, file.id, kind);
        const describe = (matte: ProjectFile, fps?: number) => {
          const r = matteRecord(matte)!;
          return {
            matte_file_id: matte.id,
            source_file_id: file.id,
            subject: kind,
            model: r.model,
            version: r.version,
            license: r.license,
            frames: r.frames,
            scale: r.scale,
            width: matte.width,
            height: matte.height,
            ...(fps !== undefined ? { matting_fps: Math.round(fps * 10) / 10 } : {}),
          };
        };
        if (existing && !input.regenerate) {
          return unchanged(tool, `${file.name ?? file.path} already has a ${kind} matte (${existing.id}).`, { data: describe(existing) });
        }
        if (file.media_type !== "video" || file.has_video === false || file.has_single_image) toolError(`${file.name ?? file.path} is not video`);
        if (matteRecord(file)) toolError(`${file.id} is itself a matte`);
        const scale = input.size === "full" ? 1 : input.size === "half" ? 0.5 : autoScale(file);
        let matte: GeneratedMatte;
        try {
          matte = await call.host.mattes!.generate(file.path, { subject: kind, scale, signal: call.signal });
        } catch (error) {
          return toolError(`matting ${file.name ?? file.path} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const added = call.commit((tx) => addMatteFile(tx, file, matte, kind, scale));
        return applied(tool, `Made a ${kind} matte of ${file.name ?? file.path}: ${matte.frames} frames at ${matte.fps.toFixed(1)} fps (${added.id}).`, {
          data: describe(added, matte.fps),
        });
      }),
  }),

  directTool({
    name: "text_behind_subject_tool",
    title: "Text behind subject",
    description:
      "Put text behind the person in a footage clip: the footage, then the text, then the person cut out on top (a copy of the clip " +
      "with a Mask effect reading the subject matte). Pass `text` for a new full-width bold line, or `title_clip_id` to slip an existing " +
      "title between. One undo step; running it again on the same clip updates the stack instead of adding another.",
    input: z.strictObject({
      clip_id: clipId,
      text: z.string().min(1).max(80).optional().describe("New text, big and centred (1-3 lines)."),
      title_clip_id: z.string().min(1).optional().describe("An existing title clip to put behind the subject instead of new text."),
      color: color("Text colour", "#ffffff"),
      font: z.string().max(80).optional().describe("Font family for new text (default a bold sans)."),
      size: z.number().min(0.03).max(0.6).optional().describe("Font size in frame heights (default as large as fits the width)."),
      y: z.number().min(0).max(1).optional().describe("Vertical centre of new text, 0 = top, 1 = bottom (default 0.36: behind the head)."),
      subject,
    }),
    annotations: ADD,
    run: (call, input) =>
      guarded("text_behind_subject_tool", async () => {
        if (!input.text === !input.title_clip_id) toolError("pass text or title_clip_id (one of them)");
        if (input.title_clip_id) {
          const title = call.doc.project.clips.find((c) => c.id === input.title_clip_id);
          if (!title) toolError(`no timeline clip with id='${input.title_clip_id}'`);
          if (title.id === input.clip_id) toolError("title_clip_id is the footage clip");
          if (isLocked(call.doc.project, title.layer)) toolError(`title clip ${title.id} is on a locked track; unlock it first`);
        }
        const textColor = hexOf(input.color, "#ffffff", "color");
        const subj = await subjectOf(call, "text_behind_subject_tool", input.clip_id, input.subject);
        const [w, h] = projectSize(call.doc.project);
        const text = input.text
          ? await generatedSvg(call, "behind-text", bigTextSvg(w, h, { text: input.text, color: textColor, font: input.font, size: input.size, y: input.y ?? 0.36 }))
          : undefined;
        return commitStack(
          call,
          "text_behind_subject",
          subj,
          (matte) => [
            text ? { role: "text", title: input.text!, kind: "image", asset: text } : { role: "text", kind: "existing", clipId: input.title_clip_id! },
            cutoutPiece(subj.source, matte),
          ],
          (stack) =>
            `Put ${input.text ? `"${input.text}"` : `title ${input.title_clip_id}`} behind the subject of clip ${subj.source.id}: text on track ${trackOf(call.doc.project, stack, "text")}, cut-out on track ${trackOf(call.doc.project, stack, "cutout")}.`,
        );
      }),
  }),

  directTool({
    name: "replace_background_tool",
    title: "Replace background",
    description:
      "Swap what is behind the person in a footage clip: a flat colour, a top-to-bottom gradient, another bin file (photo or video, " +
      "scaled to fill) or the footage itself blurred, with the person cut out on top by the subject matte. One undo step; running it " +
      "again on the same clip updates the stack.",
    input: z.strictObject({
      clip_id: clipId,
      background: z.enum(["color", "gradient", "file", "blur"]).describe("What goes behind the subject."),
      color: color("Background colour (gradient: top)", "#f4c20d for color, #1b1464 for gradient"),
      color2: color("Gradient bottom colour", "#e8326d"),
      file_id: z.string().min(1).optional().describe("Bin file for background=file."),
      blur: z.number().min(1).max(100).optional().describe("Blur radius in source pixels for background=blur (default 2.5% of the short side)."),
      subject,
    }),
    annotations: ADD,
    run: (call, input) =>
      guarded("replace_background_tool", async () => {
        const project = call.doc.project;
        if (input.background === "file") {
          const file = project.files.find((f) => f.id === input.file_id);
          if (!input.file_id) toolError("background=file needs file_id");
          if (!file) toolError(`no project file with id='${input.file_id}'`);
          if (file.media_type === "audio") toolError(`${file.name ?? file.path} is audio; pick a photo or video`);
        } else if (input.file_id) toolError("file_id is only for background=file");
        const top = hexOf(input.color, input.background === "gradient" ? "#1b1464" : "#f4c20d", "color");
        const bottom = hexOf(input.color2, "#e8326d", "color2");
        const subj = await subjectOf(call, "replace_background_tool", input.clip_id, input.subject);
        const [w, h] = projectSize(call.doc.project);
        const sourceTitle = String(subj.source.title || subj.source.id);
        let background: PieceSpec;
        if (input.background === "color") {
          background = { role: "background", title: `Background ${top}`, kind: "image", asset: await generatedSvg(call, "background", solidSvg(w, h, top)) };
        } else if (input.background === "gradient") {
          background = { role: "background", title: `Background ${top} to ${bottom}`, kind: "image", asset: await generatedSvg(call, "background", gradientSvg(w, h, top, bottom)) };
        } else if (input.background === "file") {
          background = { role: "background", title: "Background", kind: "file", fileId: input.file_id! };
        } else {
          const short = Math.min(Number(subj.file.width) || w, Number(subj.file.height) || h);
          const radius = Math.round(input.blur ?? Math.max(4, short * 0.025));
          background = {
            role: "background",
            title: `${sourceTitle} (blurred)`,
            kind: "copy",
            sourceEffects: true,
            effects: (next) => [
              { ...defaultEffectJson("Blur", next()), horizontal_radius: constantKeyframe(radius), vertical_radius: constantKeyframe(radius), iterations: constantKeyframe(3) },
            ],
          };
        }
        return commitStack(
          call,
          "replace_background",
          subj,
          (matte) => [background, cutoutPiece(subj.source, matte)],
          (stack) =>
            `Replaced the background of clip ${subj.source.id} with ${input.background === "file" ? `file ${input.file_id}` : input.background === "blur" ? "the footage blurred" : `a ${input.background}`}: background on track ${trackOf(call.doc.project, stack, "background")}, cut-out on track ${trackOf(call.doc.project, stack, "cutout")}.`,
        );
      }),
  }),

  directTool({
    name: "subject_glow_tool",
    title: "Subject glow",
    description:
      "Turn the person in a footage clip into a glowing silhouette (look=glow: a flat fill, white by default, with an outer Glow) or a " +
      "thermal-camera figure (look=thermal: a gradient-map LUT from deep blue through magenta and orange to white hot, the scene behind " +
      "in cold blues). Built from the subject matte, ColorMap with generated LUTs and Glow, so it stays editable. One undo step; " +
      "running it again on the same clip updates the stack.",
    input: z.strictObject({
      clip_id: clipId,
      look: z.enum(["glow", "thermal"]).optional().describe("glow (default) or thermal."),
      color: color("Silhouette fill for look=glow", "#ffffff"),
      glow_color: color("Glow colour", "the fill colour; thermal: #ff9a1a"),
      glow: z.number().min(0).max(1).optional().describe("Glow strength 0-1 (default 0.85 for glow, 0 for thermal)."),
      background: z
        .enum(["keep", "dim", "black", "cold"])
        .optional()
        .describe("Behind the subject: keep the footage, dim it, black, or cold thermal blues (default dim for glow, cold for thermal)."),
      subject,
    }),
    annotations: ADD,
    run: (call, input) =>
      guarded("subject_glow_tool", async () => {
        const look = input.look ?? "glow";
        const fill = hexOf(input.color, "#ffffff", "color");
        const glowHex = hexOf(input.glow_color, look === "thermal" ? "#ff9a1a" : fill, "glow_color");
        const strength = input.glow ?? (look === "glow" ? 0.85 : 0);
        const behind = input.background ?? (look === "glow" ? "dim" : "cold");
        const subj = await subjectOf(call, "subject_glow_tool", input.clip_id, input.subject);
        const project = call.doc.project;
        const [w, h] = projectSize(project);
        const sourceTitle = String(subj.source.title || subj.source.id);
        const fillLut = look === "thermal" ? await generatedLut(call, "thermal", gradientMapLut("Zenvi thermal", THERMAL_RAMP)) : await generatedLut(call, "fill", solidLut(fill));
        const pieces: PieceSpec[] = [];
        if (behind === "dim" || behind === "black") {
          const asset = await generatedSvg(call, "black", solidSvg(w, h, "#000000"));
          pieces.push({ role: "background", title: behind === "dim" ? "Dim" : "Black", kind: "image", asset, props: behind === "dim" ? { alpha: constantKeyframe(0.6) } : {} });
        } else if (behind === "cold") {
          const cold = await generatedLut(call, "thermal-cold", gradientMapLut("Zenvi thermal cold", THERMAL_COLD_RAMP));
          pieces.push({ role: "background", title: `${sourceTitle} (cold)`, kind: "copy", sourceEffects: false, effects: (next) => [cold(next())] });
        }
        const glowEffect = (id: string): Effect => ({
          ...defaultEffectJson("Glow", id),
          color: colorKeyframes(glowHex),
          opacity: constantKeyframe(Math.min(1, strength)),
          blur_radius: constantKeyframe(Math.round(Math.min(w, h) * (0.012 + 0.03 * strength))),
          spread: constantKeyframe(0.2 * strength),
        });
        return commitStack(
          call,
          "subject_glow",
          subj,
          (matte) => [
            ...pieces,
            {
              role: "silhouette",
              title: `${sourceTitle} (${look})`,
              kind: "copy",
              // The fill replaces every colour, so the clip's grade would not show.
              sourceEffects: false,
              effects: (next) => [fillLut(next()), cutoutMask(next(), matte), ...(strength > 0 ? [glowEffect(next())] : [])],
            },
          ],
          (stack) =>
            `Made the subject of clip ${subj.source.id} a ${look === "thermal" ? "thermal" : `${fill} glowing`} silhouette on track ${trackOf(call.doc.project, stack, "silhouette")} (background: ${behind}).`,
        );
      }),
  }),

  directTool({
    name: "pop_out_tool",
    title: "Pop out of letterbox",
    description:
      "Letterbox a footage clip and let the person break out of the bars: the footage, bars leaving a band of `band_aspect` (default " +
      "2.39:1, a thin band on vertical video), then the person cut out on top so they cross the bars. One undo step; running it again " +
      "on the same clip updates the stack.",
    input: z.strictObject({
      clip_id: clipId,
      band_aspect: z.number().min(0.5).max(5).optional().describe("Width / height of the picture band between the bars (default 2.39)."),
      bar_color: color("Bar colour", "#000000"),
      subject,
    }),
    annotations: ADD,
    run: (call, input) =>
      guarded("pop_out_tool", async () => {
        const [w, h] = projectSize(call.doc.project);
        const aspect = input.band_aspect ?? 2.39;
        if (letterboxBarHeight(w, h, aspect) < 1) toolError(`a ${aspect}:1 band fills this ${w}x${h} frame, so there are no bars; pick a wider band_aspect than ${(w / h).toFixed(2)}`);
        const barHex = hexOf(input.bar_color, "#000000", "bar_color");
        const subj = await subjectOf(call, "pop_out_tool", input.clip_id, input.subject);
        const bars = await generatedSvg(call, "letterbox", letterboxSvg(w, h, aspect, barHex));
        return commitStack(
          call,
          "pop_out",
          subj,
          (matte) => [{ role: "bars", title: `Letterbox ${aspect}:1`, kind: "image", asset: bars }, cutoutPiece(subj.source, matte)],
          (stack) =>
            `Letterboxed clip ${subj.source.id} at ${aspect}:1 with the subject popping out: bars on track ${trackOf(call.doc.project, stack, "bars")}, cut-out on track ${trackOf(call.doc.project, stack, "cutout")}.`,
        );
      }),
  }),
];
