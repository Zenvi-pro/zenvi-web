"""numerals_3d: a huge extruded counter. Each digit is a drum of 3D
numerals that rolls, with motion blur, from value to value (odometer
style), with an optional prefix and a unit suffix: spec and stats reels."""

import math

import bpy

from zenvi3d import camera, core, lights, materials, motion, shapes

SLOTS = 11  # 0-9 and a blank (leading places of shorter values)
BLANK = 10
STEP = 2 * math.pi / SLOTS
ROLL = 0.6  # seconds a change takes
STAGGER = 0.05  # TASTE: per item, left to right


def fading(mat, radius, axis_y):
    """Mix the material out as its glyph turns away on the drum: only the
    numeral facing the camera (and the ones rolling through) shows. The
    drums turn about a line along world X at depth `axis_y`, so how much a
    glyph faces the camera is its object's distance in front of the axis
    over the radius."""
    tree = mat.node_tree
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    surface = out.inputs["Surface"].links[0].from_socket
    info = tree.nodes.new("ShaderNodeObjectInfo")
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(info.outputs["Location"], sep.inputs["Vector"])
    facing = core.math_node(tree, "DIVIDE", core.math_node(tree, "SUBTRACT", axis_y, sep.outputs["Y"]), radius)
    fac = core.map_range(tree, facing, 0.9, 0.99)
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(fac, mix.inputs["Fac"])
    tree.links.new(clear.outputs[0], mix.inputs[1])
    tree.links.new(surface, mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    if mat.surface_render_method != "BLENDED":
        mat.surface_render_method = "DITHERED"
    return mat


def formatted(values, decimals):
    return ["%.*f" % (decimals, abs(v)) for v in values]


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    font = job.get("font")
    decimals = int(p.get("decimals", 0))
    values = [float(v) for v in (p.get("values") or [0, 100])]
    texts = formatted(values, decimals)
    int_len = max(len(t.split(".")[0]) for t in texts)
    style = p.get("style", "chrome")
    depth = float(p.get("depth", 0.5))
    extrude, bevel = 0.04 + 0.22 * depth, 0.025

    # Digit metrics: one advance for all (tabular figures), the tallest ink for the drum.
    probes = [shapes.text(str(d), font, 1.0, extrude, bevel, None, name="Probe%d" % d) for d in range(10)]
    inks = [shapes.ink_bounds(o) for o in probes]
    advance = max(b[1] - b[0] for b in inks) * 1.06
    cap = max(b[3] - b[2] for b in inks)
    y_mid = (max(b[3] for b in inks) + min(b[2] for b in inks)) / 2
    for o in probes:
        bpy.data.objects.remove(o)
    radius = 1.25 * cap / STEP

    digit_mat = fading(materials.finish(style, p.get("color") or (None if style == "clay" else p.get("accent")), p.get("secondary")), radius, radius)
    unit_mat = materials.finish(p.get("unit_style") or style, p.get("unit_color") or p.get("color") or (None if style == "clay" else p.get("accent")), p.get("secondary"))

    columns = int_len + (decimals and decimals + 1)
    counter = core.empty("Counter")
    drums = []
    x = 0.0
    layout = []  # (kind, x) left to right
    for c in range(columns):
        if decimals and c == int_len:
            layout.append(("point", x + advance * 0.12))
            x += advance * 0.34
        else:
            layout.append(("digit", x + advance / 2))
            x += advance
    digits_right = x
    prefix = (p.get("prefix") or "").strip()
    suffix = (p.get("suffix") or "").strip()

    for kind, cx in layout:
        if kind == "point":
            dot = shapes.text(".", font, 1.0, extrude, bevel, unit_mat, name="Point")
            b = shapes.ink_bounds(dot)
            dot.data.offset_x = -(b[0] + b[1]) / 2
            dot.rotation_euler = (math.radians(90), 0, 0)
            dot.location = (cx, -radius, -y_mid)  # on the numerals' baseline
            dot.parent = counter
            continue
        drum = core.empty("Drum%d" % len(drums), (cx, 0, 0))
        drum.parent = counter
        for d in range(10):
            g = shapes.text(str(d), font, 1.0, extrude, bevel, digit_mat, name="D%d_%d" % (len(drums), d))
            b = shapes.ink_bounds(g)
            g.data.offset_x = -(b[0] + b[1]) / 2
            g.data.offset_y = -y_mid
            theta = d * STEP
            g.parent = drum
            g.location = (0, -radius * math.cos(theta), -radius * math.sin(theta))
            g.rotation_euler = (math.radians(90) + theta, 0, 0)
        drums.append(drum)

    unit_size = float(p.get("unit_size", 0.45))
    left = 0.0
    if prefix:
        pre = shapes.text(prefix, font, unit_size * 1.4, extrude, bevel, unit_mat, align="RIGHT", name="Prefix")
        b = shapes.ink_bounds(pre)
        pre.data.offset_y = -(b[2] + b[3]) / 2
        pre.rotation_euler = (math.radians(90), 0, 0)
        pre.location = (-advance * 0.12, -radius, 0)
        pre.parent = counter
        left = -advance * 0.12 - (b[1] - b[0])
    right = digits_right
    if suffix:
        suf = shapes.text(suffix, font, unit_size, extrude * 0.8, bevel, unit_mat, align="LEFT", name="Suffix")
        b = shapes.ink_bounds(suf)
        # On the numerals' baseline, like a unit set after a figure.
        suf.data.offset_y = -(b[2]) + (min(i[2] for i in inks) - y_mid)
        suf.data.offset_x = -b[0]
        suf.rotation_euler = (math.radians(90), 0, 0)
        suf.location = (digits_right + advance * 0.12, -radius, 0)
        suf.parent = counter
        right = digits_right + advance * 0.12 + (b[1] - b[0])
    width = right - left
    counter.location = (-(left + right) / 2, radius, 0)  # the front face of the drums at y = 0

    lights.studio(scale=max(1.0, width / 2), rim_color=p.get("rim") or "#CFE0FF", energy=0.35 if style in ("chrome", "iridescent") else 1.0)
    core.studio_world(job, strength=1.8 if style == "chrome" else 1.0, spin_degrees=120)
    bpy.context.scene.render.motion_blur_shutter = 0.9  # the roll streaks
    cam, aim = camera.camera(lens=60, location=(0, -10, 0), dof=None)
    dist = camera.compose(cam, width, cap, float(p.get("size", 0.8)), max_height=0.55)
    if p.get("shadow", True):
        shapes.shadow_blob("Shadow", width * 1.05, cap * 1.2, strength=0.45, location=(0, 0.2 * cap, -0.62 * cap))
    motion.animate(cam, "location", [(1, lights.orbit_point(dist * 1.03, -7, 5)), (frames, lights.orbit_point(dist * 0.97, 5, 3))], "in-out")

    # Slot per drum per value: right-aligned digits, leading places blank.
    def slots(text):
        digits = text.replace(".", "")
        digits = digits.rjust(len(drums), " ")
        return [BLANK if ch == " " else int(ch) for ch in digits]

    # Each value gets an equal step (its roll, then a hold); the last value
    # holds longest (at least 30 % of the clip): it is the one that reads.
    enter = 2
    stagger = int(round(STAGGER * fps))
    last_hold = int(round(0.3 * frames))
    # The drums start one after another: the last one's lag comes out of the steps, not the hold.
    step = max(3, (frames - enter - last_hold - stagger * (len(drums) - 1)) / len(values))
    roll = max(2, min(int(round(ROLL * fps)), int(step * 0.8) - stagger * (len(drums) - 1)))
    changes = [enter + int(round(i * step)) for i in range(len(values))]
    # Every drum starts on its blank and rolls in to the first value.
    angle = [-BLANK * STEP] * len(drums)  # current rotation (radians) of each drum
    current = [BLANK] * len(drums)
    keys = [[(1, angle[0])] for _ in drums]
    eases = [[] for _ in drums]
    previous = None
    for i, text in enumerate(texts):
        target = slots(text)
        up = previous is None or values[i] >= previous
        f0 = changes[i]
        for k, drum in enumerate(drums):
            if target[k] == current[k] and not (k == len(drums) - 1 and previous is not None and abs(values[i] - previous) >= 10):
                continue
            n = (target[k] - current[k]) % SLOTS if up else -((current[k] - target[k]) % SLOTS)
            if k == len(drums) - 1 and previous is not None and abs(values[i] - previous) >= 10:
                n += SLOTS if up else -SLOTS  # the units spin a full turn more, like a counter counting
            start = f0 + k * stagger
            keys[k].append((start, angle[k]))
            eases[k].append("hold")
            angle[k] -= n * STEP
            keys[k].append((start + roll, angle[k]))
            eases[k].append("in-out")
            current[k] = target[k]
        previous = values[i]
    for k, drum in enumerate(drums):
        motion.animate(drum, "rotation_euler", [(f, (a, 0, 0)) for f, a in keys[k]], eases[k] or "smooth")
