#!/usr/bin/env python3
"""Generate packages/engine/src/tools/schemas.gen.ts: the Zenvi desktop's tool contract.

The contract is every tool the desktop app lists over its in-app MCP server
(agent_mcp_server.iter_tool_defs) at the contract ref, zenvi-core develop:

  * AGENT_TOOL_HANDLERS in src/classes/tool_handlers.py, the phase handlers of
    src/classes/agent_tools/handlers, their TOOL_SCHEMAS
    (src/classes/agent_tools/schema.py; tests/test_agent_schemas.py keeps
    schema == handler), TOOL_DISPLAY_LABELS and READ_ONLY_TOOLS;
  * the editor tools registered with @editor_tool in src/classes/editor_tools.
    They register at import time, so their schema, label, read_only and
    description come from their exported manifest,
    docs/specs/desktop-editor-tools-manifest.json. As in tool_handlers.py, an
    editor tool replaces the handler and the TOOL_SCHEMAS entry of the same
    name; its handler is found by its @editor_tool registration;
  * the MCP-only extras (src/classes/agent_api_proxy.py MCP_EXTRA_TOOLS: desktop
    plumbing for external agent CLIs), whose schema the MCP server builds from
    the handler signature (agent_mcp_server._build_input_schema).

Desktop sources are read with `git show`, so no desktop working tree is
touched. On top of them:

  * docs/specs/backend-frontend-tools.json: the schemas the Zenvi Assistant
    (zenvi-backend) model sees for its hand-written stubs. Its argument names
    are what the Assistant actually sends.
  * packages/engine/scripts/tool-schema-overlay.json: hand-written
    descriptions, arguments only the web surfaces accept, and default
    overrides.

Merge rules (why: the Assistant backend's schemas and the desktop's are kept
by different repos, and with additionalProperties=false an argument one side
sends and the other does not declare is refused):
  * properties = desktop properties, then backend-only properties, then
    overlay extra_props and web_extra_props, in that order;
  * a property both sides declare keeps the desktop schema, widened to a
    union when the backend declares a different JSON type;
  * required = desktop required minus names the backend does not declare
    (the backend sends an alias such as file_path for path);
  * default = the handler signature's literal default (documentation only:
    handlers apply defaults themselves), unless the overlay drops it; an
    editor tool's schema already carries its defaults;
  * description = the overlay's, else the backend's, else the desktop's (an
    editor tool's whole docstring, else the handler docstring's first
    paragraph), else the label;
  * additionalProperties stays false.

The vendored manifest records the zenvi-core commit it was exported from, and
the run fails unless that is the contract ref. To move the contract:

  (zenvi-core checkout at <ref>)
      python scripts/export_editor_tool_manifest.py --out /tmp/editor-tools.json
  ZENVI_CONTRACT_REF=<ref> python3 packages/engine/scripts/gen-tool-schemas.py --vendor-manifest /tmp/editor-tools.json
  then set DEFAULT_REF below and run without arguments.

Usage:  python3 packages/engine/scripts/gen-tool-schemas.py [--vendor-manifest PATH]
Env:    ZENVI_DESKTOP_REPO (default ~/Projects/zenvi),
        ZENVI_CONTRACT_REF (default 1f80cb3d0, develop with #341).
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
import types
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(ENGINE))
OUT = os.path.join(ENGINE, "src", "tools", "schemas.gen.ts")
BACKEND_JSON = os.path.join(ROOT, "docs", "specs", "backend-frontend-tools.json")
MANIFEST_JSON = os.path.join(ROOT, "docs", "specs", "desktop-editor-tools-manifest.json")
OVERLAY_JSON = os.path.join(HERE, "tool-schema-overlay.json")

DEFAULT_REF = "1f80cb3d0"
REPO = os.environ.get("ZENVI_DESKTOP_REPO", os.path.join(os.path.expanduser("~"), "Projects", "zenvi"))
REF = os.environ.get("ZENVI_CONTRACT_REF", DEFAULT_REF)

HIDDEN = {"self", "chat_session_id", "transaction_id"}
EDITOR_TOOLS_DIR = "src/classes/editor_tools"
MCP_EXTRAS_PATH = "src/classes/agent_api_proxy.py"

# Overlay descriptions of arguments a tool no longer has (fails the run).
STALE_OVERLAY: list[str] = []


def git(*args: str) -> str:
    return subprocess.check_output(["git", "-C", REPO, *args]).decode("utf-8")


def show(path: str) -> str:
    return git("show", f"{REF}:{path}")


_TREES: dict[str, ast.Module] = {}


def tree_of(path: str) -> ast.Module:
    if path not in _TREES:
        _TREES[path] = ast.parse(show(path))
    return _TREES[path]


def commit_of(ref: str) -> str:
    return git("rev-parse", "--verify", f"{ref}^{{commit}}").strip()


# ---------------------------------------------------------------------------
# Desktop sources
# ---------------------------------------------------------------------------

def load_tool_schemas() -> dict[str, dict]:
    """Execute schema.py with a stub jsonschema (only TOOL_SCHEMAS is needed)."""
    stub = types.ModuleType("jsonschema")
    stub.ValidationError = Exception  # type: ignore[attr-defined]
    stub.Draft202012Validator = object  # type: ignore[attr-defined]
    sys.modules.setdefault("jsonschema", stub)
    namespace: dict[str, Any] = {"__name__": "zenvi_contract_schema"}
    exec(compile(show("src/classes/agent_tools/schema.py"), "schema.py", "exec"), namespace)
    return namespace["TOOL_SCHEMAS"]


def assigned(tree: ast.Module, name: str) -> ast.expr:
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return node.value
    raise KeyError(name)


def dict_items(node: ast.expr) -> list[tuple[str, ast.expr]]:
    assert isinstance(node, ast.Dict), node
    return [(ast.literal_eval(k), v) for k, v in zip(node.keys, node.values)]  # type: ignore[arg-type]


def name_map(node: ast.expr) -> dict[str, str]:
    """{tool name: function name} of a dict literal mapping names to functions."""
    out: dict[str, str] = {}
    for name, value in dict_items(node):
        assert isinstance(value, ast.Name), (name, ast.dump(value))
        out[name] = value.id
    return out


def module_path(module: str) -> str:
    return "src/" + module.replace(".", "/") + ".py"


def find_function(path: str, func: str, depth: int = 0) -> tuple[str, ast.FunctionDef]:
    """The definition of `func` as seen from `path`, following `from x import func`."""
    tree = tree_of(path)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == func:
            return path, node
    if depth < 3:
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                for alias in node.names:
                    if (alias.asname or alias.name) == func:
                        return find_function(module_path(node.module), alias.name, depth + 1)
    raise SystemExit(f"{REF}: cannot find {func} from {path}")


def first_paragraph(fn: ast.FunctionDef) -> str:
    """agent_mcp_server._first_doc_paragraph."""
    doc = ast.get_docstring(fn) or ""
    return " ".join(doc.split("\n\n")[0].split())


def module_constants(tree: ast.Module) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                out[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                pass
    return out


_MISSING = object()  # no default: a required parameter
_UNKNOWN = object()  # a default that is not a literal (optional, value unknown here)


def signature(path: str, fn: ast.FunctionDef) -> list[tuple[str, ast.expr | None, Any]]:
    """(name, annotation, default) per keyword-callable parameter, module constants resolved."""
    constants = module_constants(tree_of(path))
    a = fn.args
    positional = [*a.posonlyargs, *a.args]
    defaults: list[ast.expr | None] = [None] * (len(positional) - len(a.defaults)) + list(a.defaults)
    params = [*zip(positional, defaults), *zip(a.kwonlyargs, a.kw_defaults)]
    out = []
    for arg, default in params:
        if default is None:
            value: Any = _MISSING
        elif isinstance(default, ast.Name) and default.id in constants:
            value = constants[default.id]
        else:
            try:
                value = ast.literal_eval(default)
            except ValueError:
                value = _UNKNOWN
        out.append((arg.arg, arg.annotation, value))
    return out


def literal_defaults(path: str, fn: ast.FunctionDef) -> dict[str, Any]:
    return {name: value for name, _ann, value in signature(path, fn) if value is not _MISSING and value is not _UNKNOWN}


def humanize_tool_name(name: str) -> str:
    """tool_handlers.humanize_tool_name for a name with no display label."""
    base = name[:-5] if name.endswith("_tool") else name
    base = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", base)
    return base.replace("_", " ").strip().capitalize() or "Run tool"


_ANNOTATION_TYPES = {"str": "string", "bool": "boolean", "int": "integer", "float": "number", "list": "array", "dict": "object"}
_VALUE_TYPES = {str: "string", bool: "boolean", int: "integer", float: "number", list: "array", dict: "object"}


def introspected_schema(path: str, fn: ast.FunctionDef) -> dict:
    """agent_mcp_server._build_input_schema: the schema the MCP server lists for a tool without TOOL_SCHEMAS."""
    future_annotations = any(
        isinstance(n, ast.ImportFrom) and n.module == "__future__" and any(a.name == "annotations" for a in n.names)
        for n in tree_of(path).body
    )
    if fn.args.vararg or fn.args.kwarg:
        raise SystemExit(f"{path}:{fn.name}: *args/**kwargs are not introspected; extend the generator")
    props: dict[str, dict] = {}
    required: list[str] = []
    for name, annotation, default in signature(path, fn):
        if name in HIDDEN:
            continue
        # _param_json_type: the annotation when it is a plain builtin, else the default's type, else string.
        kind = None
        if isinstance(annotation, ast.Name) and not future_annotations:
            kind = _ANNOTATION_TYPES.get(annotation.id)
        if kind is None:
            known = default is not _MISSING and default is not _UNKNOWN and default is not None
            kind = _VALUE_TYPES.get(type(default), "string") if known else "string"
        props[name] = {"type": kind}
        if default is _MISSING:
            required.append(name)
    schema: dict[str, Any] = {"type": "object", "properties": props, "additionalProperties": False}
    if required:
        schema["required"] = required
    return schema


def editor_registrations() -> dict[str, dict]:
    """@editor_tool registrations: name -> {path, func, label, read_only, params}."""
    files = [f for f in git("ls-tree", "--name-only", REF, f"{EDITOR_TOOLS_DIR}/").split() if f.endswith(".py")]
    found: dict[str, dict] = {}
    for path in files:
        for node in ast.walk(tree_of(path)):
            if not isinstance(node, ast.FunctionDef):
                continue
            for deco in node.decorator_list:
                target = deco.func if isinstance(deco, ast.Call) else None
                if not (isinstance(target, ast.Name) and target.id == "editor_tool"):
                    continue
                assert isinstance(deco, ast.Call) and deco.args and isinstance(deco.args[0], ast.Constant), f"{path}:{node.name}"
                name = deco.args[0].value
                if name in found:
                    raise SystemExit(f"{REF}: {name} is registered twice")
                kwargs = {k.arg: k.value for k in deco.keywords if k.arg}
                label = kwargs.get("label")
                read_only = kwargs.get("read_only")
                found[name] = {
                    "path": path,
                    "func": node.name,
                    "label": ast.literal_eval(label) if isinstance(label, ast.Constant) else None,
                    "read_only": ast.literal_eval(read_only) if isinstance(read_only, ast.Constant) else False,
                    "params": [name for name, _ann, _default in signature(path, node)],
                }
    return found


def check_manifest(manifest: dict, registered: dict[str, dict], commit: str) -> dict[str, dict]:
    """The manifest's tools by name, after checking they are the contract ref's registrations."""
    recorded = manifest.get("commit") or ""
    if not recorded or not commit.startswith(recorded):
        raise SystemExit(
            f"{os.path.relpath(MANIFEST_JSON, ROOT)} was exported from zenvi-core {recorded or '(unknown)'}, "
            f"not the contract ref {REF} ({commit[:12]}). Re-export it at {REF} and vendor it with --vendor-manifest."
        )
    tools = {t["name"]: t for t in manifest["tools"]}
    if set(tools) != set(registered):
        raise SystemExit(
            f"manifest vs @editor_tool registrations at {REF}: only in the manifest {sorted(set(tools) - set(registered))}, "
            f"only registered {sorted(set(registered) - set(tools))}"
        )
    for name, reg in registered.items():
        row = tools[name]
        props = sorted((row["input_schema"].get("properties") or {}).keys())
        mismatch = []
        if reg["label"] is not None and reg["label"] != row["label"]:
            mismatch.append(f"label {row['label']!r} != {reg['label']!r}")
        if bool(reg["read_only"]) != bool(row["read_only"]):
            mismatch.append(f"read_only {row['read_only']} != {reg['read_only']}")
        if props != sorted(reg["params"]):
            mismatch.append(f"properties {props} != parameters {sorted(reg['params'])}")
        if mismatch:
            raise SystemExit(f"manifest {name} does not match {reg['path']}:{reg['func']} at {REF}: {'; '.join(mismatch)}")
    return tools


def read_only_literal(node: ast.expr) -> set[str]:
    """READ_ONLY_TOOLS: `frozenset({...}) | frozenset(<editor tools with read_only>)`; the literal part."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return read_only_literal(node.left) | read_only_literal(node.right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "frozenset" and node.args:
        arg = node.args[0]
        if isinstance(arg, (ast.Set, ast.List, ast.Tuple)):
            return set(ast.literal_eval(arg))
        if isinstance(arg, ast.GeneratorExp) and "_EDITOR_TOOL_SPECS" in ast.unparse(arg) and "read_only" in ast.unparse(arg):
            return set()  # the editor tools' own read_only, taken from the manifest
    raise SystemExit(f"{REF}: READ_ONLY_TOOLS has an unexpected shape: {ast.unparse(node)}")


