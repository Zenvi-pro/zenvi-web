"""Scene setup shared by every scene: an empty scene, render settings by
quality, colour management, the studio environment and the backdrop."""

import math

import bpy

from . import motion

PALETTE = {
    "ink": "#0B0B0F",
    "paper": "#F7F7F5",
    "accent": "#FF5A36",
    "secondary": "#2F6BFF",
}
BACKDROPS = {"dark": ("#16161C", "#050507"), "light": ("#FFFFFF", "#D9DAE0")}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_color, alpha=None):
    """Linear RGB(A) of #rrggbb (Blender colours are scene-linear)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    out = tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    return out + (alpha,) if alpha is not None else out


def is_dark(job):
    bg = job["params"].get("background", "transparent")
    if bg == "dark":
        return True
    if bg in ("light", "transparent"):
        return False
    r, g, b = rgb(bg)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def setup(job):
    """An empty scene with the job's size, frame range and quality settings."""
    scene = reset()
    draft = job["quality"] == "draft"
    r = scene.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x = job["width"]
    r.resolution_y = job["height"]
    r.resolution_percentage = 100
    r.fps = int(round(job["fps"]))
    r.fps_base = r.fps / job["fps"]
    scene.frame_start = 1
    scene.frame_end = job["frames"]
    r.film_transparent = True
    r.use_motion_blur = True
    r.motion_blur_shutter = 0.5
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.image_settings.compression = 15
    r.use_file_extension = True
    r.filepath = job["output_dir"].rstrip("/") + "/f_"
    ee = scene.eevee
    ee.taa_render_samples = 12 if draft else 64
    ee.use_raytracing = True
    ee.ray_tracing_options.resolution_scale = "2" if draft else "1"
    ee.use_shadows = True
    ee.shadow_ray_count = 1 if draft else 2
    ee.use_fast_gi = False
    ee.motion_blur_steps = 1
    vs = scene.view_settings
    vs.view_transform = "AgX"
    vs.look = "AgX - Punchy"
    vs.exposure = 0.0
    scene.world = bpy.data.worlds.new("World")
    return scene


def node(tree, kind, location=(0, 0), **inputs):
    n = tree.nodes.new(kind)
    n.location = location
    for key, value in inputs.items():
        n.inputs[key].default_value = value
    return n


def map_range(tree, socket, a, b, smooth=True):
    """0..1 ramp of `socket` from a to b."""
    m = tree.nodes.new("ShaderNodeMapRange")
    m.interpolation_type = "SMOOTHSTEP" if smooth else "LINEAR"
    m.clamp = True
    m.inputs["From Min"].default_value = a
    m.inputs["From Max"].default_value = b
    tree.links.new(socket, m.inputs["Value"])
    return m.outputs["Result"]


def math_node(tree, op, a, b=None):
    m = tree.nodes.new("ShaderNodeMath")
    m.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            tree.links.new(v, m.inputs[i])
    return m.outputs[0]


def studio_world(job, strength=1.0, tint=None, spin_degrees=0.0, colors=None):
    """A procedural studio environment for reflections: a big overhead
    softbox, two tall strip boxes, a soft horizon. The camera sees the
    backdrop instead (Is Camera Ray), so chrome and glass have something
    to reflect while the frame stays clean. `spin_degrees` turns the studio
    over the clip (a light sweep across chrome)."""
    scene = bpy.context.scene
    world = scene.world
    tree = world.node_tree
    tree.nodes.clear()
    out = node(tree, "ShaderNodeOutputWorld", (1200, 0))
    coord = node(tree, "ShaderNodeTexCoord", (-1200, 0))
    mapping = node(tree, "ShaderNodeMapping", (-1000, 0))
    tree.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    if spin_degrees:
        motion.animate(mapping.inputs["Rotation"], "default_value",
                       [(1, (0, 0, 0)), (job["frames"], (0, 0, math.radians(spin_degrees)))], "in-out")
    sep = node(tree, "ShaderNodeSeparateXYZ", (-800, 0))
    tree.links.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    x, y, z = sep.outputs["X"], sep.outputs["Y"], sep.outputs["Z"]
    # Elevation bands: a dark floor, a crisp bright horizon line, a cool
    # ceiling gradient and an overhead softbox. Chrome bevels pick the line
    # up as the sharp highlight that reads as "metal".
    floor = math_node(tree, "ADD", 0.015, math_node(tree, "MULTIPLY", map_range(tree, z, -0.6, -0.05), 0.12))
    horizon = math_node(tree, "MULTIPLY", math_node(tree, "MULTIPLY", map_range(tree, z, -0.04, -0.01), math_node(tree, "SUBTRACT", 1.0, map_range(tree, z, 0.04, 0.09))), 3.0)
    ceiling = math_node(tree, "MULTIPLY", map_range(tree, z, 0.05, 0.6), 0.9)
    top = math_node(tree, "MULTIPLY", map_range(tree, z, 0.7, 0.85), 5.0)
    # Tall strip boxes at a few azimuths; the studio's spin sweeps them across.
    az = math_node(tree, "ARCTAN2", x, math_node(tree, "MULTIPLY", y, -1.0))
    strips = None
    for center, width, gain in ((-0.65, 0.07, 6.0), (0.75, 0.05, 5.0), (2.6, 0.12, 4.0)):
        d = math_node(tree, "ABSOLUTE", math_node(tree, "SUBTRACT", az, center))
        pulse = math_node(tree, "MULTIPLY", math_node(tree, "SUBTRACT", 1.0, map_range(tree, d, width * 0.6, width)), gain)
        pulse = math_node(tree, "MULTIPLY", pulse, map_range(tree, z, -0.3, -0.05))
        strips = pulse if strips is None else math_node(tree, "ADD", strips, pulse)
    light = math_node(tree, "ADD", math_node(tree, "ADD", floor, horizon), math_node(tree, "ADD", math_node(tree, "ADD", ceiling, top), strips))
    light = math_node(tree, "MULTIPLY", light, strength)
    env = node(tree, "ShaderNodeBackground", (600, 200))
    tree.links.new(light, env.inputs["Strength"])
    env.inputs["Color"].default_value = (tint or env_tint(job)) + (1.0,)
    if colors:
        # A coloured studio (glass refracts it): colours[0] above, colours[1] below, by azimuth too.
        ramp = tree.nodes.new("ShaderNodeValToRGB")
        mix_in = math_node(tree, "ADD", math_node(tree, "MULTIPLY", z, 0.5), math_node(tree, "MULTIPLY", x, 0.35))
        tree.links.new(math_node(tree, "ADD", mix_in, 0.5), ramp.inputs["Fac"])
        els = ramp.color_ramp.elements
        els[0].position, els[0].color = 0.2, rgb(colors[1], 1.0)
        els[1].position, els[1].color = 0.8, rgb(colors[0], 1.0)
        tree.links.new(ramp.outputs["Color"], env.inputs["Color"])
    env_out = env.outputs["Background"]
    tree.links.new(env_out, out.inputs["Surface"])
    return world


