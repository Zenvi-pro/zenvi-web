"""Golden outputs for the ColorMap, ColorGrade, FilmGrain and DenoiseImage kernels.

Every case starts from a fresh effect's own ``Json()`` (stored once per type
under ``defaults``), applies a JSON merge patch (RFC 7386: objects merge,
``null`` deletes a key, anything else replaces), and hands the result to
``SetJson``. ``kernels/color-kernels.test.ts`` rebuilds the same JSON,
evaluates it with ``evaluateEffectParams`` and replays each step through the
TypeScript kernels. A case runs one or more steps on the SAME effect instance
(DenoiseImage's temporal blend needs frames n, n+1, ...). A step whose output
equals its input is stored as ``"unchanged": true`` instead of the bytes.

Inputs are PNGs loaded through ``openshot.QtImageReader`` (how the desktop
premultiplies stills); the fixture stores the premultiplied bytes the effect
received, so the test does not depend on the premultiply port. ``.cube`` files
are written byte for byte as stored under ``texts`` and referenced by name.

Run with the desktop's Python and libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/kernel_goldens_color.py

Writes ``packages/engine/src/render/kernels/color-goldens.json``.
"""

import base64
import copy
import json
import math
import os
import shutil
import sys
import tempfile

import openshot  # needs PYTHONPATH to the libopenshot bindings
from PyQt5.QtGui import QImage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/render/kernels/color-goldens.json"))


def lcg(seed):
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (state * 1103515245 + 12345) & 0xFFFFFFFF
        return (state >> 8) / 16777216.0

    return rnd


# ---------------------------------------------------------------------------
# Inputs: straight RGBA, row-major
# ---------------------------------------------------------------------------


def img_photo(w, h):
    out = bytearray()
    for y in range(h):
        for x in range(w):
            r = int(20 + 215 * x / (w - 1))
            g = int(10 + 230 * y / (h - 1))
            b = (x * 37 + y * 11) % 256
            out += bytes([r, g, b, 255])
    return out


def img_ramp(w, h):
    """Opaque; every byte value on every channel, in varied combinations."""
    out = bytearray()
    for i in range(w * h):
        out += bytes([i % 256, (i * 37 + 11) % 256, (i * 101 + 29) % 256, 255])
    return out


def img_alpha(w, h, seed):
    """Random colors; ~25% opaque, a few fully transparent, the rest random alpha."""
    rnd = lcg(seed)
    out = bytearray()
    for i in range(w * h):
        roll = rnd()
        a = 255 if roll < 0.25 else 0 if roll < 0.3 else 1 + int(rnd() * 254)
        out += bytes([int(rnd() * 256), int(rnd() * 256), int(rnd() * 256), a])
    return out


def img_noisy(w, h, seed, square_x, alpha=False):
    """A smooth scene with per-frame noise and a bright square at `square_x` (motion)."""
    rnd = lcg(seed)
    out = bytearray()
    for y in range(h):
        for x in range(w):
            base = (60 + 120 * x / (w - 1), 90 + 60 * y / (h - 1), 140 - 70 * x / (w - 1))
            if square_x <= x < square_x + 6 and 4 <= y < 10:
                base = (230, 200, 60)
            px = [max(0, min(255, int(c + (rnd() - 0.5) * 50))) for c in base]
            a = 255
            if alpha:
                a = 255 if (x + y) % 5 else 90 + (x * 13 + y * 7) % 150
            out += bytes(px + [a])
    return out


INPUT_SPECS = {
    "photo": (32, 24, lambda: img_photo(32, 24)),
    "ramp": (32, 24, lambda: img_ramp(32, 24)),
    "alpha": (32, 24, lambda: img_alpha(32, 24, 11)),
    "photo-small": (24, 16, lambda: img_photo(24, 16)),
    "alpha-small": (24, 16, lambda: img_alpha(24, 16, 29)),
    "seq1": (24, 16, lambda: img_noisy(24, 16, 101, 4)),
    "seq2": (24, 16, lambda: img_noisy(24, 16, 102, 5)),
    "seq3": (24, 16, lambda: img_noisy(24, 16, 103, 9)),
    "seqa1": (24, 16, lambda: img_noisy(24, 16, 201, 3, alpha=True)),
    "seqa2": (24, 16, lambda: img_noisy(24, 16, 202, 3, alpha=True)),
    "seqa3": (24, 16, lambda: img_noisy(24, 16, 203, 4, alpha=True)),
}


