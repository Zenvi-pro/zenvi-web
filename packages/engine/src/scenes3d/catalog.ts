/**
 * Zenvi 3D scene catalog: the Blender scenes `@zenvi/scenes3d` renders,
 * with each scene's parameters (zod, defaults filled by parsing), its
 * natural length and which project media it shows. The engine owns this
 * contract so every surface validates the same way; the bpy scripts read
 * the parsed params (packages/scenes3d/blender/scenes/<id>.py).
 */

import { z } from "zod";

export const SCENE3D_IDS = ["title_3d", "device_mockup", "floating_cards", "icon_cube", "cube_cut", "glass_hero", "particle_burst"] as const;
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
    font: z.string().min(1).max(200).optional().describe("Font family installed on this computer, or a .ttf/.otf path (default a heavy sans: Arial Black, Inter, Helvetica…)."),
    exit: z.boolean().default(false).describe("Shrink away over the last 0.4 s."),
  }),
  device_mockup: z.strictObject({
    ...common,
    device: z.enum(["phone", "tablet", "laptop"]).default("phone").describe("Generic rounded phone, tablet or laptop."),
    file_id: z.string().min(1).max(64).optional().describe("Media-bin video or image shown on the screen (cover-cropped). Without it: a gradient screen."),
    media_start_seconds: z.number().min(0).default(0).describe("Where in the video the screen starts playing."),
    move: z.enum(["orbit", "push", "hero", "float"]).default("orbit").describe("orbit: the camera arcs around; push: dolly in with depth of field; hero: the device spins in and lands; float: it hovers and turns."),
    body: z.union([z.enum(["graphite", "silver", "white"]), hex]).optional().describe("Body finish (default graphite; laptop silver)."),
    open_lid: z.boolean().default(true).describe("laptop: the lid opens at the start."),
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
};

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