def load_desktop(manifest: dict) -> dict[str, Any]:
    commit = commit_of(REF)
    schemas = load_tool_schemas()
    registered = editor_registrations()
    editor = check_manifest(manifest, registered, commit)

    th_path = "src/classes/tool_handlers.py"
    th = tree_of(th_path)
    handlers: dict[str, tuple[str, str]] = {name: (th_path, func) for name, func in name_map(assigned(th, "AGENT_TOOL_HANDLERS")).items()}
    overlap = sorted(set(handlers) & set(editor))
    if overlap:
        raise SystemExit(f"{REF}: AGENT_TOOL_HANDLERS and editor_tools both define {overlap}")

    hi_path = "src/classes/agent_tools/handlers/__init__.py"
    hi = tree_of(hi_path)
    phase_labels: dict[str, str] = {}
    for dict_name in ("PHASE3_HANDLERS", "PHASE4_HANDLERS", "PHASE5_HANDLERS"):
        for name, func in name_map(assigned(hi, dict_name)).items():
            # tool_handlers.py: a phase handler runs only when no editor tool has its name.
            if name not in editor:
                handlers[name] = (hi_path, func)
    for dict_name in ("PHASE3_DISPLAY_LABELS", "PHASE4_DISPLAY_LABELS", "PHASE5_DISPLAY_LABELS"):
        for name, value in dict_items(assigned(hi, dict_name)):
            phase_labels[name] = ast.literal_eval(value)

    labels = {**{n: ast.literal_eval(v) for n, v in dict_items(assigned(th, "TOOL_DISPLAY_LABELS"))}, **phase_labels}
    read_only = read_only_literal(assigned(th, "READ_ONLY_TOOLS"))

    missing = sorted(set(handlers) - set(schemas))
    unknown = sorted(set(schemas) - set(handlers) - set(editor))
    if missing or unknown:
        raise SystemExit(f"{REF}: handlers without TOOL_SCHEMAS {missing}; TOOL_SCHEMAS without a handler {unknown}")

    extras = name_map(assigned(tree_of(MCP_EXTRAS_PATH), "MCP_EXTRA_TOOLS"))
    clash = sorted(set(extras) & (set(handlers) | set(editor)))
    if clash:
        raise SystemExit(f"{REF}: MCP_EXTRA_TOOLS shadows agent tools {clash}")

    tools: dict[str, dict] = {}
    # TOOL_SCHEMAS order (stable across regenerations), then the editor tools it lacks
    # (manifest order), then the MCP extras.
    order = [*(n for n in schemas if n in handlers or n in editor), *(n for n in editor if n not in schemas), *extras]
    for name in order:
        if name in editor:
            reg, row = registered[name], editor[name]
            tools[name] = {
                "schema": row["input_schema"],
                "doc": row["description"],
                "defaults": {},
                "label": row["label"],
                "read_only": bool(row["read_only"]),
                "handler": f"{reg['path']}:{reg['func']}",
            }
        elif name in handlers:
            path, fn = find_function(*handlers[name])
            tools[name] = {
                "schema": schemas[name],
                "doc": first_paragraph(fn),
                "defaults": literal_defaults(path, fn),
                "label": labels.get(name) or humanize_tool_name(name),
                "read_only": name in read_only,
                "handler": f"{path}:{fn.name}",
            }
        else:
            path, fn = find_function(MCP_EXTRAS_PATH, extras[name])
            tools[name] = {
                "schema": introspected_schema(path, fn),
                "doc": first_paragraph(fn),
                "defaults": literal_defaults(path, fn),
                "label": humanize_tool_name(name),
                "read_only": name in read_only,
                "handler": f"{path}:{fn.name}",
            }
    return {"commit": commit, "tools": tools}


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def json_types(schema: dict) -> set[str]:
    raw = schema.get("type")
    if isinstance(raw, list):
        return {str(t) for t in raw}
    if isinstance(raw, str):
        return {raw}
    out: set[str] = set()
    for key in ("oneOf", "anyOf"):
        for branch in schema.get(key) or []:
            out |= json_types(branch)
    return out


