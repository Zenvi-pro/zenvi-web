import { describe, expect, it } from "vitest";
import type { ProjectFile } from "../model/types.js";
import { readPictureEvents, type PictureEvent } from "../sfx/events.js";
import { SCENE3D_IDS, SCENE3D_INFO, type Scene3dId } from "./catalog.js";
import { readScene3dEvents, scene3dEvents } from "./events.js";
import { ZENVI_LINK_KEY } from "./link.js";

/** Params every scene needs to parse (the rest are defaults). */
const REQUIRED: Partial<Record<Scene3dId, Record<string, unknown>>> = {
  title_3d: { text: "ZENVI" },
  cube_cut: { from_clip_id: "a", to_clip_id: "b" },
};
const of = (events: PictureEvent[], kind: PictureEvent["kind"]): PictureEvent[] => events.filter((e) => e.kind === kind);
const frame = (f: number, fps = 30): number => Math.round(((f - 1) / fps) * 1000) / 1000;

describe("scene3dEvents", () => {
  it.each(SCENE3D_IDS)("%s with default params: valid, sorted, inside the clip", (scene) => {
    const seconds = SCENE3D_INFO[scene].defaultSeconds;
    const events = scene3dEvents(scene, REQUIRED[scene] ?? {}, seconds);
    expect(readPictureEvents(events)).toEqual(events);
    for (const e of events) expect(e.t >= 0 && e.t < seconds).toBe(true);
    expect(events.map((e) => e.t)).toEqual([...events.map((e) => e.t)].sort((a, b) => a - b));
    expect(scene3dEvents(scene, REQUIRED[scene] ?? {}, seconds)).toEqual(events);
    if (scene !== "terrain_glide") expect(events.length).toBeGreaterThan(0);
  });

  it("falls back to the defaults when the params are invalid, and is empty for no time", () => {
    expect(scene3dEvents("title_3d", { text: 5 }, 3)).toEqual(scene3dEvents("title_3d", { text: "ZENVI" }, 3));
    expect(scene3dEvents("card_stack", { count: 99 }, 3)).toEqual(scene3dEvents("card_stack", {}, 3));
    expect(scene3dEvents("card_stack", {}, 0)).toEqual([]);
  });

  it("card_stack: one land per card at the script's stagger and fall (card_stack.py:107-108)", () => {
    const drop = of(scene3dEvents("card_stack", { count: 4 }, 3), "land");
    // f0 = 1 + round(i * 0.12 * 30) = 1, 5, 8, 12; f1 = f0 + 21.
    expect(drop.map((e) => e.t)).toEqual([22, 26, 29, 33].map((f) => frame(f)));
    expect(drop[0]!.weight).toBeGreaterThan(drop[1]!.weight);
    const fan = scene3dEvents("card_stack", { count: 4, animation: "fan" }, 3);
    // Half the stagger: 1 + round(i * 0.06 * 30) = 1, 3, 5, 6.
    expect(of(fan, "land").map((e) => e.t)).toEqual([22, 24, 26, 27].map((f) => frame(f)));
    expect(of(fan, "whoosh")).toHaveLength(1);
    expect(of(scene3dEvents("card_stack", {}, 3), "land")).toHaveLength(6);
  });

  it("particle_burst bursts on the first frame at its origin (particle_burst.py:69, 88-92)", () => {
    const [burst] = scene3dEvents("particle_burst", { origin_x: 0.2, origin_y: 0.7 }, 2);
    expect(burst).toMatchObject({ t: 0, kind: "burst", x: 0.2, y: 0.7 });
    expect(burst!.weight).toBeGreaterThanOrEqual(0.7);
  });

  it("numerals_3d: a tick run per value change, the units spinning a full turn more (numerals_3d.py:149-181)", () => {
    const events = scene3dEvents("numerals_3d", { values: [0, 100] }, 3);
    const ticks = of(events, "tick");
    // frames 90, 3 drums, stagger 2, roll 18, changes at frames 2 and 2 + round(28.5) = 30.
    expect(ticks.map((e) => [e.t, e.until])).toEqual([
      [frame(6), frame(24)],
      [frame(30), frame(52)],
    ]);
    // 0 -> 100: the units roll 11 slots in 0.6 s.
    expect(ticks[1]!.rate).toBeCloseTo(11 / 0.6, 1);
    expect(of(events, "land").map((e) => e.t)).toEqual([frame(52)]);
    expect(of(scene3dEvents("numerals_3d", { values: [0, 51, 79, 99] }, 4), "tick")).toHaveLength(4);
    // A repeated value rolls nothing.
    expect(of(scene3dEvents("numerals_3d", { values: [5, 5] }, 3), "tick")).toHaveLength(1);
  });

  it("cube_cut: a whoosh through the turn and an impact at its midpoint (cube_cut.py:62-65)", () => {
    const events = scene3dEvents("cube_cut", REQUIRED.cube_cut!, 0.8);
    expect(of(events, "impact").map((e) => e.t)).toEqual([frame(12)]);
    const [whoosh] = of(events, "whoosh");
    expect(whoosh!.t).toBeCloseTo(frame(12.5), 2);
  });

  it("title_3d branches on its entrance (title_3d.py:47-66)", () => {
    const tumble = scene3dEvents("title_3d", { text: "HELLO WORLD" }, 3);
    expect(of(tumble, "land")).toHaveLength(10);
    const lands = of(tumble, "land");
    expect(lands[0]!.x).toBeLessThan(0.5);
    expect(lands[9]!.x).toBeGreaterThan(0.5);
    const reveal = (animation: string): number => of(scene3dEvents("title_3d", { text: "HI", animation }, 3), "reveal")[0]!.t;
    // An out-eased move is 95 % there at 0.426 of its length: spin 1.2 s, rise 1.0 s.
    expect(reveal("spin")).toBeCloseTo(0.426 * 1.2, 1);
    expect(reveal("rise")).toBeCloseTo(0.426 * 1.0, 1);
    expect(of(scene3dEvents("title_3d", { text: "HI", animation: "spin" }, 3), "land")).toHaveLength(0);
    // Only reflective finishes catch the sweep; exit adds a whoosh at the end.
    expect(of(scene3dEvents("title_3d", { text: "HI", style: "clay" }, 3), "glint")).toHaveLength(0);
    expect(of(scene3dEvents("title_3d", { text: "HI" }, 3), "glint")).toHaveLength(1);
    expect(of(scene3dEvents("title_3d", { text: "HI", exit: true }, 3), "whoosh").at(-1)!.t).toBeGreaterThan(2.6);
  });

  it("logo_extrude: tumble reveals once, assemble lands every letter first (logo_extrude.py:167-188)", () => {
    const tumble = scene3dEvents("logo_extrude", {}, 3);
    expect(of(tumble, "reveal")).toHaveLength(1);
    expect(of(tumble, "land")).toHaveLength(0);
    const assemble = scene3dEvents("logo_extrude", { animation: "assemble", text: "ABC" }, 3);
    const lands = of(assemble, "land");
    expect(lands).toHaveLength(3);
    // stagger 0.08 s: letters start on frames 1, 3, 6.
    expect(lands[2]!.t - lands[0]!.t).toBeCloseTo(5 / 30, 3);
    expect(of(assemble, "reveal")[0]!.t).toBe(lands[2]!.t);
  });

  it("device_mockup: hero spins in and lands, orbit is there from the start (device_mockup.py:122-139)", () => {
    const hero = scene3dEvents("device_mockup", { move: "hero" }, 4);
    expect(of(hero, "land")).toHaveLength(1);
    expect(of(hero, "land")[0]!.weight).toBe(0.7);
    const orbit = scene3dEvents("device_mockup", {}, 4);
    expect(orbit[0]).toMatchObject({ t: 0, kind: "reveal" });
    expect(of(orbit, "whoosh")[0]!.t).toBeCloseTo(frame(60.5), 2);
    expect(of(scene3dEvents("device_mockup", { device: "laptop" }, 4), "land")).toHaveLength(1);
  });

  it("icon_cube bursts at 45 % of the clip, or not at all (icon_cube.py:86-92)", () => {
    expect(of(scene3dEvents("icon_cube", {}, 3), "burst").map((e) => e.t)).toEqual([frame(40)]);
    expect(of(scene3dEvents("icon_cube", { explode: false }, 3), "burst")).toHaveLength(0);
  });

  it("model_showcase lands on the floor when dropped (model_showcase.py:265-269)", () => {
    const lands = of(scene3dEvents("model_showcase", { land: true }, 4), "land");
    // Python rounds 0.55 * 30 = 16.5 half to even: f1 = 17, f2 = 17 + 9.
    expect(lands.map((e) => e.t)).toEqual([frame(17), frame(26)]);
  });

  it("floating_cards pops one card per file, in slot order across the frame (floating_cards.py:11, 54)", () => {
    const pops = of(scene3dEvents("floating_cards", { file_ids: ["a", "b", "c"] }, 4), "pop");
    expect(pops).toHaveLength(3);
    expect(pops[1]!.x).toBeLessThan(0.5);
    expect(pops[2]!.x).toBeGreaterThan(0.5);
  });

  it("drops events past the clip's end", () => {
    const events = scene3dEvents("card_stack", { count: 12 }, 1);
    expect(events.every((e) => e.t < 1)).toBe(true);
    expect(of(events, "land").length).toBeLessThan(12);
  });
});

