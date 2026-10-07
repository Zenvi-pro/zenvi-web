/**
 * After Effects tools (`ae_*`, SPEC §3.4). Each definition here has exactly
 * one ExtendScript implementation registered with `ZenviLink.register` under
 * `extension/host/aeft/` (a test enforces the 1:1 match).
 *
 * Defaults come from TASTE (src/taste.ts); descriptions quote them so an
 * agent knows what a lazy call produces. The ExtendScript side reads the same
 * numbers from `ZenviLink.TASTE`, so they live in one place.
 */

import { z } from "zod";
import { LOOK_NAMES, TASTE } from "../taste.js";
import { absolutePath, color, defineHostTool, easing, layerRef, placement, seconds, type HostToolDef } from "./types.js";

const T = TASTE.timing;
const pct = (fraction: number): string => `${Math.round(fraction * 1000) / 10} %`;

// ---------------------------------------------------------------------------
// After Effects building blocks

/** A comp: item id or exact name; omitted = the active comp. */
const compRef = z
  .union([z.int().min(1).describe("Comp item id"), z.string().min(1).describe("Exact comp name")])
  .describe("Comp id (`comp_id`) or exact name; default: the active comp");

const layerArg = layerRef.describe("Layer: its id (`layer_id`), {\"index\": n} (1 = top) or exact name");

/** A property path below a layer. */
const propertyPath = z
  .union([
    z.string().min(1).describe("Display or match names separated by '/', e.g. \"Transform/Position\", \"Effects/Gaussian Blur/Blurriness\", \"ADBE Transform Group/ADBE Opacity\""),
    z.array(z.string().min(1)).min(1).max(12).describe("The same path as a list of names (use when a name contains '/')"),
  ])
  .describe(
    "Property path from the layer. Transform properties may omit the group (\"Position\", \"Scale\", \"Opacity\"); effect parameters may omit " +
      "\"Effects\" (\"Gaussian Blur/Blurriness\"). Digits select by 1-based index when no property has that name.",
  );

const vec2 = z.array(z.number()).length(2);

/** A mask or shape path. */
const shapePath = z
  .strictObject({
    vertices: z.array(vec2.describe("[x, y]")).min(1).max(1000).describe("Vertices in layer pixels"),
    in_tangents: z.array(vec2.describe("[x, y]")).max(1000).optional().describe("Incoming tangents, relative to each vertex (default: straight)"),
    out_tangents: z.array(vec2.describe("[x, y]")).max(1000).optional().describe("Outgoing tangents, relative to each vertex (default: straight)"),
    closed: z.boolean().optional().describe("Closed path (default true)"),
  })
  .describe("A Bezier path: {vertices, in_tangents?, out_tangents?, closed?}");

/** A value for any After Effects property. */
const propertyValue = z
  .union([
    z.number().describe("1D value (opacity, rotation, a slider, a menu index from 1, a checkbox 0/1; Scale takes one number as uniform %)"),
    z.boolean().describe("Checkbox (true = 1)"),
    z.string().describe("Text for Source Text, or a #RRGGBB colour for colour properties"),
    z.array(z.number()).min(1).max(4).describe("[x, y] / [x, y, z] for points, [r, g, b] or [r, g, b, a] with 0-1 channels for colours"),
    shapePath,
  ])
  .describe("Value in the property's own units");

/** A value for an effect parameter (no shapes). */
const effectValue = z
  .union([
    z.number().describe("Number (sliders, angles, menu index from 1, checkbox 0/1)"),
    z.boolean().describe("Checkbox"),
    z.string().describe("#RRGGBB for colour parameters"),
    z.array(z.number()).min(1).max(4).describe("[x, y] points or [r, g, b(, a)] colours with 0-1 channels"),
  ])
  .describe("Value in the parameter's own units");

/** One keyframe for ae_animate. */
const keyframe = z.strictObject({
  time: seconds.describe("Comp time in seconds (snapped to the frame grid)"),
  value: propertyValue,
  easing: easing.optional().describe("Easing of the segment that leaves this keyframe (default: the call's `easing`)"),
});

/** One effect parameter keyframe. */
const effectKeyframe = z.strictObject({
  time: seconds.describe("Comp time in seconds (snapped to the frame grid)"),
  value: effectValue,
  easing: easing.optional().describe("Easing of the segment that leaves this keyframe"),
});

const BLEND_MODES = [
  "normal",
  "dissolve",
  "dancing-dissolve",
  "darken",
  "multiply",
  "color-burn",
  "classic-color-burn",
  "linear-burn",
  "darker-color",
  "add",
  "lighten",
  "screen",
  "color-dodge",
  "classic-color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "linear-light",
  "vivid-light",
  "pin-light",
  "hard-mix",
  "difference",
  "classic-difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "stencil-alpha",
  "stencil-luma",
  "silhouette-alpha",
  "silhouette-luma",
  "alpha-add",
  "luminescent-premul",
] as const;

const blendMode = z.enum(BLEND_MODES);

const label = z.int().min(0).max(16);

const COMP_PRESETS = ["1080p", "4k", "vertical", "square", "720p"] as const;

/** TASTE §1-3 motion presets. */
export const AE_MOTION_PRESETS = [
  "fade-in",
  "fade-out",
  "slide-in",
  "slide-out",
  "scale-pop",
  "blur-in",
  "typewriter",
  "word-cascade",
  "line-rise",
  "ken-burns",
  "push-in",
  "drift",
  "whip-in",
] as const;

