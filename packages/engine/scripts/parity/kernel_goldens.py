#!/usr/bin/env python3
"""Golden outputs for the engine's effect kernels, from libopenshot 1.0 itself.

Each case loads a small PNG through ``openshot.QtImageReader`` (exactly how
the desktop premultiplies image pixels), runs one effect created with
``EffectInfo().CreateEffect(type)`` + ``SetJson`` through ``ProcessFrame``
(so the generic effect mask applies too), and records the frame's
premultiplied RGBA bytes. ``kernels/libopenshot-parity.test.ts`` replays every
case through the TypeScript kernels.

Run with the desktop's Python and libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/kernel_goldens.py

Writes ``packages/engine/src/render/kernels/libopenshot-goldens.json``.
"""

import base64
import json
import math
import os
import sys
import tempfile

import openshot  # noqa: E402  (needs PYTHONPATH to the libopenshot bindings)
from PyQt5.QtGui import QImage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/render/kernels/libopenshot-goldens.json"))
W, H = 24, 16


def lcg(seed):
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (state * 1103515245 + 12345) & 0xFFFFFFFF
        return (state >> 8) / 16777216.0

    return rnd


def make_inputs():
    """Straight (non-premultiplied) RGBA inputs, row-major."""
    photo = bytearray()
    for y in range(H):
        for x in range(W):
            r = int(30 + 200 * x / (W - 1))
            g = int(20 + 210 * y / (H - 1))
            b = (x * 37 + y * 11) % 256
            photo += bytes([r, g, b, 255])
    rnd = lcg(7)
    noise = bytearray()
    for _ in range(W * H):
        noise += bytes([int(rnd() * 256), int(rnd() * 256), int(rnd() * 256), 255])
    rnd = lcg(11)
    alpha = bytearray()
    for i in range(W * H):
        a = 255 if rnd() < 0.3 else int(rnd() * 256)
        alpha += bytes([int(rnd() * 256), int(rnd() * 256), int(rnd() * 256), a])
    green = bytearray()
    for y in range(H):
        for x in range(W):
            dx, dy = x - W / 2, y - H / 2
            d = math.sqrt(dx * dx * 0.6 + dy * dy)
            if d < 4:
                px = (200, 120, 90)
            elif d < 5.5:
                t = (d - 4) / 1.5
                px = (int(200 * (1 - t) + 20 * t), int(120 * (1 - t) + 235 * t), int(90 * (1 - t) + 30 * t))
            else:
                px = (20 + (x % 3) * 4, 235 - (y % 4) * 5, 30 + (x * y) % 7)
            green += bytes([px[0], px[1], px[2], 255])
    mask = bytearray()
    for y in range(H):
        for x in range(W):
            v = int(255 * (x + y) / (W + H - 2))
            mask += bytes([v, v, v, 255])
    return {"photo": photo, "noise": noise, "alpha": alpha, "green": green, "mask": mask}


def kf(v):
    return {"Points": [{"co": {"X": 1.0, "Y": float(v)}, "interpolation": 1}]}


def color(r, g, b, a=255):
    return {"red": kf(r), "green": kf(g), "blue": kf(b), "alpha": kf(a)}