def backend_prop_schema(prop: dict) -> dict:
    """A backend (pydantic) property without its pydantic-only keys."""
    out = {k: v for k, v in prop.items() if k not in ("title", "default")}
    if "anyOf" in out:
        branches = [b for b in out.pop("anyOf") if b.get("type") != "null"]
        if len(branches) == 1:
            out.update(branches[0])
        else:
            out["anyOf"] = branches
    return out


def widen(contract: dict, backend: dict) -> dict:
    """Keep the contract schema; add the backend's JSON type when it differs.

    The result uses anyOf (an integer matches both number and integer, which
    would fail oneOf), and never adds integer next to number.
    """
    have = json_types(contract)
    extra = sorted(json_types(backend) - have - {"null"})
    if "number" in have:
        extra = [t for t in extra if t != "integer"]
    if not extra or not have:
        return contract
    keep = {k: v for k, v in contract.items() if k not in ("type", "oneOf", "anyOf")}
    branches = contract.get("oneOf") or contract.get("anyOf") or [{"type": t} for t in sorted(have)]
    return {"anyOf": [*branches, *({"type": t} for t in extra)], **keep}


def merged_schema(
    name: str,
    contract: dict,
    backend: dict | None,
    overlay: dict,
    common: dict[str, str],
    defaults: dict[str, Any],
) -> dict:
    tool_overlay = overlay.get(name, {})
    prop_overlay: dict[str, dict] = tool_overlay.get("props", {})
    props: dict[str, dict] = {}
    for key, schema in (contract.get("properties") or {}).items():
        props[key] = dict(schema)
    backend_props = ((backend or {}).get("parameters") or {}).get("properties") or {}
    for key, prop in backend_props.items():
        if key in HIDDEN:
            continue
        if key in props:
            props[key] = widen(props[key], backend_prop_schema(prop))
        else:
            props[key] = backend_prop_schema(prop)
    for key, schema in (tool_overlay.get("extra_props") or {}).items():
        if key not in props:
            props[key] = dict(schema)
    # Arguments only the web surfaces accept (documented in docs/TOOLS.md).
    for key, schema in (tool_overlay.get("web_extra_props") or {}).items():
        if key not in props:
            props[key] = dict(schema)

    for key, schema in props.items():
        extra = prop_overlay.get(key, {})
        if "description" not in schema:
            description = extra.get("description") or common.get(key)
            if description:
                schema["description"] = description
        if key in defaults and not extra.get("drop_default"):
            value = defaults[key]
            if value is not None and value != "" and isinstance(value, (str, int, float, bool)):
                schema["default"] = value

    for key in sorted(set(prop_overlay) - set(props)):
        STALE_OVERLAY.append(f"{name}.{key}")

    required = [r for r in contract.get("required") or [] if backend is None or r in backend_props]
    out: dict[str, Any] = {"type": "object", "properties": props, "additionalProperties": False}
    if required:
        out["required"] = required
    return out


