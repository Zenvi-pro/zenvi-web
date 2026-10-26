"""floating_cards: photos and videos as cards floating in depth; they rise
in one after another, drift, and the camera glides past with depth of
field on the hero card."""

import math
import random

from zenvi3d import camera, core, lights, materials, motion, palette, shapes

# Slots (x, y in units of the visible half-frame at the hero's depth, depth in hero heights).
SLOTS = [(0.0, 0.0, 0.0), (-0.85, 0.62, -0.55), (0.8, -0.45, 1.5), (-0.7, -0.75, 2.4), (0.72, 0.78, 2.8), (0.05, -1.05, 3.6), (-0.15, 1.05, 4.2), (1.0, 0.1, 4.6)]
STAGGER = 0.12  # TASTE: per item/line


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    items = [job["media"][k] for k in sorted((k for k in job["media"] if k.startswith("card")), key=lambda k: int(k[4:]))]
    count = max(1, min(len(SLOTS), int(p.get("count") or len(items) or 5)))
    rng = random.Random(int(p.get("seed", 7)))
    colors = palette.colors(p, count)
    lights.studio(scale=1.6)
    core.studio_world(job, strength=0.8)
    aspect = camera.frame_aspect()
    cam, aim = camera.camera(lens=45, target=(0, 0, 0), dof=float(p.get("fstop", 0.3)))
    hero_h = 1.0
    first = items[0] if items else None
    hero_a = min(1.5, (first["width"] / first["height"]) if first and first.get("height") else 1.25)
    dist = camera.fit_distance(cam, hero_a * hero_h * 1.45, hero_h * 2.0)
    hx, hy = camera.visible_half(cam, dist)

    for i in range(count):
        item = items[i % len(items)] if items else None
        a = (item["width"] / item["height"]) if item and item.get("height") else (0.8 if i % 2 else 1.25)
        h = hero_h * (1.0 if i == 0 else rng.uniform(0.62, 0.82))
        w = h * a
        if w > 1.5 * hero_h:
            w, h = 1.5 * hero_h, 1.5 * hero_h / a
        mat = materials.card(item, w / h, name=f"Card{i}") if item else materials.gradient([colors[i], "#FFFFFF"], axis="Y", name=f"Card{i}")
        card = shapes.rounded_panel(f"Card{i}", w, h, min(w, h) * 0.06, material=mat, thickness=0.012)
        edge = materials.matte("#F4F4F2", roughness=0.5, name=f"Edge{i}")
        card.data.materials.append(edge)
        for poly in card.data.polygons:
            if abs(poly.normal.z) < 0.9:
                poly.material_index = 1
        holder = core.empty(f"Holder{i}")
        card.parent = holder
        card.rotation_euler = (math.radians(90), 0, 0)
        sx, sy, depth = SLOTS[i]
        spread = (dist + depth * hero_h) / dist
        x, z, y = sx * hx * 0.78 * spread, sy * hy * (0.85 if aspect < 1 else 0.72) * spread, depth * hero_h
        holder.location = (x, y, z)
        tilt = (rng.uniform(-8, 8), rng.uniform(-6, 6), rng.uniform(-14, 14) - sx * 10)
        f0 = 1 + int(round(i * STAGGER * fps))
        f1 = f0 + int(round(0.8 * fps))
        motion.animate(holder, "location", [(f0, (x, y + 0.4, z - 0.9 * hero_h)), (f1, (x, y, z))], "out")
        motion.animate(holder, "scale", [(f0, (0.001, 0.001, 0.001)), (f0 + int(0.35 * fps), (1, 1, 1))], "out")
        phase = rng.uniform(0, 6.28)
        start_rot = tuple(math.radians(v) for v in tilt)
        motion.bake(card, "location", (f1, frames), lambda f, ph=phase: (0, 0, motion.wobble(f / fps, 4.5, 0.03 * hero_h, ph)), step=3)
        motion.animate(holder, "rotation_euler", [(f0, (start_rot[0] - 0.5, start_rot[1], start_rot[2] + 0.3)), (f1, start_rot), (frames, (start_rot[0] + 0.04, start_rot[1], start_rot[2] - 0.06))], ["out", "in-out"])

    # The camera glides forward and across, focus stays on the hero card.
    motion.animate(cam, "location", [(1, (-0.25 * hx, -dist * 1.12, 0.12 * hy)), (frames, (0.18 * hx, -dist * 0.96, -0.04 * hy))], "in-out")
