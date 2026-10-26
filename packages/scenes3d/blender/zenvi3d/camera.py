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
