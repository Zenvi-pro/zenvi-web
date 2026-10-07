#!/usr/bin/env python3
"""Golden outputs for the engine's audio effect kernels, from libopenshot 1.0 itself.

Each case builds consecutive ``openshot.Frame`` objects holding deterministic
PCM (the integer generators below, mirrored in ``render/audio/testing.ts``),
runs one effect created with ``EffectInfo().CreateEffect(type)`` + ``SetJson``
over them through ``ProcessFrame(frame, n)`` for n = 1, 2, ... (what
``Clip::apply_effects`` does, so the effect's state carries across frames),
and records every processed sample. ``render/audio/libopenshot-parity.test.ts``
replays each case through the TypeScript kernels.

Frames are built directly instead of decoding a WAV through FFmpegReader:
the input is then exact (int16 / 32768 floats), identical on both sides, and
does not need to be stored in the fixture. Samples are written and read
through ``Frame.GetAudioSamples(channel)`` (the JUCE write pointer) with
ctypes.

Non-reproducible effects are made reproducible from the outside:
- ``Noise`` reseeds libc ``rand()`` with ``time(NULL)`` on every frame; the
  script reads ``time(NULL)`` around each call (retrying a frame when the
  second changes) and records the seed per frame.
- ``Whisperization`` draws its phases from libc ``rand()``; the script calls
  ``srand(fnv1a32(effect id))`` before the first frame, which is exactly how
  the TypeScript kernel seeds its libc-compatible generator.
- ``ParametricEQ`` passes the frame's sample count where the sample rate
  belongs (ParametricEQ.cpp:64); the replay passes the same count.

Some cases edit properties mid-stream (``SetJson`` before a frame, as
``ApplyJsonDiff`` does during playback). The fixture also stores system libm
results for the float functions ported in ``render/audio/apple-libm.ts``
(``expf``, ``__exp10f``, ``powf``).

Run with the desktop's Python and libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/audio_goldens.py [--out PATH] [--frames-scale K]

Writes ``packages/engine/src/render/audio/audio-goldens.json``. ``--frames-scale``
multiplies every case's frame count (for local, uncommitted error measurement).
"""

import argparse
import base64
import ctypes
import json
import os
import struct
import sys

import openshot  # noqa: E402  (needs PYTHONPATH to the libopenshot bindings)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/render/audio/audio-goldens.json"))

LIBC = ctypes.CDLL(None)
LIBC.srand.argtypes = [ctypes.c_uint]
LIBC.time.restype = ctypes.c_long
LIBC.time.argtypes = [ctypes.c_void_p]
for _name, _args in (("expf", 1), ("__exp10f", 1), ("powf", 2)):
    getattr(LIBC, _name).restype = ctypes.c_float
    getattr(LIBC, _name).argtypes = [ctypes.c_float] * _args


# ---------------------------------------------------------------------------
# Deterministic PCM (integer math only; mirrored in render/audio/testing.ts)
# ---------------------------------------------------------------------------

def lcg(seed):
    state = seed & 0xFFFFFFFF

    def nxt():
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state

    return nxt


def triangle(phase):
    """Triangle wave of a 32-bit phase, in [-2^30, 2^30]."""
    return abs(phase - 0x80000000) - 0x40000000


ENVELOPE = [29000, 2600, 18000, 700, 32000, 9000, 150, 24000]