# ---------------------------------------------------------------------------
# .cube files (exact text; the kernels read them from KernelContext.texts)
# ---------------------------------------------------------------------------


def fmt(v):
    return f"{v:.6f}".rstrip("0").rstrip(".") if v != 0 else "0"


def cube_3d_size5():
    lines = [
        "# Zenvi parity LUT: 5^3, domain lines before the size, an INPUT_RANGE quirk line after it",
        'TITLE "Zenvi warm fade"',
        "DOMAIN_MIN 0 0 0",
        "DOMAIN_MAX 1 1 1",
        "LUT_3D_SIZE 5",
        # libopenshot reads this as the first data triple (0, 0, 1): every entry shifts by one.
        "LUT_3D_INPUT_RANGE 0 1",
        "",
    ]
    n = 5
    for b in range(n):
        for g in range(n):
            for r in range(n):
                rf, gf, bf = r / (n - 1), g / (n - 1), b / (n - 1)
                out = (
                    min(1.0, rf ** 0.8 * 0.92 + 0.06 * gf + 0.02),
                    gf * 0.85 + 0.12 * bf * bf + 0.01,
                    bf ** 1.3 * 0.9 + 0.05 * rf,
                )
                lines.append(" ".join(fmt(v) for v in out))
    return "\n".join(lines) + "\n"


def cube_3d_size3_domain():
    """Size 3, domain after the size line, CRLF line endings, comments inside the data."""
    lines = ["LUT_3D_SIZE 3", "DOMAIN_MIN 0.1 0.05 0", "DOMAIN_MAX 0.9 1 1.25"]
    n = 3
    k = 0
    for b in range(n):
        for g in range(n):
            for r in range(n):
                if k == 13:
                    lines.append("# halfway")
                    lines.append("")
                rf, gf, bf = r / (n - 1), g / (n - 1), b / (n - 1)
                lines.append(f"{fmt(1.0 - rf * 0.8)} {fmt(gf * gf)} {fmt(0.3 + 0.5 * bf * rf)}")
                k += 1
    return "\r\n".join(lines) + "\r\n"


def cube_1d_size9():
    """1D, odd numeric tokens, and a DOMAIN_MAX after the data (only the failed 3D pass sees it)."""
    lines = ["# 1D curve", "LUT_1D_SIZE 9"]
    tokens = [
        ("0", "0.02", ".05"),
        ("0.2", "+0.1", "0.08"),
        ("0.35", "0.22", "1.5e-1"),
        ("0.5", "0.33", "0.25"),
        ("0.62", "0.45", "0.4"),
        ("0.73", "0.58", "0.55"),
        ("0.84", "0.7", "0.7"),
        ("0.93", "0.84", "0.86"),
        ("1.", "0.97", "1"),
    ]
    for t in tokens:
        lines.append(" ".join(t))
    lines.append("DOMAIN_MAX 1.1 1 0.9")
    return "\n".join(lines)  # no trailing newline


def cube_1d_size1():
    return "LUT_1D_SIZE 1\n0.8 0.4 0.1\n"


def cube_bad():
    lines = ["LUT_3D_SIZE 3"] + ["0.5 0.5 0.5"] * 20
    return "\n".join(lines) + "\n"


TEXTS = {
    "warm5.cube": cube_3d_size5(),
    "domain3.cube": cube_3d_size3_domain(),
    "curve9-1d.cube": cube_1d_size9(),
    "flat1-1d.cube": cube_1d_size1(),
    "bad.cube": cube_bad(),
}


# ---------------------------------------------------------------------------
# Keyframe / curve helpers for patches
# ---------------------------------------------------------------------------


def kf(v):
    return {"Points": [{"co": {"X": 1.0, "Y": float(v)}, "interpolation": 1}]}


def kf_anim(points, interpolation=0):
    return {"Points": [{"co": {"X": float(x), "Y": float(y)}, "interpolation": interpolation} for x, y in points]}


def color_kf(r, g, b, a=255):
    return {"red": kf(r), "green": kf(g), "blue": kf(b), "alpha": kf(a)}


