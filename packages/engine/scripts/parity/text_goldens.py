#!/usr/bin/env python3
"""Golden data for the Caption and Timer kernels, from libopenshot 1.0 and Qt.

Text rasterization depends on the font engine, so the goldens separate what
is exact from what is not:

* ``cues``: caption texts parsed by Qt's own ``QRegularExpression`` with the
  pattern and options of ``Caption::process_regex`` (Caption.cpp:94), then
  post-processed like ``Caption::GetFrame`` (seconds, line filters).
* ``caption`` / ``timer``: real libopenshot renders (``openshot.Caption`` /
  ``openshot.Timer`` + ``SetJson`` + ``ProcessFrame``) on solid frames. Each
  case stores the effect JSON, the parent context, the background-only render
  (the same effect with ``font_alpha`` 0, so only the rounded box remains;
  zlib + base64 premultiplied RGBA), the bounding box of the pixels the text
  changes, and the Qt font metrics of every string the kernel measures
  (``QFontMetricsF`` and ``QPainterPath::addText`` in this same process, so the
  same Qt and fonts as libopenshot). ``Timer`` cases also store
  ``Timer::TimerText``.

``kernels/text-kernels.test.ts`` replays them with a ``TextRasterizer`` that
serves the recorded metrics.

Run with the desktop's Python, PyQt5 and libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/text_goldens.py

Writes ``packages/engine/src/render/kernels/text-goldens.json``.
"""

import base64
import json
import os
import struct
import sys
import zlib

from PyQt5.QtCore import QPointF, QRectF, QRegularExpression, Qt
from PyQt5.QtGui import QFont, QFontMetricsF, QGuiApplication, QPainterPath

APP = QGuiApplication(sys.argv)  # libopenshot's QFont/QPainter need it (same Qt as PyQt5)

import openshot  # noqa: E402  (needs PYTHONPATH to the libopenshot bindings)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/render/kernels/text-goldens.json"))

CUE_PATTERN = (
    r"(\d{2})?:*(\d{2}):(\d{2}).(\d{2,3})\s*-->\s*(\d{2})?:*(\d{2}):(\d{2}).(\d{2,3})"
    r"([\s\S]*?)(.*?)(?=\d{2}:\d{2,3}|\Z)"
)
CUE_RE = QRegularExpression(CUE_PATTERN, QRegularExpression.MultilineOption)


def f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]


def kf(v):
    return {"Points": [{"co": {"X": 1.0, "Y": float(v)}, "interpolation": 1}]}


def kf_points(*points):
    return {"Points": [{"co": {"X": float(x), "Y": float(y)}, "interpolation": 1} for x, y in points]}


def color(r, g, b, a=255):
    return {"red": kf(r), "green": kf(g), "blue": kf(b), "alpha": kf(a)}


def rect(r):
    return [r.x(), r.y(), r.width(), r.height()]


# ---------------------------------------------------------------------------
# Cue parsing (Qt regex + Caption::GetFrame post-processing)
# ---------------------------------------------------------------------------


def qt_cues(text):
    prepared = text if text.endswith("\n\n") else text + "\n\n"
    cues = []
    it = CUE_RE.globalMatch(prepared)
    while it.hasNext():
        m = it.next()
        if not m.hasMatch():
            continue
        g = [m.captured(i) for i in range(11)]

        def num(s):
            return float(s) if s else 0.0

        def frac(s):
            return int(s.ljust(3, "0")) / 1000.0

        start = num(g[1]) * 3600.0 + num(g[2]) * 60.0 + num(g[3]) + frac(g[4])
        end = num(g[5]) * 3600.0 + num(g[6]) * 60.0 + num(g[7]) + frac(g[8])
        lines = [ln for ln in g[9].split("\n") if not ln.startswith("NOTE") and len(ln) > 1]
        cues.append({"start": start, "end": end, "lines": lines, "group9": g[9], "group10": g[10]})
    return cues


