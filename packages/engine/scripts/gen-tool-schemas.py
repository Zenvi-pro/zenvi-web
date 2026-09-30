#!/usr/bin/env python3
"""Generate packages/engine/src/tools/schemas.gen.ts.

Sources (read-only):
  * zenvi-core (the desktop) at the contract-3 ref: TOOL_SCHEMAS in
    src/classes/agent_tools/schema.py, handler signatures and docstrings in
    src/classes/tool_handlers.py and src/classes/agent_tools/*.py,
    TOOL_DISPLAY_LABELS and READ_ONLY_TOOLS. Read with `git show`, so the
    desktop working tree is never touched.
  * docs/specs/backend-frontend-tools.json: the schemas the Zenvi Assistant
    (zenvi-backend) model sees. Its argument names are what the Assistant
    actually sends.
  * packages/engine/scripts/tool-schema-overlay.json: hand-written
    descriptions, the real backend signature of tools the snapshot lacks, and
    default overrides.

Merge rules (why: on the contract branch TOOL_SCHEMAS and the handlers drifted
apart for ~20 tools, e.g. set_clip_volume_tool declares volume/gain/db while
the handler and the backend use level/level_db/mode/fade_ms; with
additionalProperties=false the desktop would refuse every real Assistant call):
  * properties = TOOL_SCHEMAS properties, then backend-only properties, then
    overlay extra_props, in that order;
  * a property both sides declare keeps the TOOL_SCHEMAS schema, widened to a
    union when the backend declares a different JSON type;
  * required = TOOL_SCHEMAS required minus names the backend does not declare
    (the backend sends an alias such as file_path for path);
  * default = the handler signature's literal default (documentation only:
    handlers apply defaults themselves), unless the overlay drops it;
  * additionalProperties stays false.

Usage:  python3 packages/engine/scripts/gen-tool-schemas.py
Env:    ZENVI_DESKTOP_REPO (default ~/Projects/zenvi),
        ZENVI_CONTRACT_REF (default b63c39be7, branch nilay-phase-5-speech-ml).
"""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
import types
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(ENGINE))
OUT = os.path.join(ENGINE, "src", "tools", "schemas.gen.ts")
BACKEND_JSON = os.path.join(ROOT, "docs", "specs", "backend-frontend-tools.json")
OVERLAY_JSON = os.path.join(HERE, "tool-schema-overlay.json")

REPO = os.environ.get("ZENVI_DESKTOP_REPO", os.path.join(os.path.expanduser("~"), "Projects", "zenvi"))
REF = os.environ.get("ZENVI_CONTRACT_REF", "b63c39be7")

HIDDEN = {"self", "chat_session_id", "transaction_id"}


def git(*args: str) -> str:
    return subprocess.check_output(["git", "-C", REPO, *args]).decode("utf-8")


def show(path: str) -> str:
    return git("show", f"{REF}:{path}")


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


def load_handlers() -> tuple[dict[str, tuple[str, str]], dict[str, str], set[str]]:
    """tool name -> (source path, function name); display labels; READ_ONLY_TOOLS."""
    th = ast.parse(show("src/classes/tool_handlers.py"))
    handlers: dict[str, tuple[str, str]] = {}
    for name, value in dict_items(assigned(th, "AGENT_TOOL_HANDLERS")):
        assert isinstance(value, ast.Name)
        handlers[name] = ("src/classes/tool_handlers.py", value.id)

    hi = ast.parse(show("src/classes/agent_tools/handlers/__init__.py"))
    modules: dict[str, str] = {}
    for node in hi.body:
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                modules[alias.asname or alias.name] = "src/" + node.module.replace(".", "/") + ".py"
    labels: dict[str, str] = {}
    for dict_name in ("PHASE3_HANDLERS", "PHASE4_HANDLERS", "PHASE5_HANDLERS"):
        for name, value in dict_items(assigned(hi, dict_name)):
            assert isinstance(value, ast.Name)
            handlers[name] = (modules[value.id], value.id)
    for dict_name in ("PHASE3_DISPLAY_LABELS", "PHASE4_DISPLAY_LABELS", "PHASE5_DISPLAY_LABELS"):
        for name, value in dict_items(assigned(hi, dict_name)):
            labels[name] = ast.literal_eval(value)
    for name, value in dict_items(assigned(th, "TOOL_DISPLAY_LABELS")):
        labels[name] = ast.literal_eval(value)

    read_only_node = assigned(th, "READ_ONLY_TOOLS")
    assert isinstance(read_only_node, ast.Call)
    read_only = set(ast.literal_eval(read_only_node.args[0]))
    return handlers, labels, read_only


