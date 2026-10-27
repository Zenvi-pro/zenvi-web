"""terrain_glide: a backdrop clip. A camera glides low over a procedural
field (grass that sways in the wind, rippled sand dunes, or snow) toward
a low sun, through haze that thickens with distance into the sky.

Everything is made here: the ground is a height function (sums of seeded
waves, flat along the camera's path, rolling away from it), the grass is
clumps of blades scattered on it by geometry nodes, the sky and the haze
share one gradient so the horizon has no seam."""

import math
import random

import bmesh
import bpy

from zenvi3d import camera, core, lights, motion

# (zenith, horizon, sun haze, sun colour, sun strength, sun elevation, world light) per time of day.
TIMES = {
    "day": ("#6E9BD6", "#DCE6EF", "#FFF4DE", "#FFF6EA", 4.2, 38.0, 1.0),
    "golden": ("#5C7FB5", "#F2D3AE", "#FFC27A", "#FFC98F", 3.4, 9.0, 0.8),
    "dusk": ("#1C2340", "#6B5A7A", "#FF9A5C", "#FF9F6B", 1.8, 5.0, 0.9),
}
SURFACES = {
    # ground colours (near, far), roughness
    "grass": ("#2F4A1C", "#55693A", 0.8),
    "sand": ("#D9B98A", "#E8CFA6", 0.85),
    "snow": ("#E4EAF3", "#F3F6FA", 0.55),
}
LENGTH = 140.0  # metres of field ahead of the start
HALF_WIDTH = 60.0


class Ground:
    """Height of the field at (x, y): seeded waves, nearly flat along the
    camera's path (x = 0) and rolling away from it."""

    def __init__(self, surface, seed):
        rng = random.Random(seed)
        self.surface = surface
        count = 6
        self.waves = []
        for i in range(count):
            angle = rng.uniform(0, math.pi)
            length = {"grass": 22.0, "sand": 16.0, "snow": 30.0}[surface] * (0.45 + 0.55 * rng.random()) * (1.6 if i < 2 else 1.0)
            self.waves.append((math.cos(angle) * 2 * math.pi / length, math.sin(angle) * 2 * math.pi / length, rng.uniform(0, 2 * math.pi), 1.0 / (1 + i * 0.6)))
        self.amp = {"grass": 1.2, "sand": 1.8, "snow": 1.6}[surface]

    def __call__(self, x, y):
        h = 0.0
        for kx, ky, ph, a in self.waves:
            s = math.sin(kx * x + ky * y + ph)
            if self.surface == "sand" and a == 1.0:
                s = 1.0 - 2.0 * abs(s) ** 1.3  # the two long waves get crests: dunes
            h += a * s
        away = min(1.0, max(0.0, (abs(x) - 2.5) / 18.0))
        away = away * away * (3 - 2 * away)
        return h * self.amp * (0.08 + 0.92 * away)


def ground_mesh(height, step_near=0.25, step_far=1.0):
    """A grid over the field, finer near the path."""
    def axis(lo, hi, fine_lo, fine_hi, fine, coarse):
        out, v = [], lo
        while v < hi:
            out.append(v)
            v += fine if fine_lo <= v <= fine_hi else coarse
        out.append(hi)
        return out

    xs = axis(-HALF_WIDTH, HALF_WIDTH, -10, 10, step_near, step_far)
    ys = axis(-10, LENGTH, -10, 45, step_near, step_far)
    bm = bmesh.new()
    grid = [[bm.verts.new((x, y, height(x, y))) for x in xs] for y in ys]
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    mesh = bpy.data.meshes.new("Ground")
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new("Ground", mesh)
    core.link(obj)
    return obj