CUE_TEXTS = [
    "00:00:00:000 --> 00:10:00:000\nEdit this caption with our caption editor",
    "1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n2\n00:00:05,000 --> 00:00:08,500\nSecond cue\ntwo lines\n\n"
    "10\n00:00:09,000 --> 00:00:10,000\nThird\n\n11\n00:00:11,000 --> 00:00:12,000\nFourth",
    "WEBVTT\n\n00:01.000 --> 00:04.000 align:middle line:84%\nHello <b>bold</b>\n\nNOTE this is a comment\n\n"
    "00:05.000 --> 00:06.500\nNext",
    "00:00:00.000 --> 00:00:05.000\nMeet at 10:30 tomorrow\nsecond line\n00:00:06.000 --> 00:00:07.000\nLast",
    "00:00:01.5 --> 00:00:02.00\nbad one-digit start\n00:00:03.05 --> 00:00:04.50\nfractions\n00:00:05.5 --> 00:00:06.250\ntail",
    "00:00:00,000 --> 00:00:02,000\r\nWindows line\r\n\r\n00:00:03,000 --> 00:00:04,000\r\nNext\r\n",
    "00:00:01:500 --> 00:00:02;250\nodd separators\n01:02.500-->01:04.000\nno spaces\n\n",
    "01:00:00.000 --> 01:00:01.000\nan hour in\n\tTabbed\nx\n",
    "00:00:01.000 --> 00:00:02.000 00:00:03.000 --> 00:00:04.000\nsame line",
    "00:00:00.000 --> 00:00:01.000\n日本語のテキスト next\n",
    "",
    "no timestamps here\njust text",
    "00:00:00.000 --> 00:00:02.000\n  \nblank line above has two spaces",
]


# ---------------------------------------------------------------------------
# Qt metrics
# ---------------------------------------------------------------------------


def qt_font(family, px):
    f = QFont(family, int(px))
    f.setPixelSize(int(px))
    return f


class Metrics:
    """QFontMetricsF / QPainterPath measurements of one font, as JSON."""

    def __init__(self, family, px):
        self.font = qt_font(family, px)
        self.fm = QFontMetricsF(self.font)
        self.doc = {
            "family": family,
            "pixelSize": int(px),
            "ascent": self.fm.ascent(),
            "descent": self.fm.descent(),
            "lineSpacing": self.fm.lineSpacing(),
            "strings": {},
        }

    def fmt_width(self, s):
        return self.fm.boundingRect(QRectF(0, 0, 100000, 1000), Qt.TextSingleLine, s).width()

    def measure(self, s):
        if s in self.doc["strings"]:
            return self.doc["strings"][s]
        path = QPainterPath()
        path.addText(QPointF(0, 0), self.font, s)
        rec = {
            "adv": self.fm.horizontalAdvance(s),
            "fmt": self.fmt_width(s),
            "path": rect(path.boundingRect()),
            "tight": rect(self.fm.tightBoundingRect(s)),
            "br": rect(self.fm.boundingRect(s)),
        }
        self.doc["strings"][s] = rec
        return rec


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render(effect, w, h, frame_no, bg):
    frame = openshot.Frame(frame_no, w, h, bg)
    frame.AddColor(w, h, bg)
    out = effect.ProcessFrame(frame, frame_no)
    return bytes(out.GetPixelsBytes())


def input_pixel(w, h, bg):
    frame = openshot.Frame(1, w, h, bg)
    frame.AddColor(w, h, bg)
    return list(bytes(frame.GetPixelsBytes())[:4])


def diff_bbox(a, b, w, h):
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        row = y * w * 4
        if a[row:row + w * 4] == b[row:row + w * 4]:
            continue
        for x in range(w):
            i = row + x * 4
            if a[i:i + 4] != b[i:i + 4]:
                x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
    return None if x1 < 0 else [x0, y0, x1, y1]


def pack(pixels):
    return base64.b64encode(zlib.compress(pixels, 9)).decode("ascii")


# Keys of EffectBase::JsonValue the text kernels never read.
UNUSED_KEYS = {
    "id", "name", "description", "class_name", "has_audio", "has_video", "has_tracked_object", "mask_reader",
    "mask_invert", "mask_source_id", "mask_time_mode", "mask_loop_mode", "parent_effect_id", "position", "layer",
    "start", "end", "duration", "order", "apply_before_clip",
}


def slim(value):
    """Effect JSON without unused keys; one-point keyframes drop the handles a constant ignores."""
    if isinstance(value, dict):
        if isinstance(value.get("Points"), list) and len(value["Points"]) == 1:
            p = value["Points"][0]
            return {"Points": [{"co": p["co"], "interpolation": p.get("interpolation", 0)}]}
        return {k: slim(v) for k, v in value.items() if k not in UNUSED_KEYS}
    if isinstance(value, list):
        return [slim(v) for v in value]
    return value


