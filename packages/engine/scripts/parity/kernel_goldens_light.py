#!/usr/bin/env python3
"""Golden outputs for the Shadow, Glow, LensFlare, Displace and
SphericalProjection kernels, from libopenshot 1.0 itself.

Every case loads a small PNG through ``openshot.QtImageReader`` (how the
desktop premultiplies image pixels), creates the effect with
``EffectInfo().CreateEffect(type)`` + ``SetJson`` and runs ``ProcessFrame``
(so the generic effect mask applies too). The fixture stores the effect's own
``Json()`` after ``SetJson`` (reader paths replaced by input names), so the
TypeScript test evaluates the parameters with ``evaluateEffectParams`` exactly
like the planner does. Cases with several frames reuse one effect instance
(SphericalProjection's UV cache carries over between them).

Run with the desktop's Python and libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/kernel_goldens_light.py

Writes ``packages/engine/src/render/kernels/light-goldens.json``, replayed by
``kernels/light-kernels.test.ts``.
"""

import base64
import json
import math
import os
import sys
import tempfile

import openshot  # noqa: E402  (needs PYTHONPATH to the libopenshot bindings)
from PyQt5.QtCore import qVersion
from PyQt5.QtGui import QImage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/render/kernels/light-goldens.json"))
EFFECT_ID = "K2LIGHT1"


def lcg(seed):
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (state * 1103515245 + 12345) & 0xFFFFFFFF
        return (state >> 8) / 16777216.0

    return rnd


def clamp8(v):
    return max(0, min(255, int(v)))


# ---------------------------------------------------------------------------
# Inputs: straight (non-premultiplied) RGBA, row-major
# ---------------------------------------------------------------------------


def photo(w, h):
    out = bytearray()
    for y in range(h):
        for x in range(w):
            out += bytes([int(30 + 200 * x / (w - 1)), int(20 + 210 * y / (h - 1)), (x * 37 + y * 11) % 256, 255])
    return out


def alpha_noise(w, h, seed):
    rnd = lcg(seed)
    out = bytearray()
    for _ in range(w * h):
        a = 255 if rnd() < 0.3 else int(rnd() * 256)
        out += bytes([int(rnd() * 256), int(rnd() * 256), int(rnd() * 256), a])
    return out


