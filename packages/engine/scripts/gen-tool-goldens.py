#!/usr/bin/env python3
"""Record zenvi-core's own tool output for the golden fixture project.

Exports the desktop's src/ at the contract ref (git archive, the desktop
working tree is never touched), installs its headless Qt/openshot stubs
(tests/conftest.py), fakes `get_app()` over
packages/engine/src/tools/__fixtures__/golden-project.json, runs the real
handlers and writes their text to __fixtures__/desktop-goldens.json. The
TypeScript tests compare the web tools' output with it byte for byte.

develop replaced tool_handlers.get_project_info and list_markers with editor
tools (structured receipts the engine does not produce yet); goldens.test.ts
keeps their earlier text (b63c39be7) inline until those tools are re-ported.

Usage:  python3 packages/engine/scripts/gen-tool-goldens.py [project.json] [out.json]
Env:    ZENVI_DESKTOP_REPO (default ~/Projects/zenvi), ZENVI_CONTRACT_REF (default 1f80cb3d0).
Runs with HOME pointed at a temp dir so desktop modules cannot write into the
real home directory.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import types
from unittest.mock import MagicMock

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(os.path.dirname(HERE), "src", "tools", "__fixtures__")
REPO = os.environ.get("ZENVI_DESKTOP_REPO", os.path.join(os.path.expanduser("~"), "Projects", "zenvi"))
REF = os.environ.get("ZENVI_CONTRACT_REF", "1f80cb3d0")


def export_desktop(dest: str) -> None:
    blob = subprocess.check_output(["git", "-C", REPO, "archive", REF, "src", "tests/conftest.py"])
    with tarfile.open(fileobj=io.BytesIO(blob)) as tar:
        tar.extractall(dest, filter="data")


class FakeProject:
    def __init__(self, data: dict):
        self._data = data
        self.current_filepath = ""

    def get(self, key):
        if isinstance(key, list):
            value = self._data
            for part in key:
                value = value.get(part) if isinstance(value, dict) else None
            return value
        return self._data.get(key)

    def generate_id(self) -> str:
        return "GENERATED1"


class FakeUpdates:
    data_version = 1
    transaction_id = None
    ignore_history = False

    def __init__(self):
        self.actionHistory = []
        self.redoHistory = []


class FakeApp:
    def __init__(self, data: dict):
        self.project = FakeProject(data)
        self.updates = FakeUpdates()
        self.window = MagicMock()

    def get_settings(self):
        settings = MagicMock()
        settings.get = lambda key: {"default-image-length": 10.0, "default-transition-length": 1.0}.get(key)
        return settings

    def thread(self):
        return "main"


def as_json(text: str):
    """A receipt parsed, or the raw text when the handler returned prose (an error)."""
    try:
        return json.loads(text)
    except ValueError:
        return text


def main() -> None:
    project_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(FIXTURES, "golden-project.json")
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(FIXTURES, "desktop-goldens.json")
    with open(project_path, encoding="utf-8") as fh:
        project = json.load(fh)

    work = tempfile.mkdtemp(prefix="zenvi-goldens-")
    os.environ["HOME"] = work
    export_desktop(work)
    src = os.path.join(work, "src")
    sys.path.insert(0, src)

    if "pytest" not in sys.modules:
        stub = types.ModuleType("pytest")
        stub.fixture = lambda *a, **k: (lambda fn: fn) if not (a and callable(a[0])) else a[0]  # type: ignore[attr-defined]
        stub.skip = lambda *a, **k: None  # type: ignore[attr-defined]
        sys.modules["pytest"] = stub
    conftest = os.path.join(work, "tests", "conftest.py")
    exec(compile(open(conftest, encoding="utf-8").read(), conftest, "exec"), {"__file__": conftest, "__name__": "conftest"})

    app = FakeApp(project)
    app_module = types.ModuleType("classes.app")
    app_module.get_app = lambda: app  # type: ignore[attr-defined]
    sys.modules["classes.app"] = app_module

    backend = MagicMock()
    backend.is_indexing_configured.return_value = False
    backend.search.return_value = {"results": []}
    import classes  # noqa: F401
    api_module = types.ModuleType("classes.api_client")
    api_module.get_backend_client = lambda *a, **k: backend  # type: ignore[attr-defined]
    sys.modules["classes.api_client"] = api_module

    from classes import tool_handlers as th
    from classes import track_display as td
    from classes import clip_resolver as cr

    out: dict[str, object] = {"ref": REF}
    out["list_files"] = th.list_files()
    out["list_clips"] = as_json(th.list_clips())
    out["list_clips_voice"] = as_json(th.list_clips(layer="Voice"))
    out["list_clips_bad_track"] = th.list_clips(layer="nope")
    out["list_layers"] = th.list_layers()
    state = as_json(th.get_timeline_state())
    out["get_timeline_state"] = state

    legacy = state["data"]["legacy_text"] if isinstance(state, dict) else state
    th.get_timeline_state = lambda **_kw: legacy  # develop returns the text itself
    out["editor_snapshot"] = th.build_editor_snapshot_for_chat()
    out["editor_snapshot_900"] = th.build_editor_snapshot_for_chat(max_chars=900)
    out["analyze_timeline_audio"] = th.analyze_timeline_audio()
    out["analyze_timeline_audio_windows"] = th.analyze_timeline_audio(detail="windows")
    out["get_clips_with_full_metadata"] = th.get_clips_with_full_metadata()
    out["get_clips_with_full_metadata_full"] = th.get_clips_with_full_metadata(detail_level="full")
    out["get_timeline_placements_metadata"] = th.get_timeline_placements_metadata()

    layers = project["layers"]
    out["track_stack_json"] = td.track_stack_json(layers)
    tracks = {}
    for raw in ["1000000", "L3", "voice", "Track Voice", "ui track 2", "3", "musica", "Música", "b", "9", "0", "2.7", "abc", ""]:
        tracks[raw] = list(td.normalize_track_or_layer_arg(raw, layers))
    out["normalize_track"] = tracks
    out["format_track_label"] = {str(n): td.format_track_label_for_llm(n, layers) for n in (1000000, 3000000, 7000000)}

    resolves = {}
    for label, kwargs in {
        "query_interview": {"clip_query": "interview"},
        "query_interview_occ2": {"clip_query": "interview", "occurrence": 2},
        "query_interview_track": {"clip_query": "founder", "track": "Voice"},
        "query_drone": {"clip_query": "drone mountain"},
        "query_nothing": {"clip_query": "spaceship explosion"},
        "id_missing": {"timeline_clip_id": "NOPE"},
        "no_target": {},
        "near_45": {"position_near": 45.0},
    }.items():
        r = cr.resolve_timeline_clip(**kwargs)
        resolves[label] = {"ok": r.ok, "clip": getattr(r.clip, "id", None) if r.clip else None, "error": r.error}
    out["resolve"] = resolves

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