# (name, type, input, frame, keyframe params, plain params, color params, mask)
CASES = [
    ("brightness-default", "Brightness", "photo", 1, {}, {}, {}, None),
    ("brightness-up", "Brightness", "photo", 1, {"brightness": 0.3, "contrast": -40}, {}, {}, None),
    ("brightness-down-alpha", "Brightness", "alpha", 1, {"brightness": -0.5, "contrast": 100}, {}, {}, None),
    ("saturation-gray", "Saturation", "photo", 1, {"saturation": 0}, {}, {}, None),
    ("saturation-boost-alpha", "Saturation", "alpha", 1, {"saturation": 2.5}, {}, {}, None),
    ("saturation-channels", "Saturation", "noise", 1, {"saturation_R": 0, "saturation_G": 1.5, "saturation_B": 3}, {}, {}, None),
    ("hue-quarter", "Hue", "photo", 1, {"hue": 0.25}, {}, {}, None),
    ("hue-alpha", "Hue", "alpha", 1, {"hue": 0.62}, {}, {}, None),
    ("negate", "Negate", "photo", 1, {}, {}, {}, None),
    ("negate-alpha", "Negate", "alpha", 1, {}, {}, {}, None),
    ("blur-default", "Blur", "photo", 1, {}, {}, {}, None),
    ("blur-horizontal-alpha", "Blur", "alpha", 1, {"horizontal_radius": 2, "vertical_radius": 0, "iterations": 1}, {}, {}, None),
    ("blur-margins", "Blur", "noise", 1, {"left": 0.2, "top": 0.1, "right": 0.3, "horizontal_radius": 3, "vertical_radius": 2}, {}, {}, None),
    ("pixelate-default", "Pixelate", "photo", 1, {}, {}, {}, None),
    ("pixelate-strong-alpha", "Pixelate", "alpha", 1, {"pixelization": 0.9}, {}, {}, None),
    ("pixelate-zero-alpha", "Pixelate", "alpha", 1, {"pixelization": 0}, {}, {}, None),
    ("pixelate-margins", "Pixelate", "noise", 1, {"pixelization": 0.6, "left": 0.25, "bottom": 0.3}, {}, {}, None),
    ("crop-margins", "Crop", "photo", 1, {"left": 0.1, "top": 0.2, "right": 0.15, "bottom": 0.05}, {}, {}, None),
    ("crop-shift", "Crop", "noise", 1, {"left": 0.1, "right": 0.3, "x": 0.1, "y": -0.2}, {}, {}, None),
    ("crop-resize", "Crop", "photo", 1, {"left": 0.125, "top": 0.25, "right": 0.25}, {"resize": True}, {}, None),
    ("shift-xy", "Shift", "noise", 1, {"x": 0.25, "y": -0.4}, {}, {}, None),
    ("shift-neg", "Shift", "photo", 1, {"x": -0.33}, {}, {}, None),
    ("colorshift", "ColorShift", "photo", 1, {"red_x": 0.1, "blue_y": -0.2, "alpha_x": 0.05, "green_x": -0.5}, {}, {}, None),
    ("wave-frame1", "Wave", "photo", 1, {}, {}, {}, None),
    ("wave-frame30", "Wave", "noise", 30, {"amplitude": 0.8, "multiplier": 0.4}, {}, {}, None),
    ("deinterlace-odd", "Deinterlace", "noise", 1, {}, {"isOdd": True}, {}, None),
    ("deinterlace-even", "Deinterlace", "noise", 1, {}, {"isOdd": False}, {}, None),
    ("bars-default", "Bars", "photo", 1, {}, {}, {}, None),
    ("bars-color", "Bars", "noise", 1, {"left": 0.1, "right": 0.2, "top": 0.05, "bottom": 0.15}, {}, {"color": (200, 30, 60, 128)}, None),
    ("chromakey-soft", "ChromaKey", "green", 1, {"fuzz": 80, "halo": 40}, {"keymethod": 11}, {"color": (0, 255, 0)}, None),
    ("chromakey-basic", "ChromaKey", "green", 1, {"fuzz": 90}, {"keymethod": 0}, {"color": (0, 255, 0)}, None),
    ("chromakey-method5-as-soft", "ChromaKey", "green", 1, {"fuzz": 60, "halo": 60}, {"keymethod": 5}, {"color": (20, 230, 30)}, None),
    ("chromakey-default-black", "ChromaKey", "alpha", 1, {}, {}, {}, None),
    ("sharpen-default", "Sharpen", "photo", 1, {}, {}, {}, None),
    ("sharpen-highpass-all", "Sharpen", "noise", 1, {"amount": 4, "radius": 12}, {"mode": 1, "channel": 0}, {}, None),
    ("sharpen-threshold-chroma", "Sharpen", "photo", 1, {"amount": 20, "threshold": 0.4}, {"channel": 2}, {}, None),
    ("mask-effect", "Mask", "photo", 1, {"brightness": 0.2, "contrast": 3}, {}, {}, "mask"),
    ("mask-invert-alpha", "Mask", "alpha", 1, {"brightness": -0.3, "contrast": 8}, {"mask_invert": True}, {}, "mask"),
    ("mask-replace", "Mask", "photo", 1, {"brightness": 0.1, "contrast": 1}, {"replace_image": True}, {}, "mask"),
    ("effect-mask-brightness", "Brightness", "photo", 1, {"brightness": 0.5, "contrast": 20}, {}, {}, "mask"),
    ("effect-mask-vary-strength", "Saturation", "photo", 1, {"saturation": 0}, {"mask_mode": 1, "mask_invert": True}, {}, "mask"),
    ("effect-mask-blur", "Blur", "noise", 1, {"horizontal_radius": 3, "vertical_radius": 3, "iterations": 2}, {"mask_mode": 1}, {}, "mask"),
]


def save_png(path, straight):
    img = QImage(bytes(straight), W, H, W * 4, QImage.Format_RGBA8888)
    if not img.copy().save(path, "PNG"):
        raise RuntimeError(f"could not write {path}")


def main():
    work = tempfile.mkdtemp(prefix="zenvi-kernel-goldens-")
    inputs = make_inputs()
    paths = {}
    for name, data in inputs.items():
        paths[name] = os.path.join(work, f"{name}.png")
        save_png(paths[name], data)

    out_cases = {}
    for name, etype, inp, frame_no, kfs, plain, colors, mask in CASES:
        reader = openshot.QtImageReader(paths[inp])
        reader.Open()
        frame = reader.GetFrame(1)
        effect = openshot.EffectInfo().CreateEffect(etype)
        if effect is None:
            raise RuntimeError(f"unknown effect {etype}")
        j = json.loads(effect.Json())
        for k, v in kfs.items():
            j[k] = kf(v)
        for k, v in plain.items():
            j[k] = v
        for k, v in colors.items():
            j[k] = color(*v)
        if mask:
            mask_reader = openshot.QtImageReader(paths[mask])
            j["mask_reader"] = json.loads(mask_reader.Json())
        effect.SetJson(json.dumps(j))
        result = effect.ProcessFrame(frame, frame_no)
        pixels = result.GetPixelsBytes()
        out_cases[name] = {
            "type": etype,
            "input": inp,
            "frame": frame_no,
            "keyframes": kfs,
            "plain": plain,
            "colors": {k: list(v) for k, v in colors.items()},
            "mask": mask,
            "width": result.GetWidth(),
            "height": result.GetHeight(),
            "data": base64.b64encode(bytes(pixels)).decode("ascii"),
        }
        reader.Close()

    doc = {
        "libopenshot": openshot.OPENSHOT_VERSION_FULL,
        "size": [W, H],
        "inputs": {k: base64.b64encode(bytes(v)).decode("ascii") for k, v in inputs.items()},
        "cases": out_cases,
    }
    with open(OUT, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    print(f"wrote {len(out_cases)} cases to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
