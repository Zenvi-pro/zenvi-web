/**
 * Zenvi 3D scene catalog: the Blender scenes `@zenvi/scenes3d` renders,
 * with each scene's parameters (zod, defaults filled by parsing), its
 * natural length and which project media it shows. The engine owns this
 * contract so every surface validates the same way; the bpy scripts read
 * the parsed params (packages/scenes3d/blender/scenes/<id>.py).
 */

import { z } from "zod";

export const SCENE3D_IDS = [
  "title_3d",
  "device_mockup",
  "floating_cards",
  "icon_cube",
  "cube_cut",
  "glass_hero",
  "particle_burst",
  "logo_extrude",
  "model_showcase",
  "numerals_3d",
  "terrain_glide",
  "card_stack",
] as const;
export type Scene3dId = (typeof SCENE3D_IDS)[number];

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb")
  .transform((v) => v.toUpperCase());

/** transparent: RGBA ProRes 4444 over the timeline; dark / light / #rrggbb: an opaque H.264 with a soft radial backdrop. */
const background = z.union([z.enum(["transparent", "dark", "light"]), hex]);

const common = {
  background: background.default("transparent").describe("transparent (alpha, over the video), dark, light, or a #rrggbb backdrop."),
  accent: hex.optional().describe("Accent colour, #rrggbb (default #FF5A36)."),
  seed: z.number().int().min(0).max(1_000_000).default(7).describe("Random layout seed (same seed, same render)."),
};

const size = (fallback: number, what: string) =>
  z.number().min(0.2).max(1).default(fallback).describe(`Width of the ${what} as a share of the safe width (title-safe 90 %; on 9:16 clear of the app's UI), centred a little above the middle; it also stays inside the safe height.`);