def curve(points, enabled=1.0, interpolation=1, handles=None):
    nodes = []
    for i, (x, y) in enumerate(points):
        node = {"id": i, "x": kf(x), "y": kf(y), "interpolation": interpolation, "handle_type": 0}
        if handles:
            lx, ly, rx, ry = handles
            node.update({"left_handle_x": kf(lx), "left_handle_y": kf(ly), "right_handle_x": kf(rx), "right_handle_y": kf(ry)})
        nodes.append(node)
    return {"enabled": kf(enabled), "nodes": nodes}


def merge_patch(target, patch):
    if not isinstance(patch, dict):
        return copy.deepcopy(patch)
    out = copy.deepcopy(target) if isinstance(target, dict) else {}
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        else:
            out[k] = merge_patch(out.get(k), v)
    return out


# ---------------------------------------------------------------------------
# Cases: (name, type, patch, steps [(input, frame)], timeline size or None)
# ---------------------------------------------------------------------------

NEUTRAL_GRADE = {
    "wheels": {"enabled": False},
    "curve_all": {"enabled": kf(0)},
    "curve_red": {"enabled": kf(0)},
    "curve_green": {"enabled": kf(0)},
    "curve_blue": {"enabled": kf(0)},
}

CASES = [
    # --- ColorMap -----------------------------------------------------------
    ("colormap-3d-ramp", "ColorMap", {"lut_path": "warm5.cube"}, [("ramp", 1)], None),
    ("colormap-3d-alpha", "ColorMap", {"lut_path": "warm5.cube"}, [("alpha", 1)], None),
    (
        "colormap-3d-intensities-alpha",
        "ColorMap",
        {"lut_path": "warm5.cube", "intensity": kf(0.6), "intensity_r": kf(0.3), "intensity_b": kf(0.85)},
        [("alpha", 1)],
        None,
    ),
    ("colormap-3d-domain-crlf", "ColorMap", {"lut_path": "domain3.cube"}, [("ramp", 1)], None),
    ("colormap-3d-domain-alpha", "ColorMap", {"lut_path": "domain3.cube", "intensity": kf(0.75)}, [("alpha", 1)], None),
    ("colormap-1d-ramp", "ColorMap", {"lut_path": "curve9-1d.cube"}, [("ramp", 1)], None),
    ("colormap-1d-alpha", "ColorMap", {"lut_path": "curve9-1d.cube", "intensity_g": kf(0.5)}, [("alpha", 1)], None),
    ("colormap-1d-size1", "ColorMap", {"lut_path": "flat1-1d.cube", "intensity": kf(0.5)}, [("photo", 1)], None),
    ("colormap-intensity0-alpha", "ColorMap", {"lut_path": "warm5.cube", "intensity": kf(0)}, [("alpha", 1)], None),
    ("colormap-bad-lut", "ColorMap", {"lut_path": "bad.cube"}, [("alpha", 1)], None),
    ("colormap-missing-lut", "ColorMap", {"lut_path": "missing.cube"}, [("alpha", 1)], None),
    (
        "colormap-animated-intensity",
        "ColorMap",
        {"lut_path": "warm5.cube", "intensity": kf_anim([(1, 0.1), (20, 0.9)], interpolation=0)},
        [("alpha", 7)],
        None,
    ),
    # --- ColorGrade ---------------------------------------------------------
    ("colorgrade-default-ramp", "ColorGrade", {}, [("ramp", 1)], None),
    ("colorgrade-default-alpha", "ColorGrade", {}, [("alpha", 1)], None),
    ("colorgrade-neutral-identity", "ColorGrade", NEUTRAL_GRADE, [("alpha", 1)], None),
    ("colorgrade-fast-path-lut", "ColorGrade", merge_patch(NEUTRAL_GRADE, {"lut_path": "warm5.cube", "lut_intensity": kf(0.7)}), [("alpha", 1)], None),
    (
        "colorgrade-basic-ramp",
        "ColorGrade",
        {
            "temperature": kf(0.35),
            "tint": kf(-0.4),
            # -0.08 is one of the exposures where macOS exp2f is not correctly rounded.
            "exposure": kf(-0.08),
            "contrast": kf(0.3),
            "highlights": kf(-0.45),
            "shadows": kf(0.5),
            "saturation": kf(1.35),
            "vibrance": kf(0.4),
        },
        [("ramp", 1)],
        None,
    ),
    (
        "colorgrade-basic-alpha",
        "ColorGrade",
        {
            "temperature": kf(-0.6),
            "tint": kf(0.25),
            "exposure": kf(0.457),
            "contrast": kf(-0.35),
            "highlights": kf(0.3),
            "shadows": kf(-0.2),
            "saturation": kf(0.6),
            "vibrance": kf(-0.5),
            "mix": kf(0.8),
        },
        [("alpha", 1)],
        None,
    ),
    (
        "colorgrade-extreme-clamps",
        "ColorGrade",
        {
            "temperature": kf(1.7),
            "tint": kf(-3),
            "exposure": kf(6),
            "contrast": kf(2.8),
            "highlights": kf(-1.4),
            "shadows": kf(2),
            "saturation": kf(5),
            "vibrance": kf(-1.5),
            "mix": kf(1.4),
        },
        [("photo", 1)],
        None,
    ),
    (
        "colorgrade-wheels-keyframes",
        "ColorGrade",
        {
            "wheels": {
                "enabled": None,
                "enabled_keyframes": kf(1),
                # amount/luma keyframes win over the scalar keys next to them.
                "global": {"color_keyframes": color_kf(255, 190, 120), "amount_keyframes": kf(0.5), "amount": 0.9, "luma_keyframes": kf(0.04)},
                "shadows": {"color_keyframes": color_kf(40, 90, 255), "amount_keyframes": kf(0.8), "luma_keyframes": kf(-0.1)},
                "midtones": {"color_keyframes": color_kf(120, 255, 140), "amount_keyframes": kf(0.6)},
                "highlights": {"color_keyframes": color_kf(255, 120, 200), "amount_keyframes": kf(0.7), "luma_keyframes": kf(0.08)},
            }
        },
        [("ramp", 1)],
        None,
    ),
    (
        "colorgrade-wheels-scalars-alpha",
        "ColorGrade",
        {
            "wheels": {
                "global": {"color_keyframes": None, "color": "#ffd0a0", "amount_keyframes": None, "amount": 1.7, "luma_keyframes": None, "luma": -0.05},
                "shadows": {"color_keyframes": None, "color": "#48f", "amount_keyframes": None, "amount": 0.6},
                "midtones": {"color_keyframes": None, "color": "mediumseagreen", "amount_keyframes": None, "amount": -0.4, "luma_keyframes": None, "luma": 0.03},
                "highlights": {"color_keyframes": None, "color": "#80ff00ff", "amount_keyframes": None, "amount": 0.5},
            }
        },
        [("alpha", 1)],
        None,
    ),
    (
        "colorgrade-wheels-disabled-bool",
        "ColorGrade",
        {
            # A boolean `enabled` beats enabled_keyframes (ColorGrade.cpp:155-158).
            "wheels": {"enabled": False, "enabled_keyframes": kf(1), "global": {"color_keyframes": color_kf(255, 0, 0), "amount_keyframes": kf(1)}},
            "temperature": kf(0.2),
        },
        [("photo", 1)],
        None,
    ),
    (
        "colorgrade-wheels-disabled-keyframe",
        "ColorGrade",
        {
            "wheels": {"enabled": None, "enabled_keyframes": kf(0.2), "global": {"color_keyframes": color_kf(255, 0, 0), "amount_keyframes": kf(1)}},
            "saturation": kf(1.2),
        },
        [("photo", 1)],
        None,
    ),
    (
        "colorgrade-curves-ramp",
        "ColorGrade",
        {
            "curve_all": curve([(0, 0.05), (0.3, 0.22), (0.7, 0.85), (1, 0.97)]),
            "curve_red": curve([(0, 0), (0.5, 0.62), (1, 1)], interpolation=0, handles=(0.3, 0.9, 0.6, 0.2)),
            "curve_green": curve([(0, 0.1), (1, 0.9)], enabled=0),
            "curve_blue": curve([(1, 0.8), (0, 0.2), (0.4, 0.4)]),
        },
        [("ramp", 1)],
        None,
    ),
    (
        "colorgrade-curves-alpha-mix",
        "ColorGrade",
        {
            "curve_all": curve([(0, 0.1), (0.5, 0.4), (1, 1)], interpolation=0),
            "curve_blue": curve([(0, 0), (0.5, 0.7), (1, 1)]),
            "mix": kf(0.55),
            "exposure": kf(0.3),
        },
        [("alpha", 1)],
        None,
    ),
    (
        "colorgrade-full-lut",
        "ColorGrade",
        {
            "temperature": kf(0.1),
            "contrast": kf(0.15),
            "vibrance": kf(0.3),
            "lut_path": "domain3.cube",
            "lut_intensity": kf(0.65),
            "curve_all": curve([(0, 0), (0.25, 0.2), (0.75, 0.82), (1, 1)]),
        },
        [("alpha", 1)],
        None,
    ),
    (
        "colorgrade-lut-intensity-zero",
        "ColorGrade",
        {"lut_path": "warm5.cube", "lut_intensity": kf(0), "tint": kf(0.1)},
        [("photo", 1)],
        None,
    ),
    (
        "colorgrade-animated",
        "ColorGrade",
        {
            "temperature": kf_anim([(1, -0.5), (30, 0.5)], interpolation=0),
            "exposure": kf_anim([(1, 0), (30, 1.5)], interpolation=1),
            "curve_all": {"enabled": kf_anim([(1, 1), (10, 0)], interpolation=1), "nodes": curve([(0, 0.2), (1, 0.8)])["nodes"]},
        },
        [("photo", 5)],
        None,
    ),
    # --- FilmGrain ----------------------------------------------------------
    ("filmgrain-default-sequence", "FilmGrain", {"id": "GRAIN-A1"}, [("photo-small", 1), ("photo-small", 2), ("photo-small", 3)], None),
    ("filmgrain-default-alpha", "FilmGrain", {"id": "GRAIN-A1"}, [("alpha-small", 7)], None),
    (
        "filmgrain-color-strong",
        "FilmGrain",
        {"id": "fg-été", "amount": kf(0.9), "size": kf(0.05), "color_amount": kf(0.8), "color_variation": kf(0.9), "seed": 4242},
        [("photo", 10), ("alpha", 11)],
        None,
    ),
    (
        "filmgrain-mono-coarse",
        "FilmGrain",
        {"id": "GRAIN-B", "amount": kf(0.7), "size": kf(0.85), "softness": kf(0.6), "clump": kf(0.75), "color_amount": kf(0)},
        [("photo-small", 4), ("photo-small", 5)],
        None,
    ),
    (
        "filmgrain-no-soft-no-clump",
        "FilmGrain",
        {"id": "GRAIN-C", "softness": kf(0), "clump": kf(0), "color_variation": kf(0), "amount": kf(0.5)},
        [("photo-small", 3)],
        None,
    ),
    (
        "filmgrain-static",
        "FilmGrain",
        {"id": "GRAIN-D", "evolution": kf(0), "shadows": kf(0.2), "highlights": kf(1)},
        [("photo-small", 9)],
        None,
    ),
    ("filmgrain-refscale-2x", "FilmGrain", {"id": "GRAIN-E", "amount": kf(0.6)}, [("photo-small", 2), ("photo-small", 3)], (48, 32)),
    ("filmgrain-refscale-uneven", "FilmGrain", {"id": "GRAIN-E", "size": kf(0.5), "seed": 7}, [("alpha-small", 20)], (1920, 1080)),
    ("filmgrain-amount-zero", "FilmGrain", {"id": "GRAIN-F", "amount": kf(0)}, [("photo-small", 1)], None),
    # --- DenoiseImage -------------------------------------------------------
    ("denoise-default-sequence", "DenoiseImage", {}, [("seq1", 5), ("seq2", 6), ("seq3", 7)], None),
    ("denoise-gap-resets", "DenoiseImage", {}, [("seq1", 5), ("seq2", 7), ("seq3", 8)], None),
    (
        "denoise-strong-alpha-sequence",
        "DenoiseImage",
        {"strength": kf(1), "detail": kf(0.1), "temporal": kf(0.9), "motion_safety": kf(0.2), "color_noise": kf(1)},
        [("seqa1", 1), ("seqa2", 2), ("seqa3", 3)],
        None,
    ),
    (
        "denoise-radius6",
        "DenoiseImage",
        {"strength": kf(0.85), "detail": kf(0.3), "temporal": kf(0.6), "motion_safety": kf(1)},
        [("seq2", 10), ("seq3", 11)],
        None,
    ),
    ("denoise-radius5-photo", "DenoiseImage", {"strength": kf(0.7), "detail": kf(0.55)}, [("photo", 1)], None),
    ("denoise-radius3-alpha", "DenoiseImage", {"strength": kf(0.5), "detail": kf(0.8), "color_noise": kf(0.2)}, [("alpha", 1)], None),
    ("denoise-temporal-off", "DenoiseImage", {"temporal": kf(0)}, [("seq1", 1), ("seq2", 2)], None),
    (
        "denoise-temporal-toggles",
        "DenoiseImage",
        # temporal 0 at frame 2 clears the history, so frame 3 cannot blend; frame 4 can.
        {"temporal": kf_anim([(1, 0.5), (2, 0), (3, 0.5)], interpolation=2)},
        [("seq1", 1), ("seq2", 2), ("seq3", 3), ("seq1", 4)],
        None,
    ),
    (
        "denoise-strength-zero-resets",
        "DenoiseImage",
        {"strength": kf_anim([(1, 0.8), (2, 0), (3, 0.8)], interpolation=2)},
        [("seq1", 1), ("seq2", 2), ("seq3", 3), ("seq1", 4)],
        None,
    ),
    (
        "denoise-custom-curve",
        "DenoiseImage",
        {"response_curve": curve([(0, 0.2), (0.4, 1), (1, 0.6)]), "temporal": kf(1)},
        [("seq3", 1), ("seq1", 2)],
        None,
    ),
    ("denoise-curve-disabled", "DenoiseImage", {"response_curve": {"enabled": kf(0)}}, [("seq2", 1), ("seq3", 2)], None),
    # No `nodes` key: libopenshot keeps DenoiseImage's own default nodes (DenoiseImage.cpp:310-313).
    ("denoise-curve-no-nodes", "DenoiseImage", {"response_curve": {"nodes": None, "enabled": kf(0.8)}}, [("seq1", 1)], None),
    ("denoise-size-change", "DenoiseImage", {}, [("seq1", 1), ("photo", 2), ("photo", 3)], None),
]


