"""Generic products built from primitives, for showcases without a model
file: no real product's design, nothing downloaded. Each returns the mesh
objects, standing on z = 0 with its face toward -Y."""

import math

import bmesh
import bpy

from . import materials, shapes
from .core import link, map_range, math_node, rgb


def _stand(objects):
    """Panels and bodies are built facing +Z; stand them up facing -Y."""
    root = bpy.data.objects.new("Product", None)
    link(root)
    for o in objects:
        o.parent = root
    root.rotation_euler = (math.radians(90), 0, 0)
    return root


def player(color="#E9E7E2", accent="#FF5A36"):
    """A minimal portable music player: a rounded slab, a glass screen
    showing a soft cover-art gradient, and a click wheel."""
    w, h, t = 0.62, 1.04, 0.1
    body = materials.plastic(color, roughness=0.32, coat=0.6, name="Shell")
    shell = shapes.rounded_box("Shell", (w, h, t), corner=0.09, edge=0.022, material=body)
    glass = shapes.rounded_panel("Glass", w - 0.08, 0.5, 0.04, material=materials.plastic("#050506", roughness=0.04, coat=1.0, name="Glass"))
    glass.location = (0, h / 2 - 0.04 - 0.25, t / 2 + 0.0008)
    screen = shapes.rounded_panel("Screen", w - 0.12, 0.46, 0.03, material=materials.gradient([accent, "#7B5CFF"], axis="Y", name="Art"))
    screen.location = (0, glass.location.y, t / 2 + 0.0016)
    wheel = shapes.rounded_panel("Wheel", 0.4, 0.4, 0.2, segments=24, material=materials.plastic("#BFC2C9", roughness=0.4, coat=0.3, name="Wheel"))
    wheel.location = (0, -h / 2 + 0.06 + 0.2, t / 2 + 0.001)
    button = shapes.rounded_panel("Button", 0.13, 0.13, 0.065, segments=16, material=materials.plastic(color, roughness=0.3, name="Button"))
    button.location = (wheel.location.x, wheel.location.y, t / 2 + 0.002)
    parts = [shell, glass, screen, wheel, button]
    root = _stand(parts)
    root.location = (0, 0, h / 2)
    return parts + [root]


def fabric(color, name="Fabric"):
    """Knit speaker cloth: matte, with a fine woven bump."""
    mat = materials.matte(color, roughness=0.9, name=name)
    tree = mat.node_tree
    b = tree.nodes["Principled BSDF"]
    coord = tree.nodes.new("ShaderNodeTexCoord")
    wave = tree.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "RINGS"
    wave.inputs["Scale"].default_value = 140.0
    tree.links.new(coord.outputs["Object"], wave.inputs["Vector"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    tree.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Sheen Weight"].default_value = 0.5
    return mat


def speaker(color="#3A3D44", accent="#7FD4FF"):
    """A smart speaker: a fabric-wrapped cylinder with soft shoulders and a
    glossy top whose light ring glows."""
    r, h = 0.42, 0.9
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=96, radius1=r, radius2=r, depth=h)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if not e.is_boundary and abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6], offset=0.09, segments=8, affect="EDGES", profile=0.5)
    mesh = bpy.data.meshes.new("Speaker")
    bm.to_mesh(mesh)
    bm.free()
    body = bpy.data.objects.new("Speaker", mesh)
    link(body)
    mesh.materials.append(fabric(color))
    mesh.materials.append(materials.plastic("#0C0D10", roughness=0.08, coat=1.0, name="Top"))
    for poly in mesh.polygons:
        poly.use_smooth = True
        if poly.normal.z > 0.98 and poly.center.z > h / 2 - 1e-3:
            poly.material_index = 1
    body.location = (0, 0, h / 2)
    ring = bpy.data.materials.new("Ring")
    ring.use_nodes = True
    tree = ring.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["Object"], sep.inputs["Vector"])
    radius = tree.nodes.new("ShaderNodeVectorMath")
    radius.operation = "LENGTH"
    tree.links.new(coord.outputs["Object"], radius.inputs[0])
    band = math_node(tree, "MULTIPLY", map_range(tree, radius.outputs["Value"], 0.2, 0.235), math_node(tree, "SUBTRACT", 1.0, map_range(tree, radius.outputs["Value"], 0.245, 0.28)))
    em = tree.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgb(accent, 1.0)
    tree.links.new(math_node(tree, "MULTIPLY", band, 2.5), em.inputs["Strength"])
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(band, mix.inputs["Fac"])
    tree.links.new(clear.outputs[0], mix.inputs[1])
    tree.links.new(em.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    ring.surface_render_method = "BLENDED"
    glow = shapes.rounded_panel("RingGlow", 0.6, 0.6, 0.299, segments=24, material=ring)
    glow.location = (0, 0, h + 0.002)
    return [body, glow]


PRODUCTS = {"player": player, "speaker": speaker}
