#!/usr/bin/env python3
"""Golden outputs for the FrameScope port (render/frame-scope.ts).

Every case loads a small PNG through ``openshot.QtImageReader`` (how the
desktop premultiplies a frame), records the frame's premultiplied RGBA bytes
(``GetPixelsBytes``) and what libopenshot 1.0's ``FrameScope`` measures on it:
the luma/red/green/blue histograms, the vectorscope, average luma and the
clipped counts, for the whole frame or a region (the calls zenvi-core's
colour tools make: editor_tools/effects_color_analysis.py ``scope_data``,
tool_handlers.py ``_framescope_from_frame``). ``render/frame-scope.test.ts``
replays the cases through ``analyzeFrameScope``.

Run with the desktop's Python and libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/frame_scope_goldens.py

Writes ``packages/engine/src/render/frame-scope-goldens.json``.
"""

import base64
import json
import os
import tempfile
import zlib

import openshot  # noqa: E402  (needs PYTHONPATH to the libopenshot bindings)
from PyQt5.QtGui import QImage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/render/frame-scope-goldens.json"))


def b64z(data):
    return base64.b64encode(zlib.compress(bytes(data), 9)).decode("ascii")


def lcg(seed):
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (state * 1103515245 + 12345) & 0xFFFFFFFF
        return (state >> 8) / 16777216.0

    return rnd


def photo(w, h):
    out = bytearray()
    for y in range(h):
        for x in range(w):
            r = int(30 + 200 * x / max(1, w - 1))
            g = int(20 + 210 * y / max(1, h - 1))
            b = (x * 37 + y * 11) % 256
            out += bytes([r, g, b, 255])
    return out


def noise(w, h, seed, alpha):
    rnd = lcg(seed)
    out = bytearray()
    for _ in range(w * h):
        a = 255 if not alpha or rnd() < 0.3 else int(rnd() * 256)
        out += bytes([int(rnd() * 256), int(rnd() * 256), int(rnd() * 256), a])
    return out


def screen(w, h):
    """A green screen with a grey subject in the middle and clipped white/black corners."""
    out = bytearray()
    for y in range(h):
        for x in range(w):
            if abs(x - w / 2) < w / 6 and abs(y - h / 2) < h / 4:
                px = (120, 118, 125)
            elif x < 3 and y < 3:
                px = (255, 255, 255)
            elif x >= w - 3 and y >= h - 3:
                px = (0, 0, 1)
            else:
                px = (20 + (x * 3) % 30, 170 + (y * 5) % 20, 50)
            out += bytes([*px, 255])
    return out


IMAGES = {
    "photo": (64, 36, photo(64, 36)),
    "noise-alpha": (23, 15, noise(23, 15, 7, True)),
    "noise": (31, 17, noise(31, 17, 3, False)),
    "screen": (60, 34, screen(60, 34)),
}

# (name, image, vectorscope size, region or None)
CASES = [
    ("photo-128", "photo", 128, None),
    ("photo-region", "photo", 128, (0.25, 0.25, 0.5, 0.5)),
    ("photo-96-edge", "photo", 96, (0.92, 0.0, 0.08, 1.0)),
    ("alpha-128", "noise-alpha", 128, None),
    ("alpha-region", "noise-alpha", 129, (0.1, 0.3, 0.6, 0.45)),
    ("noise-256", "noise", 256, None),
    ("screen-128", "screen", 128, None),
    ("screen-grid-cell", "screen", 128, (2 / 6.0, 1 / 4.0, 1 / 6.0, 1 / 4.0)),
]


def save_png(path, w, h, straight):
    img = QImage(bytes(straight), w, h, w * 4, QImage.Format_RGBA8888)
    if not img.copy().save(path, "PNG"):
        raise RuntimeError(f"could not write {path}")


def main():
    work = tempfile.mkdtemp(prefix="zenvi-scope-")
    frames = {}
    for name, (w, h, data) in IMAGES.items():
        path = os.path.join(work, f"{name}.png")
        save_png(path, w, h, data)
        reader = openshot.QtImageReader(path)
        reader.Open()
        frames[name] = reader.GetFrame(1)
    images = {name: {"width": f.GetWidth(), "height": f.GetHeight(), "premul": b64z(f.GetPixelsBytes())}
              for name, f in frames.items()}
    cases = []
    for name, image, size, region in CASES:
        scope = openshot.FrameScope()
        scope.SetVectorscopeSize(size)
        if region:
            scope.SetVideoRegionNormalized(*[float(v) for v in region])
        scope.SetFrame(frames[image])
        cases.append({
            "name": name,
            "image": image,
            "vectorscope_size": size,
            "region": list(region) if region else None,
            "width": scope.GetVideoWidth(),
            "height": scope.GetVideoHeight(),
            "avg_luma": scope.GetVideoAverageLuma(),
            "clipped_shadows": scope.GetVideoClippedShadows(),
            "clipped_highlights": scope.GetVideoClippedHighlights(),
            "luma": list(scope.GetVideoHistogramLuma()),
            "red": list(scope.GetVideoHistogramRed()),
            "green": list(scope.GetVideoHistogramGreen()),
            "blue": list(scope.GetVideoHistogramBlue()),
            "vectorscope": b64z(b"".join(int(n).to_bytes(4, "little") for n in scope.GetVideoVectorscope())),
        })
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"libopenshot": openshot.OPENSHOT_VERSION_FULL, "images": images, "cases": cases}, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
