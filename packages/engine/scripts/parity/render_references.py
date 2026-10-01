#!/usr/bin/env python3
"""Reference frames from libopenshot 1.0 for the engine's frame parity suite.

Generates small media with ffmpeg (lossless RGB so both renderers decode the
same pixels), builds one project per case the way the desktop builds clips
(``openshot.Clip(path).Json()``, ``EffectInfo().CreateEffect(type).Json()``),
renders the listed frames with ``openshot.Timeline`` (``SetJson`` + ``Open``
+ ``GetFrame``) and writes raw RGBA references plus a manifest.

Usage (the vitest suite ``render/parity/frame-parity.test.ts`` runs this)::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/render_references.py <output-dir>
"""

import copy
import json
import os
import subprocess
import sys

import openshot

W, H = 320, 180
FPS = {"num": 30, "den": 1}


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def make_media(out):
    def p(name):
        return os.path.join(out, name)

    # Lossless RGB video (PNG codec): FFmpegReader and the test decode identical pixels.
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2", "-c:v", "png", "-pix_fmt", "rgb24", p("bars.mkv"))
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=192x108:r=24:d=2", "-c:v", "png", "-pix_fmt", "rgb24", p("clock24.mkv"))
    # Opaque still with smooth gradients (resampling-sensitive).
    ffmpeg("-f", "lavfi", "-i", "gradients=s=200x120:c0=0x2050c0:c1=0xf0a020:x0=0:y0=0:x1=200:y1=120:seed=1",
           "-frames:v", "1", "-pix_fmt", "rgb24", p("grad.png"))
    # RGBA still: a soft-edged disc with a color ramp.
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=120x90,format=rgba",
           "-vf", "geq=r='255*X/W':g='80+100*Y/H':b='200':a='255*clip((44-hypot(X-60,Y-45))/6,0,1)'",
           "-frames:v", "1", "-pix_fmt", "rgba", p("logo.png"))
    # Grayscale wipe mask (dark on the left: revealed first).
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=160x90,format=rgba",
           "-vf", "geq=r='255*X/W':g='255*X/W':b='255*X/W':a='255'",
           "-frames:v", "1", "-pix_fmt", "rgba", p("mask.png"))
    # Green screen still with a subject.
    ffmpeg("-f", "lavfi", "-i", "color=c=0x14e61e:s=160x120,format=rgba",
           "-vf", "geq=r='if(lt(hypot(X-80,Y-60),35),220,20)':g='if(lt(hypot(X-80,Y-60),35),120,230)':b='if(lt(hypot(X-80,Y-60),35),80,30)':a='255'",
           "-frames:v", "1", "-pix_fmt", "rgba", p("green.png"))
    return {name: p(name) for name in ["bars.mkv", "clock24.mkv", "grad.png", "logo.png", "mask.png", "green.png"]}


def kf(*points):
    """Keyframe JSON from (x, y[, interpolation]) tuples (BEZIER=0, LINEAR=1, CONSTANT=2)."""
    out = []
    for pt in points:
        x, y = pt[0], pt[1]
        interp = pt[2] if len(pt) > 2 else 1
        p = {"co": {"X": float(x), "Y": float(y)}, "interpolation": interp}
        if interp == 0:
            p["handle_left"] = {"X": 0.5, "Y": 1.0}
            p["handle_right"] = {"X": 0.5, "Y": 0.0}
            p["handle_type"] = 0
        out.append(p)
    return {"Points": out}


_ids = [0]


def new_id(prefix="C"):
    _ids[0] += 1
    return f"{prefix}{_ids[0]:09d}"


def clip(media, name, position=0.0, layer=1, start=0.0, end=None, **props):
    c = openshot.Clip(media[name])
    j = json.loads(c.Json())
    j["id"] = new_id()
    j["file_id"] = "F-" + name
    j["position"] = position
    j["layer"] = layer
    j["start"] = start
    if end is not None:
        j["end"] = end
    effects = props.pop("effects", [])
    for k, v in props.items():
        j[k] = v
    j["effects"] = effects
    return j


def effect(etype, **props):
    e = openshot.EffectInfo().CreateEffect(etype)
    j = json.loads(e.Json())
    j["id"] = new_id("E")
    for k, v in props.items():
        j[k] = v
    return j