/** Presets that need a text layer (they build an editable text animator). */
export const AE_TEXT_PRESETS = ["typewriter", "word-cascade", "line-rise"] as const;

const TEXT_ANIMATIONS = ["fade-in", "slide-in", "scale-pop", "blur-in", "typewriter", "word-cascade", "line-rise"] as const;

const direction = z.enum(["left", "right", "up", "down"]);

const TEXT_STYLES = ["headline", "title", "subtitle", "lower-third", "caption"] as const;

const sizes = TASTE.type.sizes;

// ---------------------------------------------------------------------------
// Inspect

export const aeGetState = defineHostTool({
  name: "ae_get_state",
  title: "After Effects state",
  description:
    "Where After Effects is right now: app version, the open project (path, unsaved changes, item count), the active comp " +
    "(id, size, fps, duration, work area, current time, layer count), the selected project items and layers, and the render " +
    "queue. Call it first, and again whenever the user may have changed something by hand. Read-only and cheap.",
  input: z.strictObject({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeListItems = defineHostTool({
  name: "ae_list_items",
  title: "List project items",
  description:
    "Project panel items: comps, footage, solids, placeholders and folders with id, name, type, size, duration, fps, file path " +
    "and parent folder. Use it to find the item id that ae_add_layer, ae_get_comp or ae_render need. Read-only.",
  input: z.strictObject({
    type: z.enum(["comp", "footage", "solid", "placeholder", "folder"]).optional().describe("Only items of this type"),
    name_contains: z.string().min(1).optional().describe("Only items whose name contains this text (case-insensitive)"),
    limit: z.int().min(1).max(2000).default(200).describe("Maximum items returned (the receipt says when it truncated)"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeGetComp = defineHostTool({
  name: "ae_get_comp",
  title: "Inspect comp",
  description:
    "One comp in depth: settings (size, fps, duration, background, work area, motion blur, frame blending), comp markers and every " +
    "layer with id, index, name, type, source, timing (start/in/out/stretch), parent, switches, blend mode, track matte, effects and " +
    "the paths of its animated properties. Default: the active comp. Read-only.",
  input: z.strictObject({
    comp: compRef.optional(),
    max_layers: z.int().min(1).max(1000).default(200).describe("Maximum layers listed (top first)"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeGetLayer = defineHostTool({
  name: "ae_get_layer",
  title: "Inspect layer",
  description:
    "Deep view of one layer: transform values at `time`, every keyframe of its animated properties (time, value, interpolation, " +
    "temporal ease), effects with their parameters, the text document of text layers, masks and expressions (with errors). Use it " +
    "before changing animation so you edit what is there. Read-only.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    time: seconds.optional().describe("Comp time for the transform values (default: the comp's current time)"),
    max_keys: z.int().min(0).max(1000).default(100).describe("Maximum keyframes listed per property"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeListEffects = defineHostTool({
  name: "ae_list_effects",
  title: "List installed effects",
  description:
    "Effects installed in this After Effects (`app.effects`): display name, match name and category. Search before ae_apply_effect " +
    "when unsure of a name; match names work in every language. Read-only.",
  input: z.strictObject({
    search: z.string().min(1).optional().describe("Case-insensitive text matched against display name, match name and category"),
    category: z.string().min(1).optional().describe("Only this category (case-insensitive), e.g. \"Blur & Sharpen\""),
    limit: z.int().min(1).max(2000).default(100).describe("Maximum effects returned"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeCaptureFrame = defineHostTool({
  name: "ae_capture_frame",
  title: "Capture comp frame",
  description:
    "Render one comp frame to a PNG and return it as an image: your eyes. After any visual change capture the moments that matter " +
    "(first frame, each entrance end, mid-hold, last frame) and critique them against the taste guide: text inside title-safe and " +
    "readable, one focal point, nothing ending abruptly. Wide comps are downsampled to `max_width` through the comp's resolution " +
    "factor, which is restored afterwards. Read-only.",
  input: z.strictObject({
    comp: compRef.optional(),
    time: seconds.optional().describe("Comp time in seconds (default: the comp's current time); snapped to the frame grid"),
    max_width: z.int().min(64).max(4096).default(1280).describe("Largest width of the returned image in pixels"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  returnsImage: true,
  timeoutMs: 60_000,
});

// ---------------------------------------------------------------------------
// Comps

export const aeCreateComp = defineHostTool({
  name: "ae_create_comp",
  title: "Create comp",
  description:
    "Create a composition and open it. Presets: 1080p (1920x1080), 4k (3840x2160), vertical (1080x1920, 9:16 social), square " +
    "(1080x1080), 720p (1280x720), or pass width and height. Defaults: 30 fps, 10 s, background ink " +
    `${TASTE.color.palette.ink}, square pixels. A taken name gets a number appended.`,
  input: z.strictObject({
    name: z.string().min(1).max(255).default("Zenvi Comp").describe("Comp name"),
    preset: z.enum(COMP_PRESETS).optional().describe("Frame size preset (default 1080p unless width and height are given)"),
    width: z.int().min(4).max(30000).optional().describe("Width in pixels (with height; overrides preset)"),
    height: z.int().min(4).max(30000).optional().describe("Height in pixels (with width; overrides preset)"),
    fps: z.number().min(1).max(999).default(30).describe("Frame rate (29.97 and 23.976 work)"),
    duration: z.number().positive().max(10800).default(10).describe("Duration in seconds"),
    background: color.optional().describe(`Background colour (default ${TASTE.color.palette.ink})`),
    pixel_aspect: z.number().min(0.01).max(100).default(1).describe("Pixel aspect ratio"),
    folder: z.string().min(1).optional().describe("Project folder to put it in (created at the root if missing)"),
    open: z.boolean().default(true).describe("Open it in the Composition viewer"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const aeSetComp = defineHostTool({
  name: "ae_set_comp",
  title: "Change comp settings",
  description:
    "Change a comp: name, duration, fps, size, background, work area, motion blur (switch, shutter angle/phase), frame blending, " +
    "or open it in the viewer. Only the given settings change; nothing given or nothing different = unchanged.",
  input: z.strictObject({
    comp: compRef.optional(),
    name: z.string().min(1).max(255).optional().describe("New name"),
    duration: z.number().positive().max(10800).optional().describe("Duration in seconds"),
    fps: z.number().min(1).max(999).optional().describe("Frame rate"),
    width: z.int().min(4).max(30000).optional().describe("Width in pixels (layers keep their positions)"),
    height: z.int().min(4).max(30000).optional().describe("Height in pixels"),
    background: color.optional().describe("Background colour"),
    work_area: z
      .strictObject({
        start: seconds.describe("Work area start in seconds"),
        end: z.number().positive().describe("Work area end in seconds (after start, within the comp)"),
      })
      .optional()
      .describe("Work area"),
    motion_blur: z.boolean().optional().describe("Comp motion blur switch (layers also need their own switch)"),
    shutter_angle: z.number().min(0).max(720).optional().describe("Motion blur shutter angle in degrees (After Effects default 180)"),
    shutter_phase: z.number().min(-360).max(360).optional().describe("Motion blur shutter phase in degrees (default -90)"),
    frame_blending: z.boolean().optional().describe("Comp frame blending switch"),
    open: z.boolean().optional().describe("Open the comp in the viewer"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeImportFiles = defineHostTool({
  name: "ae_import_files",
  title: "Import files",
  description:
    "Import media files as footage items into a project folder (default \"Zenvi Imports\", created if missing). Paths already in " +
    "the project are reused, not imported twice (`dedupe`). All paths are checked before anything is imported.",
  input: z.strictObject({
    paths: z.array(absolutePath.describe("Absolute file path")).min(1).max(500).describe("Files to import"),
    folder: z.string().min(1).default("Zenvi Imports").describe("Project folder name"),
    sequence: z.boolean().default(false).describe("Import each path as the first frame of an image sequence"),
    dedupe: z.boolean().default(true).describe("Reuse items whose file is already imported"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aePrecompose = defineHostTool({
  name: "ae_precompose",
  title: "Precompose layers",
  description:
    "Move layers into a new comp (Layer > Pre-compose with \"Move all attributes\"), leaving one precomp layer in their place. " +
    "Returns the new comp id and the precomp layer.",
  input: z.strictObject({
    comp: compRef.optional(),
    layers: z.array(layerArg).min(1).max(500).describe("Layers to move (any order)"),
    name: z.string().min(1).max(255).optional().describe("New comp name (default: \"<top layer name> Comp\")"),
    move_all_attributes: z.boolean().default(true).describe("Move effects, masks and keyframes into the new comp (false needs exactly one layer)"),
    open: z.boolean().default(false).describe("Open the new comp in the viewer"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const aeAddMarker = defineHostTool({
  name: "ae_add_marker",
  title: "Add marker",
  description:
    "Add a comp marker, or a layer marker when `layer` is given: time, comment, duration, chapter, label colour. Use comp markers " +
    "for beats and section starts so later edits can align to them.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg.optional().describe("Put the marker on this layer instead of the comp"),
    time: seconds.optional().describe("Time in seconds (default: the comp's current time); snapped to the frame grid"),
    comment: z.string().max(2000).default("").describe("Marker comment"),
    duration: z.number().min(0).default(0).describe("Marker duration in seconds"),
    chapter: z.string().max(500).optional().describe("Chapter name"),
    url: z.string().max(2000).optional().describe("Web link"),
    label: label.optional().describe("Label colour index 0-16 (0 = none)"),
    protected_region: z.boolean().optional().describe("Comp markers: protect this time range when the comp is time-stretched"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

// ---------------------------------------------------------------------------
// Layers

export const aeAddLayer = defineHostTool({
  name: "ae_add_layer",
  title: "Add layer",
  description:
    "Add a layer at the top of a comp: footage (a project item id or a file path, imported once), solid, adjustment, null, shape " +
    "(rect or ellipse with fill, stroke and roundness), camera or light; with name, timing, initial transform, parent, blend mode, " +
    `3D and label. Solids default to the comp size in ink ${TASTE.color.palette.ink}; shapes to a centred 30 % rect filled with ` +
    `accent ${TASTE.color.palette.accent}. Text has its own tool (ae_add_text).`,
  input: z.strictObject({
    comp: compRef.optional(),
    kind: z.enum(["footage", "solid", "adjustment", "null", "shape", "camera", "light"]).describe("What to add"),
    item: z.int().min(1).optional().describe("footage: project item id (footage or comp, from ae_list_items)"),
    path: absolutePath.optional().describe("footage: a media file to import (reused when already imported)"),
    name: z.string().min(1).max(255).optional().describe("Layer name"),
    color: color.optional().describe("solid: colour; shape: fill colour"),
    width: z.int().min(4).max(30000).optional().describe("solid: width in pixels (default: the comp width)"),
    height: z.int().min(4).max(30000).optional().describe("solid: height in pixels (default: the comp height)"),
    shape: z.enum(["rect", "ellipse"]).default("rect").describe("shape: primitive"),
    size: vec2.optional().describe("shape: [width, height] in pixels (default 30 % of the comp)"),
    stroke: color.optional().describe("shape: stroke colour (no stroke when omitted)"),
    stroke_width: z.number().min(0).max(1000).optional().describe("shape: stroke width in pixels (default 4 px at 1080p)"),
    roundness: z.number().min(0).max(10000).default(0).describe("shape rect: corner roundness in pixels"),
    light_type: z.enum(["parallel", "spot", "point", "ambient"]).default("point").describe("light: type"),
    start: seconds.optional().describe("Layer start time in seconds (default 0)"),
    in_point: seconds.optional().describe("In point in seconds"),
    out_point: z.number().positive().optional().describe("Out point in seconds"),
    position: z.array(z.number()).min(2).max(3).optional().describe("Position [x, y] or [x, y, z] in comp pixels (default: centre)"),
    scale: z.union([z.number(), z.array(z.number()).min(2).max(3)]).optional().describe("Scale % (one number = uniform)"),
    rotation: z.number().optional().describe("Rotation in degrees"),
    opacity: z.number().min(0).max(100).optional().describe("Opacity %"),
    parent: layerArg.optional().describe("Parent layer"),
    blend_mode: blendMode.optional().describe("Blend mode"),
    three_d: z.boolean().optional().describe("Make it a 3D layer"),
    label: label.optional().describe("Label colour index 0-16"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const aeAddText = defineHostTool({
  name: "ae_add_text",
  title: "Add text",
  description:
    "Add a text layer that already looks designed. `style` picks the TASTE type scale at 1080p (scaled by the comp's short side): " +
    `headline ${sizes.headline} px bold, title ${sizes.title} px bold, subtitle ${sizes.subtitle} px, lower-third ${sizes.lowerThirdName} px ` +
    `name (+ ${sizes.lowerThirdRole} px role via \`subtitle\`), caption ${sizes.caption} px. Fonts fall back Inter > SF Pro Display > ` +
    `Helvetica Neue > Arial. Tracking ${TASTE.type.tracking.headline * 1000} on headlines, +${TASTE.type.tracking.caps * 1000} on ALL CAPS; ` +
    `leading ${TASTE.type.leading.headline}x headlines / ${TASTE.type.leading.body}x body. \`placement\` keeps the text inside title-safe ` +
    `(10 % inset; 9:16 also avoids the top 12 % and bottom 20 %); lower-third sits left at title-safe with its baseline at 80 % ` +
    `(70 % vertical). Lines over ${TASTE.type.maxLineChars} characters are broken at balanced word boundaries, too-wide text is ` +
    "scaled down to fit, and a soft shadow is added over footage. Optional `animation` applies a motion preset at the layer's start.",
  input: z.strictObject({
    comp: compRef.optional(),
    text: z.string().min(1).max(5000).describe("The text; \\n starts a new line"),
    subtitle: z.string().min(1).max(5000).optional().describe("Second, smaller line as its own layer below (e.g. the role in a lower third)"),
    name: z.string().min(1).max(255).optional().describe("Layer name (default: the text)"),
    style: z.enum(TEXT_STYLES).optional().describe("Type role (default: lower-third for that placement, caption for bottom-center, subtitle for top placements, else title)"),
    placement: placement.default("center").describe("Where the text sits; every placement stays inside title-safe"),
    font: z.string().min(1).optional().describe("PostScript font name, e.g. \"Inter-Bold\" (falls back with a warning when missing)"),
    size: z.number().min(1).max(1296).optional().describe("Font size in pixels (default: the style's TASTE size)"),
    fill: color.optional().describe(`Fill colour (default paper ${TASTE.color.palette.paper})`),
    stroke: color.optional().describe("Stroke colour (no stroke when omitted)"),
    stroke_width: z.number().min(0).max(1000).optional().describe("Stroke width in pixels (default 2 px at 1080p when stroke is set)"),
    tracking: z.number().min(-1000).max(10000).optional().describe("Tracking in 1/1000 em (After Effects units)"),
    leading: z.number().min(0.5).max(5).optional().describe("Line spacing as a multiple of the font size"),
    justification: z.enum(["left", "center", "right"]).optional().describe("Paragraph alignment (default: from placement)"),
    box: z
      .strictObject({ width: z.number().min(1).describe("Box width in pixels"), height: z.number().min(1).describe("Box height in pixels") })
      .optional()
      .describe("Paragraph text box (wraps inside it) instead of point text"),
    auto_break: z.boolean().default(true).describe(`Break lines longer than ${TASTE.type.maxLineChars} characters at balanced word boundaries`),
    shadow: z.boolean().optional().describe("Soft drop shadow for contrast (default: on when footage or a precomp is below)"),
    start: seconds.optional().describe("Layer start in seconds (default 0)"),
    duration: z.number().positive().optional().describe(`Seconds on screen (default: to the comp end; lower-third ${T.lowerThird.default} s)`),
    animation: z.enum(TEXT_ANIMATIONS).optional().describe("Entrance preset applied at the layer start (see ae_apply_motion_preset)"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const aeSetText = defineHostTool({
  name: "ae_set_text",
  title: "Change text",
  description:
    "Change an existing text layer's text or style: text, font (with fallback), size, fill, stroke, tracking, leading, " +
    "justification or paragraph box size. When Source Text is keyframed pass `time` to set the keyframe there. Only the given " +
    "values change.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    text: z.string().max(5000).optional().describe("New text; \\n starts a new line"),
    font: z.string().min(1).optional().describe("PostScript font name"),
    size: z.number().min(1).max(1296).optional().describe("Font size in pixels"),
    fill: color.optional().describe("Fill colour"),
    stroke: z.union([color, z.null()]).optional().describe("Stroke colour; null removes the stroke"),
    stroke_width: z.number().min(0).max(1000).optional().describe("Stroke width in pixels"),
    tracking: z.number().min(-1000).max(10000).optional().describe("Tracking in 1/1000 em"),
    leading: z.number().min(0.5).max(5).optional().describe("Line spacing as a multiple of the font size"),
    justification: z.enum(["left", "center", "right"]).optional().describe("Paragraph alignment"),
    box: z
      .strictObject({ width: z.number().min(1).describe("Box width in pixels"), height: z.number().min(1).describe("Box height in pixels") })
      .optional()
      .describe("Paragraph box size (paragraph text layers only)"),
    time: seconds.optional().describe("For keyframed Source Text: set the keyframe at this time"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

const trackMatte = z
  .strictObject({
    type: z.enum(["alpha", "alpha-inverted", "luma", "luma-inverted", "none"]).describe("Matte type; none removes the matte"),
    layer: layerArg.optional().describe("Matte layer (After Effects 2023+; default and only choice before 2023: the layer directly above)"),
  })
  .describe("Track matte");

export const aeSetLayer = defineHostTool({
  name: "ae_set_layer",
  title: "Change layer",
  description:
    "Change a layer's timing (start, in, out, stretch), switches (enabled, solo, locked, shy, motion blur, 3D, adjustment, guide, " +
    "collapse transformations, audio), blend mode, track matte, parent, label, name, comment or quality. Unlock in the same call " +
    "(locked: false) to change a locked layer. Only the given values change.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    name: z.string().min(1).max(255).optional().describe("New layer name"),
    comment: z.string().max(5000).optional().describe("Layer comment"),
    start: z.number().min(-10800).max(10800).optional().describe("Start time in seconds (moves the layer and its keyframes)"),
    in_point: z.number().min(-10800).max(10800).optional().describe("In point in seconds"),
    out_point: z.number().min(-10800).max(10800).optional().describe("Out point in seconds"),
    stretch: z.number().min(-10000).max(10000).optional().describe("Time stretch % (100 = normal, 200 = half speed, negative = reverse)"),
    enabled: z.boolean().optional().describe("Video switch (eyeball)"),
    audio_enabled: z.boolean().optional().describe("Audio switch"),
    solo: z.boolean().optional().describe("Solo"),
    locked: z.boolean().optional().describe("Lock"),
    shy: z.boolean().optional().describe("Shy"),
    motion_blur: z.boolean().optional().describe("Layer motion blur switch"),
    three_d: z.boolean().optional().describe("3D layer"),
    adjustment: z.boolean().optional().describe("Adjustment layer"),
    guide: z.boolean().optional().describe("Guide layer (not rendered)"),
    collapse: z.boolean().optional().describe("Collapse transformations / continuously rasterize"),
    blend_mode: blendMode.optional().describe("Blend mode"),
    track_matte: trackMatte.optional(),
    parent: z.union([layerArg, z.null()]).optional().describe("Parent layer; null removes the parent (the layer keeps its place on screen)"),
    label: label.optional().describe("Label colour index 0-16"),
    quality: z.enum(["best", "draft", "wireframe"]).optional().describe("Layer quality"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeArrangeLayers = defineHostTool({
  name: "ae_arrange_layers",
  title: "Arrange layers",
  description:
    "Restack, duplicate, delete or split a layer. move: `to` top, bottom, {index}, {before: layer} or {after: layer}. duplicate: " +
    "copies the layer (keyframes, effects, masks) above itself. delete: removes it (children keep their place). split: cuts it at " +
    "`time` into two layers, like Edit > Split Layer.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    action: z.enum(["move", "duplicate", "delete", "split"]).describe("What to do"),
    to: z
      .union([
        z.enum(["top", "bottom"]).describe("Top or bottom of the stack"),
        z.strictObject({ index: z.int().min(1).describe("1-based index the layer ends up at") }).describe("An index"),
        z.strictObject({ before: layerArg }).describe("Right above another layer"),
        z.strictObject({ after: layerArg }).describe("Right below another layer"),
      ])
      .optional()
      .describe("move: where the layer goes"),
    time: seconds.optional().describe("split: cut time in seconds (default: the comp's current time)"),
    name: z.string().min(1).max(255).optional().describe("duplicate / split: name for the new layer"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
});

// ---------------------------------------------------------------------------
// Properties, animation, expressions

export const aeSetProperty = defineHostTool({
  name: "ae_set_property",
  title: "Set property",
  description:
    "Set any layer property by path (display or match names): a static value, or a keyframe at `time`. Colours take #RRGGBB, " +
    "points [x, y], Scale a number for uniform %. Values are checked against the property's range first. For eased motion use " +
    "ae_animate instead.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    property: propertyPath,
    value: propertyValue,
    time: seconds.optional().describe("Set a keyframe at this time instead of the static value (required when the property already has keyframes)"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeAnimate = defineHostTool({
  name: "ae_animate",
  title: "Animate property",
  description:
    `Keyframe a property with real eased keyframes. Each segment eases with the TASTE curves (default ${TASTE.easing.default}; ` +
    "out/entrance for arrivals, in/exit for departures, in-out between resting states, snap for punchy pops, linear only for opacity " +
    "crossfades, loops and tickers, hold for steps) or a custom {x1, y1, x2, y2}, mapped exactly to After Effects speed/influence " +
    "per dimension (spatial properties along the path). Existing keyframes inside the new time span are replaced (all of them with " +
    "`replace`). `overshoot` (0-0.06) adds an editable settle keyframe for playful brands only.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    property: propertyPath,
    keyframes: z.array(keyframe).min(1).max(500).describe("Keyframes in time order: [{time, value, easing?}]"),
    easing: easing.default(TASTE.easing.default).describe("Default easing for every segment"),
    replace: z.boolean().default(false).describe("Remove all existing keyframes of the property first"),
    spatial: z.enum(["auto-bezier", "linear"]).default("auto-bezier").describe("Spatial interpolation for position-like properties"),
    overshoot: z.number().min(0).max(TASTE.easing.overshoot.max).default(0).describe("Overshoot of the last segment as a fraction of its distance (settles within 0.25 s)"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const aeApplyMotionPreset = defineHostTool({
  name: "ae_apply_motion_preset",
  title: "Apply motion preset",
  description:
    "Tasteful, editable animation on a layer. fade-in / fade-out (opacity), slide-in / slide-out (" +
    `${pct(TASTE.layout.slide.default)} of the frame width with opacity), scale-pop (${TASTE.layout.scale.entranceFrom * 100} % to 100 %), ` +
    "blur-in, whip-in (a fast push with motion blur), ken-burns (slow scale + pan over the shot, in-out), push-in (100 % to " +
    `${TASTE.layout.scale.holdPushTo * 100} % over the shot), drift (a slow procedural float, an expression); text only: typewriter, ` +
    "word-cascade, line-rise (text animators with a Range Selector, so a human can retime them). Defaults: entrances " +
    `${T.entrance.default} s eased out, exits ${T.exit.default} s eased in, pops ${T.micro.default} s snap, stagger ${T.stagger.word} s per ` +
    `word / ${T.stagger.line} s per line; entrances start at the layer's in point, exits end at its out point. \`intensity\` 0-1 ` +
    "(0.5 = the TASTE default) scales distance, scale or blur within the TASTE range. Keyframes already in the preset's time range " +
    "on the same properties are replaced.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    preset: z.enum(AE_MOTION_PRESETS).describe("Motion preset"),
    start: seconds.optional().describe("Start time in seconds (default: in point for entrances and holds; out point minus duration for exits)"),
    duration: z.number().positive().max(600).optional().describe("Seconds (default per preset; word-cascade / line-rise: each word or line's entrance; typewriter: the whole text)"),
    intensity: z.number().min(0).max(1).default(0.5).describe("0-1 within the TASTE range; 0.5 = default"),
    direction: direction.optional().describe("Direction of travel for slide/whip presets (default: slide-in up, slide-out down, whip-in right, ken-burns left)"),
    stagger: z.number().min(0.01).max(2).optional().describe("Text presets: seconds between words/lines/characters"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const aeAddExpression = defineHostTool({
  name: "ae_add_expression",
  title: "Set expression",
  description:
    "Set or clear an expression on a property. The expression is checked by After Effects right away; one that errors is removed " +
    "again and the call is refused with After Effects' message. An empty string clears the expression. Prefer keyframes for " +
    "anything a human will retime; expressions suit loops, wiggles and links between properties.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    property: propertyPath,
    expression: z.string().max(100_000).describe("Expression source; \"\" clears it"),
    enabled: z.boolean().default(true).describe("Enable the expression"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

// ---------------------------------------------------------------------------
// Effects and looks

const effectParam = z.strictObject({
  param: z.string().min(1).describe("Parameter display name, match name, or \"Section/Name\" for duplicates (e.g. \"Creative/Saturation\")"),
  value: effectValue,
});

const effectKeyframes = z.strictObject({
  param: z.string().min(1).describe("Parameter display name or match name"),
  keyframes: z.array(effectKeyframe).min(1).max(500).describe("Keyframes [{time, value, easing?}]"),
});

export const aeApplyEffect = defineHostTool({
  name: "ae_apply_effect",
  title: "Apply effect",
  description:
    "Add an effect to a layer by display name or match name (exact first, then a unique fuzzy match on the display name; " +
    "ae_list_effects lists them), then set parameters and optional eased keyframes. Returns the effect's index and the exact " +
    "parameter names it set.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    effect: z.string().min(1).describe("Effect display name (\"Gaussian Blur\") or match name (\"ADBE Gaussian Blur 2\")"),
    name: z.string().min(1).max(255).optional().describe("Name for this effect instance"),
    params: z.array(effectParam).max(200).optional().describe("Parameter values [{param, value}]"),
    keyframes: z.array(effectKeyframes).max(50).optional().describe("Animated parameters [{param, keyframes}]"),
    easing: easing.default(TASTE.easing.default).describe("Default easing for keyframe segments"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

export const aeSetEffect = defineHostTool({
  name: "ae_set_effect",
  title: "Change effect",
  description:
    "Change an effect already on a layer: parameter values, on/off, name, or remove it (destructive). Find effects with " +
    "ae_get_layer; refer to one by its instance name, match name or 1-based index in the stack.",
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    effect: z.union([z.int().min(1).describe("1-based index in the layer's effect stack"), z.string().min(1).describe("Instance name or match name")]).describe("Which effect"),
    params: z.array(effectParam).max(200).optional().describe("Parameter values [{param, value}]"),
    enabled: z.boolean().optional().describe("Effect switch (fx)"),
    name: z.string().min(1).max(255).optional().describe("Rename the effect"),
    remove: z.boolean().default(false).describe("Delete the effect"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
});

export const aeApplyLook = defineHostTool({
  name: "ae_apply_look",
  title: "Apply colour look",
  description:
    "Grade with a TASTE look built from Lumetri Color, by default on one adjustment layer (\"Zenvi Look\") over the whole comp that " +
    "is reused when you try another look. clean: contrast +5, vibrance +5. warm-film: temperature +8, tint +2, faded film 8, " +
    "saturation -6. teal-orange: Color Balance shadows to teal, highlights to orange, saturation +6. moody: exposure -0.3, contrast " +
    "+12, saturation -15, vignette -0.8. bw-contrast: saturation 0, contrast +25. `strength` scales every change (default " +
    `${TASTE.color.lookStrength}; keep skin natural); bw-contrast always fully desaturates and scales only its contrast. ` +
    "Lumetri parameters are found by their English names.",
  input: z.strictObject({
    comp: compRef.optional(),
    look: z.enum(LOOK_NAMES).describe("TASTE look"),
    strength: z.number().min(0).max(1).default(TASTE.color.lookStrength).describe("0-1 multiplier on the look's changes"),
    layer: layerArg.optional().describe("Grade this layer instead of an adjustment layer"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

// ---------------------------------------------------------------------------
// Masks

export const aeAddMask = defineHostTool({
  name: "ae_add_mask",
  title: "Add mask",
  description:
    "Add a mask to a layer: a rect or ellipse (`bounds` in layer pixels, default the whole layer) or a Bezier `path`, with feather, " +
    "expansion, opacity, mode and inversion. `animate` eases one mask property from a start value to the set value (default " +
    `${T.entrance.default} s, out) - e.g. expansion from -200 for a soft reveal.`,
  input: z.strictObject({
    comp: compRef.optional(),
    layer: layerArg,
    shape: z.enum(["rect", "ellipse", "path"]).default("rect").describe("Mask shape"),
    bounds: z
      .strictObject({
        left: z.number().describe("Left edge in layer pixels"),
        top: z.number().describe("Top edge in layer pixels"),
        width: z.number().positive().describe("Width in pixels"),
        height: z.number().positive().describe("Height in pixels"),
      })
      .optional()
      .describe("rect/ellipse bounds (default: the layer's bounds)"),
    path: shapePath.optional().describe("path: the mask path"),
    name: z.string().min(1).max(255).optional().describe("Mask name"),
    mode: z.enum(["add", "subtract", "intersect", "lighten", "darken", "difference", "none"]).default("add").describe("Mask mode"),
    inverted: z.boolean().default(false).describe("Invert the mask"),
    feather: z.union([z.number().min(0), vec2]).default(0).describe("Feather in pixels (one number or [x, y])"),
    expansion: z.number().default(0).describe("Expansion in pixels (negative shrinks)"),
    opacity: z.number().min(0).max(100).default(100).describe("Mask opacity %"),
    animate: z
      .strictObject({
        property: z.enum(["expansion", "feather", "opacity"]).describe("Which mask property to animate"),
        from: z.number().describe("Start value (it animates to the value set by this call)"),
        start: seconds.optional().describe("Start time in seconds (default: the layer's in point)"),
        duration: z.number().positive().max(600).optional().describe(`Seconds (default ${T.entrance.default})`),
        easing: easing.optional().describe("Easing (default out)"),
      })
      .optional()
      .describe("Optional eased animation"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

// ---------------------------------------------------------------------------
// Render

const RENDER_PRESETS = ["h264", "prores-422", "prores-4444", "lossless", "lossless-alpha"] as const;

export const aeRender = defineHostTool({
  name: "ae_render",
  title: "Render comp",
  description:
    "Render a comp through the render queue. preset h264 (After Effects 2023+; falls back to ProRes 422 with a warning), " +
    "prores-422, prores-4444 (alpha), lossless, lossless-alpha; or an exact output module `template`. mode render_now renders and " +
    "blocks After Effects until done (default), queue_only adds it to the queue, media_encoder queues it in Adobe Media Encoder. " +
    "The output defaults to a Renders folder next to the saved project. Existing files are not overwritten unless `overwrite`; " +
    "render_now replaces one only once the new render is complete.",
  input: z.strictObject({
    comp: compRef.optional(),
    output: absolutePath.optional().describe("Output file (extension follows the format; default <project folder>/Renders/<comp>.<ext>)"),
    preset: z.enum(RENDER_PRESETS).default("h264").describe("Output format"),
    template: z.string().min(1).optional().describe("Exact output module template name (overrides preset)"),
    render_settings: z.string().min(1).default("Best Settings").describe("Render settings template"),
    work_area_only: z.boolean().default(false).describe("Render only the work area"),
    mode: z.enum(["render_now", "queue_only", "media_encoder"]).default("render_now").describe("How to render"),
    overwrite: z.boolean().default(false).describe("Replace an existing output file"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  timeoutMs: 1_800_000,
});

export const aeRenderForZenvi = defineHostTool({
  name: "ae_render_for_zenvi",
  title: "Render for Zenvi",
  description:
    "Render a comp (default: the active comp) for a Zenvi linked clip and return everything Zenvi needs: path, comp id and name, " +
    "project, size, fps, duration and a ready `link` object (SPEC 3.6) for the desktop's import_linked_media_tool. alpha: true " +
    "renders ProRes 4444 with alpha (for overlays over other clips; QuickTime Animation where there is no ProRes 4444 template), " +
    "else H.264 (before After Effects 2023: ProRes 4444, then QuickTime Animation). Only codecs Zenvi links: h264, prores4444, " +
    "qtrle. Blocks After Effects while it renders; the render queue item is removed afterwards (two undo steps: queue, tidy). " +
    "An existing `output` is replaced only with `overwrite`, and only once the new render is complete.",
  input: z.strictObject({
    comp: compRef.optional(),
    alpha: z.boolean().default(false).describe("Keep transparency (ProRes 4444) instead of an opaque H.264"),
    output: absolutePath.optional().describe("Output file (default: a unique file in the temp folder's zenvi-link/renders)"),
    work_area_only: z.boolean().default(false).describe("Render only the work area"),
    template: z.string().min(1).optional().describe("Exact output module template name to use instead (H.264, ProRes 4444 or QuickTime Animation)"),
    overwrite: z.boolean().default(false).describe("Replace an existing file at `output` (the default output is always a new file)"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  timeoutMs: 1_800_000,
});

// ---------------------------------------------------------------------------
// Project, history, scripts

export const aeSaveProject = defineHostTool({
  name: "ae_save_project",
  title: "Save project",
  description:
    "Save the project, or save it as `path` (.aep or .aepx). An untitled project needs a path. Saving is not an undo step.",
  input: z.strictObject({
    path: absolutePath.optional().describe("Save as this file (.aep / .aepx)"),
    overwrite: z.boolean().default(false).describe("Replace an existing file at `path`"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
});

export const aeUndo = defineHostTool({
  name: "ae_undo",
  title: "Undo Zenvi steps",
  description:
    "Undo the last N steps (Edit > Undo), normally Zenvi tool calls: each mutating ae_* call is exactly one undo step. Reports " +
    "which Zenvi steps it expects to have undone; if someone changed the project by hand since, After Effects undoes that change " +
    "first.",
  input: z.strictObject({
    steps: z.int().min(1).max(50).default(1).describe("How many steps to undo"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
});

export const aeRunJsxFile = defineHostTool({
  name: "ae_run_jsx_file",
  title: "Run JSX file",
  description:
    "Run an ExtendScript file with $.evalFile inside one undo step and return the string it returns. Used by the Zenvi -> After " +
    "Effects handoff (export_to_after_effects_tool writes such a file). Runs arbitrary code: only run files you trust.",
  input: z.strictObject({
    path: absolutePath.describe("The .jsx / .jsxbin file"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  // A Zenvi export of a long, heavily keyframed timeline can take many minutes to build in After Effects.
  timeoutMs: 1_800_000,
});

export const aeRunScript = defineHostTool({
  name: "ae_run_script",
  title: "Run ExtendScript",
  description:
    "Escape hatch: run an ExtendScript (ECMAScript 3) snippet inside one undo step and return JSON of its last expression's value. " +
    "Use a dedicated ae_* tool when one exists; they validate, ease and report properly. Runs arbitrary code.",
  input: z.strictObject({
    code: z.string().min(1).max(200_000).describe("ExtendScript source; the value of its last expression is returned"),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
});

export const AE_TOOLS: HostToolDef[] = [
  aeGetState,
  aeListItems,
  aeGetComp,
  aeGetLayer,
  aeCaptureFrame,
  aeCreateComp,
  aeSetComp,
  aeImportFiles,
  aeAddLayer,
  aeAddText,
  aeSetText,
  aeSetLayer,
  aeArrangeLayers,
  aeSetProperty,
  aeAnimate,
  aeApplyMotionPreset,
  aeAddExpression,
  aeApplyEffect,
  aeSetEffect,
  aeListEffects,
  aeApplyLook,
  aeAddMask,
  aePrecompose,
  aeAddMarker,
  aeRender,
  aeSaveProject,
  aeUndo,
  aeRunJsxFile,
  aeRunScript,
  aeRenderForZenvi,
];
