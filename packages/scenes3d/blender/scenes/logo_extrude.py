"""logo_extrude: a user's SVG logo (or a word) extruded and bevelled in
chrome, glass, matte, clay or its own colours; it tumbles in, or its pieces
fly together, and settles facing the camera while a light sweeps across."""

import math
import random

import bpy
from mathutils import Matrix, Vector

from zenvi3d import camera, core, lights, materials, motion, shapes

STAGGER = 0.08  # TASTE: per item
WIDTH = 2.0  # the logo is scaled to this width before framing


def import_svg(path):
    """The filled paths of an SVG as curve objects (paint order), or a clear error."""
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_curve.svg(filepath=path)
    except Exception as error:
        raise ValueError("Blender could not read the SVG %s: %s" % (path, error)) from error
    pieces = [o for o in bpy.data.objects if o not in before and o.type == "CURVE" and len(o.data.splines) > 0]
    if not pieces:
        raise ValueError("the SVG %s has no filled shapes (outlines and strokes are not imported; convert strokes to paths)" % path)
    return pieces


def bounds(objects):
    """World bounds of the objects' evaluated geometry (a curve's bound_box
    is not reliable until it is drawn, so measure its mesh)."""
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objects:
        ev = o.evaluated_get(graph)
        mesh = ev.to_mesh()
        pts += [o.matrix_world @ v.co for v in mesh.vertices]
        ev.to_mesh_clear()
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def svg_pieces(path):
    """[(curve object, its SVG fill colour)], scaled to WIDTH and each centred on its own pivot."""
    pieces = import_svg(path)
    lo, hi = bounds(pieces)
    w, h = hi.x - lo.x, hi.y - lo.y
    if w <= 0 or h <= 0:
        raise ValueError("the SVG %s is empty" % path)
    scale = WIDTH / max(w, h * 0.5)  # very tall marks are framed by height (camera.compose)
    centre = (lo + hi) / 2
    out = []
    for obj in pieces:
        colour = tuple(obj.data.materials[0].diffuse_color)[:3] if obj.data.materials else None
        obj.data.materials.clear()
        # Bake the size into the curve, so extrusion and bevel are in final units.
        obj.data.transform(Matrix.Diagonal((scale, scale, scale, 1.0)) @ Matrix.Translation(-centre) @ obj.matrix_world)
        # transform() scales the points' radius too, which would scale the extrusion and bevel.
        for spline in obj.data.splines:
            for point in spline.bezier_points:
                point.radius = 1.0
            for point in spline.points:
                point.radius = 1.0
        obj.matrix_world = Matrix.Identity(4)
        p_lo, p_hi = bounds([obj])
        mid = (p_lo + p_hi) / 2
        obj.data.transform(Matrix.Translation(-mid))
        obj.location = mid
        obj.data.dimensions = "2D"
        obj.data.fill_mode = "BOTH"
        out.append((obj, colour))
    return out


def text_pieces(job, body, split):
    """The word as one curve, or one per letter (assemble)."""
    if split and len(body.replace(" ", "")) > 1:
        placed, (w, _) = shapes.letters(body, job.get("font"), 1.0, extrude=0.0, bevel=0.0, material=None, tracking=0.04)
        scale = WIDTH / w
        out = []
        for _, glyph in placed:
            glyph.data.size *= scale
            glyph.data.offset_x *= scale
            glyph.data.offset_y *= scale
            glyph.location = glyph.location * scale
            out.append((glyph, None))
        return out
    obj = shapes.text(body, job.get("font"), 1.0, extrude=0.0, bevel=0.0, name="Word")
    x0, x1, y0, y1 = shapes.ink_bounds(obj)
    scale = WIDTH / (x1 - x0)
    obj.data.size = scale
    obj.data.offset_x = -(x0 + x1) / 2 * scale
    obj.data.offset_y = -(y0 + y1) / 2 * scale
    return [(obj, None)]


