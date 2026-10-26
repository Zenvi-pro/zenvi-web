"""title_3d: an extruded, bevelled title that tumbles in letter by letter
(or rises, or spins) and glides while a light sweeps across it."""

import math

from zenvi3d import camera, core, lights, materials, motion, shapes

STAGGER = 0.06  # TASTE: per-word/letter stagger
ENTRANCE = 0.8


def material(params):
    style = params.get("style", "chrome")
    color = params.get("color") or params.get("accent") or core.PALETTE["accent"]
    if style == "glass":
        return materials.glass(tint="#F4F8FF")
    if style == "plastic":
        return materials.plastic(color)
    if style == "iridescent":
        return materials.iridescent()
    if style == "clay":
        return materials.clay(params.get("color") or "#ECE7DF")
    if style == "gradient":
        return materials.gradient([color, params.get("secondary") or core.PALETTE["secondary"]], axis="X")
    return materials.chrome(bands="Y")


def build(job):
    p = job["params"]
    body = (p.get("text") or "ZENVI").strip() or "ZENVI"
    fps = job["fps"]
    frames = job["frames"]
    depth = float(p.get("depth", 0.35))
    mat = material(p)
    word = core.empty("Word")
    placed, (w, h) = shapes.letters(body, job.get("font"), 1.0, extrude=0.05 + 0.4 * depth, bevel=0.03, material=mat, tracking=0.05)
    for _, glyph in placed:
        glyph.parent = word
        glyph.rotation_euler = (math.radians(90), 0, 0)
        glyph.location = (glyph.location.x, 0, glyph.location.y)

    scale = max(1.0, w / 2)
    lights.studio(scale=scale, rim_color=p.get("rim") or "#CFE0FF", energy=0.35 if p.get("style", "chrome") in ("chrome", "iridescent") else 1.0)
    core.studio_world(job, strength=1.8 if p.get("style", "chrome") == "chrome" else 1.0, spin_degrees=150 if p.get("style", "chrome") in ("chrome", "iridescent", "glass") else 60)
    aspect = camera.frame_aspect()
    cam, aim = camera.camera(lens=55, location=(0, -10, 0.35 * h))
    margin = 1.28 if aspect < 1 else 1.6
    dist = camera.fit_distance(cam, w * margin, h * 3.0)
    # Slightly below the word: its faces mirror the bright horizon line, not the dark floor.
    cam.location = (0.0, -dist, -0.05 * dist)
    aim.location = (0, 0, 0)

    start = 1
    enter = int(round(ENTRANCE * fps))
    animation = p.get("animation", "tumble")
    if animation == "tumble":
        for i, (_, glyph) in enumerate(placed):
            f0 = start + int(round(i * STAGGER * fps))
            f1 = f0 + enter
            x = glyph.location.x
            motion.animate(glyph, "location", [(f0, (x, 1.6, -0.9)), (f1, (x, 0, 0))], "out")
            motion.animate(glyph, "rotation_euler", [(f0, (math.radians(90 - 110), 0, math.radians(-12))), (f1, (math.radians(90), 0, 0))], "out")
            motion.animate(glyph, "scale", [(f0, (0.001, 0.001, 0.001)), (f0 + int(enter * 0.4), (1, 1, 1))], "out")
        landed = start + int(round((len(placed) - 1) * STAGGER * fps)) + enter
    elif animation == "spin":
        motion.animate(word, "rotation_euler", [(start, (0, 0, math.radians(-200))), (start + int(1.2 * fps), (0, 0, 0))], "out")
        motion.animate(word, "scale", [(start, (0.6, 0.6, 0.6)), (start + int(1.2 * fps), (1, 1, 1))], "out")
        landed = start + int(1.2 * fps)
    else:  # rise
        motion.animate(word, "location", [(start, (0, 0.8, -1.4)), (start + int(1.0 * fps), (0, 0, 0))], "out")
        motion.animate(word, "rotation_euler", [(start, (math.radians(-75), 0, 0)), (start + int(1.0 * fps), (0, 0, 0))], "out")
        landed = start + int(1.0 * fps)

    # The hold glides: a slow turn of the word and a small camera push (TASTE: 3-6 %).
    end = frames
    hold_from = min(landed, end - 1)
    if animation == "tumble":
        motion.animate(word, "rotation_euler", [(start, (0, 0, math.radians(-14))), (end, (0, 0, math.radians(8)))], "in-out")
    cl = tuple(cam.location)
    motion.animate(cam, "location", [(hold_from, cl), (end, (cl[0], cl[1] * 0.95, cl[2]))], "in-out")
    if p.get("exit"):
        out = max(hold_from + 1, end - int(0.4 * fps))
        motion.animate(word, "scale", [(out, (1, 1, 1)), (end, (0.001, 0.001, 0.001))], "in")