def with_font_alpha_zero(effect, j):
    zero = dict(j)
    zero["font_alpha"] = kf(0)
    effect.SetJson(json.dumps(zero))


# ---------------------------------------------------------------------------
# Caption
# ---------------------------------------------------------------------------


def caption_strings(effect, w, h, frame_no, fps, metrics):
    """Replay Caption.cpp:154-301 with Qt metrics to record every measured and drawn string."""
    left = effect.left.GetValue(frame_no)
    right = effect.right.GetValue(frame_no)
    lx = w * left
    aw = (w - w * right) - lx
    fps_f = f32(fps[0] / fps[1])
    lines_out = []
    for cue in qt_cues(effect.CaptionText()):
        first = int(cue["start"] * fps_f) + 1
        last = int(cue["end"] * fps_f)
        if frame_no < first or frame_no > last:
            continue
        for line in cue["lines"]:
            words = line.split(" ")
            use_spaces = True
            if len(line) > 20 and len(words) == 1:
                words = [""] + list(line) + [""]
                use_spaces = False
            while words:
                shown = False
                for k in range(len(words), 0, -1):
                    s = " ".join(words[:k])
                    rec = metrics.measure(s)
                    if rec["fmt"] <= aw:
                        overhang = rec["path"][0] + rec["path"][2]
                        if rec["path"][2] > 0 and overhang > rec["fmt"] and abs(rec["fmt"] - aw) < 0.1:
                            raise RuntimeError(f"borderline overhang case {s!r}")
                        drawn = s if use_spaces else "".join(words[:k])
                        metrics.measure(drawn)
                        lines_out.append(drawn)
                        words = words[k:]
                        shown = True
                        break
                    if abs(rec["fmt"] - aw) < 1e-6:
                        raise RuntimeError(f"width tie for {s!r}")
                if not shown:
                    break
    return lines_out


