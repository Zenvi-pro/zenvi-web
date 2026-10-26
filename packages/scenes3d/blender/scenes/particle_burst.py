"""particle_burst: confetti, sparks or glass shards bursting from a point
in the frame, falling under gravity with drag, tumbling, fading out by
shrinking. Ballistic motion is baked to keys (deterministic by seed)."""

import math
import random

import bmesh
import bpy
from mathutils import Euler, Vector

from zenvi3d import camera, core, lights, materials, motion, palette

GRAVITY = 3.2  # frame-heights per s^2 at the burst's depth, scaled below


def piece_mesh(kind, size):
    bm = bmesh.new()
    if kind == "confetti":
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
        for v in bm.verts:
            v.co.y *= 0.55
    elif kind == "sparks":
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=size * 0.22)
        for v in bm.verts:
            v.co.x *= 6.0  # a streak along local X, aimed along the velocity
    else:  # shards: a thin irregular triangle
        a = bm.verts.new((0, size * 0.9, 0))
        b = bm.verts.new((-size * 0.45, -size * 0.4, 0))
        c = bm.verts.new((size * 0.55, -size * 0.3, 0))
        face = bm.faces.new((a, b, c))
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        bmesh.ops.translate(bm, verts=[g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)], vec=(0, 0, size * 0.06))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(kind)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    kind = p.get("kind", "confetti")
    rng = random.Random(int(p.get("seed", 11)))
    count = int(p.get("count", 140 if kind != "sparks" else 180))
    lights.studio(scale=1.5)
    core.studio_world(job, strength=1.0, spin_degrees=30)
    cam, aim = camera.camera(lens=40, location=(0, -8, 0))
    hx, hy = camera.visible_half(cam, 8.0)
    ox = (float(p.get("origin_x", 0.5)) - 0.5) * 2 * hx
    oz = (0.5 - float(p.get("origin_y", 0.5))) * 2 * hy
    origin = Vector((ox, 0, oz))
    scale = min(hx, hy)  # the shorter half-frame: the burst reads the same in 9:16 and 16:9
    if kind == "sparks":
        core.glow(threshold=0.8, size=7, strength=0.9)
        tones = p.get("colors") or ["#FFB13D", "#FF6A1F", "#FFE2A8"]
        mats = [materials.emission(c, strength=3.5, name=f"Spark{i}") for i, c in enumerate(tones)]
        size, speed, drag, gravity = 0.09 * scale, 3.6 * scale, 1.6, 0.9 * scale
    elif kind == "shards":
        mats = [materials.crystal(roughness=0.05), materials.chrome(roughness=0.08), materials.iridescent()]
        size, speed, drag, gravity = 0.22 * scale, 2.6 * scale, 1.1, 1.3 * scale
    else:
        mats = [materials.plastic(c, roughness=0.45, coat=0.2, name=f"Paper{i}") for i, c in enumerate(palette.colors(p, 6))]
        for m in mats:
            m.use_backface_culling = False
        size, speed, drag, gravity = 0.14 * scale, 2.8 * scale, 2.2, 1.0 * scale
    mesh = piece_mesh(kind, size)
    start = 1
    for i in range(count):
        obj = bpy.data.objects.new(f"P{i}", mesh.copy() if len(mats) > 1 else mesh)
        obj.data.materials.clear()
        obj.data.materials.append(mats[i % len(mats)])
        core.link(obj)
        # Directions biased upward and toward the camera plane; speeds vary 0.4-1x.
        # Uniform directions on a sphere, flattened in depth, a little upward;
        # speeds fill the disc (sqrt) so the burst is full, not a ring.
        z = rng.uniform(-1, 1)
        theta = rng.uniform(0, 2 * math.pi)
        r = math.sqrt(1 - z * z)
        d = Vector((r * math.cos(theta), r * math.sin(theta) * 0.5, z + 0.35)).normalized()
        v = d * speed * (0.15 + 0.85 * math.sqrt(rng.random()))
        spin = Vector((rng.uniform(-9, 9), rng.uniform(-9, 9), rng.uniform(-9, 9)))
        r0 = Euler((rng.uniform(0, 6.3), rng.uniform(0, 6.3), rng.uniform(0, 6.3)))
        life = rng.uniform(0.65, 1.0) * (frames - start) / fps
        k = drag

        def pos(f, v=v):
            t = max(0.0, (f - start) / fps)
            decay = (1 - math.exp(-k * t)) / k  # velocity with linear drag
            fall = gravity * (t / k - decay / k)
            return tuple(origin + v * decay + Vector((0, 0, -fall)))

        def rot(f, spin=spin, r0=r0):
            t = max(0.0, (f - start) / fps)
            if kind == "sparks":
                # Streaks point along their (drag-slowed) velocity.
                vel = v * math.exp(-k * t) + Vector((0, 0, -gravity * (1 - math.exp(-k * t)) / k))
                return tuple(vel.to_track_quat("X", "Z").to_euler())
            return (r0.x + spin.x * t, r0.y + spin.y * t, r0.z + spin.z * t)

        def scl(f, life=life):
            t = max(0.0, (f - start) / fps)
            pop = motion.bezier("snap", min(1.0, t / 0.12))
            fade = 1 - motion.bezier("in", min(1.0, max(0.0, (t - life * 0.7) / (life * 0.3))))
            s = max(0.001, pop * fade)
            if kind == "sparks":
                return (s * (0.6 + 1.6 * math.exp(-k * t)), s, s)
            return (s, s, s)

        motion.bake(obj, "location", (start, frames), pos, step=1)
        motion.bake(obj, "rotation_euler", (start, frames), rot, step=2)
        motion.bake(obj, "scale", (start, frames), scl, step=1)