def piece_material(style, params, colour, cache):
    """`original` keeps each SVG fill as glossy plastic (a word: the accent)."""
    if style != "original":
        if "solid" not in cache:
            cache["solid"] = materials.finish(style, params.get("color") or (None if style == "clay" else params.get("accent")), params.get("secondary"))
        return cache["solid"]
    key = colour or "accent"
    if key not in cache:
        if colour is None:
            cache[key] = materials.plastic(params.get("color") or params.get("accent") or core.PALETTE["accent"], roughness=0.25)
        else:
            mat = materials.plastic("#FFFFFF", roughness=0.25, name="Fill")
            mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = colour + (1.0,)
            cache[key] = mat
    return cache[key]


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    style = p.get("style", "chrome")
    animation = p.get("animation", "tumble")
    rng = random.Random(int(p.get("seed", 7)))
    if p.get("svg"):
        pieces = svg_pieces(job["files"]["svg"])
    else:
        pieces = text_pieces(job, (p.get("text") or "ZENVI").strip() or "ZENVI", split=animation == "assemble")

    logo = core.empty("Logo")
    lo, hi = bounds([o for o, _ in pieces])
    w, h = hi.x - lo.x, hi.y - lo.y
    thick = min(w, h) if len(pieces) > 1 or p.get("svg") else h
    extrude = (0.03 + 0.17 * float(p.get("depth", 0.4))) * thick
    bevel = min(extrude * 0.8, float(p.get("bevel", 0.5)) * 0.045 * thick)
    cache = {}
    for i, (obj, colour) in enumerate(pieces):
        data = obj.data
        data.extrude = extrude
        data.bevel_depth = bevel
        data.bevel_resolution = 4
        data.resolution_u = 12
        # The bevel grows the outline; shrink it back so the logo keeps its drawing.
        data.offset = -bevel
        data.materials.append(piece_material(style, p, colour, cache))
        obj.parent = logo
        # Stand it up facing the camera (-Y); later SVG paths sit a little in front.
        x, y = obj.location.x, obj.location.y
        obj.rotation_euler = (math.radians(90), 0, 0)
        obj.location = (x, -i * extrude * 0.35, y)
    bpy.context.view_layer.update()
    lo, hi = bounds([o for o, _ in pieces])
    width, height = max(hi.x - lo.x, hi.y - lo.y), hi.z - lo.z

    lights.studio(scale=max(1.0, width / 2), rim_color=p.get("rim") or "#CFE0FF", energy=0.35 if style in ("chrome", "iridescent") else 1.0)
    core.studio_world(job, strength=1.8 if style == "chrome" else 1.0, spin_degrees=150 if style in ("chrome", "iridescent", "glass") else 60)
    cam, aim = camera.camera(lens=55, location=(0, -10, 0), dof=0.5 if p.get("dof", True) and job["quality"] == "final" else None)
    dist = camera.compose(cam, width, height, float(p.get("size", 0.6)), max_height=0.62)
    if p.get("shadow", True):
        blob = shapes.shadow_blob("Shadow", width * 1.05, max(0.6, width * 0.35), strength=0.5, location=(0, 0.1, -0.5 * height - 0.18 * min(width, height)))
        motion.animate(blob, "scale", [(1, (0.001, max(0.6, width * 0.35), 1)), (1 + int(round(1.0 * fps)), (width * 1.05, max(0.6, width * 0.35), 1))], "out")

    enter = int(round(1.0 * fps))  # TASTE: big moves 1.0 s
    settle = int(round(0.25 * fps))
    if animation == "assemble" and len(pieces) > 1:
        landed = 1
        for i, (obj, _) in enumerate(pieces):
            f0 = 1 + int(round(i * STAGGER * fps))
            f1 = f0 + enter
            home = tuple(obj.location)
            angle = rng.uniform(0, 2 * math.pi)
            spread = Vector((math.cos(angle) * width * 0.9, rng.uniform(-1.5, 2.5) * height, math.sin(angle) * height * 1.2))
            motion.animate(obj, "location", [(f0, tuple(Vector(home) + spread)), (f1, home)], "out")
            spin = [rng.uniform(-1, 1) * math.radians(160) for _ in range(3)]
            motion.animate(obj, "rotation_euler", [(f0, (math.radians(90) + spin[0], spin[1], spin[2])), (f1, (math.radians(90), 0, 0))], "out")
            motion.animate(obj, "scale", [(f0, (0.2, 0.2, 0.2)), (f0 + int(enter * 0.5), (1, 1, 1))], "out")
            landed = f1
    else:
        # One body: spins in from behind and below, overshoots the turn a little (TASTE: 6 %) and settles.
        land = 1 + enter
        motion.animate(logo, "location", [(1, (0, 2.2 * height, -0.9 * height)), (land, (0, 0, 0))], "out")
        motion.animate(logo, "rotation_euler", [(1, (math.radians(-55), 0, math.radians(-340))), (land, (0, 0, math.radians(6))), (land + settle, (0, 0, 0))], ["out", "in-out"])
        motion.animate(logo, "scale", [(1, (0.001, 0.001, 0.001)), (1 + int(enter * 0.45), (1, 1, 1))], "out")
        landed = land + settle

    # The hold: the camera drifts in (TASTE: 3-6 %) and a little round, so the
    # extrusion shows while the logo stays square to the frame.
    end = frames
    hold_from = min(landed, end - 1)
    motion.animate(cam, "location", [(1, lights.orbit_point(dist * 1.03, -11, 7)), (end, lights.orbit_point(dist * 0.96, -4, 4))], "in-out")
    if style == "original":
        # Brand colours as drawn: the filmic view would desaturate them.
        bpy.context.scene.view_settings.view_transform = "Standard"
        bpy.context.scene.view_settings.look = "None"
    if p.get("exit"):
        out = max(hold_from + 1, end - int(0.4 * fps))
        motion.animate(logo, "scale", [(out, (1, 1, 1)), (end, (0.001, 0.001, 0.001))], "in")
