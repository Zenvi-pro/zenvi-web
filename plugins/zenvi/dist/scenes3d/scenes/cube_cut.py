"""cube_cut: a transition. Clip A on the front of a box, clip B on the
side it turns to; the box rotates 90 degrees while the camera backs off and
returns. The first frame is exactly A and the last exactly B (Standard view,
emission 1), so it drops onto a cut seamlessly."""

import math

import bpy

from zenvi3d import camera, core, materials, motion, shapes

# The face B sits on and the rotation that brings it to the front (-Y).
TURNS = {
    "left": ("+X", "rotation_euler", 2, -90),
    "right": ("-X", "rotation_euler", 2, 90),
    "up": ("-Z", "rotation_euler", 0, -90),
    "down": ("+Z", "rotation_euler", 0, 90),
}


def face(name, w, h, item, location, rotation):
    mat = materials.flat_media(item, w / h, name=name) if item else materials.emission("#222226", 1.0, name=name)
    obj = shapes.rounded_panel(name, w, h, 0.0001, segments=1, material=mat)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def build(job):
    p = job["params"]
    frames = job["frames"]
    scene = bpy.context.scene
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    aspect = camera.frame_aspect()
    w, h = aspect, 1.0
    direction = p.get("direction", "left")
    side, path, axis, degrees = TURNS.get(direction, TURNS["left"])
    depth = w if side in ("+X", "-X") else h
    box = core.empty("Box")
    r90 = math.radians(90)
    a = face("A", w, h, job["media"].get("from"), (0, -depth / 2, 0), (r90, 0, 0))
    a.parent = box
    if side == "+X":
        b = face("B", depth, h, job["media"].get("to"), (w / 2, 0, 0), (r90, 0, r90))
    elif side == "-X":
        b = face("B", depth, h, job["media"].get("to"), (-w / 2, 0, 0), (r90, 0, -r90))
    elif side == "-Z":
        b = face("B", w, depth, job["media"].get("to"), (0, 0, -h / 2), (math.pi, 0, 0))
    else:
        b = face("B", w, depth, job["media"].get("to"), (0, 0, h / 2), (0, 0, 0))
    b.parent = box
    core.studio_world(job, strength=0.0)
    cam, aim = camera.camera(lens=35, location=(0, -5, 0))
    d = camera.fit_distance(cam, w, h)
    near = -depth / 2 - d
    cam.location = (0, near, 0)
    aim.location = (0, 0, 0)
    rot = [0.0, 0.0, 0.0]
    end = [0.0, 0.0, 0.0]
    end[axis] = math.radians(degrees)
    motion.animate(box, path, [(1, tuple(rot)), (frames, tuple(end))], "in-out")
    # Back off to show the edge mid-turn, land exactly on the face again.
    mid = 1 + (frames - 1) // 2
    motion.animate(cam, "location", [(1, (0, near, 0)), (mid, (0, near * 1.45, 0)), (frames, (0, near, 0))], ["in-out", "in-out"])
