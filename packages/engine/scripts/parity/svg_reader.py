#!/usr/bin/env python3
"""SVG files as Zenvi desktop draws them: libopenshot 1.0's QtImageReader
(Qt's SVG renderer, the reader of every SVG title clip).

For each SVG, writes ``<out>/<stem>.rgba`` (straight RGBA, the SVG's own
size) and prints one JSON line per file with its path and size. Used by
render-node's outline parity check (``src/svg/outline-parity.test.ts``,
``scripts/outline-parity.ts``).

Run with the desktop's Python and the libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/svg_reader.py OUT_DIR a.svg b.svg
"""

import json
import os
import sys

import openshot
from PyQt5.QtGui import QGuiApplication


def unpremultiply(data):
    out = bytearray(data)
    for i in range(0, len(out), 4):
        a = out[i + 3]
        if 0 < a < 255:
            for c in range(3):
                out[i + c] = min(255, (out[i + c] * 255 + a // 2) // a)
    return bytes(out)


def main():
    # Qt draws SVG text through QFont, which needs an application (the desktop has one).
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    app = QGuiApplication([])  # noqa: F841
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for svg in sys.argv[2:]:
        reader = openshot.QtImageReader(svg)
        reader.Open()
        frame = reader.GetFrame(1)
        # Frame images are RGBA8888 premultiplied (Frame.cpp).
        data = unpremultiply(frame.GetPixelsBytes())
        reader.Close()
        stem = os.path.splitext(os.path.basename(svg))[0]
        path = os.path.join(out, f"{stem}.rgba")
        with open(path, "wb") as fh:
            fh.write(data)
        print(json.dumps({"svg": svg, "path": path, "width": frame.GetWidth(), "height": frame.GetHeight()}), flush=True)


if __name__ == "__main__":
    main()