# Inputs for the helper vectors (`vectors` in the fixture).
QT_NUMBER_TOKENS = [
    "0.5", ".5", "5.", "+0.25", "-0.5", "1e-3", "1E-3", "1.5e+2", "-.5e1", "00.5", "abc", "", "0x10", "1.2.3",
    "e5", "1e", ".", "inf", "+inf", "-inf", "INF", "nan", "NaN", "-nan", "Infinity", "1,5", "\u22120.5", "1e40",
    "1e-50", "3.4028235e38", "0.1f", "0.5\u00a0", "17", "+17", "-3", "033", "2147483648", "33abc",
]
QCOLOR_NAMES = [
    "#48f", "#FFF", "#80ff00ff", "#ffd0a0", "#123456789", "#123456789abc", "mediumseagreen", "Medium Sea Green",
    "RED", "transparent", "#fff1", "", "notacolor", "#ggg", "#12345", "#1234567890abcd",
]


def number_json(v):
    if math.isnan(v):
        return "nan"
    if math.isinf(v):
        return "inf" if v > 0 else "-inf"
    return v


def helper_vectors():
    """Reference values from macOS libm exp2f and Qt (QLocale::c() parses like QString::toFloat/toInt)."""
    import ctypes
    import random
    import struct

    from PyQt5.QtCore import QLocale
    from PyQt5.QtGui import QColor

    libm = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
    libm.exp2f.restype = ctypes.c_float
    libm.exp2f.argtypes = [ctypes.c_float]

    def f32(x):
        return struct.unpack("<f", struct.pack("<f", x))[0]

    rnd = random.Random(1)
    xs = [f32(v / 1000) for v in range(-4000, 4001, 101)] + [f32(rnd.uniform(-4, 4)) for _ in range(120)]
    # Exposures where libm exp2f is not correctly rounded (it differs from f32(2.0 ** x)).
    xs += [f32(v) for v in (-0.08, 0.457, -1.908, -0.482, 0.155, 0.717, 1.427, -3.908, 3.761)]
    exp2f = []
    for x in xs:
        y = libm.exp2f(x)
        exp2f.append([x, y, y != f32(2.0 ** x)])
    loc = QLocale.c()
    floats = {t: number_json(loc.toFloat(t)[0]) for t in QT_NUMBER_TOKENS}
    ints = {t: loc.toInt(t)[0] for t in QT_NUMBER_TOKENS}
    colors = {}
    for name in QCOLOR_NAMES:
        q = QColor(name)
        colors[name] = [q.red(), q.green(), q.blue(), q.alpha()] if q.isValid() else None
    return {"exp2f": exp2f, "qtToFloat": floats, "qtToInt": ints, "qcolor": colors}