def backdrop_colors(job):
    """(inner, outer) sRGB hex of the backdrop, or None when transparent."""
    bg = job["params"].get("background", "transparent")
    if bg == "transparent":
        return None
    if bg in BACKDROPS:
        return BACKDROPS[bg]
    h = bg.lstrip("#")
    c = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    return bg, "#%02x%02x%02x" % tuple(int(v * 0.6) for v in c)


def env_tint(job):
    """Studio colour for refraction and reflection: glass shows something
    close to the backdrop it will be composited over."""
    colors = backdrop_colors(job)
    if colors is None:
        return (0.55, 0.56, 0.6)
    lin = rgb(colors[0])
    return tuple(0.25 + 0.75 * c for c in lin)


def write_backdrop(job):
    """The backdrop as a PNG in display colours (a soft radial gradient,
    lighter a little above centre). Rendered frames are always RGBA; the
    encoder lays them over this so the colours come out exact (AgX would
    turn a white world grey)."""
    colors = backdrop_colors(job)
    if colors is None:
        return None
    import numpy as np
    w, h = job["width"], job["height"]
    inner = np.array([int(colors[0].lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    outer = np.array([int(colors[1].lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    short = min(w, h)
    d = np.sqrt(((xs - w / 2) / short) ** 2 + ((ys - h * 0.45) / short) ** 2) / (0.5 * max(w, h) / short + 0.35)
    t = np.clip(d, 0, 1)
    t = t * t * (3 - 2 * t)
    rgb_ = inner[None, None, :] * (1 - t[..., None]) + outer[None, None, :] * t[..., None]
    rgba = np.concatenate([rgb_, np.ones((h, w, 1))], axis=2)[::-1]  # bpy rows run bottom-up
    img = bpy.data.images.new("Backdrop", w, h, alpha=False)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    path = job["output_dir"].rstrip("/") + "/backdrop.png"
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return path


def glow(threshold=1.0, size=6, strength=0.6):
    """Bloom in the compositor (EEVEE has no bloom since 4.2). The glow also
    raises alpha (its brightness), so it survives being laid over a
    backdrop or a timeline instead of vanishing with the transparent film."""
    scene = bpy.context.scene
    try:
        tree = bpy.data.node_groups.new("Glow", "CompositorNodeTree")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = tree
        rl = tree.nodes.new("CompositorNodeRLayers")
        glare = tree.nodes.new("CompositorNodeGlare")
        out = tree.nodes.new("NodeGroupOutput")
        glare.inputs["Type"].default_value = "Bloom"
        glare.inputs["Threshold"].default_value = threshold
        glare.inputs["Size"].default_value = min(1.0, size / 9)
        glare.inputs["Strength"].default_value = strength
        tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
        bw = tree.nodes.new("CompositorNodeRGBToBW")
        tree.links.new(glare.outputs["Glare"], bw.inputs[0])
        top = tree.nodes.new("ShaderNodeMath")
        top.operation = "MAXIMUM"
        top.use_clamp = True
        tree.links.new(bw.outputs[0], top.inputs[0])
        tree.links.new(rl.outputs["Alpha"], top.inputs[1])
        alpha = tree.nodes.new("CompositorNodeSetAlpha")
        alpha.inputs["Type"].default_value = "Replace Alpha" if "Type" in alpha.inputs else None
        tree.links.new(glare.outputs["Image"], alpha.inputs["Image"])
        tree.links.new(top.outputs[0], alpha.inputs["Alpha"])
        tree.links.new(alpha.outputs["Image"], out.inputs[0])
        scene.render.use_compositing = True
    except Exception as error:  # compositor API drift: keep rendering without bloom
        print("zenvi3d: no bloom:", error)


def _set(n, socket, attr, value):
    if socket in n.inputs:
        try:
            n.inputs[socket].default_value = value
            return
        except TypeError:
            pass
    if hasattr(n, attr):
        setattr(n, attr, value.upper() if isinstance(value, str) else value)


def collection():
    return bpy.context.scene.collection


def empty(name, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.location = location
    collection().objects.link(obj)
    return obj


def link(obj):
    collection().objects.link(obj)
    return obj