describe("readScene3dEvents", () => {
  const file = (link: unknown): ProjectFile => ({ id: "F1", media_type: "video", path: "/tmp/x.mov", [ZENVI_LINK_KEY]: link }) as unknown as ProjectFile;
  const link = (scene: string, props: Record<string, unknown>, frames: number, fps = { num: 30, den: 1 }) => ({
    kind: "blender",
    version: 1,
    source: { composition: scene },
    props,
    render: { fps, duration_frames: frames },
  });

  it("reads the scene, params, fps and length from the Blender link", () => {
    const events = readScene3dEvents(file(link("card_stack", { count: 3 }, 90)));
    expect(events).toEqual(scene3dEvents("card_stack", { count: 3 }, 3));
    expect(readScene3dEvents(file(link("card_stack", { count: 3 }, 50)), 3)).toEqual(scene3dEvents("card_stack", { count: 3 }, 3));
    const pal = readScene3dEvents(file(link("icon_cube", {}, 75, { num: 25, den: 1 })));
    expect(of(pal!, "burst").map((e) => e.t)).toEqual([frame(33, 25)]);
  });

  it("is null for files that are not 3D scenes", () => {
    expect(readScene3dEvents({ id: "F2", media_type: "video", path: "/tmp/y.mp4" } as unknown as ProjectFile)).toBeNull();
    expect(readScene3dEvents(file({ ...link("card_stack", {}, 90), kind: "zenvi-motion" }))).toBeNull();
    expect(readScene3dEvents(file(link("nope", {}, 90)))).toBeNull();
  });
});