def save_png(path, straight, w, h):
    img = QImage(bytes(straight), w, h, w * 4, QImage.Format_RGBA8888)
    if not img.copy().save(path, "PNG"):
        raise RuntimeError(f"could not write {path}")


def b64(data):
    return base64.b64encode(bytes(data)).decode("ascii")


def main():
    work = tempfile.mkdtemp(prefix="zenvi-color-goldens-")
    try:
        paths = {}
        for name, (w, h, make) in INPUT_SPECS.items():
            paths[name] = os.path.join(work, f"{name}.png")
            save_png(paths[name], make(), w, h)
        for name, text in TEXTS.items():
            with open(os.path.join(work, name), "w", newline="", encoding="utf-8") as fh:
                fh.write(text)

        def load(name):
            reader = openshot.QtImageReader(paths[name])
            reader.Open()
            frame = reader.GetFrame(1)
            return reader, frame

        inputs = {}
        for name, (w, h, _) in INPUT_SPECS.items():
            reader, frame = load(name)
            inputs[name] = {"width": frame.GetWidth(), "height": frame.GetHeight(), "data": b64(frame.GetPixelsBytes())}
            reader.Close()

        defaults = {}
        for t in sorted({c[1] for c in CASES}):
            j = json.loads(openshot.EffectInfo().CreateEffect(t).Json())
            j["id"] = "E1"
            defaults[t] = j

        out_cases = {}
        timelines = []
        for name, etype, patch, steps, timeline_size in CASES:
            effect_json = merge_patch(defaults[etype], patch)
            disk_json = copy.deepcopy(effect_json)
            if disk_json.get("lut_path"):
                disk_json["lut_path"] = os.path.join(work, disk_json["lut_path"])
            effect = openshot.EffectInfo().CreateEffect(etype)
            effect.SetJson(json.dumps(disk_json))
            context = {}
            if timeline_size:
                tl = openshot.Timeline(timeline_size[0], timeline_size[1], openshot.Fraction(30, 1), 44100, 2, openshot.LAYOUT_STEREO)
                timelines.append(tl)
                effect.ParentTimeline(tl)
                context = {"timelineWidth": timeline_size[0], "timelineHeight": timeline_size[1]}
            out_steps = []
            for inp, frame_no in steps:
                reader, frame = load(inp)
                before = bytes(frame.GetPixelsBytes())
                result = effect.ProcessFrame(frame, frame_no)
                after = bytes(result.GetPixelsBytes())
                step = {"input": inp, "frame": frame_no, "width": result.GetWidth(), "height": result.GetHeight()}
                # Pass-through outputs are flagged instead of stored twice.
                if after == before:
                    step["unchanged"] = True
                else:
                    step["data"] = b64(after)
                out_steps.append(step)
                reader.Close()
            out_cases[name] = {"type": etype, "patch": patch, "context": context, "steps": out_steps}

        doc = {
            "libopenshot": openshot.OPENSHOT_VERSION_FULL,
            "generator": "packages/engine/scripts/parity/kernel_goldens_color.py",
            "inputs": inputs,
            "texts": TEXTS,
            "defaults": defaults,
            "cases": out_cases,
            "vectors": helper_vectors(),
        }
        with open(OUT, "w") as fh:
            json.dump(doc, fh, separators=(",", ":"), sort_keys=True)
            fh.write("\n")
        print(f"wrote {len(out_cases)} cases ({os.path.getsize(OUT)} bytes) to {OUT}", file=sys.stderr)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
