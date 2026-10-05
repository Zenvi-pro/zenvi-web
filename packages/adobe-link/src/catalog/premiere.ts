/**
 * Premiere Pro tools (`premiere_*`, SPEC §3.4). Each definition here has
 * exactly one ExtendScript implementation registered with
 * `ZenviLink.register` under `extension/host/ppro/` (a test enforces the 1:1
 * match).
 *
 * Conventions every tool follows (docs/PREMIERE_PRO.md has the details):
 * - Project items and clips (track items) by `nodeId`, sequences by
 *   `sequenceID` or exact name, tracks by `{kind, index}` (0-based: V1 = 0).
 * - Times are seconds, snapped to the sequence frame grid (warnings say when).
 *   Clip keyframe times count from the clip's first frame.
 * - Premiere's scripting API cannot group undo. Every change is its own undo
 *   step; `undoSteps` is measured from Premiere's undo stack when the QE DOM
 *   reports it, else it is the number of changes the tool made.
 */

import { z } from "zod";
import { LOOK_NAMES, TASTE } from "../taste.js";
import { absolutePath, color, defineHostTool, easing, placement, seconds, trackRef, type HostToolDef } from "./types.js";

const UNDO = "Premiere cannot group undo: each change is its own undo step (undoSteps counts them).";

const sequenceRef = z.string().min(1).describe("Sequence id (`sequence_id` from premiere_get_state) or exact name; default: the active sequence");
const clipRef = z.string().min(1).describe("Clip (track item) nodeId: `node_id` from premiere_get_sequence or a receipt");
const itemRef = z.string().min(1).describe("Project item nodeId: `node_id` from premiere_list_items or premiere_import_files");
const binPath = z.string().min(1).max(500);
const point = z.array(z.number()).length(2);

/** Sequence presets premiere_create_sequence knows (sizes in ExtendScript: ppro/20-sequence.jsx). */
export const PREMIERE_SEQUENCE_PRESETS = ["1080p30", "1080p25", "1080p24", "4k30", "vertical", "square"] as const;

/** Opacity blend modes, in the order of Premiere's Blend Mode menu index (see ppro/40-motion.jsx). */
export const PREMIERE_BLEND_MODES = [
  "color", "color-burn", "color-dodge", "darken", "darker-color", "difference", "dissolve", "exclusion", "hard-light",
  "hard-mix", "hue", "lighten", "lighter-color", "linear-burn", "linear-dodge", "linear-light", "luminosity", "multiply",
  "normal", "overlay", "pin-light", "saturation", "screen", "soft-light", "vivid-light", "subtract", "divide",
] as const;

/** Export presets premiere_export looks up among the installed .epr files. */
export const PREMIERE_EXPORT_PRESETS = ["h264-high", "h264-social-vertical", "prores-422"] as const;

export const PREMIERE_MARKER_COLORS = ["green", "red", "purple", "orange", "yellow", "white", "blue", "cyan"] as const;

