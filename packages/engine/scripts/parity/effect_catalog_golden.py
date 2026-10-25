#!/usr/bin/env python3
"""Golden effect catalog: what zenvi-core's effects-color tools list.

Runs the desktop's own catalog builder (zenvi-core develop
src/classes/editor_tools/effects_color.py ``_load_raw_catalog`` +
``_build_catalog``, read with ``git show``) on libopenshot 1.0 and writes the
result. ``tools/catalog/effect-catalog.test.ts`` checks that the engine,
which builds the catalog from its generated libopenshot tables, says exactly
the same (properties, ranges, defaults, choices, key order).

Run with the desktop's Python and libopenshot 1.0 bindings::

    PYTHONPATH=~/zenvi-deps-1.0/python ~/Projects/zenvi/.venv/bin/python \\
        packages/engine/scripts/parity/effect_catalog_golden.py

Env: ZENVI_DESKTOP_REPO (default ~/Projects/zenvi), ZENVI_CONTRACT_REF (default 1f80cb3d0).
Writes ``packages/engine/src/tools/__fixtures__/desktop-effect-catalog.json``.
"""

import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "../../src/tools/__fixtures__/desktop-effect-catalog.json"))
REPO = os.path.expanduser(os.environ.get("ZENVI_DESKTOP_REPO", "~/Projects/zenvi"))
REF = os.environ.get("ZENVI_CONTRACT_REF", "1f80cb3d0")


def main():
    src = subprocess.run(
        ["git", "-C", REPO, "show", f"{REF}:src/classes/editor_tools/effects_color.py"],
        check=True, capture_output=True, text=True,
    ).stdout
    # The constants and catalog functions only: the rest needs the running app.
    start = src.index("HIDDEN_PROPERTIES = frozenset")
    end = src.index("def resolve_effect_name")
    ns = {}
    exec("import json\nfrom typing import Any, Optional\n" + src[start:end], ns)
    catalog = ns["_build_catalog"](ns["_load_raw_catalog"]())
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"ref": REF, "catalog": catalog}, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"wrote {len(catalog)} effects to {OUT}")


if __name__ == "__main__":
    main()