def blade_clump(rng, blades=6):
    """A tuft of tapered, curved blades about the origin (0.3-0.5 m tall)."""
    bm = bmesh.new()
    for _ in range(blades):
        h = rng.uniform(0.28, 0.5)
        w = rng.uniform(0.008, 0.014)
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, 0.05)
        ox, oy = r * math.cos(a), r * math.sin(a)
        lean = rng.uniform(0.15, 0.5)
        facing = rng.uniform(0, 2 * math.pi)
        dx, dy = math.cos(facing), math.sin(facing)
        px, py = -dy, dx
        rows = []
        segments = 4
        for k in range(segments + 1):
            t = k / segments
            bend = lean * h * t * t
            cx, cy, cz = ox + dx * bend, oy + dy * bend, h * t * (1 - 0.25 * lean * t)
            half = w * (1 - t) + 0.0006
            rows.append((bm.verts.new((cx - px * half, cy - py * half, cz)), bm.verts.new((cx + px * half, cy + py * half, cz))))
        for k in range(segments):
            bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]))
    mesh = bpy.data.meshes.new("Clump")
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new("Clump", mesh)
    core.link(obj)
    obj.hide_render = True
    obj.hide_viewport = True
    return obj


def haze(tree, shader, look, density):
    """Mix a surface shader into the sky's horizon colour with distance
    (exponential haze), brighter toward the sun, the same colour the sky
    has at the horizon in that direction (sky_world)."""
    cam = tree.nodes.new("ShaderNodeCameraData")
    fog = core.math_node(tree, "SUBTRACT", 1.0, core.math_node(tree, "EXPONENT", core.math_node(tree, "MULTIPLY", cam.outputs["View Distance"], -density)))
    geo = tree.nodes.new("ShaderNodeNewGeometry")
    color = haze_color(tree, geo.outputs["Incoming"], look, toward=-1.0)
    em = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(color, em.inputs["Color"])
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(fog, mix.inputs["Fac"])
    tree.links.new(shader, mix.inputs[1])
    tree.links.new(em.outputs[0], mix.inputs[2])
    return mix.outputs[0]


SUN_DIR = [0.0, 1.0, 0.0]  # set in build: where the sun is (unit vector)


def haze_color(tree, direction, look, toward=1.0):
    """Horizon colour, warmed toward the sun: `direction` points away from
    the viewer (toward=1) or at it (toward=-1, a surface's Incoming)."""
    dot = tree.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    tree.links.new(direction, dot.inputs[0])
    dot.inputs[1].default_value = tuple(toward * c for c in SUN_DIR)
    glow = core.math_node(tree, "POWER", core.math_node(tree, "MAXIMUM", dot.outputs["Value"], 0.0), 6.0)
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    tree.links.new(glow, mix.inputs["Factor"])
    mix.inputs[6].default_value = core.rgb(look[1], 1.0)
    mix.inputs[7].default_value = core.rgb(look[2], 1.0)
    return mix.outputs[2]


def sky_world(look, sun_dir, ambient=1.0):
    """The visible sky: zenith to horizon gradient, haze warming toward the
    sun, a soft sun glow; below the horizon the haze colour (the ground
    hides it). Also lights the field (ambient)."""
    world = bpy.context.scene.world
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputWorld")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    norm = tree.nodes.new("ShaderNodeVectorMath")
    norm.operation = "NORMALIZE"
    tree.links.new(coord.outputs["Generated"], norm.inputs[0])
    tree.links.new(norm.outputs[0], sep.inputs["Vector"])
    up = core.map_range(tree, sep.outputs["Z"], 0.0, 0.55)
    horizon = haze_color(tree, norm.outputs[0], look)
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    tree.links.new(core.math_node(tree, "POWER", up, 0.7), mix.inputs["Factor"])
    tree.links.new(horizon, mix.inputs[6])
    mix.inputs[7].default_value = core.rgb(look[0], 1.0)
    dot = tree.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    tree.links.new(norm.outputs[0], dot.inputs[0])
    dot.inputs[1].default_value = sun_dir
    facing = core.math_node(tree, "MAXIMUM", dot.outputs["Value"], 0.0)
    disc = core.math_node(tree, "MULTIPLY", core.math_node(tree, "POWER", facing, 2500.0), 8.0)
    # Two falloffs, so the glow has no visible edge.
    halo = core.math_node(tree, "ADD", core.math_node(tree, "MULTIPLY", core.math_node(tree, "POWER", facing, 120.0), 0.7), core.math_node(tree, "MULTIPLY", core.math_node(tree, "POWER", facing, 8.0), 0.3))
    sun_col = tree.nodes.new("ShaderNodeMix")
    sun_col.data_type = "RGBA"
    sun_col.blend_type = "ADD"
    tree.links.new(core.math_node(tree, "ADD", disc, halo), sun_col.inputs["Factor"])
    tree.links.new(mix.outputs[2], sun_col.inputs[6])
    sun_col.inputs[7].default_value = core.rgb(look[3], 1.0)
    bg = tree.nodes.new("ShaderNodeBackground")
    tree.links.new(sun_col.outputs[2], bg.inputs["Color"])
    # The camera sees the sky as it is; the field is lit by a dimmer copy (the sun lamp does the rest).
    path = tree.nodes.new("ShaderNodeLightPath")
    lit = min(1.0, look[6] * 0.6 * ambient)
    strength = core.math_node(tree, "ADD", core.math_node(tree, "MULTIPLY", path.outputs["Is Camera Ray"], 1.0 - lit), lit)
    tree.links.new(strength, bg.inputs["Strength"])
    tree.links.new(bg.outputs[0], out.inputs["Surface"])


