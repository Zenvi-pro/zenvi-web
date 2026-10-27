"""device_mockup: a generic phone, tablet or laptop playing the footage on
its screen while the camera glides (orbit, push) or the device spins in
(hero) or floats. Generic rounded bodies: no real product's design."""

import math

from zenvi3d import camera, core, lights, materials, motion, shapes

DEVICES = {
    # body w, h, thickness, corner radius, screen inset
    "phone": (0.74, 1.52, 0.08, 0.12, 0.028),
    "tablet": (1.18, 1.62, 0.06, 0.09, 0.05),
}


def body_material(name):
    if name == "silver":
        return materials.metal("#C9CDD3", roughness=0.22, name="Body")
    if name == "white":
        return materials.plastic("#F1F1EF", roughness=0.3, name="Body")
    if name == "graphite":
        return materials.metal("#34363C", roughness=0.3, name="Body")
    return materials.plastic(name, name="Body")


def screen_material(job, aspect):
    item = job["media"].get("screen")
    if item:
        return materials.screen(item, aspect, glow=1.0)
    p = job["params"]
    return materials.solid_screen(p.get("accent") or core.PALETTE["accent"], core.PALETTE["secondary"])


def slab(job, name, w, h, t, corner, inset, body):
    """A device body in the XY plane, screen on +Z. Returns (root, screen size)."""
    root = core.empty(name)
    shell = shapes.rounded_box(name + "Body", (w, h, t), corner=corner, edge=min(0.018, t / 3), material=body)
    shell.parent = root
    glass = shapes.rounded_panel(name + "Glass", w - 0.012, h - 0.012, corner - 0.006, material=materials.plastic("#050506", roughness=0.05, coat=1.0, name="Bezel"))
    glass.location = (0, 0, t / 2 + 0.0008)
    glass.parent = root
    sw, sh = w - 2 * inset, h - 2 * inset
    screen = shapes.rounded_panel(name + "Screen", sw, sh, max(0.01, corner - inset), material=screen_material(job, sw / sh))
    screen.location = (0, 0, t / 2 + 0.0016)
    screen.parent = root
    return root, (sw, sh)


def phone_like(job, kind, landscape):
    w, h, t, corner, inset = DEVICES[kind]
    if landscape:
        w, h = h, w
    root, _ = slab(job, "Device", w, h, t, corner, inset, body_material(job["params"].get("body", "graphite")))
    if kind == "phone":
        pill = shapes.rounded_panel("Island", 0.2, 0.055, 0.0275, material=materials.plastic("#000000", roughness=0.1, name="Island"))
        pill.location = (0, h / 2 - inset - 0.06, t / 2 + 0.0024) if not landscape else (w / 2 - inset - 0.06, 0, t / 2 + 0.0024)
        if landscape:
            pill.rotation_euler = (0, 0, math.radians(90))
        pill.parent = root
    # Stand the device up, screen toward the camera (-Y).
    root.rotation_euler = (math.radians(90), 0, 0)
    pivot = core.empty("Pivot")
    root.parent = pivot
    return pivot, (w, h), None


