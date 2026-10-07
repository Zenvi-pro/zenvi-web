#!/usr/bin/env node
/**
 * Regenerate packages/cli/src/hosts/desktop-handoff-tools.gen.json: the Zenvi
 * desktop app's handoff tools (SPEC §3.5) that `zenvi mcp` lists and forwards
 * to the desktop, with the desktop's own names, labels, descriptions and
 * input schemas, from zenvi-core's editor tool manifest:
 *
 *   (zenvi-core)  python scripts/export_editor_tool_manifest.py --out /tmp/editor-tools.json
 *   node packages/cli/scripts/sync-desktop-handoff-tools.mjs /tmp/editor-tools.json [--check] [--label "zenvi-core <sha>"]
 *
 * A tool the manifest does not have keeps its current entry unchanged (one
 * written by hand from SPEC §3.5 is `"source": "spec"`) and is reported. `--check` exits 1
 * when the file is stale. list_link_hosts_tool and call_link_host_tool are
 * left out on purpose: `zenvi mcp` reaches the Adobe apps directly (list_hosts,
 * ae_* / premiere_*), not through the desktop.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GEN_FILE = path.resolve(here, "..", "src", "hosts", "desktop-handoff-tools.gen.json");

/** SPEC §3.5 order. */
export const HANDOFF_TOOLS = [
  "export_to_after_effects_tool",
  "send_to_after_effects_tool",
  "export_to_premiere_tool",
  "send_to_premiere_tool",
  "import_timeline_xml_tool",
  "list_remotion_compositions_tool",
  "import_remotion_project_tool",
  "export_to_remotion_tool",
  "import_hyperframes_project_tool",
  "export_to_hyperframes_tool",
  "import_linked_media_tool",
  "get_linked_clip_tool",
  "update_linked_clip_tool",
  "rerender_linked_clip_tool",
  "open_linked_source_tool",
  "unlink_clip_tool",
];

/**
 * Annotation exceptions, with the reason. zenvi-core's `read_only` means "does
 * not change the project"; MCP's readOnlyHint means "does not change the
 * environment", so tools that run project code or start other programs are
 * not read-only even when the project stays untouched.
 */
export const ANNOTATION_OVERRIDES = {
  list_remotion_compositions_tool: { readOnlyHint: false, why: "runs the Remotion project's own code (bundler, headless Chrome) to read its compositions" },
  open_linked_source_tool: { readOnlyHint: false, why: "starts a code editor, Remotion Studio, a HyperFrames preview or After Effects" },
};

/**
 * MCP annotations for a desktop tool:
 * - readOnlyHint (and idempotentHint): the desktop's read_only, but never for
 *   tools that write files (export_to_*, send_to_*) or are listed above;
 * - destructiveHint: the tool can replace existing files or edits (an
 *   `overwrite` or `replace_edits` argument);
 * - openWorldHint: always (the desktop app, Node toolchains, Adobe apps).
 */
export function annotationsFor(row) {
  const override = ANNOTATION_OVERRIDES[row.name] ?? {};
  const properties = Object.keys(row.input_schema?.properties ?? {});
  const writesFiles = /^(export_to_|send_to_)/.test(row.name);
  const readOnly = override.readOnlyHint ?? (Boolean(row.read_only) && !writesFiles);
  const destructive = override.destructiveHint ?? (properties.includes("overwrite") || properties.includes("replace_edits"));
  return { readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: readOnly, openWorldHint: true };
}

/** An MCP tool entry from a manifest row (`{name, label, description, input_schema, read_only}`). */
export function fromManifest(row) {
  return {
    name: row.name,
    title: row.label,
    description: row.description,
    inputSchema: row.input_schema,
    annotations: annotationsFor(row),
    source: "zenvi-core",
  };
}

/** The new file text, plus the names the manifest lacks (their current entries are kept as they are). */
export function syncText(manifest, currentText, label) {
  const current = currentText ? JSON.parse(currentText) : { tools: [] };
  const existing = new Map(current.tools.map((tool) => [tool.name, tool]));
  const rows = new Map((manifest.tools ?? []).map((row) => [row.name, row]));
  const kept = [];
  const tools = HANDOFF_TOOLS.map((name) => {
    const row = rows.get(name);
    if (row) return fromManifest(row);
    const entry = existing.get(name);
    if (!entry) throw new Error(`${name} is neither in the manifest nor in ${path.basename(GEN_FILE)}: add its SPEC §3.5 entry by hand ("source": "spec")`);
    // A hand-written entry stays "spec"; one from an earlier manifest stays "zenvi-core".
    kept.push(name);
    return entry;
  });
  const doc = {
    generated_by: "packages/cli/scripts/sync-desktop-handoff-tools.mjs",
    manifest: { source: manifest.source ?? null, manifest_version: manifest.manifest_version ?? null, label: label ?? current.manifest?.label ?? null },
    tools,
  };
  return { text: `${JSON.stringify(doc, null, 2)}\n`, kept };
}

function main(argv) {
  const manifestPath = argv.find((arg) => !arg.startsWith("--") && argv[argv.indexOf(arg) - 1] !== "--label");
  if (!manifestPath) throw new Error("usage: sync-desktop-handoff-tools.mjs <editor-tool-manifest.json> [--check] [--label text]");
  const labelAt = argv.indexOf("--label");
  const label = labelAt >= 0 ? argv[labelAt + 1] : undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  let currentText = "";
  try {
    currentText = readFileSync(GEN_FILE, "utf8");
  } catch {
    currentText = "";
  }
  const { text, kept } = syncText(manifest, currentText, label);
  if (kept.length) console.warn(`not in this manifest (kept the current entry): ${kept.join(", ")}`);
  if (argv.includes("--check")) {
    if (text !== currentText) {
      console.error(`${path.relative(process.cwd(), GEN_FILE)} is stale: run this script without --check`);
      process.exit(1);
    }
    console.log(`${path.relative(process.cwd(), GEN_FILE)} is up to date`);
    return;
  }
  writeFileSync(GEN_FILE, text);
  console.log(`wrote ${path.relative(process.cwd(), GEN_FILE)} (${HANDOFF_TOOLS.length - kept.length} from the manifest, ${kept.length} kept)`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