def ground_material(surface, look, density):
    near, far, rough = SURFACES[surface]
    mat = bpy.data.materials.new("GroundMat")
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes["Principled BSDF"]
    coord = tree.nodes.new("ShaderNodeTexCoord")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.35
    noise.inputs["Detail"].default_value = 6.0
    tree.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = core.rgb(near, 1.0)
    ramp.color_ramp.elements[1].color = core.rgb(far, 1.0)
    tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    if surface == "sand":
        # Wind ripples: a warped wave across the dunes, as bump.
        wave = tree.nodes.new("ShaderNodeTexWave")
        wave.inputs["Scale"].default_value = 2.6
        wave.inputs["Distortion"].default_value = 5.0
        wave.inputs["Detail"].default_value = 2.0
        tree.links.new(coord.outputs["Object"], wave.inputs["Vector"])
        bump = tree.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.18
        bump.inputs["Distance"].default_value = 0.02
        tree.links.new(wave.outputs["Fac"], bump.inputs["Height"])
        tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    elif surface == "snow":
        bsdf.inputs["Subsurface Weight"].default_value = 0.25
        bsdf.inputs["Subsurface Radius"].default_value = (0.4, 0.6, 1.0)
        # Glints: a few tiny facets catch the sun.
        vor = tree.nodes.new("ShaderNodeTexVoronoi")
        vor.inputs["Scale"].default_value = 90.0
        tree.links.new(coord.outputs["Object"], vor.inputs["Vector"])
        spark = core.math_node(tree, "MULTIPLY", core.map_range(tree, vor.outputs["Distance"], 0.03, 0.0), 1.2)
        tree.links.new(spark, bsdf.inputs["Emission Strength"])
        bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
        noise.inputs["Scale"].default_value = 0.15
        # Wind-carved drifts: soft bumps that the low sun picks out.
        drift = tree.nodes.new("ShaderNodeTexNoise")
        drift.inputs["Scale"].default_value = 1.2
        drift.inputs["Detail"].default_value = 4.0
        tree.links.new(coord.outputs["Object"], drift.inputs["Vector"])
        bump = tree.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35
        bump.inputs["Distance"].default_value = 0.08
        tree.links.new(drift.outputs["Fac"], bump.inputs["Height"])
        tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    out = tree.nodes["Material Output"]
    tree.links.new(haze(tree, bsdf.outputs[0], look, density), out.inputs["Surface"])
    return mat


def grass_material(look, density):
    """Blades: deep green at the root to sunlit yellow-green tips, each tuft
    a little different, translucent so a low sun glows through them."""
    mat = bpy.data.materials.new("Grass")
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["Object"], sep.inputs["Vector"])
    tip = core.map_range(tree, sep.outputs["Z"], 0.0, 0.45)
    info = tree.nodes.new("ShaderNodeObjectInfo")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].color = core.rgb("#24401A", 1.0)
    els[1].color = core.rgb("#A3B85A", 1.0)
    els.new(0.6).color = core.rgb("#5A8430", 1.0)
    shade = core.math_node(tree, "ADD", core.math_node(tree, "MULTIPLY", tip, 0.8), core.math_node(tree, "MULTIPLY", info.outputs["Random"], 0.25))
    tree.links.new(shade, ramp.inputs["Fac"])
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.5
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    trans = tree.nodes.new("ShaderNodeBsdfTranslucent")
    tree.links.new(ramp.outputs["Color"], trans.inputs["Color"])
    mix = tree.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.5
    tree.links.new(bsdf.outputs[0], mix.inputs[1])
    tree.links.new(trans.outputs[0], mix.inputs[2])
    tree.links.new(haze(tree, mix.outputs[0], look, density), out.inputs["Surface"])
    return mat


