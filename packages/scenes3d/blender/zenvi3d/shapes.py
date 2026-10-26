"""Procedural meshes: rounded boxes (device bodies, cubes), rounded panels
with 0..1 UVs (screens, cards), extruded text."""

import math

import bmesh
import bpy

from .core import link


def _mesh_object(name, bm, material=None):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    if material is not None:
        mesh.materials.append(material)
    link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def rounded_box(name, size, corner=0.1, edge=0.02, segments=8, material=None):
    """A box `size` (x, y, z) whose four Z edges round by `corner` and every
    other edge by `edge`: a phone or tablet body, a soft cube."""
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    corner = min(corner, min(sx, sy) / 2 - 1e-4)
    if corner > 0:
        vertical = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
        bmesh.ops.bevel(bm, geom=vertical, offset=corner, segments=segments, affect="EDGES", profile=0.5)
    if edge > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(edge, sz / 2 - 1e-4), segments=3, affect="EDGES", profile=0.5)
    obj = _mesh_object(name, bm, material)
    # Smooth the curved bevels, keep the flat faces flat.
    obj.data.set_sharp_from_angle(angle=math.radians(30))
    return obj


def rounded_panel(name, width, height, radius, segments=10, material=None, thickness=0.0):
    """A flat rounded rectangle in the XY plane, facing +Z, UVs 0..1 over
    its bounds (media maps edge to edge). `thickness` > 0 gives it a back
    and sides (a card), the UV face stays the front."""
    radius = min(radius, min(width, height) / 2 - 1e-4)
    pts = []
    corners = [(width / 2 - radius, height / 2 - radius, 0), (-width / 2 + radius, height / 2 - radius, 90),
               (-width / 2 + radius, -height / 2 + radius, 180), (width / 2 - radius, -height / 2 + radius, 270)]
    for cx, cy, start in corners:
        for i in range(segments + 1):
            a = math.radians(start + 90 * i / segments)
            pts.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    face = bm.faces.new(verts)
    uv = bm.loops.layers.uv.new("UVMap")
    for loop in face.loops:
        loop[uv].uv = (loop.vert.co.x / width + 0.5, loop.vert.co.y / height + 0.5)
    if thickness > 0:
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        moved = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=moved, vec=(0, 0, -thickness))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Triangulate the n-gon so the media face shades cleanly.
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    obj = _mesh_object(name, bm, material)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def text(body, font_path=None, size=1.0, extrude=0.2, bevel=0.03, material=None, align="CENTER", name="Text"):
    """An extruded, bevelled text object centred on its ink (curve, not mesh)."""
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    if font_path:
        try:
            curve.font = bpy.data.fonts.load(font_path, check_existing=True)
        except RuntimeError as error:
            print("zenvi3d: font fallback:", error)
    curve.size = size
    curve.extrude = extrude
    curve.bevel_depth = bevel
    curve.bevel_resolution = 4
    curve.resolution_u = 6
    curve.align_x = align
    curve.align_y = "CENTER"
    obj = bpy.data.objects.new(name, curve)
    if material is not None:
        curve.materials.append(material)
    link(obj)
    return obj


def ink_bounds(obj):
    """(min_x, max_x, min_y, max_y) of an object's evaluated geometry, local space."""
    bpy.context.view_layer.update()
    xs = [c[0] for c in obj.bound_box]
    ys = [c[1] for c in obj.bound_box]
    return min(xs), max(xs), min(ys), max(ys)


def letters(body, font_path, size, extrude, bevel, material, tracking=0.0):
    """One object per visible character, placed where the whole word would
    put it (kerning included): each prefix's right ink edge sets the
    position of its last letter. Returns [(char, object)], centred."""
    probe = text(body, font_path, size, extrude, bevel, None, align="LEFT", name="Probe")
    out = []
    for i, ch in enumerate(body):
        if ch.isspace():
            continue
        probe.data.body = body[: i + 1]
        right = ink_bounds(probe)[1]
        glyph = text(ch, font_path, size, extrude, bevel, material, align="LEFT", name=f"L{i}_{ch}")
        g0, g1, gy0, gy1 = ink_bounds(glyph)
        out.append((ch, glyph, right - g1 + tracking * size * i, (g0 + g1) / 2))
    probe.data.body = body
    x0, x1, y0, y1 = ink_bounds(probe)
    bpy.data.objects.remove(probe)
    x1 += tracking * size * (len(body) - 1)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    placed = []
    for ch, glyph, dx, mid in out:
        # Pivot at the glyph's centre so it tumbles about itself.
        glyph.data.offset_x = -mid
        glyph.data.offset_y = -cy
        glyph.location = (dx + mid - cx, 0, 0)
        placed.append((ch, glyph))
    return placed, (x1 - x0, y1 - y0)


def shadow_blob(name, width, depth, strength=0.55, location=(0, 0, 0)):
    """A soft contact shadow: a horizontal plane whose darkness fades out
    radially. Works over a transparent background too (it is alpha)."""
    mat = bpy.data.materials.new(name + "Mat")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    grad = tree.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "SPHERICAL"
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Location"].default_value = (0.0, 0.0, 0.0)
    mapping.inputs["Scale"].default_value = (2.0, 2.0, 1.0)
    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    curve = tree.nodes.new("ShaderNodeMath")
    curve.operation = "POWER"
    curve.inputs[1].default_value = 2.2
    tree.links.new(grad.outputs["Fac"], curve.inputs[0])
    amount = tree.nodes.new("ShaderNodeMath")
    amount.operation = "MULTIPLY"
    amount.inputs[1].default_value = strength
    tree.links.new(curve.outputs[0], amount.inputs[0])
    dark = tree.nodes.new("ShaderNodeEmission")
    dark.inputs["Color"].default_value = (0, 0, 0, 1)
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(amount.outputs[0], mix.inputs["Fac"])
    tree.links.new(clear.outputs[0], mix.inputs[1])
    tree.links.new(dark.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    obj = _mesh_object(name, bm, mat)
    obj.scale = (width, depth, 1)
    obj.location = location
    obj.visible_shadow = False
    return obj
