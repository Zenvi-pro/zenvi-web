#!/usr/bin/env python3
"""Run the desktop's own project load code on synthetic inputs.

Dev-time only. Records input/output pairs for src/io/*.test.ts from
zenvi-core at origin/main:

- `ProjectDataStore.upgrade_project_data_structures` and its helpers
  (src/classes/project_data.py, extracted with `ast`, plus the pure
  src/classes/clip_placement.py and image_types.py it imports), run with the
  real libopenshot 1.0 bindings;
- the stored-path conversion of src/classes/json_data.py
  (`convert_paths_to_relative` / `convert_paths_to_absolute`) with
  src/classes/assets.py, once with `posixpath` and once with `ntpath` as
  `os.path`, so the Windows rules are checked on any machine.

    PYTHONPATH=~/zenvi-deps-1.0/python DYLD_LIBRARY_PATH=~/zenvi-deps-1.0/lib \
      ~/Projects/zenvi/.venv/bin/python packages/engine/scripts/gen-io-goldens.py

Writes src/io/__fixtures__/desktop-upgrades.json.
"""

import ast
import copy
import json
import ntpath
import os
import posixpath
import subprocess
import sys
import types

import openshot

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "io", "__fixtures__", "desktop-upgrades.json")
REPO = os.environ.get("ZENVI_DESKTOP_REPO", os.path.expanduser("~/Projects/zenvi"))
REF = os.environ.get("ZENVI_DESKTOP_REF", "origin/main")

METHODS = [
    "upgrade_project_data_structures",
    "_numeric_version",
    "_version_at_most",
    "_keyframe_value",
    "_legacy_location_factor",
    "_migrate_legacy_crop_locations",
    "_migrate_400_non_crop_locations",
    "is_keyframe_valid",
]


def desktop(path):
    return subprocess.check_output(["git", "-C", REPO, "show", f"{REF}:{path}"]).decode("utf8")


def package():
    """The `classes` package the desktop modules import from (created once)."""
    pkg = sys.modules.get("classes")
    if pkg is None:
        pkg = types.ModuleType("classes")
        pkg.__path__ = []
        sys.modules["classes"] = pkg
    return pkg


def install(name, source=None, attrs=None):
    """Register `classes.<name>` from desktop source (or plain attributes)."""
    mod = types.ModuleType(f"classes.{name}")
    if attrs:
        mod.__dict__.update(attrs)
    sys.modules[f"classes.{name}"] = mod
    setattr(package(), name, mod)
    if source is not None:
        exec(compile(source, f"src/classes/{name}.py", "exec"), mod.__dict__)
    return mod


class Log:
    def __getattr__(self, _name):
        return lambda *a, **k: None


