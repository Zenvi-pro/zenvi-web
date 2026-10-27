/**
 * pan_tool: place audio clips in the stereo field, constant or keyframed.
 * libopenshot has no pan on a clip, so the engine renders the clip's source
 * to a panned stereo WAV and the clip plays that (ops/pan.ts): parity-safe,
 * the desktop plays the same file (zenvi-motion sound/DEPLOY.md S3.5).
 *
 * Pan law: constant power, sin/cos of (pan + 1) * pi / 4 on the source's
 * mono sum, times sqrt(2) so the loudness of a centred render equals the
 * unpanned clip (each side is -3 dB re a hard pan). A render that would pass
 * full scale is scaled down and the clip's gain raised by the same amount.
 */

import { z } from "zod";
import { encodeWav } from "../../io/wav.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import { linkPanRender, panSourceFile, readPanMark, unlinkPanRender, type PanMark } from "../../ops/pan.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { applied, unchanged, type ToolReceipt } from "../receipt.js";
import { resolveTargets, targetShape, type MixEntry } from "../mix-roles.js";
import type { ImportedMedia } from "../types.js";
import { applyClipGain } from "./mastering.js";

const TOOL = "pan_tool";
const RATE = 48000;
/** Longest source a pan renders, seconds. */
const MAX_SOURCE_SECONDS = 600;
/** CRAFT.md section 7 / METRICS.md P2: heroes no wider than this keep the mono fold-down. */
export const HERO_MAX_PAN = 0.6;

const input = z.strictObject({
  ...targetShape,
  pan: z.number().min(-1).max(1).optional().describe("-1 hard left, 0 centre (removes the pan), 1 hard right. Heroes no wider than +-0.6 so they survive a mono phone."),
  points: z
    .array(z.strictObject({ t: z.number().min(0).describe("Timeline seconds."), pan: z.number().min(-1).max(1) }))
    .min(2)
    .max(64)
    .optional()
    .describe("Keyframed pan, timeline seconds: a whoosh that travels with the motion. Linear between points, held before the first and after the last."),
});
type Input = z.output<typeof input>;

function panAt(mark: PanMark, t: number): number {
  const pts = mark.points;
  if (!pts || pts.length === 0) return mark.pan ?? 0;
  if (t <= pts[0]!.t) return pts[0]!.pan;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (t <= b.t) return b.t - a.t <= 0 ? b.pan : a.pan + ((b.pan - a.pan) * (t - a.t)) / (b.t - a.t);
  }
  return pts[pts.length - 1]!.pan;
}

function sameMark(a: PanMark | undefined, b: PanMark): boolean {
  return Boolean(a) && JSON.stringify({ pan: a!.pan, points: a!.points }) === JSON.stringify({ pan: b.pan, points: b.points });
}

