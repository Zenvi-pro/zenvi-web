"""Demo models for model_showcase, built from Blender primitives (original,
nothing downloaded): a jet engine (glTF binary, metal materials) and a
smooth monkey head (OBJ, no materials).

    blender -b --factory-startup -P packages/scenes3d/scripts/make-models.py -- <out dir>
"""

import math
import os
import sys

import bmesh
import bpy


def metal(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = color + (1.0,)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = roughness
    return mat


def lathe(name, profile, segments, material):
    """A surface of revolution about Y from (radius, y) points."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, y, 0.0)) for r, y in profile]
    edges = [bm.edges.new((a, b)) for a, b in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 1, 0), angle=2 * math.pi, steps=segments, use_merge=True)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    mesh.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = True
    bpy.context.scene.collection.objects.link(obj)
    return obj


def engine(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    shell = metal("Nacelle", (0.80, 0.82, 0.86), 0.18)
    dark = metal("Core", (0.30, 0.31, 0.34), 0.35)
    bright = metal("Blades", (0.92, 0.93, 0.95), 0.08)
    # Nacelle: a thick lip in front, tapering to the nozzle (outer then inner wall).
    lathe("Nacelle", [(0.92, 1.25), (1.0, 1.1), (1.02, 0.6), (0.98, -0.4), (0.82, -1.1), (0.76, -1.15), (0.8, -0.5), (0.9, 0.6), (0.9, 1.15), (0.92, 1.25)], 96, shell)
    lathe("Spinner", [(0.0, 1.32), (0.12, 1.25), (0.26, 1.05), (0.3, 0.9), (0.3, 0.85)], 64, bright)
    lathe("CoreCase", [(0.42, 0.85), (0.5, 0.6), (0.52, -0.6), (0.38, -1.4), (0.0, -1.62)], 64, dark)
    for i in range(22):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= 0.05
            v.co.y *= 0.18
            v.co.z = v.co.z * 0.6 + 0.6  # radial span 0.3..0.9
            twist = (v.co.z - 0.3) * 0.9
            x, y = v.co.x, v.co.y
            v.co.x, v.co.y = x * math.cos(twist) - y * math.sin(twist), x * math.sin(twist) + y * math.cos(twist)
        mesh = bpy.data.meshes.new("Blade%d" % i)
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(bright)
        blade = bpy.data.objects.new("Blade%d" % i, mesh)
        blade.location = (0, 0.95, 0)
        blade.rotation_euler = (0, math.radians(i * 360 / 22), 0)
        bpy.context.scene.collection.objects.link(blade)
    for i in range(8):  # pylons and ribs on the casing
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.025, depth=1.1, location=(0, -0.2, 0))
        rib = bpy.context.object
        rib.rotation_euler = (math.radians(90), 0, 0)
        rib.location = (0.53 * math.cos(i * math.pi / 4), -0.1, 0.53 * math.sin(i * math.pi / 4))
        rib.data.materials.append(bright)
    # Engines are long along Y; lay it along X so the turntable shows its side.
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, "engine.glb"), export_format="GLB")


def monkey(out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_monkey_add()
    head = bpy.context.object
    mod = head.modifiers.new("Smooth", "SUBSURF")
    mod.levels = 2
    bpy.ops.object.shade_smooth()
    bpy.ops.wm.obj_export(filepath=os.path.join(out, "monkey.obj"), export_materials=False, apply_modifiers=True)


out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "."
os.makedirs(out, exist_ok=True)
engine(out)
monkey(out)
print("models in", out)
