"""card_stack: cards (or sheets of paper) tumble down one after another
onto a loose stack that lands with real soft shadows, or the stack lands
and fans out like a hand of cards; photos from the bin on their faces."""

import math
import random

import bpy

from zenvi3d import camera, core, lights, materials, motion, palette, shapes

STAGGER = 0.12  # TASTE: per item
FALL = 0.7


def paper_material(name, lines):
    """Off-white paper, matte, with faint ruled lines (notes) or plain."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    b = tree.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.7
    b.inputs["Base Color"].default_value = core.rgb("#F6F4EE", 1.0)
    if lines:
        coord = tree.nodes.new("ShaderNodeTexCoord")
        sep = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(coord.outputs["UV"], sep.inputs["Vector"])
        rows = core.math_node(tree, "FRACT", core.math_node(tree, "MULTIPLY", sep.outputs["Y"], 22.0))
        line = core.map_range(tree, core.math_node(tree, "ABSOLUTE", core.math_node(tree, "SUBTRACT", rows, 0.5)), 0.47, 0.5)
        # No lines in the top band (a header) and margins.
        band = core.math_node(tree, "MULTIPLY", core.map_range(tree, sep.outputs["Y"], 0.9, 0.86), core.map_range(tree, sep.outputs["X"], 0.06, 0.1))
        band = core.math_node(tree, "MULTIPLY", band, core.map_range(tree, sep.outputs["X"], 0.94, 0.9))
        mix = tree.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        tree.links.new(core.math_node(tree, "MULTIPLY", line, band), mix.inputs["Factor"])
        mix.inputs[6].default_value = core.rgb("#F6F4EE", 1.0)
        mix.inputs[7].default_value = core.rgb("#B9C6DA", 1.0)
        tree.links.new(mix.outputs[2], b.inputs["Base Color"])
    return mat


def face_material(i, item, aspect, color, kind):
    if item:
        return materials.card(item, aspect, name="Face%d" % i, gloss=0.35 if kind == "card" else 0.6, lift=0.15)
    if kind == "paper":
        return paper_material("Paper%d" % i, lines=i % 3 != 2)
    # Satin card stock: seen from above the faces mirror the studio's top light, so keep the sheen low.
    mat = materials.plastic(color, roughness=0.55, coat=0.0, name="Face%d" % i)
    mat.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.25
    return mat


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    kind = p.get("kind", "card")
    animation = p.get("animation", "drop")
    items = [job["media"][k] for k in sorted((k for k in job["media"] if k.startswith("card")), key=lambda k: int(k[4:]))]
    count = max(2, min(12, int(p.get("count") or len(items) or 6)))
    rng = random.Random(int(p.get("seed", 7)))
    colors = palette.colors(p, count)
    first = items[0] if items else None
    aspect = (first["width"] / first["height"]) if first and first.get("height") else (1 / 1.414 if kind == "paper" else 0.72)
    aspect = max(0.5, min(2.0, aspect))
    h = 1.4
    w = h * aspect
    if w > 1.6:
        w, h = 1.6, 1.6 / aspect
    thick = 0.014 if kind == "card" else 0.003
    radius = min(w, h) * (0.06 if kind == "card" else 0.008)

    lights.studio(scale=1.6, energy=0.8)
    core.studio_world(job, strength=0.45, spin_degrees=30)
    sun = lights.sun("Sun", 62, -40, strength=3.0, angle_deg=10)
    rig = [o for o in bpy.data.objects if o.type == "LIGHT" and o is not sun]

    cards = []
    edge = materials.matte("#F4F4F2", roughness=0.5, name="Edge")
    for i in range(count):
        item = items[i % len(items)] if items else None
        card = shapes.rounded_panel("Card%d" % i, w, h, radius, material=face_material(i, item, w / h, colors[i], kind), thickness=thick)
        card.data.materials.append(edge)
        for poly in card.data.polygons:
            if abs(poly.normal.z) < 0.9:
                poly.material_index = 1
        if kind == "paper":
            # A sheet is never quite flat: a slight curl along its length.
            bend = card.modifiers.new("Curl", "SIMPLE_DEFORM")
            bend.deform_method = "BEND"
            bend.deform_axis = "X"
            bend.angle = math.radians(rng.uniform(4, 9))
        cards.append(card)

    # Where each lands: a loose stack, every card a little off square.
    rest = []
    for i in range(count):
        z = thick / 2 + i * (thick + 0.0015)
        rest.append(((rng.uniform(-0.05, 0.05) * w, rng.uniform(-0.05, 0.05) * h, z), math.radians(rng.uniform(-13, 13))))
    spread = math.radians(float(p.get("fan_degrees", 12)))
    fan = animation == "fan"

    enter_end = 1
    for i, card in enumerate(cards):
        (x, y, z), turn = rest[i]
        holder = core.empty("Holder%d" % i)
        card.parent = holder
        f0 = 1 + int(round(i * (STAGGER * (0.5 if fan else 1.0)) * fps))
        f1 = f0 + int(round(FALL * fps))
        settle = int(round(0.3 * fps))
        drop = 2.4 + 0.15 * i
        side = rng.uniform(-1, 1)
        start_rot = (rng.uniform(-1, 1) * math.radians(150), rng.uniform(-1, 1) * math.radians(80), turn + rng.uniform(-1, 1) * math.radians(90))
        sway = (0.35 if kind == "paper" else 0.12) * h
        rock = rng.choice((-1, 1)) * math.radians(2.5 if kind == "card" else 4.0)

        def place(f, x=x, y=y, z=z, turn=turn, f0=f0, f1=f1, drop=drop, side=side, start_rot=start_rot, sway=sway, rock=rock, settle=settle):
            if f <= f0:
                u = 0.0
            else:
                u = min(1.0, (f - f0) / (f1 - f0))
            fall = 1 - u * u  # gravity: it speeds up until it lands
            ease = motion.bezier("out", u)
            flutter = math.sin(u * math.pi * (2.5 if kind == "paper" else 1.0)) * (1 - u) * sway
            loc = (x + side * 0.5 * w * (1 - ease) + flutter, y + 0.6 * h * (1 - ease), z + drop * fall)
            rx, ry, rz = (a * (1 - motion.bezier("smooth", u)) for a in start_rot)
            if f > f1:  # a little rock as it settles flat
                t = (f - f1) / max(1, settle)
                wob = rock * math.exp(-4.0 * t) * math.sin(t * math.pi * 2.0) if t < 1.5 else 0.0
                rx, ry = wob, -0.6 * wob
            return loc, (rx, ry, rz + turn)

        motion.bake(holder, "location", (1, f1 + settle + 2), lambda f, place=place: place(f)[0], step=1)
        motion.bake(holder, "rotation_euler", (1, f1 + settle + 2), lambda f, place=place: place(f)[1], step=1)
        motion.animate(holder, "scale", [(f0, (0.001, 0.001, 0.001)), (f0 + 2, (1, 1, 1))], "linear")
        enter_end = max(enter_end, f1 + settle)
        if fan:
            # The hand opens about the cards' bottom edge (the card's -Y end), one after another.
            pivot_shift = (0, h * 0.42, 0)
            card.location = pivot_shift
            holder_child = card
            angle = (i - (count - 1) / 2) * spread
            g0 = 1 + int(round((FALL + 0.2 + count * 0.06) * fps)) + int(round(i * 0.05 * fps))
            hinge = core.empty("Hinge%d" % i)
            hinge.parent = holder
            hinge.location = (0, -h * 0.42, 0)
            holder_child.parent = hinge
            motion.animate(hinge, "rotation_euler", [(g0, (0, 0, 0)), (g0 + int(round(0.6 * fps)), (0, 0, -angle))], "out")
            enter_end = max(enter_end, g0 + int(0.6 * fps))

    # Across the frame the stack shows its width (the camera looks along its length); a fan adds its swing.
    footprint_w = w + 2 * h * 0.84 * math.sin(spread * (count - 1) / 2) if fan else w * 1.2
    if p.get("shadow", True):
        catcher = shapes.shadow_catcher("Floor", 14, sun, strength=0.85)
        catcher.location = (0, 0, -0.0005)
        lights.exclude(rig, [catcher])
        shapes.calibrate_catcher(catcher)
        # Cards lie flat, so the sun's shadow hides under them: a soft occlusion grounds the stack.
        ground = shapes.shadow_blob("Contact", footprint_w * 1.25, h * 1.3, strength=0.35, location=(0, 0.12 * h if fan else 0, 0.0002))
        ground.rotation_euler = (0, 0, rest[0][1])

    elevation = float(p.get("elevation", 52))
    target = (0, -0.05 * h if not fan else 0.12 * h, 0.0)
    cam, aim = camera.camera(lens=50, target=target, dof=2.0 if p.get("dof", True) and job["quality"] == "final" else None)
    depth_seen = h * 1.1 * math.sin(math.radians(elevation)) + count * thick
    dist = camera.compose(cam, footprint_w * 1.05, depth_seen, float(p.get("size", 0.66)), max_height=0.8)
    motion.animate(cam, "location", [(1, lights.orbit_point(dist * 1.04, -22, elevation + 3, target)), (frames, lights.orbit_point(dist * 0.97, -10, elevation, target))], "in-out")
