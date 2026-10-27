"""model_showcase: the user's 3D model (.glb/.gltf/.obj/.fbx/.stl/.ply),
centred, standing on the floor and framed, on a turntable or with the
camera orbiting or pushing in; studio, low-key or table-top staging, in its
own materials, clay or chrome, or as an x-ray / wireframe."""

import math
import os

import bpy
from mathutils import Matrix, Vector

from zenvi3d import camera, core, lights, materials, motion, shapes

IMPORTERS = {
    ".glb": lambda f: bpy.ops.import_scene.gltf(filepath=f),
    ".gltf": lambda f: bpy.ops.import_scene.gltf(filepath=f),
    ".obj": lambda f: bpy.ops.wm.obj_import(filepath=f),
    ".fbx": lambda f: bpy.ops.import_scene.fbx(filepath=f),
    ".stl": lambda f: bpy.ops.wm.stl_import(filepath=f),
    ".ply": lambda f: bpy.ops.wm.ply_import(filepath=f),
}
SIZE = 2.0  # the model's largest side, before framing


def import_model(path):
    """The imported objects, or a ValueError that says what Blender could not do."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in IMPORTERS:
        raise ValueError("Blender cannot import %s files (give .glb, .gltf, .obj, .fbx, .stl or .ply)" % ext)
    before = set(bpy.data.objects)
    try:
        IMPORTERS[ext](path)
    except Exception as error:
        reason = (str(error).strip().splitlines() or [type(error).__name__])[-1].replace("Error: ", "").replace("'%s'" % path, "").strip()
        raise ValueError("Blender could not import %s: %s" % (os.path.basename(path), reason)) from error
    added = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in added if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o)
    added = [o for o in bpy.data.objects if o not in before]
    if not any(o.type == "MESH" and len(o.data.polygons) > 0 for o in added):
        raise ValueError("Blender imported nothing it can draw from %s (no meshes with faces)" % os.path.basename(path))
    return added


def mesh_points(objects):
    """Every evaluated vertex of the meshes, world space."""
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    for o in objects:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(graph)
        mesh = ev.to_mesh()
        mw = ev.matrix_world
        points += [mw @ v.co for v in mesh.vertices]
        ev.to_mesh_clear()
    return points


def normalise(objects):
    """Parent the model to a pivot that scales its largest side to SIZE,
    centres it across and stands it on z = 0. Returns (pivot, radius about
    the vertical axis, width, height)."""
    pivot = core.empty("Model")
    for o in objects:
        if o.parent is None or o.parent not in objects:
            o.parent = pivot
            o.matrix_parent_inverse = Matrix.Identity(4)
    pts = mesh_points(objects)
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    side = max(hi - lo)
    if side <= 0:
        raise ValueError("the model has no size")
    s = SIZE / side
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    inner = core.empty("ModelOffset")
    inner.parent = pivot
    for o in objects:
        if o.parent == pivot:
            o.parent = inner
    inner.scale = (s, s, s)
    inner.location = -centre * s
    radius = max(math.hypot(p.x - centre.x, p.y - centre.y) for p in pts) * s
    return pivot, radius, max(hi.x - lo.x, hi.y - lo.y) * s, (hi.z - lo.z) * s


def xray(color, name="XRay"):
    """See-through glow brightest where the surface turns away (fresnel),
    with a faint wire: the x-ray / hologram look."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    weight = tree.nodes.new("ShaderNodeLayerWeight")
    weight.inputs["Blend"].default_value = 0.55
    edge = core.map_range(tree, weight.outputs["Facing"], 0.15, 1.0)
    wire = tree.nodes.new("ShaderNodeWireframe")
    wire.use_pixel_size = True
    wire.inputs["Size"].default_value = 1.0
    glow = core.math_node(tree, "ADD", core.math_node(tree, "MULTIPLY", edge, 0.9), core.math_node(tree, "MULTIPLY", wire.outputs[0], 0.25))
    glow = core.math_node(tree, "ADD", glow, 0.04)
    em = tree.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgb_of(color)
    tree.links.new(core.math_node(tree, "MULTIPLY", glow, 1.1), em.inputs["Strength"])
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    add = tree.nodes.new("ShaderNodeAddShader")
    tree.links.new(clear.outputs[0], add.inputs[0])
    tree.links.new(em.outputs[0], add.inputs[1])
    tree.links.new(add.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    mat.use_transparency_overlap = True
    return mat


def wireframe(color, fill, name="Wire"):
    """Glowing edges over a dark, faintly lit body (a technical drawing in 3D)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    body = tree.nodes.new("ShaderNodeBsdfPrincipled")
    body.inputs["Base Color"].default_value = rgb_of(fill)
    body.inputs["Roughness"].default_value = 0.5
    wire = tree.nodes.new("ShaderNodeWireframe")
    wire.use_pixel_size = True
    wire.inputs["Size"].default_value = 1.4
    em = tree.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgb_of(color)
    em.inputs["Strength"].default_value = 3.0
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(wire.outputs[0], mix.inputs["Fac"])
    tree.links.new(body.outputs[0], mix.inputs[1])
    tree.links.new(em.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def rgb_of(color):
    return core.rgb(color, 1.0)


def table_material(dark):
    """Oiled oak (light) or walnut (dark) by rings of a wave texture, under a
    soft coat; it fades out with distance so it melts into the backdrop."""
    mat = bpy.data.materials.new("Table")
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (14.0, 1.6, 1.0)
    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    wave = tree.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 3.0
    wave.inputs["Distortion"].default_value = 1.6
    wave.inputs["Detail"].default_value = 4.0
    wave.inputs["Detail Roughness"].default_value = 0.6
    tree.links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    a, b = ("#3A2416", "#5A3A24") if dark else ("#C9A27A", "#E2C29C")
    els[0].color, els[1].color = core.rgb(a, 1.0), core.rgb(b, 1.0)
    tree.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.5
    bsdf.inputs["Coat Weight"].default_value = 0.12
    bsdf.inputs["Coat Roughness"].default_value = 0.2
    grad = tree.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "SPHERICAL"
    tree.links.new(coord.outputs["Object"], grad.inputs["Vector"])
    tree.links.new(core.map_range(tree, grad.outputs["Fac"], 0.5, 0.85), bsdf.inputs["Alpha"])
    mat.surface_render_method = "BLENDED"
    return mat


def override(objects, mat):
    for o in objects:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(mat)


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    objects = import_model(job["files"]["model"])
    pivot, radius, width, height = normalise(objects)
    dark = core.is_dark(job)
    look = p.get("look", "solid")
    stage = p.get("stage", "studio")
    accent = p.get("accent") or ("#7FD4FF" if look != "solid" else core.PALETTE["accent"])
    finish = p.get("material", "original")
    if look == "xray":
        override(objects, xray(accent))
    elif look == "wireframe":
        override(objects, wireframe(accent, "#0E1015" if dark else "#E9EBEF"))
    elif finish == "clay":
        override(objects, materials.clay(p.get("color") or "#E9E4DC"))
    elif finish == "chrome":
        override(objects, materials.chrome(roughness=0.08))
    elif finish == "matte":
        override(objects, materials.matte(p.get("color") or "#D8D9DD", roughness=0.6))
    else:
        for o in objects:
            if o.type == "MESH" and len(o.data.materials) == 0:
                o.data.materials.append(materials.clay("#E3E1DC"))
    if look != "solid":
        core.glow(threshold=0.9, size=5, strength=0.3)

    # Lights: three-point (studio), rims only (dark), warm window light (table).
    key_energy = {"studio": 1.0, "dark": 0.35, "table": 0.8}[stage]
    lights.studio(scale=max(1.0, radius), rim_color=p.get("rim") or "#D6E4FF", energy=key_energy)
    if stage == "dark":
        lights.area("RimL", (-2.6 * radius, 2.4 * radius, 1.6 * height), target=(0, 0, height / 2), size=0.6, size_y=4.0 * height, energy=2500 * radius * radius, color="#BFD4FF")
        lights.area("RimR", (2.6 * radius, 2.2 * radius, 1.2 * height), target=(0, 0, height / 2), size=0.6, size_y=4.0 * height, energy=1800 * radius * radius, color="#FFE2C8")
    core.studio_world(job, strength={"studio": 0.9, "dark": 0.5, "table": 0.7}[stage], spin_degrees=40)
    sun = lights.sun("Sun", 58 if stage != "table" else 38, -35 if stage != "table" else -60, strength=3.0, angle_deg=14 if stage != "table" else 5,
                     color="#FFFFFF" if stage != "table" else "#FFE6C7")
    floor_lights = [o for o in bpy.data.objects if o.type == "LIGHT" and o is not sun]
    if p.get("shadow", True) and look == "solid":
        if stage == "table":
            # A unit panel scaled up: its object coordinates span -0.5..0.5 for the fade-out.
            table = shapes.rounded_panel("TableTop", 1.0, 1.0, 0.01, material=table_material(dark))
            table.scale = (10 * max(radius, height), 10 * max(radius, height), 1)
            table.location = (0, 0, -0.0005)
            # Contact shadow: the sun's shadow falls behind the model; this grounds it where it touches.
            shapes.shadow_blob("Contact", 2.2 * radius, 2.2 * radius, strength=0.5, location=(0, 0, 0.001))
        else:
            catcher = shapes.shadow_catcher("Floor", 12 * max(radius, height), sun, strength=0.75 if not dark else 0.85)
            lights.exclude(floor_lights, [catcher])
            shapes.calibrate_catcher(catcher)

    move = p.get("move", "turntable")
    target = (0, 0, height * 0.5)
    fstop = (0.6 if move == "push" else 1.6) if p.get("dof", True) and job["quality"] == "final" else None
    cam, aim = camera.camera(lens=50, target=target, dof=fstop)
    span = 2 * radius if move == "turntable" else max(width, 2 * radius * 0.85)
    dist = camera.compose(cam, span, height, float(p.get("size", 0.7)), max_height=0.78)
    end = frames

    def at(az, el, r):
        return lights.orbit_point(r, az, el, target)

    elevation = float(p.get("elevation", 14))
    if move == "orbit":
        motion.animate(cam, "location", [(1, at(-40, elevation + 6, dist)), (end, at(30, elevation - 4, dist * 0.96))], "in-out")
    elif move == "push":
        motion.animate(cam, "location", [(1, at(-24, elevation + 4, dist * 1.45)), (end, at(-12, elevation, dist * 0.9))], "smooth")
    else:  # turntable
        motion.animate(cam, "location", [(1, at(-18, elevation, dist * 1.02)), (end, at(-18, elevation, dist * 0.97))], "in-out")
        turn = math.radians(float(p.get("turn_degrees", 120)))
        motion.animate(pivot, "rotation_euler", [(1, (0, 0, -turn / 2)), (end, (0, 0, turn / 2))], "linear" if p.get("steady", True) else "in-out")
    if p.get("land"):
        # Dropped onto the floor: falls fast, lands, settles (TASTE: enter fast, settle slowly).
        f1 = 1 + int(round(0.55 * fps))
        f2 = f1 + int(round(0.3 * fps))
        motion.animate(pivot, "location", [(1, (0, 0, height * 0.9)), (f1, (0, 0, 0)), (f1 + int(0.12 * fps), (0, 0, height * 0.03)), (f2, (0, 0, 0))], ["in", "out", "in-out"])