def signal(kind, channel, count, seed):
    """int16 samples (as Python ints) of one channel."""
    rnd = lcg(seed * 7919 + channel * 104729 + 1)
    out = []
    if kind == "music":
        p1 = p2 = 0
        inc1 = 9_830_400 + channel * 1_966_080   # ~110 Hz (+ 22 Hz per channel) at 48 kHz
        inc2 = 131_072_000 + channel * 7_340_032  # ~1.46 kHz
        for i in range(count):
            p1 = (p1 + inc1) & 0xFFFFFFFF
            p2 = (p2 + inc2) & 0xFFFFFFFF
            env = ENVELOPE[(i // 173) % len(ENVELOPE)]
            tone = ((triangle(p1) >> 16) * 3 + (triangle(p2) >> 16)) >> 2   # |.| <= 2^14
            v = ((tone * env) >> 14) + ((rnd() >> 21) - 1024)
            out.append(max(-32768, min(32767, v)))
    elif kind == "sparse":
        for i in range(count):
            r = rnd()
            if r % 97 == 0:
                out.append(((r >> 16) & 0xFFFF) - 32768)
            elif r % 13 == 0:
                out.append(((r >> 20) & 0xFFF) - 2048)
            else:
                out.append(0)
    else:
        raise ValueError(kind)
    return out


def kf(*points, interpolation=1):
    """Keyframe JSON from (x, y) pairs (LINEAR by default, 2 = CONSTANT)."""
    return {"Points": [{"co": {"X": float(x), "Y": float(y)}, "interpolation": interpolation} for x, y in points]}


def fnv1a32(text):
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def f32_bytes(values):
    return struct.pack("<%df" % len(values), *values)


# ---------------------------------------------------------------------------
# Cases: (name, type, signal, channels, sample_rate, (fps_num, fps_den), frames, json)
# 48000 Hz at 375/2 fps and 44100 Hz at 100 fps give 256 and 441 samples per
# frame; 30000/1001 at 44100 gives libopenshot's 1470/1472 pattern.
# ---------------------------------------------------------------------------
SPF256 = (48000, (375, 2))
SPF441 = (44100, (100, 1))
NTSC = (44100, (30000, 1001))

CASES = [
    ("compressor-default", "Compressor", "music", 2, SPF256, 3, {}),
    ("compressor-fast", "Compressor", "music", 2, SPF441, 2,
     {"threshold": kf((1, -24)), "ratio": kf((1, 6)), "attack": kf((1, 0.002)), "release": kf((1, 0.03)), "makeup_gain": kf((1, 4))}),
    ("compressor-keyframed-3ch", "Compressor", "music", 3, SPF256, 3,
     {"threshold": kf((1, -30), (3, -6)), "ratio": kf((1, 3)), "attack": kf((1, 0.001)), "release": kf((1, 0.02)), "makeup_gain": kf((1, 0), (3, 6))}),
    ("compressor-mono-bypass", "Compressor", "music", 1, SPF256, 4,
     {"threshold": kf((1, -20)), "ratio": kf((1, 10)), "attack": kf((1, 0.0005)), "release": kf((1, 0.01)),
      "bypass": kf((1, 0), (3, 1), (4, 0), interpolation=2)}),
    ("compressor-zero-times", "Compressor", "music", 2, SPF256, 2,
     {"threshold": kf((1, -18)), "ratio": kf((1, 2.5)), "attack": kf((1, 0)), "release": kf((1, 0))}),
    ("expander-default", "Expander", "music", 2, SPF256, 3, {}),
    ("expander-gate", "Expander", "music", 2, SPF441, 2,
     {"threshold": kf((1, -30)), "ratio": kf((1, 4)), "attack": kf((1, 0.001)), "release": kf((1, 0.05)), "makeup_gain": kf((1, 0))}),
    ("expander-keyframed-mono", "Expander", "music", 1, SPF256, 3,
     {"threshold": kf((1, -45), (3, -20)), "ratio": kf((1, 2), (3, 8)), "attack": kf((1, 0.004)), "release": kf((1, 0.002))}),
    ("delay-fractional", "Delay", "sparse", 2, SPF441, 2, {"delay_time": kf((1, 0.00731))}),
    ("delay-keyframed", "Delay", "music", 2, SPF256, 4, {"delay_time": kf((1, 0.002), (2, 0), (3, 0), (4, 0.0041))}),
    ("echo-short", "Echo", "sparse", 2, SPF441, 2, {"echo_time": kf((1, 0.0035)), "feedback": kf((1, 0.6)), "mix": kf((1, 0.4))}),
    ("echo-keyframed", "Echo", "music", 2, SPF256, 3, {"echo_time": kf((1, 0.0011), (3, 0.0023)), "feedback": kf((1, 0.9)), "mix": kf((1, 1))}),
    ("distortion-hard-default", "Distortion", "music", 2, SPF256, 2, {}),
    ("distortion-soft", "Distortion", "music", 2, SPF256, 2,
     {"distortion_type": 1, "input_gain": kf((1, 12.7)), "output_gain": kf((1, -6.9)), "tone": kf((1, -3))}),
    ("distortion-exponential", "Distortion", "music", 2, SPF256, 2,
     {"distortion_type": 2, "input_gain": kf((1, 3), (2, 9)), "output_gain": kf((1, 0)), "tone": kf((1, 12))}),
    ("distortion-full-wave", "Distortion", "sparse", 2, SPF256, 2, {"distortion_type": 3, "input_gain": kf((1, 0)), "tone": kf((1, -8))}),
    ("distortion-half-wave", "Distortion", "music", 1, SPF441, 2, {"distortion_type": 4, "tone": kf((1, 0), (2, 20))}),
    ("eq-default", "ParametricEQ", "music", 2, SPF256, 2, {}),
    ("eq-low-pass", "ParametricEQ", "music", 2, SPF256, 2, {"filter_type": 0, "frequency": kf((1, 8))}),
    ("eq-high-pass", "ParametricEQ", "music", 1, SPF441, 2, {"filter_type": 1, "frequency": kf((1, 20))}),
    ("eq-low-shelf", "ParametricEQ", "music", 2, SPF256, 2, {"filter_type": 2, "frequency": kf((1, 10)), "gain": kf((1, 6))}),
    ("eq-high-shelf", "ParametricEQ", "music", 2, SPF256, 2, {"filter_type": 3, "frequency": kf((1, 30)), "gain": kf((1, -9))}),
    ("eq-band-pass", "ParametricEQ", "sparse", 2, SPF256, 2, {"filter_type": 4, "frequency": kf((1, 16)), "q_factor": kf((1, 2))}),
    ("eq-band-stop", "ParametricEQ", "music", 2, SPF256, 2, {"filter_type": 5, "frequency": kf((1, 16)), "q_factor": kf((1, 0.7))}),
    ("eq-peaking-keyframed", "ParametricEQ", "music", 1, NTSC, 2,
     {"filter_type": 6, "frequency": kf((1, 100), (2, 160)), "gain": kf((1, 8)), "q_factor": kf((1, 1.5))}),
    ("eq-unknown-type", "ParametricEQ", "music", 1, SPF256, 1, {"filter_type": 9}),
    ("noise-default", "Noise", "music", 2, SPF256, 2, {}),
    ("noise-keyframed", "Noise", "music", 1, SPF441, 3, {"level": kf((1, 0), (3, 99.6))}),
    ("robotization-default", "Robotization", "music", 2, SPF256, 4, {}),
    ("robotization-hann-256-overlap4", "Robotization", "music", 2, SPF256, 3, {"fft_size": 3, "hop_size": 1, "window_type": 2}),
    ("robotization-hamming-128-overlap8", "Robotization", "music", 1, SPF441, 2, {"fft_size": 2, "hop_size": 2, "window_type": 3}),
    ("robotization-bartlett-64", "Robotization", "sparse", 2, SPF256, 2, {"fft_size": 1, "hop_size": 0, "window_type": 1}),
    ("whisperization-default", "Whisperization", "music", 2, SPF256, 4, {}),
    ("whisperization-hann-128-overlap4", "Whisperization", "music", 1, SPF441, 2, {"fft_size": 2, "hop_size": 1, "window_type": 2}),
]

# Mid-stream property edits (SetJson before that frame, as an ApplyJsonDiff would):
# a new fft size keeps the old hop (STFT::updateHopSize only runs on an overlap
# change), a new overlap moves only the synthesis write position, and an
# unknown window type keeps the previous window.
UPDATES = {
    "robotization-resize-midstream": ("Robotization", "music", 1, SPF256, 5, {"fft_size": 2, "hop_size": 0},
                                      {3: {"fft_size": 1}, 4: {"hop_size": 1}, 5: {"window_type": 7}}),
}


def make_frame(number, channels, sample_rate, samples):
    frame = openshot.Frame(number, len(samples[0]), channels)
    frame.SampleRate(sample_rate)
    for ch in range(channels):
        n = len(samples[ch])
        buf = (ctypes.c_float * n).from_address(int(frame.GetAudioSamples(ch)))
        buf[:] = samples[ch]
    return frame


def read_frame(frame, channels, count):
    out = []
    for ch in range(channels):
        buf = (ctypes.c_float * count).from_address(int(frame.GetAudioSamples(ch)))
        out.append(list(buf))
    return out


def run_case(name, etype, kind, channels, rate_fps, frames, overrides, seed, updates=None):
    sample_rate, (fps_num, fps_den) = rate_fps
    fps = openshot.Fraction(fps_num, fps_den)
    sizes = [openshot.Frame.GetSamplesPerFrame(n, fps, sample_rate, channels) for n in range(1, frames + 1)]
    total = sum(sizes)
    pcm = [signal(kind, ch, total, seed) for ch in range(channels)]

    effect = openshot.EffectInfo().CreateEffect(etype)
    if effect is None:
        raise RuntimeError(f"unknown effect {etype}")
    j = json.loads(effect.Json())
    j["id"] = name  # stable ids (libopenshot makes random ones); Whisperization seeds from it
    j.update(overrides)
    effect.SetJson(json.dumps(j))
    effect_json = json.loads(effect.Json())

    case = {
        "type": etype,
        "signal": kind,
        "seed": seed,
        "channels": channels,
        "sampleRate": sample_rate,
        "fps": [fps_num, fps_den],
        "frameSizes": sizes,
        "effect": effect_json,
    }
    if etype == "Whisperization":
        case["srand"] = fnv1a32(effect_json["id"])
        LIBC.srand(case["srand"])
    if updates:
        case["updates"] = [{"frame": f, "json": u} for f, u in sorted(updates.items())]
    noise_seeds = []

    output = bytearray()
    offset = 0
    for index, size in enumerate(sizes):
        number = index + 1
        if updates and number in updates:
            effect.SetJson(json.dumps(updates[number]))
        block = [[v / 32768.0 for v in pcm[ch][offset:offset + size]] for ch in range(channels)]
        offset += size
        while True:
            frame = make_frame(number, channels, sample_rate, block)
            before = LIBC.time(None)
            result = effect.ProcessFrame(frame, number)
            after = LIBC.time(None)
            if etype != "Noise" or before == after:
                break
        if etype == "Noise":
            noise_seeds.append(before)
        processed = read_frame(result, channels, size)
        for ch in range(channels):
            output += f32_bytes(processed[ch])
    if noise_seeds:
        case["noiseSeeds"] = noise_seeds
    case["output"] = base64.b64encode(bytes(output)).decode("ascii")
    return case


def libm_vectors():
    """System libm results for the ported float functions (render/audio/apple-libm.ts)."""
    rnd = lcg(20260930)

    def uniform(lo, hi):
        return struct.unpack("<f", struct.pack("<f", lo + (hi - lo) * (rnd() / 4294967296.0)))[0]

    def bits_float(b):
        return struct.unpack("<f", struct.pack("<I", b))[0]

    specials = [0.0, -0.0, 1.0, -1.0, float("inf"), float("-inf"), 1e-45, -1e-45, 127.99, -127.99, 63.99, -63.99,
                88.7228, -87.33655, -103.97, 38.53, -45.15, 3.4e38, -3.4e38]
    unary = specials + [uniform(-110.0, 90.0) for _ in range(160)] + [uniform(-1.0, 1.0) for _ in range(60)] + \
        [bits_float(rnd()) for _ in range(60)]
    out = {"expf": [], "exp10f": [], "powf": []}
    for x in unary:
        out["expf"].append([x, LIBC.expf(x)])
        out["exp10f"].append([x, LIBC.__exp10f(x)])
    pairs = [(0.36787945, uniform(-0.5, 0.5) * 2.0 ** ((rnd() % 30) - 20)) for _ in range(60)]
    pairs += [(uniform(0.0, 4.0), uniform(-40.0, 40.0)) for _ in range(60)]
    pairs += [(-uniform(0.0, 3.0), float(int(rnd() % 21) - 10)) for _ in range(20)]
    pairs += [(bits_float(rnd() & 0x807FFFFF), uniform(-3.0, 3.0)) for _ in range(20)]
    pairs += [(bits_float(rnd()), bits_float(rnd())) for _ in range(40)]
    for x in [0.0, -0.0, 1.0, -1.0, 2.0, 0.5, float("inf"), float("-inf"), -2.0, 1e-45]:
        for y in [0.0, -0.0, 1.0, -1.0, 2.0, 3.0, -3.0, 0.5, float("inf"), float("-inf"), 1e30, -1e30]:
            pairs.append((x, y))
    for x, y in pairs:
        out["powf"].append([x, y, LIBC.powf(x, y)])
    # Bit patterns (hex) so NaN/inf/-0 survive JSON.
    def hexf(v):
        return "%08x" % struct.unpack("<I", struct.pack("<f", v))[0]
    return {k: ["".join(hexf(v) for v in row) for row in rows] for k, rows in out.items()}


def write_doc(path, doc):
    """One case per line: readable diffs without pretty-printing every sample string."""
    with open(path, "w") as fh:
        fh.write("{\n")
        fh.write(' "libopenshot": %s,\n' % json.dumps(doc["libopenshot"]))
        fh.write(' "layout": %s,\n' % json.dumps(doc["layout"]))
        fh.write(' "libm": %s,\n' % json.dumps(doc["libm"], separators=(",", ":")))
        fh.write(' "cases": {\n')
        items = list(doc["cases"].items())
        for i, (name, case) in enumerate(items):
            sep = "," if i < len(items) - 1 else ""
            fh.write("  %s: %s%s\n" % (json.dumps(name), json.dumps(case, separators=(",", ":")), sep))
        fh.write(" }\n}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--frames-scale", type=int, default=1)
    args = parser.parse_args()

    cases = {}
    seed = 0
    for name, etype, kind, channels, rate_fps, frames, overrides in CASES:
        seed += 1
        cases[name] = run_case(name, etype, kind, channels, rate_fps, frames * args.frames_scale, overrides, seed)
        print(f"{name}: {len(cases[name]['frameSizes'])} frames", file=sys.stderr)
    for name, (etype, kind, channels, rate_fps, frames, overrides, updates) in UPDATES.items():
        seed += 1
        cases[name] = run_case(name, etype, kind, channels, rate_fps, frames, overrides, seed, updates)
        print(f"{name}: {len(cases[name]['frameSizes'])} frames", file=sys.stderr)

    doc = {
        "libopenshot": openshot.OPENSHOT_VERSION_FULL,
        "layout": "output = base64 float32 LE, frame by frame, channel by channel (planar within a frame); libm rows = hex float32 bits of args then result",
        "libm": libm_vectors(),
        "cases": cases,
    }
    write_doc(args.out, doc)
    print(f"wrote {len(cases)} cases to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
