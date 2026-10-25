#!/usr/bin/env python3
"""Golden outputs of zenvi-core's color_agent.py for tools/color-agent.ts.

Runs the desktop's own module (src/classes/color_agent.py and
color_presets.py at the contract ref, read with ``git show``; pure Python,
no libopenshot needed) on fixed inputs: scope summaries of seeded random
histograms, LookProfiles, the grade solver, outcome assessment, gap hints,
the looks catalog, a merge with deltas / wheels / curves / LUT, sample counts
and a soft preset (every preset's values are ops/__fixtures__/color-grade-presets.json).
``tools/color-agent.test.ts`` replays them.

    python3 packages/engine/scripts/parity/color_agent_golden.py

Env: ZENVI_DESKTOP_REPO (default ~/Projects/zenvi), ZENVI_CONTRACT_REF (default 1f80cb3d0).
Writes ``packages/engine/src/tools/__fixtures__/desktop-color-agent.json``.
"""

import json
import os
import random
import subprocess
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/tools/__fixtures__/desktop-color-agent.json"))
REPO = os.path.expanduser(os.environ.get("ZENVI_DESKTOP_REPO", "~/Projects/zenvi"))
REF = os.environ.get("ZENVI_CONTRACT_REF", "1f80cb3d0")


def load(path, name):
    src = subprocess.run(["git", "-C", REPO, "show", f"{REF}:{path}"], check=True, capture_output=True, text=True).stdout
    module = types.ModuleType(name)
    exec(compile(src, path, "exec"), module.__dict__)
    sys.modules[name] = module
    return module


def main():
    # color_presets only needs two openshot enum values.
    sys.modules["openshot"] = types.SimpleNamespace(LINEAR=1, AUTO=0)
    classes = types.ModuleType("classes")
    sys.modules["classes"] = classes
    classes.color_presets = load("src/classes/color_presets.py", "classes.color_presets")
    ca = load("src/classes/color_agent.py", "classes.color_agent")

    random.seed(7)
    scopes = []
    for _ in range(5):
        video = {
            "present": True,
            "histogram": {c: [random.randint(0, 40) for _ in range(256)] for c in ("luma", "red", "green", "blue")},
            "summary": {"avg_luma": random.random(), "clipped_shadows": random.random() * 0.05,
                        "clipped_highlights": random.random() * 0.1},
        }
        scopes.append({"video": video, "summary": ca.scope_from_raw_video(video)})
    profile = ca.build_look_profile([s["summary"] for s in scopes])
    reference = ca.build_look_profile([s["summary"] for s in scopes[:3]])
    out = {
        "ref": REF,
        "scopes": scopes,
        "profile": profile,
        "reference": reference,
        "distance": ca.look_profile_distance(profile, reference),
        "solve": ca.solve_grade_from_profiles(profile, reference, scale=1.0),
        "solve_half": ca.solve_grade_from_profiles(profile, reference, scale=0.49),
        "assess": ca.assess_grade_outcome(profile, reference, ca.target_profile_for_look("sunny"), outdoor_bright=True),
        "hints": ca.reference_gap_hints(scopes[0]["summary"], scopes[1]["summary"]),
        "looks_teal_orange": ca.list_looks_catalog("teal orange"),
        "looks_sunny_ids": [e["id"] for e in ca.list_looks_catalog("sunny")["looks"]],
        "looks_count": ca.list_looks_catalog()["count"],
        "merge": ca.merge_color_grade(ca.blank_color_grade("e1"), {
            "temperature_delta": 0.08, "exposure": "0.2", "wheels": {"shadows": {"color": "224466", "amount": 0.3}},
            "masterCurve": [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]], "lut": {"path": "x/y.cube", "strength": 0.6}}),
        "sample_counts": [ca.sample_count_for_duration(d) for d in (0, 0.01, 5, 30, 60, 212.5, 237.5, 600, 3600)],
        "soft_warm_up": ca.apply_soft_color_preset(ca.blank_color_grade("e"), "warm_up"),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