# ---------------------------------------------------------------------------
# TypeScript emission
# ---------------------------------------------------------------------------

def ts(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def zod_fields(schema: dict) -> list[str]:
    required = set(schema.get("required") or [])
    fields = []
    for key, prop in (schema.get("properties") or {}).items():
        field = zod_of(prop)
        if key not in required:
            field += ".optional()"
        fields.append(f"{ts(key)}: {field}")
    return fields


def zod_of(schema: dict) -> str:
    """zod source for the JSON Schema subset the desktop's schemas use.

    `nullable` (an OpenAPI keyword the desktop's editor tools also set) is not
    a JSON Schema keyword, so, like the desktop's validator, it is ignored: a
    property accepts null only when its type lists "null".
    """
    branches = schema.get("oneOf") or schema.get("anyOf")
    raw_type = schema.get("type")
    if branches:
        code = "z.union([" + ", ".join(zod_of(b) for b in branches) + "])"
    elif isinstance(raw_type, list):
        bare = {k: v for k, v in schema.items() if k not in ("type", "description")}
        code = "z.union([" + ", ".join(zod_of({**bare, "type": t}) for t in raw_type) + "])"
    elif raw_type == "string":
        code = "z.enum(" + ts(schema["enum"]) + ")" if "enum" in schema else "z.string()"
    elif raw_type in ("number", "integer"):
        code = "z.int()" if raw_type == "integer" else "z.number()"
        if "minimum" in schema:
            code += f".min({schema['minimum']})"
        if "maximum" in schema:
            code += f".max({schema['maximum']})"
    elif raw_type == "boolean":
        code = "z.boolean()"
    elif raw_type == "null":
        code = "z.null()"
    elif raw_type == "array":
        code = f"z.array({zod_of(schema.get('items') or {})})"
        if "minItems" in schema:
            code += f".min({schema['minItems']})"
    elif raw_type == "object":
        fields = zod_fields(schema)
        if not schema.get("properties"):
            # A free-form object (effect properties, template params): any keys.
            code = "z.record(z.string(), z.unknown())"
        elif schema.get("additionalProperties", True) is False:
            code = "z.strictObject({" + ", ".join(fields) + "})"
        else:
            code = "z.looseObject({" + ", ".join(fields) + "})"
    elif not raw_type:
        code = "z.unknown()"
    else:
        raise ValueError(f"unsupported schema type {raw_type!r}")
    # Keywords that would narrow what the desktop accepts: emit them before a source uses them.
    unsupported = sorted(set(schema) & {
        "allOf", "const", "exclusiveMaximum", "exclusiveMinimum", "format", "maxItems", "maxLength",
        "minLength", "not", "pattern", "patternProperties", "uniqueItems",
    })
    if unsupported:
        raise ValueError(f"unsupported schema keywords {unsupported}")
    if schema.get("description") and raw_type != "object":
        code += f".describe({ts(schema['description'])})"
    return code


def zod_object(schema: dict) -> str:
    lines = [f"    {field}," for field in zod_fields(schema)]
    if not lines:
        return "z.strictObject({})"
    return "z.strictObject({\n" + "\n".join(lines) + "\n  })"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def vendor_manifest(path: str) -> None:
    """Copy an exported editor tool manifest into docs/specs, recording the contract ref's commit."""
    with open(path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    manifest["commit"] = commit_of(REF)
    check_manifest(manifest, editor_registrations(), manifest["commit"])
    # export_editor_tool_manifest.py's own formatting, so the file diffs cleanly against an export.
    with open(MANIFEST_JSON, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    print(f"wrote {os.path.relpath(MANIFEST_JSON, ROOT)}: {len(manifest['tools'])} editor tools from zenvi-core {manifest['commit'][:12]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--vendor-manifest", metavar="PATH", help="vendor an exported editor tool manifest, then stop")
    args = parser.parse_args()
    if args.vendor_manifest:
        vendor_manifest(args.vendor_manifest)
        return

    with open(MANIFEST_JSON, encoding="utf-8") as fh:
        manifest = json.load(fh)
    desktop = load_desktop(manifest)
    commit = desktop["commit"][:12]
    with open(BACKEND_JSON, encoding="utf-8") as fh:
        backend_doc = json.load(fh)
    backend_tools: dict[str, dict] = backend_doc["tools"]
    assistant_names = set(backend_tools) | set(backend_doc.get("missing") or [])
    with open(OVERLAY_JSON, encoding="utf-8") as fh:
        overlay_doc = json.load(fh)
    overlay: dict[str, dict] = overlay_doc["tools"]
    common: dict[str, str] = overlay_doc["common_props"]

    tools: dict[str, dict] = desktop["tools"]
    unknown_overlay = sorted(set(overlay) - set(tools))
    if unknown_overlay:
        raise SystemExit(f"overlay names unknown tools: {unknown_overlay}")

    entries = []
    for name, tool in tools.items():
        backend = backend_tools.get(name)
        schema = merged_schema(name, tool["schema"], backend, overlay, common, tool["defaults"])
        written = overlay.get(name, {}).get("description") or ((backend or {}).get("description") or "").strip()
        if written or not tool["doc"]:
            description = " ".join((written or tool["label"]).split())
        else:
            # A desktop docstring (an editor tool's is several paragraphs written for the model):
            # each paragraph on one line, paragraphs kept apart.
            description = "\n\n".join(" ".join(p.split()) for p in re.split(r"\n\s*\n", tool["doc"].strip()) if p.strip())
        entries.append({
            "name": name,
            "title": tool["label"],
            "description": description,
            "assistant": name in assistant_names,
            "desktopReadOnly": tool["read_only"],
            "handler": tool["handler"],
            "schema": schema,
        })

    if STALE_OVERLAY:
        raise SystemExit(f"overlay describes arguments the tools do not have: {', '.join(STALE_OVERLAY)}")

    out: list[str] = []
    out.append("// Generated by packages/engine/scripts/gen-tool-schemas.py. Do not edit by hand.")
    out.append(f"// Sources: zenvi-core {commit} (develop): agent_tools/schema.py TOOL_SCHEMAS, tool_handlers.py, agent_tools/handlers,")
    out.append("// editor_tools (docs/specs/desktop-editor-tools-manifest.json), agent_api_proxy.py MCP_EXTRA_TOOLS;")
    out.append("// docs/specs/backend-frontend-tools.json, scripts/tool-schema-overlay.json.")
    out.append("")
    out.append('import { z } from "zod";')
    out.append('import type { JsonSchemaObject } from "./json-schema.js";')
    out.append("")
    out.append("/** zenvi-core commit the contract follows (develop). */")
    out.append(f"export const CONTRACT_REF = {ts(commit)};")
    out.append("")
    out.append("/** Static facts about one desktop tool. */")
    out.append("export interface ContractToolMeta {")
    out.append("  readonly name: string;")
    out.append("  /** Desktop display label (TOOL_DISPLAY_LABELS, an editor tool's label). */")
    out.append("  readonly title: string;")
    out.append("  /** Overlay or backend (Assistant) description when there is one, else the desktop's docstring. */")
    out.append("  readonly description: string;")
    out.append("  /** zenvi-backend routes this tool to the frontend (docs/specs/backend-frontend-tools.json). */")
    out.append("  readonly assistant: boolean;")
    out.append("  /** Member of the desktop READ_ONLY_TOOLS set (an editor tool's read_only). */")
    out.append("  readonly desktopReadOnly: boolean;")
    out.append("  /** Desktop handler, `path:function`. */")
    out.append("  readonly handler: string;")
    out.append("  /** Merged JSON Schema: the MCP inputSchema, and what argument coercion reads. */")
    out.append("  readonly inputSchema: JsonSchemaObject;")
    out.append("}")
    out.append("")
    out.append("export const contractInputs = {")
    for entry in entries:
        out.append(f"  {entry['name']}: {zod_object(entry['schema'])},")
    out.append("} as const;")
    out.append("")
    out.append("export type ContractToolName = keyof typeof contractInputs;")
    out.append("export type ContractInput<N extends ContractToolName> = z.output<(typeof contractInputs)[N]>;")
    out.append("")
    out.append("export const contractMeta: { readonly [N in ContractToolName]: ContractToolMeta } = {")
    for entry in entries:
        schema = entry["schema"]
        out.append(f"  {entry['name']}: {{")
        for key in ("name", "title", "description", "assistant", "desktopReadOnly", "handler"):
            out.append(f"    {key}: {ts(entry[key])},")
        out.append("    inputSchema: {")
        out.append('      type: "object",')
        out.append("      additionalProperties: false,")
        if schema.get("required"):
            out.append(f"      required: {ts(schema['required'])},")
        if schema["properties"]:
            out.append("      properties: {")
            for key, prop in schema["properties"].items():
                out.append(f"        {ts(key)}: {ts(prop)},")
            out.append("      },")
        else:
            out.append("      properties: {},")
        out.append("    },")
        out.append("  },")
    out.append("};")
    out.append("")
    out.append("/** Every tool the desktop app lists, in TOOL_SCHEMAS order, then the other editor tools, then the MCP extras. */")
    out.append("export const CONTRACT_TOOL_NAMES = Object.keys(contractInputs) as ContractToolName[];")
    out.append("")
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    kinds = {"editor": 0, "extra": 0, "handlers": 0}
    for entry in entries:
        handler = entry["handler"]
        kinds["editor" if handler.startswith(EDITOR_TOOLS_DIR) else "extra" if handler.startswith(MCP_EXTRAS_PATH) else "handlers"] += 1
    print(
        f"wrote {os.path.relpath(OUT, ROOT)}: {len(entries)} tools from zenvi-core {commit} "
        f"({kinds['handlers']} agent handlers, {kinds['editor']} editor tools, {kinds['extra']} MCP extras)"
    )


if __name__ == "__main__":
    main()
