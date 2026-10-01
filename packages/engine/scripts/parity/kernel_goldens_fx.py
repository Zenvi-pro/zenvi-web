#!/usr/bin/env python3
"""Golden outputs for the AnalogTape, BeatSync and AudioVisualization kernels.

Every case runs the real libopenshot 1.0 effect (``EffectInfo().CreateEffect``
+ ``SetJson`` + ``ProcessFrame``) and records the frame's premultiplied RGBA
bytes (``GetPixelsBytes``). ``render/kernels/fx-kernels.test.ts`` replays the
cases through the TypeScript kernels, evaluating each stored effect JSON with
``evaluateEffectParams`` so parameter evaluation is covered too.

Inputs:

- Small PNGs loaded through ``openshot.QtImageReader`` (how the desktop
  premultiplies stills).
- Audio: ffmpeg writes a 48 kHz stereo s16 WAV (tones, chords, noise, beeps,
  silence) into a temp dir; ``openshot.FFmpegReader`` decodes it and the
  decoded float samples (exactly s16 / 32768) are copied into each test frame
  through ``Frame.ResizeAudio`` + ``GetAudioSamples`` (ctypes). The fixture
  stores the decoded samples as zlib-compressed int16.
- Effects that read a parent timeline (fps, reference size, the 1 px canvas
  fallback) get one with ``ParentTimeline(openshot.Timeline(...))``.

Run with the desktop's Python and libopenshot 1.0 bindings (needs ffmpeg)::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/kernel_goldens_fx.py

Writes ``packages/engine/src/render/kernels/fx-goldens.json``.
"""

import base64
import ctypes
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

import openshot  # noqa: E402  (needs PYTHONPATH to the libopenshot bindings)
from PyQt5.QtGui import QImage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/render/kernels/fx-goldens.json"))
SAMPLE_RATE = 48000


def b64z(data):
    return base64.b64encode(zlib.compress(bytes(data), 9)).decode("ascii")


def lcg(seed):
    state = seed & 0xFFFFFFFF

    def rnd():
        nonlocal state
        state = (state * 1103515245 + 12345) & 0xFFFFFFFF
        return (state >> 8) / 16777216.0

    return rnd


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------


def make_images():
    """Straight RGBA inputs, row-major: {name: (w, h, bytes)}."""
    images = {}

    def photo(w, h):
        out = bytearray()
        for y in range(h):
            for x in range(w):
                r = int(30 + 200 * x / max(1, w - 1))
                g = int(20 + 210 * y / max(1, h - 1))
                b = (x * 37 + y * 11) % 256
                out += bytes([r, g, b, 255])
        return out

    def noise(w, h, seed):
        rnd = lcg(seed)
        out = bytearray()
        for _ in range(w * h):
            out += bytes([int(rnd() * 256), int(rnd() * 256), int(rnd() * 256), 255])
        return out

    def alpha(w, h, seed):
        rnd = lcg(seed)
        out = bytearray()
        for _ in range(w * h):
            a = 255 if rnd() < 0.3 else int(rnd() * 256)
            out += bytes([int(rnd() * 256), int(rnd() * 256), int(rnd() * 256), a])
        return out

    images["photo"] = (24, 16, photo(24, 16))
    images["noise"] = (24, 16, noise(24, 16, 7))
    images["odd"] = (23, 15, noise(23, 15, 3))
    images["alpha"] = (24, 16, alpha(24, 16, 11))
    images["tiny"] = (8, 6, photo(8, 6))
    images["canvas"] = (48, 27, photo(48, 27))
    return images


def save_png(path, w, h, straight):
    img = QImage(bytes(straight), w, h, w * 4, QImage.Format_RGBA8888)
    if not img.copy().save(path, "PNG"):
        raise RuntimeError(f"could not write {path}")


class Inputs:
    def __init__(self, work):
        self.images = make_images()
        self.paths = {}
        for name, (w, h, data) in self.images.items():
            self.paths[name] = os.path.join(work, f"{name}.png")
            save_png(self.paths[name], w, h, data)
        self.readers = {}

    def frame(self, name):
        """A fresh frame holding image `name` (premultiplied by QtImageReader)."""
        if name == "pixel":
            return openshot.Frame(1, 1, 1, "#000000", 0, 2)
        reader = self.readers.get(name)
        if reader is None:
            reader = openshot.QtImageReader(self.paths[name])
            reader.Open()
            self.readers[name] = reader
        src = reader.GetFrame(1)
        # Deep copy so cached reader frames are never modified by an effect.
        frame = openshot.Frame()
        frame.DeepCopy(src)
        return frame


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------