def laptop(job):
    w, d, t = 1.9, 1.3, 0.045
    body = body_material(job["params"].get("body", "silver"))
    pivot = core.empty("Pivot")
    base = shapes.rounded_box("Base", (w, d, t), corner=0.06, edge=0.012, material=body)
    base.parent = pivot
    deck = shapes.rounded_panel("Keys", w * 0.82, d * 0.42, 0.02, material=materials.matte("#1A1B1E", name="Keys"))
    deck.location = (0, 0.12, t / 2 + 0.0008)
    deck.parent = pivot
    pad = shapes.rounded_panel("Pad", w * 0.3, d * 0.26, 0.03, material=materials.plastic("#B9BCC2", roughness=0.4, name="Pad"))
    pad.location = (0, -0.4, t / 2 + 0.0008)
    pad.parent = pivot
    hinge = core.empty("Hinge", (0, d / 2 - 0.02, t / 2))
    hinge.parent = pivot
    lid_h = d - 0.04
    lid, _ = slab(job, "Lid", w, lid_h, 0.03, 0.06, 0.06, body)
    lid.location = (0, lid_h / 2, 0.015)
    lid.parent = hinge
    return pivot, (w, lid_h + 0.2), hinge


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    kind = p.get("device", "phone")
    item = job["media"].get("screen")
    src_aspect = (item["width"] / item["height"]) if item and item.get("height") else 9 / 16
    if kind == "laptop":
        pivot, (w, h), hinge = laptop(job)
    else:
        pivot, (w, h), hinge = phone_like(job, kind, landscape=kind == "tablet" and src_aspect > 1.05)
    lift = 0.0 if kind == "laptop" else h / 2
    pivot.location = (0, 0, lift)

    size = max(w, h)
    lights.studio(scale=size / 1.5, rim_color=p.get("rim") or "#D6E4FF")
    core.studio_world(job, strength=0.9, spin_degrees=50)
    if p.get("shadow", True):
        shapes.shadow_blob("Shadow", w * 1.5, max(0.5, w * 0.6) if kind != "laptop" else 1.6, location=(0, 0, -0.002), strength=0.5 if core.backdrop_colors(job) else 0.35)

    move = p.get("move", "orbit")
    target = (0, 0, h * 0.42 if kind == "laptop" else lift)
    # Subtle depth of field on the device (stronger on the push-in; finals only).
    fstop = (0.5 if move == "push" else 1.0) if p.get("dof", True) and job["quality"] == "final" else None
    cam, aim = camera.camera(lens=50, target=target, dof=fstop)
    # `size` of the safe width on the optical centre; 0.9 of the safe height
    # leaves room for the push-in's last 8 % (the laptop's nominal height
    # leaves out its base, which the orbit's perspective adds back).
    dist = camera.compose(cam, w, h, float(p.get("size", 0.65)), max_height=0.72 if kind == "laptop" else 0.9)
    end = frames
    enter = int(round(1.0 * fps))  # TASTE: big moves 1.0 s

    def at(az, el, r):
        return lights.orbit_point(r, az, el, target)

    if move == "orbit":
        motion.animate(cam, "location", [(1, at(-38, 10, dist)), (end, at(24, 4, dist * 0.96))], "in-out")
    elif move == "push":
        motion.animate(cam, "location", [(1, at(-18, 8, dist * 1.45)), (end, at(-6, 3, dist * 0.92))], "smooth")
    elif move == "hero":
        cam.location = at(-12, 6, dist)
        motion.animate(pivot, "rotation_euler", [(1, (math.radians(-10), 0, math.radians(-150))), (enter + 6, (0, 0, math.radians(-8)))], "out")
        motion.animate(pivot, "location", [(1, (0, 0.6, lift - h * 0.6)), (enter + 6, (0, 0, lift))], "out")
        motion.animate(pivot, "scale", [(1, (0.7, 0.7, 0.7)), (enter + 6, (1, 1, 1))], "out")
        motion.animate(aim, "location", [(enter + 6, target), (end, (target[0], target[1], target[2] + h * 0.03))], "in-out")
    else:  # float
        cam.location = at(-14, 5, dist * 1.05)
        motion.bake(pivot, "location", (1, end), lambda f: (0, 0, lift + motion.wobble(f / fps, 3.2, h * 0.025)), step=2)
        motion.bake(pivot, "rotation_euler", (1, end), lambda f: (math.radians(6) + motion.wobble(f / fps, 4.0, 0.04), motion.wobble(f / fps, 5.0, 0.05), math.radians(-18) + 0.18 * (f / max(1, end))), step=2)
    if hinge is not None:
        opened = math.radians(78)
        if p.get("open_lid", True):
            motion.animate(hinge, "rotation_euler", [(1, (math.radians(178), 0, 0)), (1 + int(1.2 * fps), (opened, 0, 0))], "in-out")
        else:
            hinge.rotation_euler = (opened, 0, 0)
