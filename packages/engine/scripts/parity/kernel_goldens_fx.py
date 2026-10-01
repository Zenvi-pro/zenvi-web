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
    images["wide"] = (64, 36, photo(64, 36))
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


# ---------------------------------------------------------------------------
# BeatSync (stateful: each sequence reuses one effect instance)
# ---------------------------------------------------------------------------


def curve(nodes, enabled=1):
    out = []
    for i, (x, y, interpolation) in enumerate(nodes):
        out.append({"id": i, "x": kf(x), "y": kf(y), "interpolation": interpolation,
                    "left_handle_x": kf(0.3), "left_handle_y": kf(0.9),
                    "right_handle_x": kf(0.6), "right_handle_y": kf(0.2), "handle_type": 0})
    return {"enabled": kf(enabled), "nodes": out}


def beats(frames, size, channels=2, start_frame=1):
    """Steps over consecutive `size`-sample slices of the beeps segment."""
    return [(start_frame + i, ("beeps", i * size, size, channels)) for i in range(frames)]


# (name, image, timeline size or None, params, [(frame, (segment, offset, count, channels) | None)])
BEAT_CASES = [
    ("defaults-with-seek", "tiny", None, {},
     beats(10, 800) + [(20, ("beeps", 8000, 800, 2)), (21, ("beeps", 8800, 800, 2)), (22, ("beeps", 9600, 800, 2))]),
    ("band-invert-curve", "tiny", None, {
        "low_color": color(10, 20, 200, 255), "high_color": color(255, 120, 0, 180), "intensity": kf(4),
        "threshold": kf(0.3), "attack_ms": kf(30), "decay_ms": kf(80), "frequency_low": kf(0.2),
        "frequency_high": kf(0.5), "invert": True, "response_curve": curve([(0, 0, 1), (0.35, 0.1, 0), (1, 1, 1)])},
     beats(12, 800)),
    ("tones-mono-1600", "tiny", None, {"threshold": kf(0), "decay_ms": kf(40)},
     [(n, ("tones", (n - 1) * 400, 1600, 1)) for n in range(1, 5)] + [(5, ("quiet", 0, 1600, 1)), (6, ("noise", 0, 1600, 1))]),
    ("no-audio-pixel-fallback", "pixel", (32, 18), {"color": color(40, 220, 90, 255), "decay_ms": kf(60)},
     [(1, ("tones", 0, 800, 2)), (2, None), (3, None), (4, ("loud", 0, 800, 2)), (5, ("beeps", 0, 800, 2))]),
    ("keyframed-step-back", "tiny", None, {
        "intensity": kf_ramp(1, 0.5, 10, 8), "attack_ms": kf(1), "decay_ms": kf(5000),
        "low_color": color(0, 0, 0, 0), "high_color": color(255, 255, 255, 128),
        "response_curve": curve([(0, 0, 1), (1, 1, 1)], enabled=0)},
     [(5, ("beeps", 0, 800, 2)), (6, ("beeps", 800, 800, 2)), (5, ("beeps", 1600, 800, 2)), (6, ("beeps", 2400, 800, 2)),
      (7, ("noise", 0, 800, 2))]),
]


def beat_sync_cases(inputs, audio, base):
    cases = []
    for name, image, size, params, steps in BEAT_CASES:
        effect = make_effect("BeatSync", params, f"beat-{name}")
        tl = timeline(size, (30, 1))
        if tl is not None:
            effect.ParentTimeline(tl)
        out_steps = []
        for number, slice_ in steps:
            frame = inputs.frame(image)
            if slice_ is not None:
                segment, offset, count, channels = slice_
                audio.fill(frame, audio.at(segment, offset), count, channels)
            w, h, pixels = run(effect, frame, number)
            first = pixels[:4]
            if pixels != first * (w * h):
                raise RuntimeError(f"BeatSync {name}: output is not a solid fill")
            out_steps.append({
                "frame": number,
                "audio": [audio.at(slice_[0], slice_[1]), slice_[2], slice_[3]] if slice_ else None,
                "width": w, "height": h, "color": list(first),
            })
        cases.append({"name": name, "input": image, "timeline": list(size) if size else None,
                      "json": json_overrides(effect, base), "steps": out_steps})
    return cases


# ---------------------------------------------------------------------------
# AudioVisualization
# ---------------------------------------------------------------------------

TONES = ("tones", 0, 1600, 2)
NOISE = ("noise", 0, 1600, 2)
LOUD = ("loud", 400, 1600, 2)
QUIET = ("quiet", 400, 1600, 2)
BEEPS = ("beeps", 0, 1600, 2)
MONO = ("tones", 400, 1600, 1)


def av(mode, **params):
    out = {"visualization_type": mode}
    for k, v in params.items():
        out[k] = kf(v) if isinstance(v, (int, float)) and k in ("intensity", "smoothing", "detail", "glow", "color_spread", "frequency_low", "frequency_high") else v
    return out


# Clip::apply_waveform's settings (Clip.cpp:1498-1514) on a transparent canvas.
CLIP_WAVEFORM = {"style": 3, "color": color(250, 160, 40, 255), "intensity": kf(1), "smoothing": kf(0.25), "detail": kf(0.75),
                 "glow": kf(0), "color_spread": kf(0), "color_mode": 0, "channel_layout": 0, "frequency_low": kf(0),
                 "frequency_high": kf(1), "background": 0}