def mask_transition(media, mask_name, position, duration, layer, contrast=3.0):
    """The dict the desktop's addTransition builds (zenvi-core timeline.py:5799-5819)."""
    brightness = openshot.Keyframe()
    brightness.AddPoint(1, 1.0, openshot.BEZIER)
    brightness.AddPoint(round(duration * FPS["num"] / FPS["den"]) + 1, -1.0, openshot.BEZIER)
    return {
        "id": new_id("T"),
        "layer": layer,
        "title": "Transition",
        "type": "Mask",
        "position": position,
        "start": 0,
        "end": duration,
        "resource": media[mask_name],
        "brightness": json.loads(brightness.Json()),
        "contrast": json.loads(openshot.Keyframe(contrast).Json()),
        "reader": json.loads(openshot.QtImageReader(media[mask_name]).Json()),
        "replace_image": False,
    }


def project(clips, effects=(), width=W, height=H, fps=None):
    return {
        "id": "T0",
        "fps": fps or FPS,
        "display_ratio": {"num": 16, "den": 9},
        "pixel_ratio": {"num": 1, "den": 1},
        "width": width,
        "height": height,
        "sample_rate": 48000,
        "channels": 2,
        "channel_layout": 3,
        "duration": 10,
        "clips": clips,
        "effects": list(effects),
        "files": [],
        "layers": [{"id": f"L{i}", "number": n, "label": "", "y": 0, "lock": False} for i, n in enumerate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
        "markers": [],
        "version": {"openshot-qt": "1.0.188", "libopenshot": "1.0.0"},
    }


def cases(media):
    full = {"gravity": 4, "scale": 1}
    out = []
    out.append(("identity-video", project([clip(media, "bars.mkv", **full)]), [1, 15, 45]))
    out.append(("fit-still", project([clip(media, "grad.png", end=3.0)]), [1]))
    out.append(("stretch-24fps-video", project([clip(media, "clock24.mkv", scale=2)]), [1, 10, 31]))
    out.append(("crop-mode-location", project([clip(media, "grad.png", end=3.0, scale=0, location_x=kf((1, 0.2)), location_y=kf((1, -0.1)))]), [1]))
    out.append(("none-scale-double", project([clip(media, "logo.png", end=3.0, scale=3, gravity=0, scale_x=kf((1, 0.5)), scale_y=kf((1, 0.5)))]), [1]))
    grav = [clip(media, "logo.png", end=3.0, layer=i + 1, gravity=i, scale_x=kf((1, 0.3)), scale_y=kf((1, 0.3))) for i in range(9)]
    out.append(("gravity-grid", project(grav), [1]))
    bez = clip(media, "bars.mkv", scale_x=kf((1, 0.5, 0), (30, 0.9, 0)), scale_y=kf((1, 0.5, 0), (30, 0.7, 0)),
               location_x=kf((1, -0.2, 0), (30, 0.25, 0)), rotation=kf((1, 0, 0), (30, 40, 0)))
    out.append(("keyframes-bezier", project([bez]), [1, 10, 20, 30]))
    lin = clip(media, "bars.mkv", scale_x=kf((1, 0.6)), scale_y=kf((1, 0.6)), rotation=kf((1, -15, 1), (25, 25, 1)),
               location_y=kf((1, 0.0, 2), (12, 0.15, 2)), shear_x=kf((1, 0.0, 1), (25, 0.3, 1)), origin_x=kf((1, 0.2)))
    out.append(("keyframes-linear-constant", project([lin]), [1, 12, 25]))
    bg = clip(media, "grad.png", end=3.0, layer=1)
    fade = clip(media, "bars.mkv", layer=2, alpha=kf((1, 0.0), (30, 1.0)), scale_x=kf((1, 0.8)), scale_y=kf((1, 0.8)))
    out.append(("alpha-fade", project([bg, fade]), [1, 8, 15, 29]))
    base = clip(media, "bars.mkv", layer=1)
    top = clip(media, "logo.png", end=3.0, layer=2, scale_x=kf((1, 0.6)), scale_y=kf((1, 0.6)), location_x=kf((1, 0.15)), location_y=kf((1, 0.1)))
    out.append(("two-layer-composite", project([base, top]), [1, 30]))
    a = clip(media, "grad.png", position=0.0, end=2.0, layer=1)
    b = clip(media, "bars.mkv", position=1.0, end=2.0, layer=1)
    tr = mask_transition(media, "mask.png", position=1.0, duration=1.0, layer=1)
    out.append(("mask-transition", project([a, b], [tr]), [31, 38, 46, 55, 60]))
    color = clip(media, "bars.mkv", effects=[
        effect("Brightness", brightness=kf((1, 0.15)), contrast=kf((1, 12))),
        effect("Saturation", saturation=kf((1, 1.8))),
    ])
    out.append(("effects-brightness-saturation", project([color]), [1, 30]))
    blurred = clip(media, "grad.png", end=3.0, layer=1, effects=[effect("Blur", horizontal_radius=kf((1, 4)), vertical_radius=kf((1, 2)), iterations=kf((1, 2)))])
    pix = clip(media, "bars.mkv", layer=2, scale_x=kf((1, 0.5)), scale_y=kf((1, 0.5)), gravity=2, effects=[effect("Pixelate", pixelization=kf((1, 0.7)))])
    out.append(("effects-blur-pixelate", project([blurred, pix]), [1, 20]))
    cropped = clip(media, "bars.mkv", layer=1, effects=[effect("Crop", left=kf((1, 0.1)), right=kf((1, 0.2)), top=kf((1, 0.1)))])
    resized = clip(media, "grad.png", end=3.0, layer=2, scale_x=kf((1, 0.5)), scale_y=kf((1, 0.5)), gravity=8,
                   effects=[effect("Crop", left=kf((1, 0.25)), right=kf((1, 0.25)), top=kf((1, 0.2)), resize=True)])
    out.append(("effects-crop", project([cropped, resized]), [1]))
    keyed = clip(media, "green.png", end=3.0, layer=2, effects=[effect("ChromaKey", color={"red": kf((1, 20)), "green": kf((1, 230)), "blue": kf((1, 30)), "alpha": kf((1, 255))}, fuzz=kf((1, 60)), halo=kf((1, 30)))])
    out.append(("chroma-key", project([clip(media, "bars.mkv", layer=1), keyed]), [1]))
    blends = [clip(media, "bars.mkv", layer=1)]
    for i, mode in enumerate([13, 14, 22, 12]):
        blends.append(clip(media, "logo.png", end=3.0, layer=2 + i, composite=mode, gravity=[0, 2, 6, 8][i], scale_x=kf((1, 0.7)), scale_y=kf((1, 0.7))))
    out.append(("blend-modes", project(blends), [1]))
    out.append(("corner-radius", project([clip(media, "grad.png", end=3.0, layer=1), clip(media, "bars.mkv", layer=2, scale_x=kf((1, 0.7)), scale_y=kf((1, 0.7)), corner_radius=kf((1, 0.15)))]), [1]))
    remap = clip(media, "bars.mkv", time=kf((1, 60), (60, 1)))
    out.append(("time-remap-reverse", project([remap]), [1, 20, 45]))
    parent = clip(media, "grad.png", end=3.0, layer=1, scale_x=kf((1, 0.8)), scale_y=kf((1, 0.8)), rotation=kf((1, 10)), location_x=kf((1, 0.05)))
    child = clip(media, "logo.png", end=3.0, layer=2, scale_x=kf((1, 0.5)), scale_y=kf((1, 0.5)), parentObjectId=parent["id"])
    out.append(("parent-clip", project([parent, child]), [1]))
    shadow = clip(media, "logo.png", end=3.0, layer=2, scale_x=kf((1, 0.7)), scale_y=kf((1, 0.7)), rotation=kf((1, 12)), effects=[effect("Shadow")])
    out.append(("shadow-after-transform", project([clip(media, "grad.png", end=3.0, layer=1), shadow]), [1]))
    glow = clip(media, "logo.png", end=3.0, layer=2, effects=[effect("Glow")])
    out.append(("glow", project([clip(media, "bars.mkv", layer=1), glow]), [1]))
    blended = clip(media, "logo.png", end=3.0, layer=2, composite=13, location_x=kf((1, 0.2)), effects=[effect("Shadow")])
    out.append(("shadow-blend-mode", project([clip(media, "bars.mkv", layer=1), blended]), [1]))
    out.append(("ntsc-timeline", project([clip(media, "bars.mkv", scale=2)], fps={"num": 30000, "den": 1001}), [1, 17, 40]))
    out.append(("time-remap-slow", project([clip(media, "bars.mkv", time=kf((1, 1), (60, 30.5)))]), [1, 9, 40]))
    mask_json = json.loads(openshot.QtImageReader(media["mask.png"]).Json())
    masked = clip(media, "bars.mkv", scale_x=kf((1, 0.8)), scale_y=kf((1, 0.8)), effects=[effect("Brightness", brightness=kf((1, 0.4)), mask_reader=mask_json)])
    out.append(("effect-mask-reader", project([masked]), [1]))
    masked_still = clip(media, "logo.png", end=3.0, effects=[effect("Saturation", saturation=kf((1, 0.0)), mask_reader=mask_json)])
    out.append(("effect-mask-reader-still", project([clip(media, "grad.png", end=3.0, layer=0), masked_still]), [1]))
    displaced = clip(media, "grad.png", end=3.0, effects=[effect("Displace", map_reader=mask_json)])
    out.append(("displace-map", project([displaced]), [1]))
    rounded = clip(media, "bars.mkv", layer=2, scale_x=kf((1, 0.6)), scale_y=kf((1, 0.6)), rotation=kf((1, 20)), alpha=kf((1, 0.7)), corner_radius=kf((1, 0.25)))
    out.append(("corner-rotate-alpha", project([clip(media, "grad.png", end=3.0, layer=1), rounded]), [1]))
    cropped = clip(media, "bars.mkv", rotation=kf((1, 15)), scale_x=kf((1, 0.7)), scale_y=kf((1, 0.7)), effects=[effect("Crop", left=kf((1, 0.2)), right=kf((1, 0.1)), resize=True)])
    out.append(("crop-resize-rotate", project([cropped]), [1]))
    return out


def render(proj, frames, out_prefix, max_size=None, export_size=None):
    t = openshot.Timeline(proj["width"], proj["height"], openshot.Fraction(proj["fps"]["num"], proj["fps"]["den"]), 48000, 2, openshot.LAYOUT_STEREO)
    t.SetJson(json.dumps(proj))
    t.Open()
    openshot.Settings.Instance().HIGH_QUALITY_SCALING = export_size is not None
    if export_size:
        # The desktop exporter (windows/export.py:990-1060): the canvas becomes the export size.
        t.info.width, t.info.height = export_size
        t.SetMaxSize(export_size[0], export_size[1])
    if max_size:
        t.SetMaxSize(max_size[0], max_size[1])
    refs = {}
    for n in frames:
        f = t.GetFrame(n)
        data = f.GetPixelsBytes()
        path = f"{out_prefix}-{n}.rgba"
        with open(path, "wb") as fh:
            fh.write(bytes(data))
        refs[str(n)] = {"path": path, "width": f.GetWidth(), "height": f.GetHeight()}
    t.Close()
    return refs


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    media = make_media(out)
    manifest = {"libopenshot": openshot.OPENSHOT_VERSION_FULL, "media": media, "cases": []}
    for name, proj, frames in cases(media):
        proj_path = os.path.join(out, f"{name}.json")
        with open(proj_path, "w") as fh:
            json.dump(proj, fh)
        refs = render(copy.deepcopy(proj), frames, os.path.join(out, name))
        manifest["cases"].append({"name": name, "project": proj_path, "frames": refs})
    # Preview rendering: SetMaxSize shrinks the canvas and every clip consistently.
    name = "preview-160x90"
    proj = project([clip(media, "bars.mkv", layer=1, scale_x=kf((1, 0.6)), scale_y=kf((1, 0.6)), rotation=kf((1, 12))), clip(media, "logo.png", end=3.0, layer=2, gravity=0)])
    proj_path = os.path.join(out, f"{name}.json")
    with open(proj_path, "w") as fh:
        json.dump(proj, fh)
    refs = render(copy.deepcopy(proj), [1, 20], os.path.join(out, name), max_size=(160, 90))
    manifest["cases"].append({"name": name, "project": proj_path, "frames": refs, "preview": [160, 90]})
    # Export below the project size: bicubic decoder scaling, canvas = export size.
    name = "export-192x108"
    proj_path = os.path.join(out, f"{name}.json")
    with open(proj_path, "w") as fh:
        json.dump(proj, fh)
    refs = render(copy.deepcopy(proj), [1, 20], os.path.join(out, name), export_size=(192, 108))
    manifest["cases"].append({"name": name, "project": proj_path, "frames": refs, "export": [192, 108]})
    openshot.Settings.Instance().HIGH_QUALITY_SCALING = False
    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(os.path.join(out, "manifest.json"))


if __name__ == "__main__":
    main()
