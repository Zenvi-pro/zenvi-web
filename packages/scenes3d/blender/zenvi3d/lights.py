"""Light rigs: area lights placed around a subject at the origin."""

import math

import bpy
from mathutils import Vector

from .core import link, rgb


def area(name, location, target=(0, 0, 0), size=2.0, energy=300.0, color="#FFFFFF", shape="RECTANGLE", size_y=None):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = shape
    data.size = size
    data.size_y = size_y or size
    data.energy = energy
    data.color = rgb(color)
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    link(obj)
    return obj


def studio(scale=1.0, key_color="#FFF4E8", rim_color="#DDE6FF", energy=1.0):
    """Key softbox (front left, high), fill (front right, low), rim (behind):
    the three-point product rig. `scale` is the subject's size."""
    s = scale
    area("Key", (-3.2 * s, -3.4 * s, 3.4 * s), size=3.0 * s, energy=900 * s * s * energy, color=key_color)
    area("Fill", (3.6 * s, -2.6 * s, 0.6 * s), size=4.0 * s, energy=260 * s * s * energy, color="#FFFFFF")
    area("Rim", (1.5 * s, 3.8 * s, 2.6 * s), size=1.2 * s, size_y=5.0 * s, energy=1300 * s * s * energy, color=rim_color, shape="RECTANGLE")


def gradient(colors, scale=1.0, energy=1.0, back=1.0):
    """Two coloured strip lights left and right (a gradient wash on glass
    and chrome) plus a soft white top light."""
    s = scale
    a = colors[0]
    b = colors[1] if len(colors) > 1 else colors[0]
    area("Left", (-3.5 * s, -0.8 * s, 0.6 * s), size=0.8 * s, size_y=6 * s, energy=1600 * s * s * energy, color=a)
    area("Right", (3.5 * s, -0.4 * s, 0.4 * s), size=0.8 * s, size_y=6 * s, energy=1600 * s * s * energy, color=b)
    area("Top", (0, -1.0 * s, 4.5 * s), size=4 * s, energy=500 * s * s * energy, color="#FFFFFF")
    area("Back", (0, 4.0 * s, 1.0 * s), size=6 * s, energy=500 * s * s * energy * back, color=b)


def orbit_point(radius, azimuth_deg, elevation_deg, center=(0, 0, 0)):
    a, e = math.radians(azimuth_deg), math.radians(elevation_deg)
    return (center[0] + radius * math.cos(e) * math.sin(a), center[1] - radius * math.cos(e) * math.cos(a), center[2] + radius * math.sin(e))


def sun(name, elevation_deg, azimuth_deg, strength=3.0, angle_deg=6.0, color="#FFFFFF"):
    """A sun from (azimuth, elevation) (azimuth 0: from behind the camera,
    positive: from the right). `angle_deg` softens its shadows."""
    data = bpy.data.lights.new(name, "SUN")
    data.energy = strength
    data.angle = math.radians(angle_deg)
    data.color = rgb(color)
    obj = bpy.data.objects.new(name, data)
    source = Vector(orbit_point(1.0, azimuth_deg, elevation_deg))
    obj.rotation_euler = (-source).to_track_quat("-Z", "Y").to_euler()
    link(obj)
    return obj


def exclude(light_objects, receivers):
    """Light linking: these lights do not light (or shadow) `receivers`."""
    coll = bpy.data.collections.new("NotLit")
    for obj in receivers:
        coll.objects.link(obj)
    for light in light_objects:
        light.light_linking.receiver_collection = coll
    for item in coll.collection_objects:
        item.light_linking.link_state = "EXCLUDE"
