/**
 * Timer overlays and emoji stickers: add_timer_tool, search_emojis_tool,
 * add_emoji_tool.
 *
 * Ports of zenvi-core develop src/classes/editor_tools/titles_text_overlays.py.
 * A timer is libopenshot's Timer effect (live digits, drawn by every
 * renderer: render/kernels/timer.ts) on a transparent "Timer" overlay clip,
 * or on an existing clip. Emoji are the Emojis dock's OpenMoji SVGs, bundled
 * with the engine (assets/emojis, io/emojis.ts) and stored as `@emojis/<file>`
 * like the desktop stores them. The desktop also lists the user's own emoji
 * folder; web surfaces have only the bundled set.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { DEFAULT_IMAGE_LENGTH } from "../../model/defaults.js";
import type { Clip, Effect, Project } from "../../model/types.js";
import { idFactory } from "../../model/ids.js";
import { pyRound } from "../../model/rounding.js";
import { EMOJI_CATALOG_ASSET, emojiReaderInfo, parseBundledEmojiCatalog, searchEmojis, type EmojiEntry } from "../../io/emojis.js";
import { addFile } from "../../ops/files.js";
import { placeOverlayClip, replaceClipEffects } from "../../ops/overlays.js";
import { contractTool, type ToolCall } from "../define.js";
import { pyFixed, pyG, pyReprString } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { AssetHost } from "../types.js";
import {
  GRAVITY,
  carrierFile,
  clipExtent,
  colorHexAlpha,
  colorKeyframes,
  constantKeyframe,
  fpsOfProject,
  guarded,
  isLocked,
  planOverlayTrack,
  prepareOverlayCarrier,
  projectSize,
  pyRoundTo,
  snapToFrame,
  summaryLine,
  toolError,
  trackInfo,
  uiTrackNumber,
  type ScreenPosition,
} from "../titles-text.js";

export const TIMER_ROLE = "timer";
const TIMER_MODES = { count_up: 0, count_down: 1, clock: 2, timecode: 3, frame_number: 4 } as const;
const TIMER_FORMATS = { "mm:ss": 0, "hh:mm:ss": 1, "hh:mm:ss.mmm": 2, timecode: 3, frames: 4 } as const;
const TIME_CLIP = 0;
const TIME_SOURCE = 1;

/** `_offsets`: (x, y) offsets that keep an overlay `margin` in from the edges it hugs. */
function edgeOffsets(position: ScreenPosition, margin: number): [number, number] {
  const x = position.endsWith("right") ? -margin : position.endsWith("left") ? margin : 0;
  const y = position.startsWith("top") ? margin : position.startsWith("bottom") ? -margin : 0;
  return [x, y];
}

/** `_timeline_end`: where the last clip ends. */
function timelineEnd(project: Project): number {
  return project.clips.reduce((end, clip) => Math.max(end, clipExtent(clip)[1]), 0);
}

/** `max(1, int(round(seconds * fps))) / fps`: a length in whole frames, at least one. */
function wholeFrames(project: Project, seconds: number): number {
  const fps = fpsOfProject(project);
  return Math.max(1, pyRound(seconds * fps)) / fps;
}

