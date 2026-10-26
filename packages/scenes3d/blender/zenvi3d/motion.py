"""Keyframes with docs/TASTE.md easing, set as bezier handles.

A CSS cubic-bezier (x1, y1, x2, y2) on the segment from key a to key b is the
2D bezier Blender evaluates when a's right handle sits at
(a.t + x1*dt, a.v + y1*dv) and b's left handle at (a.t + x2*dt, a.v + y2*dv).
Keys stay editable in Blender, unlike baked per-frame values."""

import math

from bpy_extras import anim_utils

EASES = {
    "smooth": (0.33, 0.0, 0.20, 1.0),
    "out": (0.16, 1.0, 0.30, 1.0),
    "in": (0.70, 0.0, 0.84, 0.0),
    "in-out": (0.65, 0.0, 0.35, 1.0),
    "snap": (0.20, 0.0, 0.0, 1.0),
    "linear": (0.0, 0.0, 1.0, 1.0),
}


def bezier(name, u):
    """Eased progress at u in [0, 1] (for values computed in Python)."""
    x1, y1, x2, y2 = EASES[name]
    u = min(1.0, max(0.0, u))
    lo, hi = 0.0, 1.0
    for _ in range(40):  # solve x(s) = u by bisection; x is monotonic for these curves
        s = (lo + hi) / 2
        x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3
        if x < u:
            lo = s
        else:
            hi = s
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3


def _fcurve(id_data, data_path, index):
    ad = id_data.animation_data
    if hasattr(anim_utils, "action_get_channelbag_for_slot"):  # slotted actions (4.4+)
        bag = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)
        return bag.fcurves.find(data_path, index=index)
    return ad.action.fcurves.find(data_path, index=index)


def animate(target, data_path, keys, ease="smooth"):
    """Key `target.data_path` at [(frame, value), ...]; values are scalars or
    vectors. `ease` names the easing of every segment, or is a list with one
    name per segment. Holds are flat (both handles level)."""
    keys = sorted(keys, key=lambda k: k[0])
    eases = ease if isinstance(ease, (list, tuple)) else [ease] * max(1, len(keys) - 1)
    first = keys[0][1]
    width = len(first) if hasattr(first, "__len__") else 0
    for frame, value in keys:
        setattr(target, data_path, value)
        target.keyframe_insert(data_path, frame=frame)
    id_data = target.id_data
    for index in range(width or 1):
        fc = _fcurve(id_data, data_path, index if width else 0)
        if fc is None:
            continue
        points = fc.keyframe_points
        for p in points:
            p.interpolation = "BEZIER"
            p.handle_left_type = "FREE"
            p.handle_right_type = "FREE"
        for i in range(len(points) - 1):
            a, b = points[i], points[i + 1]
            name = eases[min(i, len(eases) - 1)]
            if name == "hold":
                a.interpolation = "CONSTANT"
                continue
            if name == "linear":
                a.interpolation = "LINEAR"
                continue
            x1, y1, x2, y2 = EASES[name]
            dt = b.co.x - a.co.x
            dv = b.co.y - a.co.y
            a.handle_right = (a.co.x + x1 * dt, a.co.y + y1 * dv)
            b.handle_left = (a.co.x + x2 * dt, a.co.y + y2 * dv)
        points[0].handle_left = (points[0].co.x - 1, points[0].co.y)
        points[-1].handle_right = (points[-1].co.x + 1, points[-1].co.y)
        fc.update()


def bake(target, data_path, frames, fn, step=1):
    """Key `target.data_path` with fn(frame) at every `step` frames, linear
    between keys: motion that is not a few eased moves (orbits, ballistics).
    Uses foreach_set, so hundreds of objects stay fast."""
    sample = list(range(frames[0], frames[1] + 1, step))
    if sample[-1] != frames[1]:
        sample.append(frames[1])
    values = [fn(f) for f in sample]
    width = len(values[0]) if hasattr(values[0], "__len__") else 0
    setattr(target, data_path, values[0])
    target.keyframe_insert(data_path, frame=sample[0])
    id_data = target.id_data
    for index in range(width or 1):
        fc = _fcurve(id_data, data_path, index if width else 0)
        fc.keyframe_points.clear()
        fc.keyframe_points.add(len(sample))
        co = []
        for f, v in zip(sample, values):
            co += [f, v[index] if width else v]
        fc.keyframe_points.foreach_set("co", co)
        fc.keyframe_points.foreach_set("interpolation", [1] * len(sample))  # LINEAR
        fc.update()


def seconds(job, s):
    """Frame number (1-based) of time s."""
    return 1 + int(round(s * job["fps"]))


def wobble(t, period, amount, phase=0.0):
    return amount * math.sin(2 * math.pi * (t / period) + phase)
