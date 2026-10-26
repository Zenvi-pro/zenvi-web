"""glass_hero: an abstract hero object (a morphing blob, a torus, linked
rings or a cluster of spheres) in glass, chrome or pearl, turning slowly in
coloured gradient light."""

import math
import random

import bpy

from zenvi3d import camera, core, lights, materials, motion, palette


def hero_material(p):
    kind = p.get("material", "glass")
    if kind == "chrome":
        return materials.chrome(roughness=0.04)
    if kind == "iridescent":
        return materials.iridescent()
    return materials.crystal(tint="#FFFFFF", roughness=0.02)


def _smooth(obj, level=2):
    sub = obj.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = level
    sub.render_levels = level
    for poly in obj.data.polygons:
        poly.use_smooth = True


def blob(mat, frames, fps):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=0.8)
    obj = bpy.context.active_object
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    tex = bpy.data.textures.new("Morph", "CLOUDS")
    tex.noise_scale = 0.9
    tex.noise_depth = 1
    disp = obj.modifiers.new("Morph", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.32
    disp.texture_coords = "OBJECT"
    # The noise drifts through the sphere: the surface flows.
    drift = core.empty("MorphDrift")
    disp.texture_coords_object = drift
    motion.animate(drift, "location", [(1, (0, 0, 0)), (frames, (0.0, 0.0, 0.25 * frames / fps))], "linear")
    return obj


def torus(mat, rings=1):
    out = []
    for i in range(rings):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.72, minor_radius=0.26 if rings == 1 else 0.17, major_segments=96, minor_segments=32)
        obj = bpy.context.active_object
        obj.data.materials.append(mat)
        for poly in obj.data.polygons:
            poly.use_smooth = True
        if rings > 1:
            obj.location = (0.38 * (1 if i else -1), 0, 0)
            obj.rotation_euler = (math.radians(90) if i else 0, 0, 0)
        out.append(obj)
    return out


def spheres(mat, p, rng):
    accent = palette.colors(p, 3)
    mats = [mat, materials.plastic(accent[0], roughness=0.2), materials.chrome(), materials.matte(accent[1], roughness=0.5)]
    out = []
    for i, (r, pos) in enumerate([(0.62, (0, 0, 0)), (0.28, (0.82, -0.35, 0.45)), (0.2, (-0.78, -0.2, -0.5)), (0.14, (-0.55, -0.5, 0.7)), (0.1, (0.6, -0.4, -0.65))]):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=64, ring_count=32, location=pos)
        obj = bpy.context.active_object
        obj.data.materials.append(mats[i % len(mats)])
        for poly in obj.data.polygons:
            poly.use_smooth = True
        out.append(obj)
    return out


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    rng = random.Random(int(p.get("seed", 5)))
    colors = palette.colors({"colors": p.get("colors"), "accent": p.get("accent") or "#7B5CFF"}, 2)
    if not p.get("colors"):
        colors = [p.get("accent") or "#7B5CFF", "#00C2FF"]
    lights.gradient(colors, scale=1.0, energy=1.0, back=0.25 if p.get("material", "glass") == "glass" else 1.0)
    core.studio_world(job, strength=1.2 if p.get("material", "glass") == "glass" else 0.6, spin_degrees=90, colors=colors)
    root = core.empty("Hero")
    mat = hero_material(p)
    shape = p.get("shape", "blob")
    if shape == "torus":
        parts = torus(mat)
    elif shape == "rings":
        parts = torus(mat, rings=2)
    elif shape == "spheres":
        parts = spheres(mat, p, rng)
    else:
        parts = [blob(mat, frames, fps)]
    for obj in parts:
        obj.parent = root
    base = (math.radians(58), math.radians(-14), 0.0) if shape in ("torus", "rings") else (0.0, 0.0, 0.0)
    root.rotation_euler = base
    bpy.context.view_layer.update()
    cam, aim = camera.camera(lens=60, location=(0, -6, 0.4))
    # Measured as posed; 0.9 of the safe height leaves room for the 6 % push.
    w, h = camera.extent(parts)
    dist = camera.compose(cam, w, h, float(p.get("size", 0.66)), max_height=0.9)
    cam.location = (0, -dist, dist * 0.06)
    # Entrance (TASTE out, 0.8 s) then a steady turn (loops may be linear).
    enter = int(round(0.8 * fps))
    motion.animate(root, "scale", [(1, (0.82, 0.82, 0.82)), (1 + enter, (1, 1, 1))], "out")
    turn = math.radians(float(p.get("turn_degrees", 120)))
    motion.animate(root, "rotation_euler", [(1, (base[0], base[1], -turn / 2)), (frames, (base[0] + 0.25, base[1], turn / 2))], "linear")
    motion.animate(cam, "location", [(1, tuple(cam.location)), (frames, (cam.location.x, cam.location.y * 0.94, cam.location.z))], "in-out")
