"""Cameras that look at a target, with depth of field and eased moves."""

import math

import bpy
from mathutils import Vector

from .core import empty, link


def camera(name="Camera", lens=50.0, location=(0, -6, 0), target=(0, 0, 0), dof=None, sensor=36.0):
    """A camera tracking an empty at `target`. `dof`: f-stop, focusing on
    the target (None: everything sharp)."""
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.sensor_width = sensor
    data.sensor_fit = "AUTO"
    data.clip_start = 0.05
    data.clip_end = 200
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    link(obj)
    aim = empty(name + "Target", target)
    track = obj.constraints.new("TRACK_TO")
    track.target = aim
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    if dof:
        data.dof.use_dof = True
        data.dof.focus_object = aim
        data.dof.aperture_fstop = dof
        data.dof.aperture_blades = 0
    bpy.context.scene.camera = obj
    return obj, aim


def fit_distance(cam, width, height, margin=1.0):
    """Distance at which a width x height rectangle facing the camera fills
    the frame (times `margin`), for the scene's aspect."""
    scene = bpy.context.scene
    aspect = scene.render.resolution_x / scene.render.resolution_y
    data = cam.data
    sensor = data.sensor_width
    # AUTO fit: the sensor width spans the longer side of the frame.
    fov_long = 2 * math.atan(sensor / (2 * data.lens))
    if aspect >= 1:
        fov_x = fov_long
        fov_y = 2 * math.atan(math.tan(fov_long / 2) / aspect)
    else:
        fov_y = fov_long
        fov_x = 2 * math.atan(math.tan(fov_long / 2) * aspect)
    dx = (width / 2) / math.tan(fov_x / 2)
    dy = (height / 2) / math.tan(fov_y / 2)
    return max(dx, dy) * margin


def frame_aspect():
    r = bpy.context.scene.render
    return r.resolution_x / r.resolution_y


def toward(location, target, distance):
    v = Vector(location) - Vector(target)
    return tuple(Vector(target) + v.normalized() * distance)


def visible_half(cam, distance):
    """Half width and half height of what the camera sees at `distance`."""
    aspect = frame_aspect()
    long = cam.data.sensor_width / (2 * cam.data.lens) * distance
    return (long, long / aspect) if aspect >= 1 else (long * aspect, long)


def distance_for_width(cam, width, fraction):
    """Distance at which `width` spans `fraction` of the frame width."""
    aspect = frame_aspect()
    per_unit = cam.data.sensor_width / (2 * cam.data.lens)  # half-extent of the long side per unit of distance
    half_width = per_unit if aspect >= 1 else per_unit * aspect
    return (width / (2 * fraction)) / half_width


def safe_area():
    """The frame's safe area, (left, right, top, bottom) as fractions of the
    frame. Wide and square: title-safe 90 %. Vertical: clear of the Reels /
    TikTok side margins, top bar and bottom captions (the same 12 % / 20 %
    the engine's captions keep, packages/engine/src/tools/caption-style.ts)."""
    if frame_aspect() < 1:
        return (0.06, 0.94, 0.12, 0.80)
    return (0.05, 0.95, 0.05, 0.95)


def optical_centre():
    """Where a lone subject sits: centred across, a little above the middle
    of the safe area (TASTE: 45 % down it)."""
    left, right, top, bottom = safe_area()
    return ((left + right) / 2, top + 0.45 * (bottom - top))


def compose(cam, width, height, size, max_height=1.0):
    """Frame a width x height subject facing `cam` at its target: it spans
    `size` of the safe width, its height at most `max_height` of the room the
    safe area leaves around the optical centre, and the lens shift puts the
    target on the optical centre (shift keeps the perspective, so moves and
    depth of field are unchanged). Returns the camera's distance."""
    left, right, top, bottom = safe_area()
    cx, cy = optical_centre()
    room = 2 * min(cy - top, bottom - cy)
    hx, hy = visible_half(cam, 1.0)
    dist = max(width / (2 * hx * size * (right - left)), height / (2 * hy * max_height * room))
    r = bpy.context.scene.render
    longest = max(r.resolution_x, r.resolution_y)
    # Shift is in units of the longer side; a positive shift_y moves the view up, the subject down.
    cam.data.shift_x = -(cx - 0.5) * r.resolution_x / longest
    cam.data.shift_y = (cy - 0.5) * r.resolution_y / longest
    return dist


def extent(objects):
    """Width (the larger horizontal extent, so it holds while the subject
    turns about Z) and height of the objects' evaluated world bounds."""
    graph = bpy.context.evaluated_depsgraph_get()
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.evaluated_get(graph).bound_box]
    span = [max(p[i] for p in points) - min(p[i] for p in points) for i in range(3)]
    return max(span[0], span[1]), span[2]


def fit_points(cam, target, direction, points, size, max_height=1.0):
    """Distance from `target` along `direction` (toward the camera) at which
    `points`, as the camera sees them in perspective, span `size` of the
    safe width and at most `max_height` of the room the safe area leaves
    around the optical centre. For subjects that are not a flat face toward
    the camera (a stack seen from above, a fan): their near end looms larger
    than a bounding box says. Sets the lens shift like compose."""
    left, right_edge, top, bottom = safe_area()
    cx, cy = optical_centre()
    room = 2 * min(cy - top, bottom - cy)
    hx, hy = visible_half(cam, 1.0)
    fwd = -Vector(direction).normalized()
    side = fwd.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(fwd)
    target = Vector(target)

    def fits(d):
        eye = target - fwd * d
        xs, ys = [], []
        for p in points:
            v = Vector(p) - eye
            z = v.dot(fwd)
            if z <= 1e-3:
                return False
            xs.append(v.dot(side) / z)
            ys.append(v.dot(up) / z)
        return (max(xs) - min(xs)) / (2 * hx) <= size * (right_edge - left) and (max(ys) - min(ys)) / (2 * hy) <= max_height * room

    lo, hi = 0.05, 1000.0
    for _ in range(50):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if fits(mid) else (mid, hi)
    r = bpy.context.scene.render
    longest = max(r.resolution_x, r.resolution_y)
    cam.data.shift_x = -(cx - 0.5) * r.resolution_x / longest
    cam.data.shift_y = (cy - 0.5) * r.resolution_y / longest
    return hi
