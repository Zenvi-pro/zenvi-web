"""Materials: chrome, glass, plastic, matte, clay, iridescent, gradient
emission, and media (image or video) surfaces."""

import bpy

from .core import rgb


def _principled(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    return mat, bsdf


def _set(bsdf, **values):
    for key, value in values.items():
        bsdf.inputs[key.replace("_", " ")].default_value = value


def chrome(color="#DADCE2", roughness=0.05, name="Chrome", bands=None):
    """A mirror metal. `bands` ("X", "Y" or "Z"): tint the reflectance with a
    sky/horizon/ground ramp along that local axis, the classic chrome-type
    look that flat faces cannot get from reflections alone."""
    mat, b = _principled(name)
    _set(b, Base_Color=rgb(color, 1.0), Metallic=1.0, Roughness=roughness)
    if bands:
        _ramp_into(mat, b.inputs["Base Color"], bands, [(0.0, "#F4F6FA"), (0.42, "#9AA2B1"), (0.5, "#2B2F38"), (0.56, "#E9EDF3"), (1.0, "#6C7381")])
    return mat


def _ramp_into(mat, socket, axis, stops):
    tree = mat.node_tree
    coord = tree.nodes.new("ShaderNodeTexCoord")
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    tree.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    tree.links.new(sep.outputs[axis], ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, color) in zip(els, stops):
        el.position = pos
        el.color = rgb(color, 1.0)
    tree.links.new(ramp.outputs["Color"], socket)


def _facing_ramp(mat, socket, stops, blend=0.45, sweep=0.0):
    """Colour ramp by viewing angle; `sweep` adds a band across world X so
    flat faces facing the camera still change colour along the object."""
    tree = mat.node_tree
    weight = tree.nodes.new("ShaderNodeLayerWeight")
    weight.inputs["Blend"].default_value = blend
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    fac = weight.outputs["Facing"]
    if sweep:
        geo = tree.nodes.new("ShaderNodeNewGeometry")
        sep = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(geo.outputs["Position"], sep.inputs["Vector"])
        m = tree.nodes.new("ShaderNodeMath")
        m.operation = "MULTIPLY_ADD"
        tree.links.new(sep.outputs["X"], m.inputs[0])
        m.inputs[1].default_value = sweep
        tree.links.new(fac, m.inputs[2])
        wrap = tree.nodes.new("ShaderNodeMath")
        wrap.operation = "PINGPONG"
        wrap.inputs[1].default_value = 1.0
        tree.links.new(m.outputs[0], wrap.inputs[0])
        fac = wrap.outputs[0]
    tree.links.new(fac, ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, color) in zip(els, stops):
        el.position = pos
        el.color = rgb(color, 1.0)
    tree.links.new(ramp.outputs["Color"], socket)


def iridescent(color="#E8E8F0", roughness=0.18, name="Iridescent"):
    """Pearlescent: the colour shifts with the viewing angle (pearl face-on,
    cyan, violet, gold at grazing angles) under a clear coat. Not metallic,
    so it keeps its colour in a dark studio (EEVEE does not show thin film)."""
    mat, b = _principled(name)
    _set(b, Roughness=roughness)
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.03
    stops = [(0.0, "#F4D9FF"), (0.25, "#8FE6F5"), (0.5, "#A98BFF"), (0.75, "#FFC48A"), (1.0, "#FF86B6")]
    _facing_ramp(mat, b.inputs["Base Color"], stops, sweep=0.22)
    _facing_ramp(mat, b.inputs["Emission Color"], stops, sweep=0.22)
    b.inputs["Emission Strength"].default_value = 0.25
    return mat


def glass(tint="#FFFFFF", roughness=0.03, name="Glass"):
    """Clear glass that reads over any backdrop: see-through face-on, a
    mirror at grazing angles (fresnel), a faint body tint. EEVEE's true
    refraction only shows the studio, which is never in frame."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    clear.inputs["Color"].default_value = rgb(tint, 1.0)
    body = tree.nodes.new("ShaderNodeEmission")
    body.inputs["Color"].default_value = rgb(tint, 1.0)
    body.inputs["Strength"].default_value = 0.12
    base = tree.nodes.new("ShaderNodeAddShader")
    tree.links.new(clear.outputs[0], base.inputs[0])
    tree.links.new(body.outputs[0], base.inputs[1])
    gloss = tree.nodes.new("ShaderNodeBsdfPrincipled")
    gloss.inputs["Metallic"].default_value = 1.0
    gloss.inputs["Roughness"].default_value = roughness
    gloss.inputs["Base Color"].default_value = (1, 1, 1, 1)
    weight = tree.nodes.new("ShaderNodeLayerWeight")
    weight.inputs["Blend"].default_value = 0.35
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(weight.outputs["Fresnel"], mix.inputs["Fac"])
    tree.links.new(base.outputs[0], mix.inputs[1])
    tree.links.new(gloss.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"
    mat.use_transparency_overlap = True
    return mat


def plastic(color, roughness=0.32, coat=0.6, name="Plastic"):
    mat, b = _principled(name)
    _set(b, Base_Color=rgb(color, 1.0), Roughness=roughness)
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.08
    return mat


def matte(color, roughness=0.75, name="Matte"):
    mat, b = _principled(name)
    _set(b, Base_Color=rgb(color, 1.0), Roughness=roughness)
    return mat


def clay(color="#E9E4DC", name="Clay"):
    mat, b = _principled(name)
    _set(b, Base_Color=rgb(color, 1.0), Roughness=0.9)
    b.inputs["Sheen Weight"].default_value = 0.3
    return mat


def metal(color, roughness=0.32, name="Metal"):
    mat, b = _principled(name)
    _set(b, Base_Color=rgb(color, 1.0), Metallic=0.9, Roughness=roughness)
    return mat


def emission(color, strength=4.0, name="Emission"):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    em = tree.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = rgb(color, 1.0)
    em.inputs["Strength"].default_value = strength
    tree.links.new(em.outputs[0], out.inputs["Surface"])
    return mat


def gradient(colors, axis="Z", glossy=True, name="Gradient"):
    """A colour ramp across the object's bounding box (generated coords)
    on a glossy coated base: a two-tone gradient look."""
    mat, b = _principled(name)
    tree = mat.node_tree
    coord = tree.nodes.new("ShaderNodeTexCoord")
    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    tree.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    tree.links.new(sep.outputs[axis], ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    while len(els) < len(colors):
        els.new(0.5)
    for i, c in enumerate(colors):
        els[i].position = i / max(1, len(colors) - 1)
        els[i].color = rgb(c, 1.0)
    tree.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    tree.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.35
    b.inputs["Roughness"].default_value = 0.25 if glossy else 0.6
    b.inputs["Coat Weight"].default_value = 0.8 if glossy else 0.0
    return mat


def tile(item, color, name="Tile"):
    """A cube face: the picture over a coloured tile (transparent PNG icons
    sit on the colour), glossy plastic."""
    mat, b = _principled(name)
    tree = mat.node_tree
    _set(b, Roughness=0.28)
    b.inputs["Coat Weight"].default_value = 0.7
    if item is None:
        _set(b, Base_Color=rgb(color, 1.0))
        return mat
    tex = _image_node(tree, item, 1.0)
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    tree.links.new(tex.outputs["Alpha"], mix.inputs["Factor"])
    mix.inputs[6].default_value = rgb(color, 1.0)
    tree.links.new(tex.outputs["Color"], mix.inputs[7])
    tree.links.new(mix.outputs[2], b.inputs["Base Color"])
    tree.links.new(mix.outputs[2], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.2
    return mat


def flat_media(item, aspect, name="Flat"):
    """Footage exactly as it is (emission 1 under the Standard view), dimmed
    by how far the face turns from the camera axis: for cube_cut, whose
    first and last frames must match the clips."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    tex = _image_node(tree, item, aspect)
    geo = tree.nodes.new("ShaderNodeNewGeometry")
    dot = tree.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = (0.0, -1.0, 0.0)
    tree.links.new(geo.outputs["Normal"], dot.inputs[0])
    shade = tree.nodes.new("ShaderNodeMapRange")
    shade.inputs["From Min"].default_value = 0.0
    shade.inputs["From Max"].default_value = 1.0
    shade.inputs["To Min"].default_value = 0.25
    shade.inputs["To Max"].default_value = 1.0
    tree.links.new(dot.outputs["Value"], shade.inputs["Value"])
    em = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(tex.outputs["Color"], em.inputs["Color"])
    tree.links.new(shade.outputs["Result"], em.inputs["Strength"])
    tree.links.new(em.outputs[0], out.inputs["Surface"])
    return mat


def crystal(tint="#FFFFFF", roughness=0.04, ior=1.45, name="Crystal"):
    """Physically refracting glass (EEVEE ray-traced refraction): for hero
    objects whose refraction of the coloured studio is the point."""
    mat, b = _principled(name)
    _set(b, Base_Color=rgb(tint, 1.0), Roughness=roughness, IOR=ior, Transmission_Weight=1.0)
    mat.surface_render_method = "DITHERED"
    mat.use_raytrace_refraction = True
    mat.thickness_mode = "SPHERE"
    return mat


def media_image(item):
    """A bpy image for a job media item: a still, or a movie that plays
    from `start` seconds (its frames advance with the scene)."""
    img = bpy.data.images.load(item["file"], check_existing=True)
    if item["kind"] == "video":
        img.source = "MOVIE"
    return img


def _image_node(tree, item, cover_aspect=None):
    tex = tree.nodes.new("ShaderNodeTexImage")
    tex.image = media_image(item)
    tex.extension = "EXTEND"
    tex.interpolation = "Linear"
    if item["kind"] == "video":
        user = tex.image_user
        user.frame_duration = max(1, int(item.get("frames") or 1))
        user.frame_start = 1
        user.frame_offset = int(round(float(item.get("start") or 0.0) * float(item.get("fps") or 30)))
        user.use_auto_refresh = True
        user.use_cyclic = False
    if cover_aspect:
        # Fill a surface of aspect `cover_aspect` (w/h) without stretching: crop the long side.
        src = (item.get("width") or 1) / max(1, item.get("height") or 1)
        uv = tree.nodes.new("ShaderNodeTexCoord")
        mapping = tree.nodes.new("ShaderNodeMapping")
        sx, sy = (cover_aspect / src, 1.0) if src > cover_aspect else (1.0, src / cover_aspect)
        mapping.inputs["Scale"].default_value = (sx, sy, 1.0)
        mapping.inputs["Location"].default_value = ((1 - sx) / 2, (1 - sy) / 2, 0.0)
        tree.links.new(uv.outputs["UV"], mapping.inputs["Vector"])
        tree.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    return tex


def screen(item, aspect, glow=1.0, gloss=0.04, name="Screen"):
    """A display: the media as emission (stays bright whatever the light)
    under a glossy glass coat that catches reflections."""
    mat, b = _principled(name)
    tree = mat.node_tree
    tex = _image_node(tree, item, aspect)
    _set(b, Base_Color=(0.0, 0.0, 0.0, 1.0), Roughness=gloss)
    b.inputs["Coat Weight"].default_value = 0.45
    b.inputs["Coat Roughness"].default_value = 0.02
    tree.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = glow
    return mat


def card(item, aspect, name="Card", gloss=0.35, lift=0.25):
    """A printed card / photo: lit like paper, with a little self-light so
    the picture keeps its colours in shade."""
    mat, b = _principled(name)
    tree = mat.node_tree
    tex = _image_node(tree, item, aspect)
    tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    tree.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = lift
    b.inputs["Roughness"].default_value = gloss
    b.inputs["Coat Weight"].default_value = 0.4
    return mat


def solid_screen(color_top, color_bottom, name="ScreenSolid"):
    """A placeholder display (no footage): a soft vertical gradient glow."""
    return gradient([color_bottom, color_top], axis="Y", name=name)