export const panTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Pan",
    description:
      "Pan audio clips (sound effects, music, VO files) left or right, constant or keyframed over time so a whoosh travels with the motion. " +
      "Renders the clip's sound to a panned stereo WAV the clip then plays (libopenshot has no pan), keeping its trim, position and volume; pan 0 puts the original back. " +
      "Constant-power law, loudness unchanged at centre. Keep heroes within +-0.6 (mono phones). One undo step. Audio-only clips only: split a video's sound off first.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["audio", "media"],
    run: async (call, args: Input): Promise<ToolReceipt | string> => {
      const audio = call.host.audio;
      const media = call.host.media;
      if (!audio?.decodePcm || !media?.writeGenerated) return unavailable(TOOL, "this host cannot decode and write audio files.");
      if (args.pan === undefined && args.points === undefined) return "Error: pass pan or points.";
      if (args.points && args.points.some((p, i) => i > 0 && p.t <= args.points![i - 1]!.t)) return "Error: points must be in increasing time.";
      const project = call.doc.project;
      const targets = resolveTargets(project, args);
      if (typeof targets === "string") return targets;
      const video = targets.find((t) => !isAudioOnlyMedia(panSourceFile(project, t.clip) ?? {}));
      if (video) return `Error: clip ${video.id} has picture: pan_tool pans audio-only clips (split its sound off first).`;

      const centre = args.points === undefined && args.pan === 0;
      const jobs: { entry: MixEntry; mark: PanMark }[] = [];
      const restore: MixEntry[] = [];
      for (const entry of targets) {
        const current = readPanMark(entry.clip);
        const source = panSourceFile(project, entry.clip)!;
        if (centre) {
          if (current) restore.push(entry);
          continue;
        }
        const mark: PanMark = { source_file_id: String(source.id), ...(args.points ? { points: args.points } : { pan: args.pan }) };
        if (!sameMark(current, mark)) jobs.push({ entry, mark });
      }
      if (jobs.length === 0 && restore.length === 0) return unchanged(TOOL, centre ? "Already centred: nothing to undo." : "Already panned so: nothing written.");

      const rendered: { entry: MixEntry; mark: PanMark; media: ImportedMedia; compensateDb: number }[] = [];
      const written: string[] = [];
      try {
        for (const job of jobs) {
          const source = project.files.find((f) => String(f.id) === job.mark.source_file_id)!;
          const pcm = await audio.decodePcm(String(source.path), { sampleRate: RATE, channels: 2, maxSeconds: MAX_SOURCE_SECONDS, signal: call.signal });
          const right = pcm.right ?? pcm.samples;
          const n = pcm.samples.length;
          const left = new Float32Array(n);
          const rightOut = new Float32Array(n);
          const position = Number(job.entry.clip.position) || 0;
          const start = Number(job.entry.clip.start) || 0;
          let peak = 0;
          for (let i = 0; i < n; i += 1) {
            const mono = (pcm.samples[i]! + right[i]!) / 2;
            const theta = ((panAt(job.mark, i / pcm.sampleRate - start + position) + 1) * Math.PI) / 4;
            left[i] = Math.SQRT2 * mono * Math.cos(theta);
            rightOut[i] = Math.SQRT2 * mono * Math.sin(theta);
            peak = Math.max(peak, Math.abs(left[i]!), Math.abs(rightOut[i]!));
          }
          let compensateDb = 0;
          if (peak > 0.99) {
            const scale = 0.99 / peak;
            for (let i = 0; i < n; i += 1) {
              left[i]! *= scale;
              rightOut[i]! *= scale;
            }
            compensateDb = -20 * Math.log10(scale);
          }
          const name = `pan-${String(source.id).slice(0, 10)}-${job.entry.id.slice(0, 10)}.wav`;
          const path = await media.writeGenerated(name, encodeWav([left, rightOut], pcm.sampleRate), "audio/wav");
          written.push(path);
          const info = await media.probe(path);
          rendered.push({ ...job, compensateDb, media: { path, info: { ...info, media_type: "audio", has_video: false, has_audio: true }, name: `${String(source.name ?? "audio")} (panned)` } });
        }
      } catch (error) {
        await media.discardGenerated?.(written);
        return `Error: could not render the panned audio: ${error instanceof Error ? error.message : String(error)}`;
      }

      call.commit((tx) => {
        for (const entry of restore) unlinkPanRender(tx, entry.id);
        for (const r of rendered) {
          linkPanRender(tx, r.entry.id, r.media, r.mark);
          if (r.compensateDb > 0) applyClipGain(tx, r.entry.id, r.compensateDb);
        }
      }, "Pan");
      const warnings = rendered.filter((r) => (r.mark.pan !== undefined && Math.abs(r.mark.pan) > HERO_MAX_PAN) || (r.mark.points ?? []).some((p) => Math.abs(p.pan) > HERO_MAX_PAN));
      const what = centre ? "centred" : args.points ? `keyframed (${args.points.length} points)` : `panned ${args.pan! > 0 ? "right" : "left"} ${Math.abs(args.pan!).toFixed(2)}`;
      return applied(TOOL, `${rendered.length + restore.length} clip(s) ${what}: ${[...rendered.map((r) => r.entry.id), ...restore.map((e) => e.id)].slice(0, 6).join(", ")}.`, {
        data: { clips: [...rendered.map((r) => ({ id: r.entry.id, pan: r.mark.pan, points: r.mark.points, gainDb: Math.round(r.compensateDb * 100) / 100 })), ...restore.map((e) => ({ id: e.id, pan: 0 }))] },
        warnings: warnings.length ? [`${warnings.length} clip(s) pan wider than +-${HERO_MAX_PAN}: a hero that wide folds down badly on a mono phone.`] : [],
      });
    },
  }),
];