# Segments of the test WAV, in order: (name, seconds, ffmpeg aevalsrc expression L|R).
AUDIO_SEGMENTS = [
    ("silence", 0.05, "0|0"),
    ("tones", 0.1, "0.45*sin(2*PI*440*t)+0.2*sin(2*PI*2500*t)|0.3*sin(2*PI*660*t+0.5)+0.05*sin(2*PI*90*t)"),
    ("quiet", 0.05, "0.02*sin(2*PI*1000*t)|0.015*sin(2*PI*1200*t)"),
    ("noise", 0.1, "0.5*(random(1)-0.5)|0.5*(random(2)-0.5)"),
    ("beeps", 0.25, "if(lt(mod(t,0.05),0.0125),0.8*sin(2*PI*180*t),0.01*sin(2*PI*5000*t))|if(lt(mod(t,0.05),0.0125),0.7*sin(2*PI*190*t),0)"),
    ("loud", 0.05, "0.95*sin(2*PI*120*t)|-0.9*sin(2*PI*120*t)"),
]


class Audio:
    """The decoded test WAV: planar float lists exactly equal to s16 / 32768."""

    def __init__(self, work):
        path = os.path.join(work, "fx.wav")
        parts = []
        for i, (_, seconds, e) in enumerate(AUDIO_SEGMENTS):
            parts.append(f"aevalsrc=exprs='{e}':s={SAMPLE_RATE}:d={seconds}[a{i}]")
        concat = "".join(f"[a{i}]" for i in range(len(AUDIO_SEGMENTS)))
        graph = ";".join(parts) + f";{concat}concat=n={len(AUDIO_SEGMENTS)}:v=0:a=1[out]"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-filter_complex", graph,
             "-map", "[out]", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", path],
            check=True,
        )
        reader = openshot.FFmpegReader(path)
        reader.Open()
        info = json.loads(reader.Json())
        left, right = [], []
        for n in range(1, int(info["video_length"]) + 1):
            f = reader.GetFrame(n)
            count = f.GetAudioSamplesCount()
            if count <= 0:
                continue
            for ch, dest in ((0, left), (1, right)):
                arr = (ctypes.c_float * count).from_address(int(f.GetAudioSamples(ch)))
                dest.extend(arr[i] for i in range(count))
        reader.Close()
        total = sum(int(round(s * SAMPLE_RATE)) for _, s, _ in AUDIO_SEGMENTS)
        left, right = left[:total], right[:total]
        for v in left + right:
            if v * 32768 != int(v * 32768):
                raise RuntimeError("decoded sample is not an exact s16 value")
        self.left, self.right = left, right
        self.offsets = {}
        pos = 0
        for name, seconds, _ in AUDIO_SEGMENTS:
            self.offsets[name] = pos
            pos += int(round(seconds * SAMPLE_RATE))

    def at(self, segment, offset=0):
        return self.offsets[segment] + offset

    def fill(self, frame, start, count, channels):
        """Give `frame` exactly samples [start, start+count) of 1 or 2 channels."""
        frame.ResizeAudio(channels, count, SAMPLE_RATE, openshot.LAYOUT_STEREO if channels == 2 else openshot.LAYOUT_MONO)
        for ch in range(channels):
            src = (self.left if ch == 0 else self.right)[start:start + count]
            if len(src) != count:
                raise RuntimeError("audio slice out of range")
            ctypes.memmove(int(frame.GetAudioSamples(ch)), (ctypes.c_float * count)(*src), 4 * count)

    def encode(self):
        data = bytearray()
        for v in self.left + self.right:
            data += struct.pack("<h", int(v * 32768))
        return {"sampleRate": SAMPLE_RATE, "length": len(self.left), "segments": self.offsets, "data": b64z(data)}


# ---------------------------------------------------------------------------
# Effects
# ---------------------------------------------------------------------------


def kf(v):
    return {"Points": [{"co": {"X": 1.0, "Y": float(v)}, "interpolation": 1}]}


def kf_ramp(x0, y0, x1, y1, interpolation=1):
    return {"Points": [
        {"co": {"X": float(x0), "Y": float(y0)}, "interpolation": interpolation},
        {"co": {"X": float(x1), "Y": float(y1)}, "interpolation": interpolation},
    ]}


def color(r, g, b, a=255):
    return {"red": kf(r), "green": kf(g), "blue": kf(b), "alpha": kf(a)}


def make_effect(etype, overrides, effect_id):
    effect = openshot.EffectInfo().CreateEffect(etype)
    if effect is None:
        raise RuntimeError(f"unknown effect {etype}")
    j = json.loads(effect.Json())
    j["id"] = effect_id
    for k, v in overrides.items():
        j[k] = v
    effect.SetJson(json.dumps(j))
    return effect


def default_json(etype):
    j = json.loads(openshot.EffectInfo().CreateEffect(etype).Json())
    j.pop("id", None)
    return j