/** A file on this computer (absolute, or relative to the project's folder) with one of these extensions. */
const localFile = (extensions: readonly string[], what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine((v) => extensions.some((e) => v.toLowerCase().endsWith(e)), `give a ${extensions.join(" / ")} file`)
    .describe(what);

/** Model formats Blender imports (scenes3d/blender/scenes/model_showcase.py IMPORTERS). */
export const SCENE3D_MODEL_EXTENSIONS = [".glb", ".gltf", ".obj", ".fbx", ".stl", ".ply"] as const;

const solidStyle = z.enum(["chrome", "glass", "plastic", "matte", "iridescent", "clay", "gradient"]);
const font = z.string().min(1).max(200).optional().describe("Font family installed on this computer, or a .ttf/.otf path (default a heavy sans: Arial Black, Inter, Helvetica…).");

const fileIds = (max: number, what: string) => z.array(z.string().min(1).max(64)).min(1).max(max).describe(what);

export const SCENE3D_PARAMS = {
  title_3d: z.strictObject({
    ...common,
    text: z.string().trim().min(1).max(32).describe("The title, 1-32 characters (one line)."),
    style: z.enum(["chrome", "glass", "plastic", "iridescent", "clay", "gradient"]).default("chrome").describe("Material. glass reads best over a backdrop or footage."),
    animation: z.enum(["tumble", "rise", "spin"]).default("tumble").describe("tumble: letters tumble in one by one; rise: the word tips up from below; spin: the word spins in."),
    color: hex.optional().describe("plastic / clay / gradient colour (default the accent)."),
    secondary: hex.optional().describe("gradient's second colour (default #2F6BFF)."),
    depth: z.number().min(0).max(1).default(0.35).describe("Extrusion depth, 0 (flat) to 1 (deep)."),
    font,
    exit: z.boolean().default(false).describe("Shrink away over the last 0.4 s."),
    size: size(0.66, "word"),
    shadow: z.boolean().default(true).describe("Soft contact shadow under the word."),
    dof: z.boolean().default(true).describe("Shallow depth of field on the word (letters arriving from behind are soft)."),
  }),
  device_mockup: z.strictObject({
    ...common,
    device: z.enum(["phone", "tablet", "laptop"]).default("phone").describe("Generic rounded phone, tablet or laptop."),
    file_id: z.string().min(1).max(64).optional().describe("Media-bin video or image shown on the screen (cover-cropped). Without it: a gradient screen."),
    media_start_seconds: z.number().min(0).default(0).describe("Where in the video the screen starts playing."),
    move: z.enum(["orbit", "push", "hero", "float"]).default("orbit").describe("orbit: the camera arcs around; push: dolly in with depth of field; hero: the device spins in and lands; float: it hovers and turns."),
    body: z.union([z.enum(["graphite", "silver", "white"]), hex]).optional().describe("Body finish (default graphite; laptop silver)."),
    size: size(0.65, "device"),
    open_lid: z.boolean().default(true).describe("laptop: the lid opens at the start."),
    shadow: z.boolean().default(true).describe("Soft contact shadow under the device."),
    dof: z.boolean().default(true).describe("Subtle depth of field focused on the device."),
  }),
  floating_cards: z.strictObject({
    ...common,
    file_ids: fileIds(8, "Media-bin videos or images on the cards (1-8; the first is the sharp hero card).").optional(),
    count: z.number().int().min(1).max(8).optional().describe("Number of cards (default one per file, or 5 gradient cards)."),
    fstop: z.number().min(0.05).max(16).default(0.3).describe("Depth of field: lower blurs the far cards more."),
  }),
  icon_cube: z.strictObject({
    ...common,
    file_ids: fileIds(12, "Media-bin images (icons, logos; PNG alpha sits on a coloured tile) for the cube's faces.").optional(),
    grid: z.union([z.literal(2), z.literal(3)]).default(2).describe("Cubelets per edge: 2 (8 cubes) or 3 (26)."),
    explode: z.boolean().default(true).describe("Burst into the cubelets after the spin."),
    colors: z.array(hex).min(1).max(8).optional().describe("Tile colours (default accent + a vivid set)."),
  }),
  cube_cut: z.strictObject({
    ...common,
    background: background.default("dark").describe("What shows around the cube mid-turn: dark (default), light or #rrggbb (never transparent)."),
    from_clip_id: z.string().min(1).max(64).describe("Timeline clip that ends at the cut (shown on the front face)."),
    to_clip_id: z.string().min(1).max(64).describe("Timeline clip that starts at the cut (on the face the cube turns to)."),
    direction: z.enum(["left", "right", "up", "down"]).default("left").describe("Which way the picture moves."),
  }),
  glass_hero: z.strictObject({
    ...common,
    shape: z.enum(["blob", "torus", "rings", "spheres"]).default("blob").describe("blob: a slowly morphing drop; torus; rings: two linked rings; spheres: a cluster."),
    material: z.enum(["glass", "chrome", "iridescent"]).default("glass"),
    colors: z.array(hex).length(2).optional().describe("The two gradient light colours (default #7B5CFF, #00C2FF)."),
    size: size(0.66, "object"),
    turn_degrees: z.number().min(0).max(1080).default(120).describe("How far it turns over the clip."),
  }),
  particle_burst: z.strictObject({
    ...common,
    kind: z.enum(["confetti", "sparks", "shards"]).default("confetti").describe("confetti: paper; sparks: glowing streaks; shards: glass, chrome and pearl."),
    count: z.number().int().min(10).max(400).optional().describe("Pieces (default 140; sparks 180)."),
    origin_x: z.number().min(0).max(1).default(0.5).describe("Burst point, 0 left to 1 right."),
    origin_y: z.number().min(0).max(1).default(0.5).describe("Burst point, 0 top to 1 bottom."),
    colors: z.array(hex).min(1).max(8).optional(),
  }),
  logo_extrude: z.strictObject({
    ...common,
    svg: localFile([".svg"], "The logo: an .svg on this computer (filled paths; strokes are not imported, outline them first).").optional(),
    text: z.string().trim().min(1).max(24).optional().describe("A word or monogram to extrude when there is no svg (default ZENVI)."),
    style: z.union([solidStyle, z.literal("original")]).default("chrome").describe("Material; original keeps the SVG's own fill colours as glossy plastic."),
    animation: z.enum(["tumble", "assemble"]).default("tumble").describe("tumble: the logo spins in and settles square to the camera; assemble: its pieces (SVG shapes, letters) fly together."),
    color: hex.optional().describe("plastic / matte / clay / gradient colour (default the accent)."),
    secondary: hex.optional().describe("gradient's second colour (default #2F6BFF)."),
    depth: z.number().min(0).max(1).default(0.4).describe("Extrusion depth, 0 (thin) to 1 (deep)."),
    bevel: z.number().min(0).max(1).default(0.5).describe("Rounded edge, 0 (sharp) to 1 (soft)."),
    font,
    size: size(0.6, "logo"),
    exit: z.boolean().default(false).describe("Shrink away over the last 0.4 s."),
    shadow: z.boolean().default(true).describe("Soft contact shadow under the logo."),
    dof: z.boolean().default(true).describe("Shallow depth of field (pieces arriving from behind are soft)."),
  }),
  model_showcase: z.strictObject({
    ...common,
    model: localFile(SCENE3D_MODEL_EXTENSIONS, "The 3D model on this computer: .glb, .gltf, .obj, .fbx (binary), .stl or .ply. It is centred, stood on the floor and framed."),
    move: z.enum(["turntable", "orbit", "push"]).default("turntable").describe("turntable: the model turns, the camera holds; orbit: the camera arcs around it; push: a slow dolly in with depth of field."),
    stage: z.enum(["studio", "dark", "table"]).default("studio").describe("studio: soft three-point light and real floor shadows; dark: low key with strong rim lights; table: on a wooden table top in warm window light."),
    look: z.enum(["solid", "xray", "wireframe"]).default("solid").describe("solid: lit surfaces; xray: see-through glow at the silhouette (fresnel); wireframe: glowing edges over a dark body. xray/wireframe read best on a dark background."),
    material: z.enum(["original", "clay", "chrome", "matte"]).default("original").describe("original keeps the model's materials (glTF/FBX); models without any are clay."),
    color: hex.optional().describe("clay / matte colour."),
    turn_degrees: z.number().min(0).max(1080).default(120).describe("turntable: how far it turns over the clip."),
    elevation: z.number().min(-10).max(70).default(14).describe("Camera height as an angle above the model's middle, degrees."),
    land: z.boolean().default(false).describe("The model drops onto the floor and settles at the start."),
    size: size(0.7, "model"),
    shadow: z.boolean().default(true).describe("Floor shadows (studio, dark) or the table (table)."),
    dof: z.boolean().default(true).describe("Depth of field on the model."),
  }),
  numerals_3d: z.strictObject({
    ...common,
    values: z.array(z.number().min(0).max(99_999_999)).min(1).max(8).default([0, 100]).describe("The figures it rolls through in order, e.g. [0, 51, 79] (non-negative; the first rolls in from blank)."),
    decimals: z.number().int().min(0).max(2).default(0).describe("Digits after the decimal point, the same for every value."),
    prefix: z.string().trim().max(3).optional().describe("Before the figure, e.g. $ or +."),
    suffix: z.string().trim().max(6).optional().describe("Unit after the figure, set smaller on its baseline, e.g. %, kt, km/h, x."),
    style: solidStyle.default("chrome").describe("Material of the figures."),
    color: hex.optional().describe("plastic / matte / clay / gradient colour (default the accent)."),
    secondary: hex.optional().describe("gradient's second colour."),
    unit_color: hex.optional().describe("Prefix / suffix colour (default as the figures)."),
    depth: z.number().min(0).max(1).default(0.5).describe("Extrusion depth."),
    font,
    size: size(0.8, "figure"),
    shadow: z.boolean().default(true).describe("Soft shadow under the figures."),
  }),
  terrain_glide: z.strictObject({
    ...common,
    background: z.union([z.enum(["dark", "light"]), hex]).default("light").describe("light: day, dark: dusk (when time is not given); a #rrggbb tints the haze and horizon. Never transparent: the sky is part of the picture."),
    surface: z.enum(["grass", "sand", "snow"]).default("grass").describe("grass: tufts swaying in the wind; sand: dunes with wind ripples; snow: soft drifts that glint."),
    time: z.enum(["day", "golden", "dusk"]).optional().describe("Sun and sky: day (high sun, blue sky), golden (low warm sun ahead), dusk (sun on the horizon, deep blue sky)."),
    speed: z.number().min(0).max(12).default(2.5).describe("Glide speed, metres per second."),
    camera_height: z.number().min(0.1).max(5).optional().describe("Camera height above the ground, metres (default 0.75 over grass, 0.9 otherwise)."),
    haze: z.number().min(0).max(1).default(0.4).describe("How quickly the distance fades into the sky."),
    lens: z.number().min(14).max(85).default(28).describe("Focal length, mm (wide is faster)."),
    dof: z.boolean().default(true).describe("Shallow focus a few metres ahead (near blades soft)."),
  }),
  card_stack: z.strictObject({
    ...common,
    file_ids: fileIds(12, "Media-bin images or videos printed on the cards (cycled); without them: coloured cards or paper.").optional(),
    count: z.number().int().min(2).max(12).optional().describe("Number of cards (default one per file, or 6)."),
    kind: z.enum(["card", "paper"]).default("card").describe("card: thick rounded cards; paper: thin sheets with a slight curl (ruled notes when there is no picture)."),
    animation: z.enum(["drop", "fan"]).default("drop").describe("drop: cards tumble down one by one onto a loose stack; fan: the stack lands and opens like a hand of cards."),
    colors: z.array(hex).min(1).max(8).optional().describe("Card colours (default accent + a vivid set)."),
    fan_degrees: z.number().min(2).max(30).default(12).describe("fan: angle between cards."),
    elevation: z.number().min(20).max(85).default(52).describe("Camera angle above the table, degrees (85: nearly top-down)."),
    size: size(0.75, "stack"),
    shadow: z.boolean().default(true).describe("Real soft shadows on the floor."),
    dof: z.boolean().default(true).describe("Subtle depth of field."),
  }),
} as const satisfies Record<Scene3dId, z.ZodObject>;

export type Scene3dParams<S extends Scene3dId = Scene3dId> = z.output<(typeof SCENE3D_PARAMS)[S]>;

export interface Scene3dInfo {
  id: Scene3dId;
  title: string;
  summary: string;
  /** Natural length, seconds (TASTE: a title card 2.5-4 s, a transition 0.5-1 s). */
  defaultSeconds: number;
  maxSeconds: number;
  /** Where it goes: over the video, or replacing the picture across a cut. */
  placement: "overlay" | "cut";
}

export const SCENE3D_INFO: Readonly<Record<Scene3dId, Scene3dInfo>> = {
  title_3d: { id: "title_3d", title: "3D title", summary: "An extruded chrome / glass / plastic / pearl title that tumbles in letter by letter (or rises, or spins) and glides while a light sweeps across it.", defaultSeconds: 3, maxSeconds: 12, placement: "overlay" },
  device_mockup: { id: "device_mockup", title: "Device mockup", summary: "A generic phone, tablet or laptop playing a bin video on its screen while the camera orbits or pushes in, or the device spins in and lands.", defaultSeconds: 4, maxSeconds: 15, placement: "overlay" },
  floating_cards: { id: "floating_cards", title: "Floating cards", summary: "Photos and videos as cards floating in depth with depth of field; they rise in one by one and drift while the camera glides.", defaultSeconds: 4, maxSeconds: 15, placement: "overlay" },
  icon_cube: { id: "icon_cube", title: "Icon cube", summary: "A cube of glossy tiles (icons or colours on its faces) spins, then bursts into its cubelets.", defaultSeconds: 3, maxSeconds: 10, placement: "overlay" },
  cube_cut: { id: "cube_cut", title: "Cube cut", summary: "A transition: clip A on a 3D cube turns to clip B; first and last frames match the clips, so it sits seamlessly on the cut.", defaultSeconds: 0.8, maxSeconds: 2, placement: "cut" },
  glass_hero: { id: "glass_hero", title: "Glass hero object", summary: "An abstract hero object (morphing blob, torus, linked rings, sphere cluster) in glass, chrome or pearl, turning in coloured gradient light.", defaultSeconds: 4, maxSeconds: 15, placement: "overlay" },
  particle_burst: { id: "particle_burst", title: "Particle burst", summary: "Confetti, glowing sparks or glass shards bursting from a point, falling and tumbling.", defaultSeconds: 2, maxSeconds: 8, placement: "overlay" },
  logo_extrude: { id: "logo_extrude", title: "3D logo", summary: "The user's SVG logo (or a word) extruded and bevelled in chrome, glass, matte, clay or its own colours; it tumbles in or its pieces fly together, and settles facing the camera.", defaultSeconds: 3, maxSeconds: 12, placement: "overlay" },
  model_showcase: { id: "model_showcase", title: "3D model showcase", summary: "The user's .glb/.gltf/.obj/.fbx/.stl/.ply model, centred and framed, on a turntable or with the camera orbiting or pushing in; studio, low-key or table-top staging; optional x-ray or wireframe look.", defaultSeconds: 4, maxSeconds: 15, placement: "overlay" },
  numerals_3d: { id: "numerals_3d", title: "3D counter", summary: "A huge extruded figure whose digits roll like an odometer, with motion blur, through a list of values, with a prefix and unit suffix: for spec and stats beats.", defaultSeconds: 3, maxSeconds: 12, placement: "overlay" },
  terrain_glide: { id: "terrain_glide", title: "Terrain glide", summary: "A backdrop: the camera glides low over a procedural grass, sand or snow field toward a low sun, with haze and sky (full frame).", defaultSeconds: 4, maxSeconds: 15, placement: "overlay" },
  card_stack: { id: "card_stack", title: "Card stack", summary: "Cards or sheets of paper (optionally printed with bin photos) tumble down onto a loose stack with soft real shadows, or land and fan out like a hand of cards.", defaultSeconds: 3, maxSeconds: 10, placement: "overlay" },
};

/** Params that name a file on this computer, by job slot (the renderer resolves, checks and fingerprints them). */
export function scene3dFiles(scene: Scene3dId, params: Scene3dParams): Record<string, string> {
  const p = params as Record<string, unknown>;
  if (scene === "logo_extrude" && typeof p.svg === "string") return { svg: p.svg };
  if (scene === "model_showcase" && typeof p.model === "string") return { model: p.model };
  return {};
}

/** Scenes that draw text in a font (the renderer resolves `params.font`). */
export const SCENE3D_FONT_SCENES: readonly Scene3dId[] = ["title_3d", "logo_extrude", "numerals_3d"];

export function isScene3dId(value: unknown): value is Scene3dId {
  return typeof value === "string" && (SCENE3D_IDS as readonly string[]).includes(value);
}

export type ParsedScene3dParams = { ok: true; params: Scene3dParams } | { ok: false; error: string };

/** Validate and complete a scene's params (defaults filled). Errors name each bad key. */
export function parseScene3dParams(scene: Scene3dId, raw: unknown): ParsedScene3dParams {
  const result = SCENE3D_PARAMS[scene].safeParse(raw ?? {});
  if (result.success) return { ok: true, params: result.data as Scene3dParams };
  const issues = result.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "params"}: ${i.message}`);
  return { ok: false, error: `${scene} params: ${issues.join("; ")}` };
}