# (name, width, height, frame, effect json overrides, timeline fps or None, frame color)
CAPTION_CASES = [
    ("default-text", 320, 180, 1, {}, None, "#ff204060"),
    ("default-with-background", 320, 180, 1, {"background_alpha": kf(0.6), "background": color(20, 40, 160)}, None, "#ff808080"),
    (
        "srt-two-lines",
        320, 180, 40,
        {
            "caption_text": "1\n00:00:01,000 --> 00:00:04,000\nHello world\nsecond line here\n\n2\n00:00:05,000 --> 00:00:08,500\nLater",
            "background_alpha": kf(0.8),
        },
        (30, 1), "#ff336699",
    ),
    (
        "wrap-three-lines",
        320, 180, 10,
        {
            "caption_text": "00:00:00.000 --> 00:01:00.000\nThe quick brown fox jumps over the lazy dog again and again",
            "left": kf(0.2), "right": kf(0.25), "top": kf(0.35), "line_spacing": kf(1.5),
            "background_alpha": kf(1.0), "background": color(200, 30, 60), "background_corner": kf(4),
        },
        (24, 1), "#ff000000",
    ),
    (
        "no-space-split",
        320, 180, 5,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nabcdefghijklmnopqrstuvwxyz0123456789",
            "left": kf(0.3), "right": kf(0.3), "top": kf(0.2),
            "background_alpha": kf(0.7),
        },
        (25, 1), "#ff102030",
    ),
    (
        "word-too-long-drops-rest",
        320, 180, 5,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nok Supercalifragilisticexpialidocious done\nnext line",
            "left": kf(0.35), "right": kf(0.35), "top": kf(0.3),
            "background_alpha": kf(0.5),
        },
        (25, 1), "#ff404040",
    ),
    (
        "fade-in-midway",
        320, 180, 46,
        {
            "caption_text": "00:00:01.000 --> 00:00:05.000\nFading in",
            "fade_in": kf(1.0), "fade_out": kf(1.0), "background_alpha": kf(0.9), "background": color(250, 250, 250),
        },
        (30, 1), "#ff202020",
    ),
    (
        "fade-out-last-frames",
        320, 180, 145,
        {
            "caption_text": "00:00:01.000 --> 00:00:05.000\nFading out\n00:00:04.000 --> 00:00:06.000\nOverlapping cue",
            "fade_in": kf(0.5), "fade_out": kf(1.5), "background_alpha": kf(0.9),
        },
        (30, 1), "#ff606060",
    ),
    (
        "clip-area-cuts-background",
        320, 180, 3,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nClipped box\nand a second line that overflows",
            "top": kf(0.62), "bottom": kf(0.2), "background_padding": kf(40), "background_alpha": kf(0.75),
            "background": color(30, 200, 90),
        },
        (25, 1), "#ff000080",
    ),
    (
        "bad-color-is-black",
        320, 180, 2,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nBlack box",
            "background": color(300, 40, 40), "background_alpha": kf(1.0), "color": color(255, 255, 0),
        },
        (25, 1), "#80336699",
    ),
    (
        "square-corners",
        320, 180, 2,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nSquare box",
            "background_corner": kf(0), "background_alpha": kf(0.66), "background": color(10, 120, 240),
        },
        (25, 1), "#ffc0c0c0",
    ),
    (
        "negative-area-width",
        320, 180, 2,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nNothing fits",
            "left": kf(0.6), "right": kf(0.55), "background_alpha": kf(1.0), "background": color(240, 200, 0),
        },
        (25, 1), "#ff000000",
    ),
    (
        "vtt-settings-drawn",
        320, 180, 30,
        {
            "caption_text": "WEBVTT\n\n00:01.000 --> 00:04.000 align:middle\nHello VTT\n\n00:05.000 --> 00:06.000\nLater",
            "background_alpha": kf(0.5), "font_size": kf(26),
        },
        (25, 1), "#ff333333",
    ),
    (
        "blank-line-pulls-top",
        320, 180, 2,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\n  \nAfter a blank line",
            "top": kf(0.55), "background_alpha": kf(0.6),
        },
        (25, 1), "#ff000000",
    ),
    (
        "inactive-frame",
        320, 180, 400,
        {"caption_text": "00:00:01.000 --> 00:00:02.000\nGone", "background_alpha": kf(1.0)},
        (30, 1), "#ff445566",
    ),
    (
        "ntsc-boundary",
        320, 180, 300,
        {
            "caption_text": "00:00:10.010 --> 00:00:11.000\nNTSC boundary",
            "background_alpha": kf(0.7), "stroke_width": kf(2.5), "stroke": color(255, 0, 0),
        },
        (30000, 1001), "#ff000000",
    ),
    (
        "arial-large-stroke",
        640, 360, 12,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nArial at a larger size with a stroke",
            "caption_font": "Arial", "font_size": kf(36), "stroke_width": kf(3), "background_alpha": kf(0.55),
            "background_corner": kf(18), "background_padding": kf(12), "left": kf(0.05), "right": kf(0.05),
            "top": kf(0.6),
        },
        (24, 1), "#ff0a0a0a",
    ),
    (
        "animated-font-size",
        320, 180, 50,
        {
            "caption_text": "00:00:00.000 --> 00:00:10.000\nGrowing text",
            "font_size": kf_points((1, 20), (100, 40)), "background_alpha": kf(0.8),
            "left": kf_points((1, 0.05), (100, 0.25)),
        },
        (25, 1), "#ff000000",
    ),
    ("no-parent-fps-one", 320, 180, 3, {"caption_text": "00:00:02.000 --> 00:00:04.000\nOne fps", "background_alpha": kf(1.0)}, None, "#ff000000"),
]


def caption_case(name, w, h, frame_no, overrides, fps, bg):
    effect = openshot.Caption()
    j = json.loads(effect.Json())
    j.update(overrides)
    effect.SetJson(json.dumps(j))
    timeline = None
    if fps:
        timeline = openshot.Timeline(w, h, openshot.Fraction(*fps), 44100, 2, openshot.LAYOUT_STEREO)
        effect.ParentTimeline(timeline)
    full_json = json.loads(effect.Json())
    full = render(effect, w, h, frame_no, bg)
    with_font_alpha_zero(effect, full_json)
    bg_only = render(effect, w, h, frame_no, bg)
    effect.SetJson(json.dumps(full_json))

    scale = w / 600.0
    px = int(max(effect.font_size.GetValue(frame_no) * scale, 1.0))
    metrics = Metrics(effect.font_name, px)
    drawn = caption_strings(effect, w, h, frame_no, fps or (1, 1), metrics)
    return {
        "width": w,
        "height": h,
        "frame": frame_no,
        "fps": list(fps) if fps else None,
        "input": input_pixel(w, h, bg),
        "effect": slim(full_json),
        "metrics": metrics.doc,
        "lines": drawn,
        "backgroundOnly": pack(bg_only),
        "textBox": diff_bbox(full, bg_only, w, h),
        "timelineFps": timeline.info.fps.ToDouble() if timeline else None,
    }


