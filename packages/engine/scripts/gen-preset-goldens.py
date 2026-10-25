#!/usr/bin/env python3
"""Run the desktop's export-settings code on synthetic projects.

Dev-time only. Extracts `get_default_export_settings`, `_parse_bitrate_to_bps`
and `Export.calculate_all_formats_bitrate` from zenvi-core
src/windows/export.py at origin/main (with `ast`; the dialog itself needs
Qt), runs them with stub app/settings objects, and records the results for
src/presets/export.test.ts.

    PYTHONPATH=~/zenvi-deps-1.0/python DYLD_LIBRARY_PATH=~/zenvi-deps-1.0/lib \
      ~/Projects/zenvi/.venv/bin/python packages/engine/scripts/gen-preset-goldens.py

Writes src/presets/__fixtures__/desktop-export.json.
"""

import ast
import io
import json
import locale
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import types

import openshot

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "presets", "__fixtures__", "desktop-export.json")
FIXTURE = os.path.join(HERE, "..", "fixtures", "projects", "mountain-montage.zvn")
REPO = os.environ.get("ZENVI_DESKTOP_REPO", os.path.expanduser("~/Projects/zenvi"))
REF = os.environ.get("ZENVI_DESKTOP_REF", "origin/main")


def desktop(path):
    return subprocess.check_output(["git", "-C", REPO, "show", f"{REF}:{path}"]).decode("utf8")


class Project:
    def __init__(self, data):
        self.data = data

    def get(self, key):
        return self.data.get(key)


class Settings:
    actionType = types.SimpleNamespace(EXPORT="export")

    def get(self, _name):
        return None

    def getDefaultPath(self, _action):
        return "/media/exports"


def load():
    tree = ast.parse(desktop("src/windows/export.py"))
    funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ("get_default_export_settings", "_parse_bitrate_to_bps")]
    export_cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Export")
    method = next(n for n in export_cls.body if isinstance(n, ast.FunctionDef) and n.name == "calculate_all_formats_bitrate")
    module = ast.Module(body=[*funcs, ast.ClassDef(name="Dialog", bases=[], keywords=[], body=[method], decorator_list=[])], type_ignores=[])
    ast.fix_missing_locations(module)

    state = {"project": None}
    app = types.SimpleNamespace(get_settings=Settings, _tr=lambda s: s)
    app.__dict__["project"] = property(lambda _self: state["project"])

    class App:
        _tr = staticmethod(lambda s: s)

        @property
        def project(self):
            return state["project"]

        @staticmethod
        def get_settings():
            return Settings()

    classes = types.ModuleType("classes")
    classes.__path__ = []
    app_mod = types.ModuleType("classes.app")
    app_mod.get_app = lambda: App()
    sys.modules["classes"] = classes
    sys.modules["classes.app"] = app_mod
    env = {"os": os, "openshot": openshot, "locale": locale, "maybe_apply_hardware_bitrate": None}
    exec(compile(module, "export.py", "exec"), env)
    return env, state


def spin(value):
    return types.SimpleNamespace(value=lambda: value)


def preset_profiles():
    """The Simple tab's profile combo for every preset (export.py L267-292, L700-790)."""
    tmp = tempfile.mkdtemp(prefix="zenvi-preset-goldens-")
    try:
        archive = subprocess.check_output(["git", "-C", REPO, "archive", REF, "src/profiles", "src/presets"])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(tmp, filter="data")
        folder = os.path.join(tmp, "src", "profiles")
        profile_paths = {}
        profile_names = []
        for file in reversed(sorted(os.listdir(folder))):
            path = os.path.join(folder, file)
            if os.path.isdir(path):
                continue
            profile = openshot.Profile(path)
            name = f"{profile.info.description} ({profile.info.width}x{profile.info.height})"
            profile_names.append(name)
            profile_paths[name] = file

        def get_profile_path(profile_name):
            for profile, key in profile_paths.items():
                if profile_name in profile:
                    return key

        from xml.dom import minidom
        out = {}
        presets = os.path.join(tmp, "src", "presets")
        for file in sorted(os.listdir(presets)):
            doc = minidom.parse(os.path.join(presets, file))
            names = sorted(p.childNodes[0].data for p in doc.getElementsByTagName("projectprofile"))
            if names:
                out[file[:-4]] = [get_profile_path(n) for n in names]
        return out, [profile_paths[n] for n in profile_names]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    env, state = load()
    with open(FIXTURE) as fh:
        mountain = json.load(fh)
    base = {"fps": {"num": 30, "den": 1}, "width": 1280, "height": 720, "sample_rate": 48000, "channels": 2,
            "duration": 300, "export_settings": None, "export_overrides": {}}
    cases = [
        ("defaults", dict(base)),
        ("empty-project", {}),
        ("fractional-duration", {**base, "duration": 12.9, "fps": {"num": 30000, "den": 1001}}),
        ("saved-dialog", {**base, "export_settings": mountain["export_settings"]}),
        ("saved-crf-video-only", {**base, "export_settings": [
            {"name": "txtVideoBitRate", "type": "QLineEdit", "value": "21 crf"},
            {"name": "cboExportTo", "type": "QComboBox", "value": 1},
            {"name": "cboChannelLayout", "type": "QComboBox", "value": 0},
        ]}),
        ("overrides", {**base, "export_overrides": {
            "width": 640, "height": 360, "fps_num": 25, "fps_den": 1, "vcodec": "libx265", "format": "mkv",
            "acodec": "libopus", "sample_rate": 44100, "channels": 1, "start_frame": 10, "end_frame": 99,
            "output_path": "/out/clip.mkv", "unknown": "zzz",
        }}),
    ]
    settings = []
    for name, data in cases:
        state["project"] = Project(data)
        video, audio, export_type, default_path = env["get_default_export_settings"]()
        settings.append({"name": name, "project": data, "video": video, "audio": audio, "exportType": export_type, "defaultPath": default_path})

    rates = ["3.32 Mb/s", "500 kb/s", "15.00 Mb/s", "1.7 Mb/s", "23 crf", "70 crf", "22 cqp", "300 qp", "-3 crf",
             "0 crf", "160 qp", "8", "", "   ", "abc Mb/s", "5 bananas", "0 kb/s", "1536 kb/s", "2.05 Mb/s"]
    parsed = [[r, env["_parse_bitrate_to_bps"](r, default=None)] for r in rates]

    dialog = env["Dialog"]()
    bitrates = []
    for w, h, num, den in [(1920, 1080, 30, 1), (1280, 720, 30, 1), (3840, 2160, 60000, 1001), (1080, 1920, 24000, 1001),
                           (720, 576, 25, 1), (640, 360, 15, 1), (7680, 4320, 60, 1), (0, 720, 30, 1)]:
        dialog.txtWidth, dialog.txtHeight, dialog.txtFrameRateNum, dialog.txtFrameRateDen = spin(w), spin(h), spin(num), spin(den)
        for quality in ("Low", "Med", "High"):
            bitrates.append([w, h, num, den, quality, dialog.calculate_all_formats_bitrate(quality)])

    profiles, all_profiles = preset_profiles()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump({
            "source": f"zenvi-core {REF} src/windows/export.py",
            "settings": settings,
            "parse": parsed,
            "allFormats": bitrates,
            "presetProfiles": profiles,
            "allProfiles": all_profiles,
        }, fh, indent=1)
        fh.write("\n")
    print(f"wrote {len(settings)} settings cases, {len(parsed)} rates, {len(bitrates)} bitrates to {OUT}")


if __name__ == "__main__":
    main()