def handler_signature(path: str, func: str, cache: dict[str, ast.Module]) -> tuple[str, dict[str, Any]]:
    """(first docstring paragraph, literal parameter defaults) of a handler."""
    if path not in cache:
        cache[path] = ast.parse(show(path))
    fn = next(n for n in cache[path].body if isinstance(n, ast.FunctionDef) and n.name == func)
    doc = ast.get_docstring(fn) or ""
    first = " ".join(doc.split("\n\n")[0].split())
    defaults: dict[str, Any] = {}
    params = fn.args.args
    for arg, default in zip(params[len(params) - len(fn.args.defaults):], fn.args.defaults):
        try:
            defaults[arg.arg] = ast.literal_eval(default)
        except ValueError:
            pass
    return first, defaults


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


def zod_of(schema: dict) -> str:
    """zod source for the JSON Schema subset TOOL_SCHEMAS uses."""
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
        required = set(schema.get("required") or [])
        fields = []
        for key, prop in (schema.get("properties") or {}).items():
            field = zod_of(prop)
            if key not in required:
                field += ".optional()"
            fields.append(f"{ts(key)}: {field}")
        code = "z.strictObject({" + ", ".join(fields) + "})"
    elif not raw_type:
        code = "z.unknown()"
    else:
        raise ValueError(f"unsupported schema type {raw_type!r}")
    if schema.get("description") and raw_type != "object":
        code += f".describe({ts(schema['description'])})"
    return code


def zod_object(schema: dict) -> str:
    required = set(schema.get("required") or [])
    lines = []
    for key, prop in schema["properties"].items():
        field = zod_of(prop)
        if key not in required:
            field += ".optional()"
        lines.append(f"    {ts(key)}: {field},")
    if not lines:
        return "z.strictObject({})"
    return "z.strictObject({\n" + "\n".join(lines) + "\n  })"


def main() -> None:
    commit = git("rev-parse", "--short=12", REF).strip()
    tool_schemas = load_tool_schemas()
    handlers, labels, read_only = load_handlers()
    with open(BACKEND_JSON, encoding="utf-8") as fh:
        backend_doc = json.load(fh)
    backend_tools: dict[str, dict] = backend_doc["tools"]
    assistant_names = set(backend_tools) | set(backend_doc.get("missing") or [])
    with open(OVERLAY_JSON, encoding="utf-8") as fh:
        overlay_doc = json.load(fh)
    overlay: dict[str, dict] = overlay_doc["tools"]
    common: dict[str, str] = overlay_doc["common_props"]

    missing = sorted(set(handlers) ^ set(tool_schemas))
    if missing:
        raise SystemExit(f"TOOL_SCHEMAS and AGENT_TOOL_HANDLERS differ: {missing}")
    unknown_overlay = sorted(set(overlay) - set(tool_schemas))
    if unknown_overlay:
        raise SystemExit(f"overlay names unknown tools: {unknown_overlay}")

    cache: dict[str, ast.Module] = {}
    entries = []
    for name, contract in tool_schemas.items():
        path, func = handlers[name]
        doc, defaults = handler_signature(path, func, cache)
        backend = backend_tools.get(name)
        schema = merged_schema(name, contract, backend, overlay, common, defaults)
        description = (
            overlay.get(name, {}).get("description")
            or ((backend or {}).get("description") or "").strip()
            or doc
            or labels.get(name, name)
        )
        entries.append({
            "name": name,
            "title": labels.get(name) or name,
            "description": " ".join(description.split()),
            "assistant": name in assistant_names,
            "desktopReadOnly": name in read_only,
            "handler": f"{path}:{func}",
            "schema": schema,
        })

    out: list[str] = []
    out.append("// Generated by packages/engine/scripts/gen-tool-schemas.py. Do not edit by hand.")
    out.append(f"// Sources: zenvi-core {commit} (agent_tools/schema.py TOOL_SCHEMAS, tool_handlers.py,")
    out.append("// agent_tools/*.py), docs/specs/backend-frontend-tools.json, scripts/tool-schema-overlay.json.")
    out.append("")
    out.append('import { z } from "zod";')
    out.append('import type { JsonSchemaObject } from "./json-schema.js";')
    out.append("")
    out.append(f"export const CONTRACT_REF = {ts(commit)};")
    out.append("")
    out.append("/** Static facts about one contract-3 tool. */")
    out.append("export interface ContractToolMeta {")
    out.append("  readonly name: string;")
    out.append("  /** Desktop TOOL_DISPLAY_LABELS entry. */")
    out.append("  readonly title: string;")
    out.append("  /** Backend (Assistant) description when it has one, else the desktop handler docstring. */")
    out.append("  readonly description: string;")
    out.append("  /** zenvi-backend routes this tool to the frontend (FRONTEND_TOOL_NAMES). */")
    out.append("  readonly assistant: boolean;")
    out.append("  /** Member of the desktop READ_ONLY_TOOLS set. */")
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
    out.append("export const CONTRACT_TOOL_NAMES = Object.keys(contractInputs) as ContractToolName[];")
    out.append("")
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(entries)} tools from zenvi-core {commit}")


if __name__ == "__main__":
    main()
