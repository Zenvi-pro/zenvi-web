"""icon_cube: a cube of glossy tiles with pictures on its faces spins,
then bursts apart into its cubelets, which drift and tumble."""

import math
import random

import bmesh
import bpy
from mathutils import Vector

from zenvi3d import camera, core, lights, materials, motion, palette

AXES = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((0, 0, -1))]


def cubelet(name, size, mats, outward):
    """A rounded cube; its flat faces on the `outward` axes take the tile
    materials (UVs 0..1 per face), the rest is body (slot 0)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=size)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=size * 0.12, segments=4, affect="EDGES", profile=0.5)
    uv = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        n = face.normal
        k = max(range(6), key=lambda j: n.dot(AXES[j]))
        face.material_index = 0
        if n.dot(AXES[k]) > 0.999 and k in outward:
            face.material_index = 1 + outward.index(k)
        for loop in face.loops:
            c = loop.vert.co
            ax = abs(AXES[k].x) > 0.5 and (c.y, c.z) or abs(AXES[k].y) > 0.5 and (c.x, c.z) or (c.x, c.y)
            loop[uv].uv = (ax[0] / size + 0.5, ax[1] / size + 0.5)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.set_sharp_from_angle(angle=math.radians(30))
    obj = bpy.data.objects.new(name, mesh)
    core.link(obj)
    return obj


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    n = 3 if int(p.get("grid", 2)) >= 3 else 2
    items = [job["media"][k] for k in sorted((k for k in job["media"] if k.startswith("face")), key=lambda k: int(k[4:]))]
    rng = random.Random(int(p.get("seed", 3)))
    colors = palette.colors(p, 12)
    size = 1.0 / n * 0.96
    step = 1.0 / n
    lights.studio(scale=1.2)
    core.studio_world(job, strength=1.0, spin_degrees=40)
    root = core.empty("Cube")
    body = materials.plastic("#F3F3F1", roughness=0.3, name="Body")
    tiles = {}
    k = 0
    cubes = []
    for ix in range(n):
        for iy in range(n):
            for iz in range(n):
                c = [(i - (n - 1) / 2) for i in (ix, iy, iz)]
                outward = [j for j, ax in enumerate(AXES) if abs(Vector(c).dot(ax) - (n - 1) / 2) < 1e-6]
                if not outward:
                    continue
                tint = colors[len(cubes) % len(colors)]
                mats = [materials.plastic(tint, roughness=0.3, name=f"Body{len(cubes)}") if not items else body]
                for _ in outward:
                    key = k % max(1, len(items) or 12)
                    if key not in tiles:
                        tiles[key] = materials.tile(items[key] if items else None, "#F7F7F5" if not items else colors[k % len(colors)], name=f"Tile{key}")
                    mats.append(tiles[key])
                    k += 1
                obj = cubelet(f"C{ix}{iy}{iz}", size, mats, outward)
                obj.parent = root
                obj.location = Vector(c) * step
                cubes.append((obj, Vector(c)))

    aspect = camera.frame_aspect()
    cam, aim = camera.camera(lens=50, location=lights.orbit_point(6, -28, 18))
    dist = camera.fit_distance(cam, 1.0 * (2.2 if aspect < 1 else 1.9), 1.0 * 2.0)
    cam.location = lights.orbit_point(dist, -28, 18)
    explode = bool(p.get("explode", True))
    spin_end = int(frames * (0.45 if explode else 1.0))
    motion.animate(root, "rotation_euler", [(1, (math.radians(-25), math.radians(10), math.radians(-120))), (spin_end, (math.radians(8), 0, math.radians(45)))], "in-out" if explode else "smooth")
    motion.animate(root, "scale", [(1, (0.6, 0.6, 0.6)), (1 + int(0.6 * fps), (1, 1, 1))], "out")
    if not explode:
        return
    burst = spin_end
    land = min(frames, burst + int(1.0 * fps))
    for obj, c in cubes:
        direction = (c.normalized() if c.length > 1e-6 else Vector((0, 0, 1))) + Vector((rng.uniform(-0.3, 0.3) for _ in range(3)))
        far = obj.location + direction.normalized() * rng.uniform(0.5, 0.95)
        drift = far + direction.normalized() * 0.15
        rot = Vector(math.radians(rng.uniform(-160, 160)) for _ in range(3))
        motion.animate(obj, "location", [(burst, tuple(obj.location)), (land, tuple(far)), (frames, tuple(drift))], ["out", "linear"])
        motion.animate(obj, "rotation_euler", [(burst, (0, 0, 0)), (land, tuple(rot)), (frames, tuple(rot * 1.15))], ["out", "linear"])
    # Pull back so the burst stays in frame.
    cl = Vector(cam.location)
    motion.animate(cam, "location", [(burst, tuple(cl)), (land, tuple(cl * 1.7))], "out")