def load_store():
    """A minimal ProjectDataStore: the real upgrade methods over `self._data`."""
    install("image_types", desktop("src/classes/image_types.py"))
    clip_placement = install("clip_placement", desktop("src/classes/clip_placement.py"))

    tree = ast.parse(desktop("src/classes/project_data.py"))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "ProjectDataStore")
    methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in METHODS]
    assert {m.name for m in methods} == set(METHODS), "desktop upgrade methods moved"
    module = ast.Module(body=[ast.ClassDef(name="Store", bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])
    ast.fix_missing_locations(module)

    ids = {"next": None}

    def generate_id(*_args):
        return next(ids["next"])

    project = types.SimpleNamespace(generate_id=generate_id)
    env = {
        "json": json,
        "re": __import__("re"),
        "openshot": openshot,
        "log": Log(),
        "get_app": lambda: types.SimpleNamespace(project=project),
        "repair_audio_only_project_data": clip_placement.repair_audio_only_project_data,
    }
    exec(compile(module, "project_data.py", "exec"), env)
    store_cls = env["Store"]
    store_cls.generate_id = generate_id

    def reset_ids(_self):
        ids["next"] = iter(f"MIGRATED{n:02d}" for n in range(1, 100))

    store_cls.reset_ids = reset_ids
    return store_cls()


def kf(*points):
    """Keyframe from (x, y[, interpolation[, handle_left, handle_right]]) tuples."""
    out = []
    for p in points:
        x, y = p[0], p[1]
        interp = p[2] if len(p) > 2 else 0
        point = {"co": {"X": x, "Y": y}, "interpolation": interp}
        if interp == 0:
            hl = p[3] if len(p) > 3 else (0.5, 1.0)
            hr = p[4] if len(p) > 4 else (0.5, 0.0)
            point["handle_left"] = {"X": hl[0], "Y": hl[1]}
            point["handle_right"] = {"X": hr[0], "Y": hr[1]}
            point["handle_type"] = 0
        out.append(point)
    return {"Points": out}


def color(r, g, b, a=255):
    return {"red": kf((1, r)), "green": kf((1, g)), "blue": kf((1, b)), "alpha": kf((1, a))}


def reader(width, height, path="/media/clip.mp4", **extra):
    data = {"path": path, "width": width, "height": height, "has_video": True, "has_audio": True}
    data.update(extra)
    return data


def clip(cid, **props):
    data = {
        "id": cid, "file_id": props.pop("file_id", "F1"), "position": 0.0, "start": 0.0, "end": 5.0,
        "layer": 1000000, "gravity": 4, "scale": 1, "effects": [],
        "location_x": kf((1, 0.0)), "location_y": kf((1, 0.0)),
        "scale_x": kf((1, 1.0)), "scale_y": kf((1, 1.0)), "alpha": kf((1, 1.0)),
        "reader": reader(1920, 1080),
    }
    data.update(props)
    return data


def project(version, libopenshot, clips=(), files=(), effects=(), pid="P1"):
    return {
        "id": pid, "width": 1280, "height": 720, "fps": {"num": 30, "den": 1},
        "clips": list(clips), "files": list(files), "effects": list(effects),
        "version": {"openshot-qt": version, "libopenshot": libopenshot},
    }


CUSTOM = ((0.2, 0.9), (0.3, 0.1))


def cases():
    yield "beta-alpha-flip", project("0.0.0", "0.0.0", clips=[
        clip("C1", alpha=kf((1, 1.0, 0, (0.5, 0.75), (0.5, 0.25)), (30, 0.25, 1))),
        clip("C2", alpha=kf((1, 0.0))),
    ])
    yield "openshot-2.0-handles", project("2.0.7", "0.1.1", clips=[
        clip("C1",
             location_x=kf((1, 0.0, 0, *CUSTOM), (60, 0.5, 0, *CUSTOM)),
             wave_color=color(10, 20, 30),
             effects=[{"id": "E1", "type": "Blur", "class_name": "Blur", "sigma": kf((1, 3.0, 0, *CUSTOM))}]),
    ], effects=[{"id": "T1", "type": "Mask", "layer": 1000000, "position": 0.0, "start": 0.0, "end": 1.0,
                 "brightness": kf((1, 1.0, 0, *CUSTOM), (31, -1.0, 0, *CUSTOM)), "contrast": kf((1, 3.0))}])
    yield "openshot-2.5-crop", project("2.5.1", "0.2.5", clips=[
        clip("C1", crop_x=kf((1, 0.1)), crop_y=kf((1, 0.0)), crop_width=kf((1, 0.5)), crop_height=kf((1, 1.0))),
        clip("C2", crop_x=kf((1, 0.0)), crop_y=kf((1, 0.0)), crop_width=kf((1, 1.0)), crop_height=kf((1, 1.0))),
        clip("C3", crop_height=kf((1, 1.0), (90, 0.5))),
        clip("C4"),
    ])
    tracker = {
        "id": "E1", "type": "Tracker", "class_name": "Tracker", "name": "Tracker",
        "display_box_text": kf((1, 0.0, 2)),
        "objects": {"E1-1": {"child_clip_id": "C2", "background_alpha": kf((1, 0.25)), "stroke_alpha": kf((1, 1.0), (10, 0.5))}},
    }
    detector = {"id": "E2", "type": "ObjectDetection", "class_name": "ObjectDetection", "name": "Object Detector",
                "display_box_text": {"Points": []}, "objects": {}}
    yield "openshot-3.1-tracked-objects", project("3.1.1", "0.3.2", clips=[
        clip("C1", effects=[tracker, detector]),
        clip("C2", parentObjectId=""),
    ])
    yield "libopenshot-0.x-crop-locations", project("3.2.0", "0.4.0", clips=[
        clip("C1", scale=0, gravity=4, location_y=kf((1, 0.5), (30, -0.25)), reader=reader(1000, 1000)),
        clip("C2", scale=0, gravity=1, location_y=kf((1, 0.5), (30, -0.5)), scale_y=kf((1, 1.0), (30, 2.0)), reader=reader(1000, 1000)),
        clip("C3", scale=0, gravity=8, location_x=kf((1, -0.4), (45, 0.3)), location_y=kf((1, 0.2)), reader=reader(640, 480)),
        clip("C4", scale=1, location_y=kf((1, 0.5)), reader=reader(1000, 1000)),
        clip("C5", scale=0, location_y=kf((1, 0.5)), reader={}, file_id="F2"),
    ], files=[{"id": "F2", "path": "/media/b.mp4", "width": 400, "height": 800}])
    yield "openshot-4.0.0-locations", project("4.0.0", "1.0.0", clips=[
        clip("C1", scale=1, gravity=4, location_x=kf((1, 0.5)), location_y=kf((1, -0.5)), reader=reader(1920, 1080)),
        clip("C2", scale=2, gravity=0, location_x=kf((1, 0.25), (20, -0.25)), margin=kf((1, 0.1)), reader=reader(640, 360)),
        clip("C3", scale=3, gravity=7, location_y=kf((1, 0.3)), scale_y=kf((1, 0.5)), reader=reader(320, 240)),
        clip("C4", scale=0, location_x=kf((1, 0.5)), reader=reader(1920, 1080)),
    ])
    yield "openshot-4.0.0-rc-untouched", project("4.0.0-rc1", "1.0.0", clips=[
        clip("C1", scale=1, location_x=kf((1, 0.5)), reader=reader(1920, 1080)),
    ])
    yield "audio-only-repair", project("1.0.150", "1.0.0", clips=[
        clip("C1", file_id="A1", reader=reader(720, 480, path="/media/song.mp3", has_video=True)),
        clip("C2", file_id="", reader=reader(720, 480, path="/media/song.mp3", has_video=True, id="A1")),
        clip("C3", file_id="V1"),
    ], files=[
        {"id": "A1", "path": "/media/song.mp3", "has_video": True, "has_audio": True, "media_type": "audio"},
        {"id": "V1", "path": "/media/clip.mp4", "has_video": True, "has_audio": True, "media_type": "video"},
    ])
    yield "template-id", project("1.0.188", "1.0.0", pid="T0")
    # The desktop string-compares "1.0.188" <= "2.1.0-dev" and resets these
    # handles on every load; the engine keeps them (see src/io/migrate.ts).
    yield "zenvi-1.0-handles", project("1.0.188", "1.0.0", clips=[
        clip("C1", location_x=kf((1, 0.0, 0, *CUSTOM), (60, 0.5, 0, *CUSTOM))),
    ])


def path_store(flavor):
    """json_data.JsonDataStore with `os.path` = posixpath or ntpath and stub app folders."""
    pathmod = ntpath if flavor == "win32" else posixpath
    fake_os = types.ModuleType("os")
    fake_os.__dict__.update(os.__dict__)
    fake_os.path = pathmod
    fake_os.sep = pathmod.sep

    if flavor == "win32":
        app, home, project_file = r"C:\Program Files\Zenvi", r"C:\Users\me", r"C:\Users\me\Videos\Trip\trip.zvn"
    else:
        app, home, project_file = "/opt/zenvi", "/home/me", "/home/me/Videos/Trip/trip.zvn"
    user = pathmod.join(home, ".openshot_qt")
    assets = pathmod.join(pathmod.dirname(project_file), "trip_assets")
    install("info", attrs={
        "PATH": app,
        "COLORS_PATH": pathmod.join(app, "colors"),
        "USER_PATH": user,
        "BACKUP_FILE": pathmod.join(user, "backup.zvn"),
        "RECOVERY_PATH": pathmod.join(user, "recovery"),
        # After a load or save the desktop points this into the project assets.
        "THUMBNAIL_PATH": pathmod.join(assets, "thumbnail"),
    })
    info = sys.modules["classes.info"]
    install("logger", attrs={"log": Log()})
    install("app", attrs={"get_app": lambda: None})
    assets_mod = install("assets", desktop("src/classes/assets.py"))
    assets_mod.os = fake_os
    json_data = install("json_data", desktop("src/classes/json_data.py"))
    json_data.os = fake_os
    store = json_data.JsonDataStore()
    roots = {
        "transitions": pathmod.join(app, "transitions"),
        "emojis": pathmod.join(app, "emojis", "color", "svg"),
        "colors": info.COLORS_PATH,
        "assets": assets,
        "thumbnails": info.THUMBNAIL_PATH,
    }

    def to_stored(path):
        return json.loads(store.convert_paths_to_relative(project_file, None, json.dumps({"path": path})))["path"]

    def from_stored(path):
        return json.loads(store.convert_paths_to_absolute(project_file, json.dumps({"path": path})))["path"]

    return pathmod, project_file, roots, to_stored, from_stored


def path_cases(flavor):
    pathmod, project_file, roots, to_stored, from_stored = path_store(flavor)
    folder = pathmod.dirname(project_file)
    j = pathmod.join
    store_inputs = [
        j(folder, "clip.mp4"),
        j(folder, "media", "a b.mp4"),
        j(folder, "media", "..", "clip.mp4"),
        j(pathmod.dirname(folder), "other.mp4"),
        j(roots["transitions"], "common", "fade.svg"),
        j(roots["transitions"], "extra", "board_1.jpg"),
        j(roots["emojis"], "1F600.svg"),
        j(roots["colors"], "cinematic_&_blockbuster", "teal_cinema.cube"),
        j(roots["assets"], "title", "Title 1.svg"),
        j(roots["assets"], "media", "generated_0a1b.mp4"),
        j(roots["thumbnails"], "ABCDEFGHIJ.png"),
        "relative/x.mp4",
        "../up.mp4",
        "",
    ]
    if flavor == "win32":
        store_inputs += [r"D:\Media\x.mp4", "C:/Users/me/Videos/Trip/fwd/slash.mp4", r"c:\users\me\videos\trip\lower.mp4"]
    load_inputs = [
        "clip.mp4",
        "media/a b.mp4",
        "../media/x.mp4",
        "@transitions/common/fade.svg",
        "@emojis/1F600.svg",
        "@colors/cinematic_&_blockbuster/teal_cinema.cube",
        "@assets/title/Title 1.svg",
        "thumbnail/ABCDEFGHIJ.png",
        j(pathmod.dirname(folder), "abs.mp4"),
        "",
    ]
    if flavor == "win32":
        load_inputs += ["D:/Media/x.mp4"]
    return {
        "projectFile": project_file,
        "projectDir": folder,
        "roots": roots,
        "store": [[p, to_stored(p)] for p in store_inputs],
        "load": [[p, from_stored(p)] for p in load_inputs],
    }


def main():
    paths = {flavor: path_cases(flavor) for flavor in ("posix", "win32")}
    store = load_store()
    out = {
        "source": f"zenvi-core {REF} src/classes/project_data.py, json_data.py, assets.py",
        "cases": [],
        "paths": paths,
    }
    for name, data in cases():
        store._data = copy.deepcopy(data)
        store.reset_ids()
        store.upgrade_project_data_structures()
        out["cases"].append({"name": name, "input": data, "output": store._data})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")
    print(f"wrote {len(out['cases'])} upgrade cases and path cases to {OUT}")


if __name__ == "__main__":
    main()