# ---------------------------------------------------------------------------
# Timer
# ---------------------------------------------------------------------------


def timer_strings(text, layout_text, metrics):
    for s in dict.fromkeys([text, layout_text, *text, *layout_text, *"0123456789"]):
        metrics.measure(s)


# (name, width, height, frame, json overrides, parent, frame color)
# parent: None | ("timeline", (num, den)) | ("clip", reader fps, time points or None, timeline fps or None)
TIMER_CASES = [
    ("default-no-parent", 320, 180, 1, {}, None, "#ff000000"),
    ("timeline-24fps", 320, 180, 95, {}, ("timeline", (24, 1)), "#ff336699"),
    (
        "hhmmss-ms-top-left-offsets",
        320, 180, 37,
        {"format": 2, "gravity": 0, "x_offset": kf(3.3), "y_offset": kf(2.5), "start_time": kf(3661.25)},
        ("timeline", (30, 1)), "#ff202020",
    ),
    ("countdown-unclamped", 320, 180, 80, {"mode": 1, "end_time": kf(1.0), "clamp": 0, "gravity": 4}, ("timeline", (25, 1)), "#ff000000"),
    ("countdown-clamped", 320, 180, 80, {"mode": 1, "end_time": kf(1.0), "gravity": 1}, ("timeline", (25, 1)), "#ff000000"),
    ("clock-wraps", 320, 180, 31, {"mode": 2, "format": 1, "start_time": kf(86399.5), "gravity": 5}, ("timeline", (30, 1)), "#ff101010"),
    ("clock-mmss-long", 320, 180, 1, {"mode": 2, "start_time": kf(45296)}, ("timeline", (30, 1)), "#ff101010"),
    (
        "timecode-center-no-stroke",
        320, 180, 66,
        {"mode": 3, "gravity": 4, "stroke_width": kf(0), "background_alpha": kf(0.8)},
        ("timeline", (30, 1)), "#ff505050",
    ),
    (
        "frame-number-prefix-suffix",
        320, 180, 12,
        {"mode": 4, "prefix": "F ", "suffix": " #", "start_time": kf(2.0), "gravity": 8},
        ("timeline", (24, 1)), "#ff000000",
    ),
    ("format-frames-count-up", 320, 180, 7, {"format": 4, "gravity": 6}, ("timeline", (30, 1)), "#ff000000"),
    ("source-time-clip", 320, 180, 50, {"time_source": 1}, ("clip", 25, [(1, 1), (100, 300)], None), "#ff000000"),
    ("clip-time-ignores-curve", 320, 180, 50, {"time_source": 0}, ("clip", 25, [(1, 1), (100, 300)], (30, 1)), "#ff000000"),
    ("countdown-clip-duration", 320, 180, 20, {"mode": 1, "time_source": 1}, ("clip", 24, None, None), "#ff000000"),
    ("no-background", 320, 180, 45, {"show_background": 0, "gravity": 2}, ("timeline", (30, 1)), "#ff2a2a2a"),
    (
        "square-box-top-right",
        320, 180, 45,
        {"background_corner": kf(0), "background_padding": kf(30), "gravity": 2, "x_offset": kf(-4.0), "y_offset": kf(5.5)},
        ("timeline", (30, 1)), "#ffd0d0d0",
    ),
    (
        "arial-tabular-digits",
        640, 360, 1234,
        {"font_name": "Arial", "font_size": kf(60), "format": 1, "background": color(0, 80, 200), "background_alpha": kf(0.9)},
        ("timeline", (24, 1)), "#ff000000",
    ),
    ("alpha-clamps", 320, 180, 15, {"background_alpha": kf(1.7), "font_alpha": kf(0.5), "gravity": 12}, ("timeline", (30, 1)), "#ff7f7f7f"),
    (
        "prefix-unicode-clock",
        320, 180, 200,
        {"mode": 2, "prefix": "⏱ ", "format": 1, "start_time": kf(-30), "font_size": kf(40)},
        ("timeline", (25, 1)), "#ff000000",
    ),
    ("negative-start-unclamped", 320, 180, 10, {"start_time": kf(-5.5), "clamp": 0}, ("timeline", (30, 1)), "#ff000000"),
]