def shape(w, h, seed):
    """An antialiased ellipse and a half-transparent bar on a transparent canvas
    (RGB garbage under alpha 0, which premultiplication must discard)."""
    rnd = lcg(seed)
    cx, cy = w * 0.42, h * 0.45
    rx, ry = w * 0.24, h * 0.27
    out = bytearray()
    for y in range(h):
        for x in range(w):
            px, py = x + 0.5, y + 0.5
            d = math.sqrt(((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2)
            cover = max(0.0, min(1.0, (1.0 - d) * min(rx, ry) / 1.5 + 0.5))
            r = clamp8(60 + 180 * x / w)
            g = clamp8(200 - 120 * y / h)
            b = clamp8(90 + (x * y) % 50)
            a = int(round(255 * cover))
            if w * 0.70 <= px <= w * 0.88 and h * 0.15 <= py <= h * 0.80:
                r, g, b, a = 240, 220, 40, 128 if a < 128 else a
            if a == 0:
                r, g, b = int(rnd() * 256), int(rnd() * 256), int(rnd() * 256)
            out += bytes([r, g, b, a])
    return out


def displacement_map(w, h, with_alpha):
    out = bytearray()
    for y in range(h):
        for x in range(w):
            v = 128 + 110 * math.sin(x * 0.45 + 0.3) * math.cos(y * 0.35 - 0.2)
            r = clamp8(v + 25 * math.sin(y * 0.9))
            g = clamp8(v)
            b = clamp8(v - 30 * math.cos(x * 0.7))
            a = 255
            if with_alpha:
                if (x + 2 * y) % 11 == 0:
                    a = 0
                elif x > w * 0.6:
                    a = clamp8(90 + 7 * y)
            out += bytes([r, g, b, a])
    return out


def panorama(w, h):
    """An equirectangular test texture: hue by longitude, bands by latitude, grid lines."""
    out = bytearray()
    for y in range(h):
        for x in range(w):
            t = x / w
            r = clamp8(128 + 120 * math.cos(2 * math.pi * t))
            g = clamp8(128 + 120 * math.cos(2 * math.pi * (t - 1 / 3)))
            b = clamp8(128 + 120 * math.cos(2 * math.pi * (t - 2 / 3)))
            band = 0.55 + 0.45 * math.sin(math.pi * (y + 0.5) / h)
            r, g, b = clamp8(r * band), clamp8(g * band), clamp8(b * band)
            if x % 8 == 0 or y % 6 == 0:
                r, g, b = 250, 250, 250
            out += bytes([r, g, b, 255])
    return out


def make_inputs():
    W, H = 32, 24
    return {
        "photo": (W, H, photo(W, H)),
        "alpha": (W, H, alpha_noise(W, H, 11)),
        "shape": (W, H, shape(W, H, 3)),
        "shape-lg": (48, 44, shape(48, 44, 4)),
        "map": (W, H, displacement_map(W, H, True)),
        "map-small": (13, 9, displacement_map(13, 9, False)),
        "map-big": (40, 30, displacement_map(40, 30, True)),
        "pano": (32, 16, panorama(32, 16)),
        "pano-alpha": (30, 20, alpha_noise(30, 20, 23)),
    }


# ---------------------------------------------------------------------------
# Effect JSON helpers
# ---------------------------------------------------------------------------


def kf(v):
    return {"Points": [{"co": {"X": 1.0, "Y": float(v)}, "interpolation": 1}]}


def kfa(points, interpolation=0):
    """Animated keyframe: [(frame, value), ...] (0 = Bezier, 1 = linear, 2 = constant)."""
    return {"Points": [{"co": {"X": float(x), "Y": float(y)}, "interpolation": interpolation} for x, y in points]}


def color(r, g, b, a=255):
    return {"red": kf(r), "green": kf(g), "blue": kf(b), "alpha": kf(a)}


# (name, type, input, frames, overrides, images)
# overrides: plain JSON merged into the effect JSON (numbers become constant keyframes
# for keyframe properties; use kf/kfa/color for anything else).
KEYFRAME_KEYS = {
    "opacity", "blur_radius", "spread", "distance", "angle", "x", "y", "brightness", "size",
    "strength", "horizontal", "vertical", "contrast", "yaw", "pitch", "roll", "fov", "in_fov",
}

CASES = [
    # --- Shadow (apply_before_clip=false: the kernel sees the canvas-sized layer) ---
    ("shadow-default", "Shadow", "shape-lg", [1], {}, {}),
    ("shadow-tinted", "Shadow", "shape", [1],
     {"blur_radius": 6, "spread": 0.3, "distance": 4, "angle": 135, "opacity": 0.8, "color": color(200, 30, 60, 180)}, {}),
    ("shadow-alpha-input", "Shadow", "alpha", [1],
     {"blur_radius": 3, "spread": 0.0, "distance": -3, "angle": 30.5, "opacity": 0.95, "color": color(10, 40, 120)}, {}),
    ("shadow-animated", "Shadow", "shape", [7],
     {"blur_radius": kfa([(1, 2), (20, 11)]), "angle": kfa([(1, -40), (20, 220)], 1), "distance": kfa([(1, 2), (20, 9)]),
      "spread": 0.45, "color": color(0, 0, 0, 230)}, {}),
    ("shadow-no-blur", "Shadow", "shape", [1], {"blur_radius": 0, "spread": 1.0, "distance": 3, "angle": 90}, {}),
    # --- Glow ---
    ("glow-outer-default", "Glow", "shape-lg", [1], {}, {}),
    ("glow-inner-default", "Glow", "shape-lg", [1], {"mode": 1}, {}),
    ("glow-outer-params", "Glow", "shape", [1],
     {"blur_radius": 5, "spread": 0.5, "opacity": 0.9, "color": color(60, 200, 255, 200)}, {}),
    ("glow-inner-alpha", "Glow", "alpha", [1], {"mode": 1, "blur_radius": 4, "spread": 0.2, "opacity": 1.0}, {}),
    ("glow-inner-shape", "Glow", "shape", [1], {"mode": 1, "blur_radius": 7, "spread": 0.0, "opacity": 0.7, "color": color(255, 40, 10)}, {}),
    # --- LensFlare ---
    ("lensflare-default", "LensFlare", "photo", [1], {}, {}),
    ("lensflare-tinted-alpha", "LensFlare", "alpha", [1],
     {"x": 0.3, "y": -0.2, "brightness": 0.7, "size": 1.6, "spread": 0.6, "color": color(255, 120, 40)}, {}),
    ("lensflare-gray-shape", "LensFlare", "shape", [1],
     {"x": -0.1, "y": 0.25, "brightness": 0.5, "size": 2.2, "color": color(128, 128, 128)}, {}),
    ("lensflare-bright-blue", "LensFlare", "shape", [1],
     {"x": 0.8, "y": 0.7, "brightness": 1.4, "size": 0.6, "spread": 0.2, "color": color(40, 90, 250, 200)}, {}),
    ("lensflare-zero-brightness", "LensFlare", "alpha", [1], {"brightness": 0.0}, {}),
    # --- Displace ---
    ("displace-default", "Displace", "photo", [1], {}, {"map_reader": "map"}),
    ("displace-params", "Displace", "photo", [1],
     {"strength": 2.0, "horizontal": -0.1, "vertical": 0.15, "brightness": 0.2, "contrast": 4.0, "invert": True},
     {"map_reader": "map"}),
    ("displace-replace-image", "Displace", "photo", [1], {"replace_image": True, "brightness": -0.1, "contrast": 2.5},
     {"map_reader": "map"}),
    ("displace-upscaled-map", "Displace", "alpha", [1], {"horizontal": 0.2, "vertical": -0.08}, {"map_reader": "map-small"}),
    # Legacy projects carry the map as `reader` with no `map_reader` key at all (a present
    # `map_reader: {}` would win and clear it, Displace.cpp:282-289); stored as given.
    ("displace-downscaled-legacy-reader", "Displace", "photo", [1],
     {"strength": 0.7, "vertical": 0.3, "contrast": 19.0, "map_reader": None}, {"reader": "map-big"}),
    ("displace-empty-map-reader-wins", "Displace", "photo", [1], {"horizontal": 0.4}, {"reader": "map"}),
    ("displace-with-effect-mask", "Displace", "photo", [1], {"horizontal": -0.25}, {"map_reader": "map", "mask_reader": "map-small"}),
    # --- SphericalProjection ---
    ("spherical-default", "SphericalProjection", "pano", [1], {}, {}),
    ("spherical-yaw-pitch-roll-nearest", "SphericalProjection", "pano", [1],
     {"yaw": 35, "pitch": -20, "roll": 15, "fov": 75, "interpolation": 0}, {}),
    ("spherical-bilinear", "SphericalProjection", "pano", [1], {"yaw": -110, "pitch": 30, "fov": 120, "interpolation": 1}, {}),
    ("spherical-bicubic-roll", "SphericalProjection", "pano", [1], {"pitch": 70, "roll": -60, "fov": 100, "interpolation": 2}, {}),
    ("spherical-hemisphere", "SphericalProjection", "pano", [1], {"projection_mode": 1, "yaw": 50, "fov": 140}, {}),
    ("spherical-invert-equirect", "SphericalProjection", "pano", [1], {"invert": 1, "pitch": 10, "fov": 60}, {}),
    ("spherical-fisheye-equidistant", "SphericalProjection", "pano", [1], {"projection_mode": 2, "fov": 170, "roll": 30}, {}),
    ("spherical-fisheye-equisolid", "SphericalProjection", "photo", [1],
     {"projection_mode": 3, "input_model": 1, "in_fov": 190, "fov": 150, "yaw": 20}, {}),
    ("spherical-fisheye-stereographic", "SphericalProjection", "pano", [1], {"projection_mode": 4, "fov": 120, "pitch": -45}, {}),
    ("spherical-fisheye-orthographic", "SphericalProjection", "pano", [1],
     {"projection_mode": 5, "fov": 160, "yaw": 90, "interpolation": 1}, {}),
    ("spherical-input-equisolid-invert", "SphericalProjection", "photo", [1],
     {"input_model": 2, "invert": 1, "in_fov": 200, "fov": 90, "yaw": 160}, {}),
    ("spherical-input-stereographic", "SphericalProjection", "alpha", [1], {"input_model": 3, "in_fov": 150, "fov": 110, "pitch": 15}, {}),
    ("spherical-input-orthographic-auto-mip", "SphericalProjection", "photo", [1],
     {"input_model": 4, "in_fov": 60, "fov": 150, "projection_mode": 2}, {}),
    ("spherical-auto-bilinear", "SphericalProjection", "photo", [1],
     {"input_model": 1, "in_fov": 100, "fov": 90, "projection_mode": 2}, {}),
    ("spherical-auto-mip-equirect", "SphericalProjection", "pano", [1], {"projection_mode": 3, "in_fov": 90, "fov": 170}, {}),
    ("spherical-alpha-odd-width", "SphericalProjection", "pano-alpha", [1], {"yaw": 12, "pitch": 8, "fov": 80}, {}),
    ("spherical-uv-cache-reuse", "SphericalProjection", "pano", [1, 2, 3],
     {"yaw": kfa([(1, 30.0), (2, 30.000025), (3, 31.0)], 1), "interpolation": 1}, {}),
]

STRIP = {"description", "name", "class_name", "has_audio", "has_video", "has_tracked_object", "duration", "parent_effect_id",
         "mask_source_id", "mask_time_mode", "mask_loop_mode", "position", "layer", "start", "end", "order"}


def save_png(path, w, h, straight):
    img = QImage(bytes(straight), w, h, w * 4, QImage.Format_RGBA8888)
    if not img.copy().save(path, "PNG"):
        raise RuntimeError(f"could not write {path}")


def sanitize(value, path_names):
    """Replace absolute reader paths by input names and drop volatile reader metadata."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k == "path" and isinstance(v, str):
                out[k] = path_names.get(v, os.path.basename(v))
            else:
                out[k] = sanitize(v, path_names)
        return out
    if isinstance(value, list):
        return [sanitize(v, path_names) for v in value]
    return value


def main():
    work = tempfile.mkdtemp(prefix="zenvi-light-goldens-")
    inputs = make_inputs()
    paths, path_names = {}, {}
    for name, (w, h, data) in inputs.items():
        paths[name] = os.path.join(work, f"{name}.png")
        path_names[paths[name]] = f"{name}.png"
        save_png(paths[name], w, h, data)

    out_cases = {}
    for name, etype, inp, frames, overrides, images in CASES:
        effect = openshot.EffectInfo().CreateEffect(etype)
        if effect is None:
            raise RuntimeError(f"unknown effect {etype}")
        j = json.loads(effect.Json())
        j["id"] = EFFECT_ID
        for k, v in overrides.items():
            if v is None:
                j.pop(k, None)
            else:
                j[k] = kf(v) if k in KEYFRAME_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool) else v
        for key, img in images.items():
            reader = openshot.QtImageReader(paths[img])
            j[key] = json.loads(reader.Json())
        effect.SetJson(json.dumps(j))
        results = []
        for frame_no in frames:
            reader = openshot.QtImageReader(paths[inp])
            reader.Open()
            frame = reader.GetFrame(1)
            result = effect.ProcessFrame(frame, frame_no)
            pixels = bytes(result.GetPixelsBytes())
            # The SWIG QImage is opaque here. SphericalProjection converts the frame to
            # straight ARGB32 and leaves it so (SphericalProjection.cpp:66-67, 370); every
            # other effect keeps RGBA8888_Premultiplied.
            layout = "argb32" if etype == "SphericalProjection" else "rgba-premul"
            results.append({
                "frame": frame_no,
                "width": result.GetWidth(),
                "height": result.GetHeight(),
                "layout": layout,
                "data": base64.b64encode(pixels).decode("ascii"),
            })
            reader.Close()
        if "reader" in images:
            # Effect::Json() rewrites the legacy key as map_reader; keep what a project file holds.
            stored = sanitize(j, path_names)
            adopted = json.loads(effect.Json()).get("map_reader")
            if bool(adopted) != ("map_reader" not in j):
                raise RuntimeError(f"{name}: unexpected map_reader adoption {bool(adopted)}")
        else:
            stored = sanitize(json.loads(effect.Json()), path_names)
        for k in STRIP:
            stored.pop(k, None)
        out_cases[name] = {"type": etype, "input": inp, "effect": stored, "results": results}

    doc = {
        "libopenshot": openshot.OPENSHOT_VERSION_FULL,
        "qt": qVersion(),
        "inputs": {k: {"width": w, "height": h, "data": base64.b64encode(bytes(d)).decode("ascii")} for k, (w, h, d) in inputs.items()},
        "cases": out_cases,
    }
    with open(OUT, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
        fh.write("\n")
    size = os.path.getsize(OUT)
    print(f"wrote {len(out_cases)} cases ({size} bytes) to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