def scatter(ground, clump, path_end, seed, quality):
    """Geometry nodes on the ground: dense tufts along the camera's path,
    sparse bigger ones elsewhere (the haze hides the thinning), random
    turn, lean and size, swaying in a travelling wind."""
    ng = bpy.data.node_groups.new("Grass", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n = ng.nodes
    L = ng.links
    gin = n.new("NodeGroupInput")
    gout = n.new("NodeGroupOutput")
    pos = n.new("GeometryNodeInputPosition")
    sep = n.new("ShaderNodeSeparateXYZ")
    L.new(pos.outputs[0], sep.inputs[0])

    def m(op, a, b=None):
        node = n.new("ShaderNodeMath")
        node.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                node.inputs[i].default_value = v
            else:
                L.new(v, node.inputs[i])
        return node.outputs[0]

    def ramp01(v, a, b):
        node = n.new("ShaderNodeMapRange")
        node.interpolation_type = "SMOOTHSTEP"
        node.clamp = True
        node.inputs["From Min"].default_value = a
        node.inputs["From Max"].default_value = b
        L.new(v, node.inputs["Value"])
        return node.outputs["Result"]

    near_x = m("SUBTRACT", 1.0, ramp01(m("ABSOLUTE", sep.outputs["X"]), 3.0, 7.0))
    near_y = m("MULTIPLY", ramp01(sep.outputs["Y"], -3.0, -1.0), m("SUBTRACT", 1.0, ramp01(sep.outputs["Y"], path_end + 18, path_end + 30)))
    near = m("MULTIPLY", near_x, near_y)
    dense = 170.0 if quality == "final" else 90.0
    density = m("ADD", 6.0, m("MULTIPLY", near, dense - 6.0))
    dist = n.new("GeometryNodeDistributePointsOnFaces")
    dist.distribute_method = "RANDOM"
    dist.inputs["Seed"].default_value = seed
    L.new(gin.outputs[0], dist.inputs["Mesh"])
    L.new(density, dist.inputs["Density"])
    info = n.new("GeometryNodeObjectInfo")
    info.inputs["Object"].default_value = clump
    rand_rot = n.new("FunctionNodeRandomValue")
    rand_rot.data_type = "FLOAT_VECTOR"
    rand_rot.inputs["Min"].default_value = (-0.12, -0.12, 0.0)
    rand_rot.inputs["Max"].default_value = (0.12, 0.12, 6.283)
    rand_rot.inputs["Seed"].default_value = seed + 1
    # Wind: gusts travel along the field; the tufts lean with them.
    time = n.new("GeometryNodeInputSceneTime")
    phase = m("ADD", m("MULTIPLY", sep.outputs["Y"], 0.45), m("MULTIPLY", time.outputs["Seconds"], -2.2))
    phase = m("ADD", phase, m("MULTIPLY", sep.outputs["X"], 0.2))
    gust = m("MULTIPLY", m("SINE", phase), 0.13)
    comb = n.new("ShaderNodeCombineXYZ")
    L.new(gust, comb.inputs["X"])
    rot = n.new("ShaderNodeVectorMath")
    rot.operation = "ADD"
    L.new(rand_rot.outputs[0], rot.inputs[0])
    L.new(comb.outputs[0], rot.inputs[1])
    rand_scale = n.new("FunctionNodeRandomValue")
    rand_scale.data_type = "FLOAT"
    for socket in rand_scale.inputs:
        if socket.type == "VALUE" and socket.name in ("Min", "Max"):
            socket.default_value = 0.7 if socket.name == "Min" else 1.35
    rand_scale.inputs["Seed"].default_value = seed + 2
    scale_out = next(o for o in rand_scale.outputs if o.type == "VALUE")
    scale = m("MULTIPLY", scale_out, m("ADD", 1.0, m("MULTIPLY", m("SUBTRACT", 1.0, near), 0.6)))
    inst = n.new("GeometryNodeInstanceOnPoints")
    L.new(dist.outputs["Points"], inst.inputs["Points"])
    L.new(info.outputs["Geometry"], inst.inputs["Instance"])
    L.new(rot.outputs[0], inst.inputs["Rotation"])
    L.new(scale, inst.inputs["Scale"])
    join = n.new("GeometryNodeJoinGeometry")
    L.new(gin.outputs[0], join.inputs[0])
    L.new(inst.outputs[0], join.inputs[0])
    L.new(join.outputs[0], gout.inputs[0])
    mod = ground.modifiers.new("Grass", "NODES")
    mod.node_group = ng


def build(job):
    p = job["params"]
    fps, frames = job["fps"], job["frames"]
    seconds = frames / fps
    surface = p.get("surface", "grass")
    time_of_day = p.get("time") or ("dusk" if core.is_dark(job) else "day")
    look = list(TIMES[time_of_day])
    bg = p.get("background")
    if bg and bg.startswith("#"):
        look[1] = bg  # a colour backdrop: the haze and horizon take it
    seed = int(p.get("seed", 7))
    rng = random.Random(seed)
    scene = bpy.context.scene
    scene.render.film_transparent = False  # the sky is part of the picture
    scene.view_settings.look = "AgX - Base Contrast"
    fog = 0.004 + 0.05 * float(p.get("haze", 0.4)) ** 1.5

    # A low sun ahead of the camera, a little to the side: backlight through the grass.
    # On a vertical frame the view is narrow: keep the sun inside it.
    side = 18 if camera.frame_aspect() >= 1 else 7
    sun_az = 180 + (side if rng.random() < 0.5 else -side)
    elevation = look[5]
    sun_vec = lights.orbit_point(1.0, sun_az, elevation)
    SUN_DIR[:] = list(sun_vec)
    lights.sun("Sun", elevation, sun_az, strength=look[4], angle_deg=2.0, color=look[3])
    # Snow is lit mostly by the sky (blue in its shadows); grass and sand by the sun.
    sky_world(look, sun_vec, ambient=1.25 if surface == "snow" else 1.0)

    height = Ground(surface, seed)
    ground = ground_mesh(height)
    ground.data.materials.append(ground_material(surface, look, fog))
    speed = float(p.get("speed", 2.5))
    travel = speed * seconds
    if surface == "grass":
        clump = blade_clump(rng)
        clump.data.materials.append(grass_material(look, fog))
        scatter(ground, clump, travel, seed, job["quality"])

    # The glide: forward along +Y at camera height above the ground, a slow sway and bank.
    eye = float(p.get("camera_height", 0.75 if surface == "grass" else 0.9))
    cam, aim = camera.camera(lens=float(p.get("lens", 28)), location=(0, 0, eye))
    cam.constraints.clear()
    cam.data.clip_end = 400
    if p.get("dof", True) and job["quality"] == "final":
        cam.data.dof.use_dof = True
        cam.data.dof.focus_distance = 4.0
        cam.data.dof.aperture_fstop = 2.0

    def pose(f):
        t = (f - 1) / fps
        y = t * speed
        x = motion.wobble(t, 9.0, 0.35, 0.6)
        z = height(x, y) + eye + motion.wobble(t, 5.5, 0.04)
        return (x, y, z)

    def turn(f):
        t = (f - 1) / fps
        pitch = math.radians(90 - 5.0 + motion.wobble(t, 7.0, 0.8))
        bank = math.radians(motion.wobble(t, 9.0, 1.4, 2.2))
        yaw = math.radians(motion.wobble(t, 11.0, 3.0, 1.0))
        return (pitch, bank, yaw)

    motion.bake(cam, "location", (1, frames), pose, step=2)
    motion.bake(cam, "rotation_euler", (1, frames), turn, step=2)
    scene.render.motion_blur_shutter = 0.5