/** A font name as given, without surrounding quotes (`resolve_font` when installed fonts are unknown). */
function fontName(font: unknown): string {
  return String(font ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");
}

const catalogs = new WeakMap<AssetHost, Promise<EmojiEntry[]>>();

/** The bundled emoji catalog, read once per asset host. */
function emojiCatalog(call: ToolCall): Promise<EmojiEntry[]> {
  const assets = call.host.assets!;
  let pending = catalogs.get(assets);
  if (!pending) {
    pending = assets.readText(EMOJI_CATALOG_ASSET).then(parseBundledEmojiCatalog);
    pending.catch(() => catalogs.delete(assets));
    catalogs.set(assets, pending);
  }
  return pending;
}

async function loadEmojis(call: ToolCall): Promise<EmojiEntry[]> {
  try {
    return await emojiCatalog(call);
  } catch (error) {
    return toolError(`the emoji catalog could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface EmojiRow {
  code: string;
  emoji: string;
  name: string;
  group: string;
  source: "bundled";
}

/** `EmojiEntry.as_dict`. */
function emojiRow(entry: EmojiEntry): EmojiRow {
  return { code: entry.id, emoji: entry.char, name: entry.name, group: entry.groupId, source: "bundled" };
}

export const overlayTools = [
  contractTool("add_timer_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      guarded("add_timer_tool", async () => {
        const tool = "add_timer_tool";
        const project = call.doc.project;
        const mode = input.mode ?? "count_down";
        const format = input.format ?? "mm:ss";
        const screen = (input.screen_position ?? "bottom_center") as ScreenPosition;
        const countdownFrom = input.countdown_from_seconds ?? 0;
        const startAt = input.start_at_seconds ?? 0;
        const font = fontName(input.font);
        const [fg, fgAlpha] = colorHexAlpha(input.text_color ?? "#ffffff", "text_color");
        const strokeHex = colorHexAlpha(input.stroke_color ?? "#000000", "stroke_color")[0];
        const [bgHex, bgAlpha] = colorHexAlpha(input.background_color ?? "#000000", "background_color");
        const backgroundOpacity = bgAlpha < 1 ? bgAlpha : (input.background_opacity ?? 0.45);
        const attachId = String(input.timeline_clip_id ?? "").trim();
        const position = snapToFrame(project, input.position_seconds ?? 0);

        let attached: Clip | undefined;
        let duration = 0;
        if (attachId) {
          attached = project.clips.find((c) => c.id === attachId);
          if (!attached) toolError(`no timeline clip with id=${pyReprString(attachId)}`);
          if (isLocked(project, attached.layer)) toolError(`clip ${attached.id} is on locked track ${uiTrackNumber(project, attached.layer)}; unlock it first`);
        } else {
          let length: number;
          if (input.duration_seconds) length = input.duration_seconds;
          else if (mode === "count_down") length = countdownFrom || 10;
          else {
            const toEnd = timelineEnd(project) - position;
            length = toEnd > 1 ? toEnd : 10;
          }
          duration = wholeFrames(project, length);
          planOverlayTrack(project, position, position + duration, input.track);
        }

        const [w, h] = projectSize(project);
        const fontPx = (input.text_size ?? 0.07) * Math.min(w, h);
        const units = 600 / w; // Timer scales sizes by width / 600
        const [xOff, yOff] = edgeOffsets(screen, input.margin_percent ?? 3);
        const props: Record<string, unknown> = {
          mode: TIMER_MODES[mode],
          format: TIMER_FORMATS[format],
          clamp: 1,
          gravity: GRAVITY[screen],
          show_background: (input.background ?? true) ? 1 : 0,
          font_name: font || "sans",
          prefix: String(input.prefix ?? ""),
          suffix: String(input.suffix ?? ""),
          color: colorKeyframes(fg),
          font_alpha: constantKeyframe(fgAlpha),
          stroke: colorKeyframes(strokeHex),
          stroke_width: constantKeyframe(pyRoundTo((input.stroke_width ?? 0.03) * fontPx * units, 3)),
          background: colorKeyframes(bgHex),
          background_alpha: constantKeyframe(backgroundOpacity),
          background_padding: constantKeyframe(pyRoundTo(0.25 * fontPx * units, 3)),
          background_corner: constantKeyframe(pyRoundTo(0.15 * fontPx * units, 3)),
          font_size: constantKeyframe(pyRoundTo(fontPx * units, 3)),
          x_offset: constantKeyframe(xOff),
          y_offset: constantKeyframe(yOff),
          apply_before_clip: false,
        };
        const newTimer = (id: string, timeSource: number, startTime: number): Effect => ({
          ...defaultEffectJson("Timer", id),
          ...structuredClone(props),
          time_source: timeSource,
          start_time: constantKeyframe(startTime),
          end_time: constantKeyframe(countdownFrom || 0),
        });
        const what = mode.replaceAll("_", " ");
        const where = screen.replaceAll("_", " ");

        if (attached) {
          const clip = attached;
          const start = Number(clip.start) || 0;
          const length = (Number(clip.end) || 0) - start;
          // A source-time timer counts from the clip's first visible frame.
          const offset = mode === "count_up" || mode === "count_down" ? startAt - start : startAt;
          const effect = call.commit((tx) => {
            const timer = newTimer(idFactory(tx.project)(), TIME_SOURCE, offset);
            replaceClipEffects(tx, clip.id, [...(clip.effects ?? []), timer]);
            return timer;
          });
          return applied(tool, summaryLine(`Added a ${what} timer to clip ${clip.id} (${where}).`), {
            data: {
              timeline_clip_id: clip.id,
              effect_id: effect.id,
              overlay: false,
              mode,
              format,
              position: pyRoundTo(Number(clip.position) || 0, 3),
              duration: pyRoundTo(length, 3),
              screen_position: screen,
              track: uiTrackNumber(call.doc.project, clip.layer),
            },
          });
        }

        const end = position + duration;
        const carrier = await prepareOverlayCarrier(call);
        const placed = call.commit((tx) => {
          const { layer, created } = planOverlayTrack(tx.project, position, end, input.track);
          const file = carrierFile(tx, carrier);
          const timer = newTimer(idFactory(tx.project)(), TIME_CLIP, startAt);
          const clip = placeOverlayClip(tx, {
            fileId: file.id,
            position,
            duration,
            layer,
            newTrackLabel: "Timer",
            title: "Timer",
            props: { zenvi_role: TIMER_ROLE, effects: [timer] },
          });
          return { clip, timer, layer, created };
        });
        const t = trackInfo(call.doc.project, placed.layer);
        return applied(tool, summaryLine(`Added a ${what} timer on track ${t.track} at ${pyFixed(position, 2)}-${pyFixed(end, 2)}s (${where}).`), {
          data: {
            timeline_clip_id: placed.clip.id,
            effect_id: placed.timer.id,
            overlay: true,
            mode,
            format,
            position: pyRoundTo(position, 3),
            duration: pyRoundTo(duration, 3),
            end: pyRoundTo(end, 3),
            countdown_from: countdownFrom || (mode === "count_down" ? duration : 0),
            screen_position: screen,
            new_track: placed.created,
            ...t,
          },
        });
      }),
  }),

  contractTool("search_emojis_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    requires: ["assets"],
    run: (call, input) =>
      guarded("search_emojis_tool", async () => {
        const q = String(input.query ?? "").trim();
        const group = input.group ?? "";
        if (!q && !group) toolError("pass a query (e.g. 'fire') or a group");
        const matches = searchEmojis(await loadEmojis(call), q, group, input.limit ?? 10);
        if (matches.length === 0) toolError(`no emoji matches ${pyReprString(q)}${group ? ` in group ${group}` : ""}`);
        const rows = matches.map((m) => ({ ...emojiRow(m.entry), score: pyRoundTo(m.score, 1) }));
        const shown = rows
          .slice(0, 8)
          .map((r) => `${r.emoji} ${r.name}`)
          .join(", ");
        return applied("search_emojis_tool", summaryLine(`${rows.length} emoji match ${pyReprString(q || group)}: ${shown}`), { data: { matches: rows } }, 0);
      }),
  }),

  contractTool("add_emoji_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["assets"],
    run: (call, input) =>
      guarded("add_emoji_tool", async () => {
        const tool = "add_emoji_tool";
        // The editor registry refuses a required argument that is empty (_registry._wrap).
        if (input.emoji === undefined || input.emoji === "") toolError("add_emoji_tool: missing required argument(s) emoji");
        const query = String(input.emoji ?? "").trim();
        const group = input.group ?? "";
        const matches = searchEmojis(await loadEmojis(call), query, group, 6);
        if (matches.length === 0) {
          toolError(`no emoji matches ${pyReprString(String(input.emoji ?? ""))}${group ? ` in group ${group}` : ""}; try search_emojis_tool with a simpler word`);
        }
        const [best, ...rest] = matches;
        if (best!.score < 20) {
          toolError(
            `no good emoji match for ${pyReprString(String(input.emoji ?? ""))}; closest: ` +
              matches
                .slice(0, 5)
                .map((m) => `${m.entry.char} ${m.entry.name} (${m.entry.id})`)
                .join(", "),
          );
        }
        const entry = best!.entry;
        const project = call.doc.project;
        const screen = (input.screen_position ?? "center") as ScreenPosition;
        const size = input.size ?? 0.2;
        const margin = input.margin ?? 0.04;
        const position = snapToFrame(project, input.position_seconds ?? 0);
        // The desktop's default is its Default Image Length preference (10 s unless changed).
        const duration = wholeFrames(project, input.duration_seconds || DEFAULT_IMAGE_LENGTH);
        const end = position + duration;
        planOverlayTrack(project, position, end, input.track);

        const [w, h] = projectSize(project);
        const short = Math.min(w, h);
        const [xOff, yOff] = edgeOffsets(screen, 1);
        const props = {
          gravity: GRAVITY[screen],
          scale_x: constantKeyframe(size),
          scale_y: constantKeyframe(size),
          location_x: constantKeyframe(pyRoundTo((xOff * margin * short) / w, 5)),
          location_y: constantKeyframe(pyRoundTo((yOff * margin * short) / h, 5)),
        };
        const placed = call.commit((tx) => {
          const { layer, created } = planOverlayTrack(tx.project, position, end, input.track);
          const file = addFile(tx, { path: entry.storedPath, info: emojiReaderInfo(entry.storedPath), name: entry.name }, { mediaType: "image" });
          const clip = placeOverlayClip(tx, { fileId: file.id, position, duration, layer, newTrackLabel: "Emoji", props });
          return { fileId: file.id, clip, layer, created };
        });
        const t = trackInfo(call.doc.project, placed.layer);
        return applied(
          tool,
          summaryLine(`Added ${entry.char} ${entry.name} on track ${t.track} at ${pyFixed(position, 2)}-${pyFixed(end, 2)}s (${screen.replaceAll("_", " ")}, size ${pyG(size)}).`),
          {
            data: {
              timeline_clip_id: placed.clip.id,
              file_id: placed.fileId,
              emoji: emojiRow(entry),
              position: pyRoundTo(position, 3),
              duration: pyRoundTo(duration, 3),
              end: pyRoundTo(end, 3),
              screen_position: screen,
              size,
              new_track: placed.created,
              alternatives: rest.slice(0, 5).map((m) => emojiRow(m.entry)),
              ...t,
            },
          },
        );
      }),
  }),
];