export const premiereGetState = defineHostTool({
  name: "premiere_get_state",
  title: "Premiere Pro state",
  description:
    "Where Premiere Pro is right now: app version, the open project (path, name), every sequence (id, name, duration, " +
    "frame size, fps), the active sequence with its playhead, in/out points and selected clips. Call it first, and again " +
    "whenever the user may have changed something by hand. Read-only and cheap.",
  input: z.strictObject({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const premiereListItems = defineHostTool({
  name: "premiere_list_items",
  title: "List project items",
  description:
    "The project's bins and items as a flat list in tree order: nodeId, name, kind (bin, media, sequence, clip), bin path, " +
    "media path, in/out and duration, offline flag. Use it to find the nodeId of footage before placing it, or to check " +
    "what is already imported. Filter by `kind`, `name_contains` or a starting `bin`. Read-only.",
  input: z.strictObject({
    bin: binPath.optional().describe("Start from this bin: its nodeId or its path from the project root, e.g. \"Footage/Day 1\"; default: the whole project"),
    kind: z.enum(["any", "media", "sequence", "bin"]).default("any").describe("Only list this kind: media (items with a file), sequence, bin, or any"),
    name_contains: z.string().min(1).optional().describe("Only items whose name contains this text (case-insensitive)"),
    recursive: z.boolean().default(true).describe("Include the contents of nested bins"),
    limit: z.int().min(1).max(2000).default(200).describe("Most items to return; the receipt says when more exist"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const premiereGetSequence = defineHostTool({
  name: "premiere_get_sequence",
  title: "Read a sequence",
  description:
    "One sequence in detail (default: the active one): settings, playhead, in/out, every track (index, name, muted, locked, " +
    "targeted) with its clips (nodeId, name, start/end/in/out in seconds, media path, project item, enabled, speed, " +
    "selected, applied effects, Motion/Opacity or volume values and which properties are animated) and transitions, plus " +
    "the sequence markers. Call it before editing so you address clips by nodeId. Read-only.",
  input: z.strictObject({
    sequence: sequenceRef.optional(),
    include_properties: z.boolean().default(true).describe("Per clip: effects, Motion/Opacity values (video) or volume (audio), and animated properties"),
    max_clips: z.int().min(1).max(5000).default(500).describe("Most clips to list across all tracks; the receipt says when more exist"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const premiereCaptureFrame = defineHostTool({
  name: "premiere_capture_frame",
  title: "Capture a frame",
  description:
    "Render one frame of a sequence to PNG and return it as an image: your eyes on the edit. Use it after every visual " +
    "change at the moments that matter (first frame, entrance end, mid-hold, last frame) and critique it against TASTE: " +
    "title-safe text, contrast, one focal point. Default time: the playhead; the time is snapped to a frame. Uses the QE " +
    "DOM's exportFramePNG at the sequence's frame size; a sequence that is not active is opened first. Changes nothing in the project.",
  input: z.strictObject({
    time: seconds.optional().describe("Sequence time to capture, in seconds; default: the playhead"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  returnsImage: true,
  timeoutMs: 60_000,
});

export const premiereImportFiles = defineHostTool({
  name: "premiere_import_files",
  title: "Import media",
  description:
    "Import files (video, audio, stills, .srt, .mogrt) into a bin, \"Zenvi Imports\" by default, created if missing. " +
    "Files already in the project are not imported twice (`dedupe`): their existing items are returned instead. Returns " +
    "the nodeId of every item for premiere_place_clip. Missing files are refused before anything is imported. " + UNDO,
  input: z.strictObject({
    paths: z.array(absolutePath).min(1).max(500).describe("Absolute paths of files on this computer"),
    bin: binPath.default("Zenvi Imports").describe("Bin to import into, created if missing; \"Footage/Day 1\" nests bins; \"/\" is the project root"),
    dedupe: z.boolean().default(true).describe("Return the existing item for files already in the project instead of importing them again"),
    image_sequence: z.boolean().default(false).describe("Import numbered stills as one image sequence (pass the first frame)"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  timeoutMs: 600_000,
});

export const premiereCreateSequence = defineHostTool({
  name: "premiere_create_sequence",
  title: "Create a sequence",
  description:
    "Create a sequence and make it active. `preset`: 1080p30 (default, 1920x1080 at 30 fps), 1080p25, 1080p24, 4k30 " +
    "(3840x2160), vertical (1080x1920 at 30, social 9:16), square (1080x1080 at 30). Built from an installed sequence " +
    "preset (never Premiere's New Sequence dialog) and set to the exact size and rate. Or pass `from_clips` to build it " +
    "from project items with settings matching the first clip. " + UNDO,
  input: z.strictObject({
    name: z.string().min(1).max(200).default("Zenvi Sequence").describe("Sequence name"),
    preset: z.enum(PREMIERE_SEQUENCE_PRESETS).default("1080p30").describe("Frame size and rate (ignored with from_clips)"),
    from_clips: z.array(itemRef).min(1).max(200).optional().describe("Build the sequence from these project items, in this order, matching the first clip's settings"),
    bin: binPath.optional().describe("Bin for the new sequence (path from the project root, created if missing); default: the project root"),
    open: z.boolean().default(true).describe("Make the new sequence the active one"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereOpenSequence = defineHostTool({
  name: "premiere_open_sequence",
  title: "Open a sequence",
  description:
    "Open a sequence in the Timeline and make it the active sequence (tools default to the active one). Changes only what " +
    "Premiere shows, not the project; nothing to undo.",
  input: z.strictObject({
    sequence: z.string().min(1).describe("Sequence id (`sequence_id` from premiere_get_state) or exact name"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const premierePlaceClip = defineHostTool({
  name: "premiere_place_clip",
  title: "Place a clip",
  description:
    "Put a project item on a track at a time, optionally using only part of the source (`source_in`/`source_out`). " +
    "`mode`: overwrite (default) replaces what is there; insert pushes later clips right. Default time: right after the " +
    "last clip on the track, so repeated calls build a sequence in order. Video items bring their linked audio. The item's " +
    "own in/out marks are restored afterwards. Cut on action; keep b-roll shots 1.5-3 s, talking heads 4-8 s (TASTE §6). " + UNDO,
  input: z.strictObject({
    item: itemRef,
    track: trackRef.default({ kind: "video", index: 0 }).describe("Target track, {kind, index} with 0-based index (V1 = 0); default V1"),
    time: seconds.optional().describe("Sequence time of the clip's first frame; default: the end of the last clip on the track"),
    source_in: seconds.optional().describe("Source in point, seconds from the start of the media; default: the item's in mark"),
    source_out: seconds.optional().describe("Source out point, seconds from the start of the media; default: the item's out mark"),
    mode: z.enum(["overwrite", "insert"]).default("overwrite").describe("overwrite replaces what is under it; insert ripples later clips right"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereEditClip = defineHostTool({
  name: "premiere_edit_clip",
  title: "Edit a clip",
  description:
    "One edit on a clip by `action`: move (`to` a start time or `by` seconds), trim (new timeline `start` and/or `end`; " +
    "the source in/out moves with the edge), enable / disable, rename (`name`), speed (`speed` 0.5 = half speed, with " +
    "`reverse`, `maintain_pitch`, `ripple`; QE DOM), delete (`ripple` closes the gap on the clip's tracks). move, " +
    "trim, enable/disable and delete include the linked audio/video unless `include_linked` is false. Locked tracks, " +
    "moves onto other clips and trims into a neighbour are refused, as are trims of retimed clips. delete " +
    "is destructive. " + UNDO,
  input: z.strictObject({
    clip: clipRef,
    action: z.enum(["move", "trim", "enable", "disable", "rename", "speed", "delete"]).describe("What to do"),
    to: seconds.optional().describe("move: the new start time on the sequence"),
    by: z.number().optional().describe("move: shift by this many seconds (negative = earlier)"),
    start: seconds.optional().describe("trim: new start (head) on the sequence; the source in point follows"),
    end: seconds.optional().describe("trim: new end (tail) on the sequence; the source out point follows"),
    name: z.string().min(1).max(500).optional().describe("rename: the new clip name"),
    speed: z.number().min(0.01).max(100).optional().describe("speed: playback rate, 1 = normal, 0.5 = half speed (twice as long), 2 = double"),
    reverse: z.boolean().default(false).describe("speed: play backwards"),
    maintain_pitch: z.boolean().default(true).describe("speed: keep the audio pitch"),
    ripple: z.boolean().default(false).describe("delete: close the gap; speed: push or pull the clips after it"),
    include_linked: z.boolean().default(true).describe("move, trim, enable/disable, delete: also the clip's linked audio/video"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
});

export const premiereRazor = defineHostTool({
  name: "premiere_razor",
  title: "Razor cut",
  description:
    "Cut clips at a time, like the Razor tool, so each side can be trimmed, moved or deleted. Default: every unlocked " +
    "track with a clip at `time`; pass `tracks` to cut only some. Returns the nodeIds of the new right-hand pieces. Uses " +
    "the QE DOM. " + UNDO,
  input: z.strictObject({
    time: seconds.describe("Sequence time to cut at, in seconds (snapped to the frame grid)"),
    tracks: z.array(trackRef).min(1).max(64).optional().describe("Only these tracks, {kind, index} 0-based; default: every unlocked track with a clip at that time"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereSetClipProperties = defineHostTool({
  name: "premiere_set_clip_properties",
  title: "Set clip properties",
  description:
    "Static values on a clip's built-in effects: Motion (position in sequence pixels, scale %, rotation, anchor), Opacity " +
    "(opacity %, blend mode) and audio volume in dB. Only the properties you pass change. An animated property is refused " +
    "unless `clear_keyframes` (use premiere_animate to change keyframes). Respect the frame: keep faces in the upper third " +
    "and text inside title-safe (TASTE §3). " + UNDO,
  input: z.strictObject({
    clip: clipRef,
    position: point.optional().describe("Motion > Position [x, y] in sequence pixels from the top-left; [width/2, height/2] is the centre"),
    scale: z.number().min(0).max(10000).optional().describe("Motion > Scale in percent (100 = original size)"),
    rotation: z.number().min(-36000).max(36000).optional().describe("Motion > Rotation in degrees, clockwise"),
    anchor: point.optional().describe("Motion > Anchor Point as fractions of the clip frame [x, y]; [0.5, 0.5] is the centre"),
    opacity: z.number().min(0).max(100).optional().describe("Opacity in percent"),
    blend_mode: z.enum(PREMIERE_BLEND_MODES).optional().describe("Opacity > Blend Mode"),
    volume_db: z.number().min(-96).max(15).optional().describe("Audio clips: Volume > Level in dB (0 = as recorded, max +15; -96 = silent)"),
    clear_keyframes: z.boolean().default(false).describe("Remove the keyframes of an animated property you set instead of refusing"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

const keyframeValue = z.union([z.number(), z.array(z.number()).min(2).max(4)]);

export const premiereAnimate = defineHostTool({
  name: "premiere_animate",
  title: "Animate a property",
  description:
    "Keyframes on a clip's Motion (position, scale, rotation, anchor), opacity, volume, or any parameter of an applied " +
    "effect (`{effect, param}`). Times count from the clip's first frame; values use the units of " +
    "premiere_set_clip_properties. TASTE easings map to Premiere interpolation: smooth/in-out/snap ease in and out " +
    "(Bezier ease), out/entrance arrives softly, in/exit leaves softly, linear (opacity and volume fades only), hold. " +
    "Defaults: smooth easing, replace existing keyframes. Typical: entrance 0.6 s, exit 0.4 s, scale 92->100 % on entry, " +
    "Ken Burns 100->104 % over the shot; never linear on Motion. Clips with a speed change are refused. " + UNDO,
  input: z.strictObject({
    clip: clipRef,
    property: z
      .union([
        z.enum(["position", "scale", "rotation", "anchor", "opacity", "volume"]).describe("A built-in property"),
        z
          .strictObject({
            effect: z.string().min(1).describe("Effect display name as in Effect Controls, e.g. \"Gaussian Blur\""),
            param: z.string().min(1).describe("Parameter display name, e.g. \"Blurriness\""),
          })
          .describe("A parameter of an effect applied to the clip"),
      ])
      .describe("What to animate"),
    keyframes: z
      .array(
        z.strictObject({
          time: seconds.describe("Seconds from the clip's first frame (0 = where it starts on the timeline)"),
          value: keyframeValue.describe("position [x, y] px, scale %, rotation degrees, anchor fractions, opacity %, volume dB; effect parameters as Premiere shows them"),
          easing: easing.optional().describe("Easing of the segment from this keyframe to the next; default: `easing`"),
        }),
      )
      .min(2)
      .max(200)
      .describe("At least two keyframes; sorted by time for you"),
    easing: easing.default(TASTE.easing.default).describe("Easing for every segment (TASTE §2): smooth, out/entrance, in/exit, in-out, snap, linear, hold, or {x1, y1, x2, y2}"),
    replace: z.boolean().default(true).describe("Remove the property's existing keyframes first"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereApplyEffect = defineHostTool({
  name: "premiere_apply_effect",
  title: "Apply an effect",
  description:
    "Add a video or audio effect to a clip by its name in the Effects panel (QE DOM), then set parameters on it through " +
    "the component API. Unknown effect names are refused with close matches; unknown parameter names are reported with " +
    "the parameters the effect has. For colour looks prefer premiere_apply_look; for keyframes use premiere_animate with " +
    "`{effect, param}`. " + UNDO,
  input: z.strictObject({
    clip: clipRef,
    effect: z.string().min(1).describe("Effect name as in the Effects panel, e.g. \"Gaussian Blur\", \"Lumetri Color\", \"DeNoise\""),
    params: z
      .array(
        z.strictObject({
          name: z.string().min(1).describe("Parameter display name, e.g. \"Blurriness\""),
          value: z.union([z.number(), z.boolean(), z.array(z.number()).min(2).max(4)]).describe("Number, checkbox, or point/colour array"),
        }),
      )
      .max(50)
      .optional()
      .describe("Parameter values to set once the effect is on the clip"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereAddTransition = defineHostTool({
  name: "premiere_add_transition",
  title: "Add a transition",
  description:
    "Add a transition at a clip's edge (QE DOM): `at` end (default; the cut after the clip, or its tail), start (the cut " +
    "before it, or its head) or both. Default Cross Dissolve for video (Constant Power for audio), 0.5 s centred on the " +
    "cut (TASTE: 0.5 s within a scene, 1.0 s for a change of time or place; dips to black for chapter breaks only). " +
    "Clips without media handles get a shorter or one-sided transition; the receipt reports what Premiere made. " + UNDO,
  input: z.strictObject({
    clip: clipRef,
    at: z.enum(["end", "start", "both"]).default("end").describe("Which edge of the clip"),
    transition: z.string().min(1).optional().describe("Transition name as in the Effects panel; default: Cross Dissolve (video) or Constant Power (audio)"),
    duration: z.number().positive().max(30).default(TASTE.timing.crossDissolve.default).describe("Seconds (snapped to whole frames)"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereApplyLook = defineHostTool({
  name: "premiere_apply_look",
  title: "Apply a colour look",
  description:
    "Grade clips with a Lumetri Color look (added when missing, reused when present): clean (+5 contrast, +5 vibrance), " +
    "warm-film (temperature +8, tint +2, faded film 8, saturation -6), teal-orange (teal shadow tint, orange highlight " +
    "tint, saturation +6), moody (exposure -0.3, contrast +12, saturation -15, vignette -0.8), bw-contrast (saturation 0, " +
    "contrast +25), scaled by `strength` (default 0.6: keep skin natural). Targets `clips`, else every clip on `track`, " +
    "else the selected video clips. Lumetri parameters are found by their English names. " + UNDO,
  input: z.strictObject({
    look: z.enum(LOOK_NAMES).describe("The look (TASTE §5)"),
    strength: z.number().min(0).max(1).default(TASTE.color.lookStrength).describe("0-1 share of the look's adjustments"),
    clips: z.array(clipRef).min(1).max(500).optional().describe("Video clips to grade"),
    track: trackRef.optional().describe("Grade every clip on this video track"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const premiereAddText = defineHostTool({
  name: "premiere_add_text",
  title: "Add a title",
  description:
    "Add a title to the sequence on a free video track above the footage. Premiere's scripting API cannot type text into " +
    "its own title templates, so the title comes from `image` (a transparent PNG title, e.g. rendered by Zenvi; scaled to " +
    "the frame width) or from `mogrt` (an After Effects-authored Essential Graphics template whose text control is set to " +
    "`text`, plus its size and colour controls when it exposes them). Defaults (TASTE §1, §4): `style` title 72 px at 1080p " +
    "(headline 96, subtitle 44, lower-third 54, caption 42), colour #F7F7F5, placement inside title-safe, on screen for " +
    "1.5 s + 0.3 s per word (at least 3 s for titles, 5 s for lower thirds). Without `image` or `mogrt` the call is " +
    "refused with what to pass. " + UNDO,
  input: z.strictObject({
    text: z.string().min(1).max(500).describe("The words; keep lines under 32 characters and break on phrases (TASTE §4)"),
    style: z.enum(["headline", "title", "subtitle", "lower-third", "caption"]).default("title").describe("Type scale step"),
    font_size: z.number().min(6).max(1000).optional().describe("Override the style's size, in pixels at the sequence's size"),
    color: color.default(TASTE.color.palette.paper).describe("Text colour, #RRGGBB or [r, g, b] 0-1"),
    placement: placement.optional().describe("Where the title sits, inside title-safe; default: lower-third for that style, bottom-center for captions, else center"),
    time: seconds.optional().describe("Sequence time of the title's first frame; default: the playhead"),
    duration: z.number().positive().max(3600).optional().describe("Seconds on screen; default: reading time"),
    track: z.int().min(0).max(98).optional().describe("Video track index (0 = V1); default: the lowest track above V1 that is free for the whole duration"),
    mogrt: absolutePath.optional().describe("An After Effects-authored .mogrt with a text control"),
    image: absolutePath.optional().describe("A transparent PNG title to place"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereAddMarker = defineHostTool({
  name: "premiere_add_marker",
  title: "Add a marker",
  description:
    "Add a sequence marker, or with `clip` a clip marker (Premiere keeps those on the clip's source item, so every use of " +
    "that media shows it). Name, comment, duration (0 = a point), colour, type (comment, chapter, segmentation). Default " +
    "time: the playhead. Use markers to leave notes for the editor and to mark beats and chapters. " + UNDO,
  input: z.strictObject({
    time: seconds.optional().describe("Sequence time; default: the playhead"),
    name: z.string().max(500).optional().describe("Marker name"),
    comment: z.string().max(5000).optional().describe("Marker comment"),
    duration: z.number().min(0).max(86_400).default(0).describe("Seconds; 0 = a point marker"),
    color: z.enum(PREMIERE_MARKER_COLORS).optional().describe("Marker colour; default: Premiere's (green)"),
    type: z.enum(["comment", "chapter", "segmentation"]).default("comment").describe("Marker type"),
    clip: clipRef.optional().describe("Mark this clip instead of the sequence"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereAddCaptions = defineHostTool({
  name: "premiere_add_captions",
  title: "Add captions from SRT",
  description:
    "Import an .srt file and turn it into a caption track on the sequence, starting at `time` (default 0). Format " +
    "subtitle (default) or a broadcast standard. Style captions in Premiere's Essential Graphics panel; keep them inside " +
    "title-safe and readable at phone size. " + UNDO,
  input: z.strictObject({
    srt: absolutePath.describe("Absolute path to a .srt subtitle file"),
    time: seconds.default(0).describe("Sequence time where the file's 00:00:00,000 lands"),
    format: z.enum(["subtitle", "cea-608", "cea-708", "teletext", "ebu", "op42", "op47"]).default("subtitle").describe("Caption format of the new track"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const premiereAutoReframe = defineHostTool({
  name: "premiere_auto_reframe",
  title: "Auto Reframe",
  description:
    "Make a reframed copy of a sequence for another aspect ratio with Premiere's Auto Reframe (Premiere Pro 2020 / 14.0 " +
    "or later): 9:16 (default, social vertical 1080x1920 from 1080p), 1:1, 4:5, 16:9. The copy keeps the source's short " +
    "side and is opened. The original is untouched. Check the result with premiere_capture_frame: faces in the upper " +
    "third, text inside the vertical safe area. " + UNDO,
  input: z.strictObject({
    aspect: z.enum(["9:16", "1:1", "4:5", "16:9"]).default("9:16").describe("Target aspect ratio"),
    motion: z.enum(["default", "slower", "faster"]).default("default").describe("How quickly the framing follows the action"),
    name: z.string().min(1).max(200).optional().describe("Name of the new sequence; default: \"<sequence> 9x16\""),
    nest: z.boolean().default(false).describe("Nest clips before reframing"),
    open: z.boolean().default(true).describe("Open the new sequence"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  timeoutMs: 1_800_000,
});

export const premiereSceneDetect = defineHostTool({
  name: "premiere_scene_detect",
  title: "Scene edit detection",
  description:
    "Find the camera cuts inside long clips with Premiere's Scene Edit Detection and either razor them (`action` cuts, " +
    "default, linked audio too) or mark them (markers land on the source items). Runs on every clip of a track (default " +
    "V1) or on `clips`. Premiere is blocked while it analyses; long media takes minutes. The previous selection is " +
    "restored. " + UNDO,
  input: z.strictObject({
    track: trackRef.default({ kind: "video", index: 0 }).describe("Video track to analyse, {kind, index} 0-based; default V1"),
    clips: z.array(clipRef).min(1).max(500).optional().describe("Only these clips of the track"),
    action: z.enum(["cuts", "markers"]).default("cuts").describe("cuts = razor at each detected scene change; markers = add markers"),
    sensitivity: z.enum(["low", "medium", "high"]).default("medium").describe("Detection sensitivity"),
    include_linked_audio: z.boolean().default(true).describe("cuts: also cut the linked audio"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  timeoutMs: 1_800_000,
});

export const premiereExport = defineHostTool({
  name: "premiere_export",
  title: "Export a sequence",
  description:
    "Render a sequence to a file. `preset`: h264-high (default, H.264 matching the source at a high bitrate), " +
    "h264-social-vertical (the same for a 9:16 sequence; others are refused, run premiere_auto_reframe first), " +
    "prores-422, or the path of an .epr. Presets are found among the installed Premiere / Media Encoder presets. " +
    "`range` entire, in-out or work-area. `via` media_encoder (default: queued in Adobe Media Encoder and started, returns " +
    "the job id at once) or direct (Premiere renders now and blocks until done). Existing files are refused unless " +
    "`overwrite`. Changes nothing in the project.",
  input: z.strictObject({
    preset: z
      .union([z.enum(PREMIERE_EXPORT_PRESETS).describe("A named preset"), absolutePath.describe("Absolute path to an .epr export preset")])
      .default("h264-high")
      .describe("Export preset"),
    output: absolutePath.optional().describe("Output file; its extension comes from the preset when missing; default: \"Zenvi Exports/<sequence>.<ext>\" next to the project"),
    range: z.enum(["entire", "in-out", "work-area"]).default("entire").describe("What to render"),
    via: z.enum(["media_encoder", "direct"]).default("media_encoder").describe("Queue in Media Encoder, or render inside Premiere now"),
    overwrite: z.boolean().default(false).describe("Replace an existing output file"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  timeoutMs: 3_600_000,
});

export const premiereExportXml = defineHostTool({
  name: "premiere_export_xml",
  title: "Export FCP XML",
  description:
    "Write a sequence (default: the active one) as Final Cut Pro 7 XML (xmeml), Premiere's own exchange format, with " +
    "warnings dialogs suppressed. Zenvi reads this file to bring a Premiere edit back (import_timeline_xml_tool). Default " +
    "output: a new file in the system temp folder. Changes nothing in the project.",
  input: z.strictObject({
    output: absolutePath.optional().describe("Where to write the .xml; default: a new file in the temp folder"),
    overwrite: z.boolean().default(false).describe("Replace an existing file"),
    sequence: sequenceRef.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  timeoutMs: 300_000,
});

export const premiereImportXml = defineHostTool({
  name: "premiere_import_xml",
  title: "Import FCP XML",
  description:
    "Import a Final Cut Pro 7 XML (e.g. a Zenvi export) into a bin (\"Zenvi Imports\" by default) and open the sequence " +
    "it contains. Returns the new sequence ids. Media referenced by the XML must exist at its paths or Premiere marks " +
    "it offline. " + UNDO,
  input: z.strictObject({
    path: absolutePath.describe("The .xml file"),
    bin: binPath.default("Zenvi Imports").describe("Bin to import into, created if missing; \"/\" is the project root"),
    open: z.boolean().default(true).describe("Open the first imported sequence"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  timeoutMs: 600_000,
});

export const premiereSaveProject = defineHostTool({
  name: "premiere_save_project",
  title: "Save the project",
  description:
    "Save the project in place, or with `path` save it as a new .prproj and keep working in that copy (Premiere's Save " +
    "As closes the original). Save after a batch of edits the user wants to keep. Changes nothing in the project's " +
    "content; saving is not an undo step.",
  input: z.strictObject({
    path: absolutePath.optional().describe("Save As this .prproj path; default: save in place"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const premiereRunScript = defineHostTool({
  name: "premiere_run_script",
  title: "Run ExtendScript",
  description:
    "Escape hatch: run an ExtendScript (ECMAScript 3) snippet in Premiere and return its completion value as JSON. `app`, " +
    "`qe` (QE DOM, enabled) and `ZenviLink` are in scope. Use only when no premiere_* tool covers the job; the snippet can " +
    "change or delete anything. " + UNDO,
  input: z.strictObject({
    script: z.string().min(1).max(200_000).describe("ExtendScript source; the value of its last statement is returned"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  timeoutMs: 600_000,
});

export const PREMIERE_TOOLS: HostToolDef[] = [
  premiereGetState,
  premiereListItems,
  premiereGetSequence,
  premiereCaptureFrame,
  premiereImportFiles,
  premiereCreateSequence,
  premiereOpenSequence,
  premierePlaceClip,
  premiereEditClip,
  premiereRazor,
  premiereSetClipProperties,
  premiereAnimate,
  premiereApplyEffect,
  premiereAddTransition,
  premiereApplyLook,
  premiereAddText,
  premiereAddMarker,
  premiereAddCaptions,
  premiereAutoReframe,
  premiereSceneDetect,
  premiereExport,
  premiereExportXml,
  premiereImportXml,
  premiereSaveProject,
  premiereRunScript,
];
