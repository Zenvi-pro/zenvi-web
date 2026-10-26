#!/usr/bin/env python3
"""One frame of a Zenvi project as Zenvi desktop renders it (libopenshot 1.0
Timeline from the project JSON), saved as a PNG. Used to check native
features (kinetic captions: SVG title clips with keyframes) against the
engine's render (`zenvi frame`).

Run with the desktop's Python and the libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/project_frame.py PROJECT.zvn FRAME OUT.png

FRAME is 1-based, like libopenshot (frame n shows time (n - 1) / fps).
"""

import json
import os
import sys

import openshot
from PyQt5.QtGui import QGuiApplication


def main():
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    app = QGuiApplication([])  # noqa: F841
    project_path, frame, out = sys.argv[1], int(sys.argv[2]), os.path.abspath(sys.argv[3])
    with open(project_path) as fh:
        project = json.load(fh)
    # Media paths in a project are relative to its folder, generated files under `@assets/` in
    # `<project>_assets/`, as the desktop stores them (its project loader expands them the same way).
    os.chdir(os.path.dirname(os.path.abspath(project_path)))
    assets = os.path.splitext(os.path.abspath(project_path))[0] + "_assets/"
    text = json.dumps(project).replace('"@assets/', json.dumps(assets)[:-1])
    project = json.loads(text)
    fps = project["fps"]
    t = openshot.Timeline(project["width"], project["height"], openshot.Fraction(fps["num"], fps["den"]),
                          project.get("sample_rate", 48000), project.get("channels", 2), openshot.LAYOUT_STEREO)
    # The desktop loads the whole project JSON into its timeline (UpdateManager load action).
    t.SetJson(json.dumps(project))
    t.Open()
    t.GetFrame(frame).Save(out, 1.0)
    t.Close()
    print(out)


if __name__ == "__main__":
    main()