# (name, image, frame, audio slice or None, timeline size or None, params)
AV_CASES = [
    ("waveform-default", "canvas", 1, TONES, None, av(0)),
    ("waveform-minimal-combined", "canvas", 2, TONES, None, av(0, style=3, channel_layout=1, background=0, glow=0)),
    ("waveform-rainbow-overlay-neon", "canvas", 3, NOISE, None, av(0, color_mode=1, channel_layout=3, style=2, background=1)),
    ("waveform-soft-mono-fade", "wide", 4, MONO, None, av(0, style=1, background=2, detail=0.3)),
    ("filled-default", "canvas", 5, TONES, None, av(1)),
    ("filled-clip-waveform", "wide", 6, LOUD, None, dict(CLIP_WAVEFORM, visualization_type=1)),
    ("filled-rainbow-overlay-gradient", "canvas", 7, NOISE, None, av(1, color_mode=1, channel_layout=3, background=3)),
    ("filled-neon-split-quiet", "canvas", 8, QUIET, None, av(1, style=2, channel_layout=2, intensity=6)),
    ("bars-default", "canvas", 9, NOISE, None, av(2)),
    ("bars-rainbow-soft-band", "wide", 10, TONES, None, av(2, color_mode=1, style=1, background=0, frequency_low=0.2, frequency_high=0.8)),
    ("bars-minimal-solid", "canvas", 11, BEEPS, None, av(2, style=3, glow=0, background=1, detail=0.1)),
    ("radial-default", "wide", 12, TONES, None, av(3, background=0)),
    ("radial-rainbow-neon", "wide", 13, NOISE, None, av(3, color_mode=1, style=2, background=0)),
    ("radial-minimal-source", "canvas", 14, LOUD, None, av(3, style=3)),
    ("spectrum-default", "wide", 15, NOISE, None, av(4, background=0, intensity=6)),
    ("spectrum-rainbow-fade", "canvas", 16, TONES, None, av(4, color_mode=1, background=2)),
    ("spectrum-minimal", "wide", 17, BEEPS, None, av(4, style=3, background=0, glow=0)),
    ("phase-default", "wide", 18, LOUD, None, av(5, background=0)),
    ("phase-rainbow-tones", "wide", 19, TONES, None, av(5, color_mode=1, background=0, intensity=2)),
    ("phase-minimal-solid", "canvas", 20, NOISE, None, av(5, style=3, background=1)),
    ("phase-mono-fallback", "canvas", 21, MONO, None, av(5, background=0)),
    ("particles-default", "wide", 22, NOISE, None, av(6, background=0)),
    ("particles-rainbow-minimal", "wide", 23, TONES, None, av(6, color_mode=1, style=3, background=0)),
    ("particles-neon-source", "canvas", 77, LOUD, None, av(6, style=2, detail=0.1)),
    ("vu-default", "canvas", 24, TONES, None, av(7)),
    ("vu-minimal-combined", "canvas", 25, LOUD, None, av(7, style=3, channel_layout=1, background=0)),
    ("vu-soft-quiet-gradient", "canvas", 26, QUIET, None, av(7, style=1, background=3, intensity=8)),
    ("radialbars-default", "wide", 27, NOISE, None, av(8, background=0)),
    ("radialbars-rainbow-soft", "wide", 28, TONES, None, av(8, color_mode=1, style=1, background=0, glow=0.6)),
    ("no-audio-solid", "canvas", 29, None, None, av(2, background=1)),
    ("pixel-timeline-fallback", "pixel", 30, NOISE, (40, 24), av(2)),
    ("mode-clamped", "wide", 31, NOISE, None, av(12, background=0)),
    ("keyframed-color-intensity", "canvas", 15, TONES, None, av(0, background=0,
        color={"red": kf_ramp(1, 255, 30, 0), "green": kf(120), "blue": kf_ramp(1, 0, 30, 255), "alpha": kf(200)},
        intensity=kf_ramp(1, 0.5, 30, 4))),
    ("frequencies-in-hz", "wide", 32, NOISE, None, av(2, background=0, frequency_low=300, frequency_high=4000, intensity=5)),
]


def audio_visualization_cases(inputs, audio, base):
    cases = []
    for name, image, number, slice_, size, params in AV_CASES:
        effect = make_effect("AudioVisualization", params, f"av-{name}")
        tl = timeline(size, (30, 1))
        if tl is not None:
            effect.ParentTimeline(tl)
        frame = inputs.frame(image)
        if slice_ is not None:
            segment, offset, count, channels = slice_
            audio.fill(frame, audio.at(segment, offset), count, channels)
        w, h, pixels = run(effect, frame, number)
        cases.append({
            "name": name, "input": image, "frame": number,
            "audio": [audio.at(slice_[0], slice_[1]), slice_[2], slice_[3]] if slice_ else None,
            "timeline": list(size) if size else None,
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
            "beatSync": beat_sync_cases(inputs, audio, base["BeatSync"]),
            "audioVisualization": audio_visualization_cases(inputs, audio, base["AudioVisualization"]),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
    with open(OUT, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
