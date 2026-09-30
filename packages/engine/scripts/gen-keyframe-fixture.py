#!/usr/bin/env python3
"""Sample libopenshot 1.0 Keyframe/Color evaluation into a JSON fixture.

Dev-time only. The engine's parity test (src/keyframe/parity.test.ts) checks
the TypeScript port against these samples. Run with the libopenshot Python
bindings on the path, e.g.:

    PYTHONPATH=~/zenvi-deps-1.0/python DYLD_LIBRARY_PATH=~/zenvi-deps-1.0/lib \
      ~/Projects/zenvi/.venv/bin/python packages/engine/scripts/gen-keyframe-fixture.py

Writes src/keyframe/__fixtures__/libopenshot-keyframes.json.
"""

import json
import math
import os
import random
import sys

import openshot

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "keyframe", "__fixtures__", "libopenshot-keyframes.json")


def point(x, y, interp=0, hl=None, hr=None):
    p = {"co": {"X": x, "Y": y}, "interpolation": interp}
    if hl is not None:
        p["handle_left"] = {"X": hl[0], "Y": hl[1]}
    if hr is not None:
        p["handle_right"] = {"X": hr[0], "Y": hr[1]}
    return p


def cases():
    rng = random.Random(20260930)
    out = [
        ("bezier-2", {"Points": [point(1, 1), point(50, 4)]}),
        ("bezier-5", {"Points": [point(1, 1), point(50, 4), point(100, 10), point(150, 0), point(200, 3)]}),
        ("linear-3", {"Points": [point(1, 1, 1), point(25, 8, 1), point(50, 2, 1)]}),
        ("constant-3", {"Points": [point(1, 1, 2), point(25, 8, 2), point(50, 2, 2)]}),
        ("delta-500", {"Points": [point(1, 500), point(400, 100), point(500, 500)]}),
        ("empty", {"Points": []}),
        ("single", {"Points": [point(1, 0.75)]}),
        ("single-late", {"Points": [point(30, 2.5, 1)]}),
        ("bare-number", 0.1),
        ("unsorted", {"Points": [point(40, 3, 1), point(1, 0, 1), point(20, 9, 1)]}),
        ("duplicate-x", {"Points": [point(1, 0, 1), point(10, 5, 1), point(10, 7, 1), point(20, 0, 1)]}),
        ("fractional-x", {"Points": [point(1, 0), point(30.969999313354492, 1), point(91.5, 0.25, 1)]}),
        ("custom-handles", {"Points": [point(1, 0, 0, hr=(0.42, 0.0)), point(60, 1, 0, hl=(0.58, 1.0))]}),
        ("ease-in-back", {"Points": [point(1, 0, 0, hr=(0.6, -0.28)), point(45, 1, 0, hl=(0.735, 0.045))]}),
        ("overshoot-handles", {"Points": [point(1, 0, 0, hr=(0.68, -0.55)), point(40, 1, 0, hl=(0.265, 1.55))]}),
        ("negative-values", {"Points": [point(1, -1), point(25, 1), point(50, -1, 1)]}),
        ("unknown-interp", {"Points": [point(1, 0, 1), point(20, 10, 7)]}),
        ("time-curve", {"Points": [point(1, 1, 1), point(121, 241, 1)]}),
        ("reverse-time", {"Points": [point(1, 240, 1), point(240, 1, 1)]}),
        ("freeze", {"Points": [point(1, 1, 1), point(31, 31, 1), point(91, 31, 1), point(151, 91, 1)]}),
    ]
    # Random multi-point curves with mixed interpolation and handles.
    for n in range(12):
        xs = sorted(rng.sample(range(1, 300), rng.randint(2, 7)))
        pts = []
        for x in xs:
            interp = rng.choice([0, 0, 1, 2])
            hl = (round(rng.uniform(0, 1), 3), round(rng.uniform(-0.5, 1.5), 3)) if rng.random() < 0.5 else None
            hr = (round(rng.uniform(0, 1), 3), round(rng.uniform(-0.5, 1.5), 3)) if rng.random() < 0.5 else None
            pts.append(point(x, round(rng.uniform(-5, 5), 4), interp, hl, hr))
        out.append((f"random-{n}", {"Points": pts}))
    return out


def frames_for(kf_json):
    """Every frame near the start and around each point, every 3rd frame elsewhere."""
    frames = set(range(-2, 12))
    xs = []
    if isinstance(kf_json, dict):
        xs = [p["co"]["X"] for p in kf_json["Points"]]
    top = int(math.ceil(max(xs))) if xs else 20
    frames.update(range(1, top + 15, 3))
    for x in xs:
        base = int(math.floor(x))
        frames.update(range(base - 2, base + 4))
    return sorted(frames)


def sample_keyframe(name, kf_json):
    kf = openshot.Keyframe()
    kf.SetJson(json.dumps(kf_json))
    samples = []
    for f in frames_for(kf_json):
        samples.append({
            "frame": f,
            "value": kf.GetValue(f),
            "int": kf.GetInt(f),
            "long": kf.GetLong(f),
            "delta": kf.GetDelta(f),
            "increasing": bool(kf.IsIncreasing(f)),
        })
    return {
        "name": name,
        "keyframe": kf_json,
        "length": kf.GetLength(),
        "count": kf.GetCount(),
        "normalized": json.loads(kf.Json()),
        "samples": samples,
    }


def sample_color():
    color = openshot.Color()
    color_json = {
        "red": {"Points": [point(1, 0, 1), point(30, 255, 1)]},
        "green": {"Points": [point(1, 128.5, 2)]},
        "blue": {"Points": [point(1, 10), point(60, 250)]},
        "alpha": {"Points": [point(1, 255)]},
    }
    color.SetJson(json.dumps(color_json))
    samples = []
    for f in [1, 2, 15, 29, 30, 31, 45, 60, 61, 100]:
        samples.append({"frame": f, "rgba": list(color.GetColorRGBA(f)), "hex": color.GetColorHex(f)})
    return {"color": color_json, "samples": samples}


def main():
    fixture = {
        "generator": "packages/engine/scripts/gen-keyframe-fixture.py",
        "libopenshot": openshot.OPENSHOT_VERSION_FULL,
        "keyframes": [sample_keyframe(n, k) for n, k in cases()],
        "color": sample_color(),
        "constructors": {
            "Keyframe(0.1)": json.loads(openshot.Keyframe(0.1).Json()),
            "Point(30.97, 0.3, BEZIER)": json.loads(openshot.Point(30.97, 0.3, openshot.BEZIER).Json()),
            "Point(5, 2, LINEAR)": json.loads(openshot.Point(5, 2, openshot.LINEAR).Json()),
            "Color(0,123,255,255)": json.loads(openshot.Color(0, 123, 255, 255).Json()),
        },
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(fixture, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    sys.exit(main())