def json_overrides(effect, base):
    """The effect's own serialized JSON, minus keys equal to the default JSON."""
    full = json.loads(effect.Json())
    return {k: v for k, v in full.items() if base.get(k) != v}


def timeline(size, fps):
    if size is None:
        return None
    return openshot.Timeline(size[0], size[1], openshot.Fraction(fps[0], fps[1]), SAMPLE_RATE, 2, openshot.LAYOUT_STEREO)


def run(effect, frame, number):
    result = effect.ProcessFrame(frame, number)
    return result.GetWidth(), result.GetHeight(), bytes(result.GetPixelsBytes())


# ---------------------------------------------------------------------------
# AnalogTape
# ---------------------------------------------------------------------------

# (name, image, frame, timeline size or None, timeline fps, effect id, params)
TAPE_CASES = [
    ("default-no-timeline", "photo", 1, None, (30, 1), "TAPE0001", {}),
    ("default-30fps", "photo", 12, (24, 16), (30, 1), "TAPE0001", {}),
    ("scaled-reference", "photo", 37, (48, 24), (24, 1), "tape-b", {}),
    ("odd-width-hd-reference", "odd", 100, (1920, 1080), (30000, 1001), "Z9Q", {"seed_offset": 9}),
    ("heavy", "noise", 55, (24, 16), (30, 1), "abc", {
        "tracking": kf(1), "bleed": kf(1), "softness": kf(1), "noise": kf(0.9),
        "stripe": kf(1), "static_bands": kf(1), "seed_offset": 7}),
    ("all-zero", "noise", 3, (24, 16), (25, 1), "z", {
        "tracking": kf(0), "bleed": kf(0), "softness": kf(0), "noise": kf(0),
        "stripe": kf(0), "static_bands": kf(0)}),
    ("alpha-input", "alpha", 8, (24, 16), (30, 1), "alpha-tape", {"noise": kf(0.7), "bleed": kf(0.3)}),
    ("keyframed", "photo", 20, (36, 20), (30, 1), "kf-tape", {
        "tracking": kf_ramp(1, 0.1, 40, 0.9), "noise": kf_ramp(1, 0.2, 40, 0.8, 0), "bleed": kf_ramp(1, 1, 40, 0)}),
    ("unicode-id", "tiny", 9, (8, 6), (30, 1), "télé-☃", {"static_bands": kf(0.6)}),
]
# Frame sweeps on a tiny image around static bursts: effect id "burst-2" spawns one band
# at frames 38-41, "burst-32" two bands at 26-29 (found by searching the schedule).
TAPE_SWEEPS = [
    ("burst-one", "tiny", list(range(36, 44)), (8, 6), (24, 1), "burst-2", {"static_bands": kf(1), "stripe": kf(0.8)}),
    ("burst-two", "tiny", list(range(24, 32)), (8, 6), (24, 1), "burst-32", {"static_bands": kf(1), "stripe": kf(0.8)}),
]


def analog_tape_cases(inputs, base):
    cases = []
    for name, image, number, size, fps, effect_id, params in TAPE_CASES:
        effect = make_effect("AnalogTape", params, effect_id)
        tl = timeline(size, fps)
        if tl is not None:
            effect.ParentTimeline(tl)
        w, h, pixels = run(effect, inputs.frame(image), number)
        cases.append({
            "name": name, "input": image, "frame": number,
            "timeline": list(size) if size else None, "fps": list(fps) if size else None,
            "json": json_overrides(effect, base), "width": w, "height": h, "out": b64z(pixels),
        })
    for name, image, numbers, size, fps, effect_id, params in TAPE_SWEEPS:
        effect = make_effect("AnalogTape", params, effect_id)
        tl = timeline(size, fps)
        effect.ParentTimeline(tl)
        for number in numbers:
            w, h, pixels = run(effect, inputs.frame(image), number)
            cases.append({
                "name": f"{name}-{number}", "input": image, "frame": number,
                "timeline": list(size), "fps": list(fps),
                "json": json_overrides(effect, base), "width": w, "height": h, "out": b64z(pixels),
            })
    return cases


def main():
    work = tempfile.mkdtemp(prefix="zenvi-fx-goldens-")
    try:
        inputs = Inputs(work)
        audio = Audio(work)
        base = {t: default_json(t) for t in ("AnalogTape", "BeatSync", "AudioVisualization")}
        doc = {
            "libopenshot": openshot.OPENSHOT_VERSION_FULL,
            "images": {k: {"width": w, "height": h, "data": base64.b64encode(bytes(d)).decode("ascii")}
                       for k, (w, h, d) in inputs.images.items()},
            "audio": audio.encode(),
            "base": base,
            "analogTape": analog_tape_cases(inputs, base["AnalogTape"]),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
    with open(OUT, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