def timer_case(name, w, h, frame_no, overrides, parent, bg):
    effect = openshot.Timer()
    j = json.loads(effect.Json())
    j.update(overrides)
    effect.SetJson(json.dumps(j))
    keep = []
    ctx = {"fps": None, "clip": None}
    if parent and parent[0] == "timeline":
        timeline = openshot.Timeline(w, h, openshot.Fraction(*parent[1]), 44100, 2, openshot.LAYOUT_STEREO)
        effect.ParentTimeline(timeline)
        keep.append(timeline)
        ctx["fps"] = list(parent[1])
    elif parent and parent[0] == "clip":
        _, reader_fps, points, timeline_fps = parent
        reader = openshot.DummyReader(openshot.Fraction(reader_fps, 1), w, h, 44100, 2, 30.0)
        reader.Open()
        clip = openshot.Clip(reader)
        if points:
            for x, y in points:
                clip.time.AddPoint(x, y)
        keep += [reader, clip]
        if timeline_fps:
            timeline = openshot.Timeline(w, h, openshot.Fraction(*timeline_fps), 44100, 2, openshot.LAYOUT_STEREO)
            clip.ParentTimeline(timeline)
            keep.append(timeline)
            ctx["fps"] = list(timeline_fps)
        effect.ParentClip(clip)
        mapped = clip.time.GetLong(frame_no) if clip.time.GetLength() > 1 else frame_no
        ctx["clip"] = {"mappedFrame": max(1, mapped), "readerFps": reader.info.fps.ToDouble(), "duration": f32(clip.End() - clip.Start())}
    full_json = json.loads(effect.Json())
    text = effect.TimerText(frame_no)
    full = render(effect, w, h, frame_no, bg)
    with_font_alpha_zero(effect, full_json)
    bg_only = render(effect, w, h, frame_no, bg)
    effect.SetJson(json.dumps(full_json))

    scale = w / 600.0
    px = int(max(1.0, effect.font_size.GetValue(frame_no) * scale))
    metrics = Metrics(effect.font_name, px)
    mode, fmt = effect.mode, effect.format
    if mode == 4 or fmt == 4:
        layout_text = text
    else:
        template = "88:88"
        if mode == 3 or fmt == 3:
            template = "88:88:88:88"
        elif fmt == 2:
            template = "88:88:88.888"
        elif fmt == 1:
            template = "88:88:88"
        layout_text = effect.prefix + template + effect.suffix
    timer_strings(text, layout_text, metrics)
    del keep
    return {
        "width": w,
        "height": h,
        "frame": frame_no,
        "ctx": ctx,
        "input": input_pixel(w, h, bg),
        "effect": slim(full_json),
        "metrics": metrics.doc,
        "timerText": text,
        "layoutText": layout_text,
        "backgroundOnly": pack(bg_only),
        "textBox": diff_bbox(full, bg_only, w, h),
    }


def main():
    doc = {
        "libopenshot": openshot.OPENSHOT_VERSION_FULL,
        "cues": [{"text": t, "cues": qt_cues(t)} for t in CUE_TEXTS],
        "caption": {},
        "timer": {},
    }
    for name, *args in CAPTION_CASES:
        doc["caption"][name] = caption_case(name, *args)
    for name, *args in TIMER_CASES:
        doc["timer"][name] = timer_case(name, *args)
    def compact(v):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))

    # One case per line keeps diffs readable without pretty-printing the payload.
    parts = [f'"libopenshot":{compact(doc["libopenshot"])}', '"cues":[\n' + ",\n".join(compact(c) for c in doc["cues"]) + "\n]"]
    for section in ("caption", "timer"):
        body = ",\n".join(f"{compact(k)}:{compact(v)}" for k, v in doc[section].items())
        parts.append(f'"{section}":{{\n{body}\n}}')
    with open(OUT, "w") as fh:
        fh.write("{\n" + ",\n".join(parts) + "\n}\n")
    size = os.path.getsize(OUT)
    print(f"wrote {len(doc['caption'])} caption and {len(doc['timer'])} timer cases ({size} bytes) to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
