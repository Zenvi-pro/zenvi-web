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
 * A tool the manifest does not have yet keeps its current entry (written by
 * hand from SPEC §3.5, `"source": "spec"`) and is reported. `--check` exits 1
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

/** An MCP tool entry from a manifest row (`{name, label, description, input_schema, read_only}`). */
export function fromManifest(row) {
  const readOnly = Boolean(row.read_only);
  return {
    name: row.name,
    title: row.label,
    description: row.description,
    inputSchema: row.input_schema,
    // Every handoff tool acts through the desktop app (and often Node, ffmpeg or an Adobe app).
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: true },
    source: "zenvi-core",
  };
}

/** The new file text, plus the names still hand-written. */
export function syncText(manifest, currentText, label) {
  const current = currentText ? JSON.parse(currentText) : { tools: [] };
  const existing = new Map(current.tools.map((tool) => [tool.name, tool]));
  const rows = new Map((manifest.tools ?? []).map((row) => [row.name, row]));
  const handWritten = [];
  const tools = HANDOFF_TOOLS.map((name) => {
    const row = rows.get(name);
    if (row) return fromManifest(row);
    const kept = existing.get(name);
    if (!kept) throw new Error(`${name} is neither in the manifest nor in ${path.basename(GEN_FILE)}: add its SPEC §3.5 entry by hand ("source": "spec")`);
    handWritten.push(name);
    return { ...kept, source: "spec" };
  });
  const doc = {
    generated_by: "packages/cli/scripts/sync-desktop-handoff-tools.mjs",
    manifest: { source: manifest.source ?? null, manifest_version: manifest.manifest_version ?? null, label: label ?? current.manifest?.label ?? null },
    tools,
  };
  return { text: `${JSON.stringify(doc, null, 2)}\n`, handWritten };
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
  const { text, handWritten } = syncText(manifest, currentText, label);
  if (handWritten.length) console.warn(`not in the manifest yet (kept the SPEC §3.5 entry): ${handWritten.join(", ")}`);
  if (argv.includes("--check")) {
    if (text !== currentText) {
      console.error(`${path.relative(process.cwd(), GEN_FILE)} is stale: run this script without --check`);
      process.exit(1);
    }
    console.log(`${path.relative(process.cwd(), GEN_FILE)} is up to date`);
    return;
  }
  writeFileSync(GEN_FILE, text);
  console.log(`wrote ${path.relative(process.cwd(), GEN_FILE)} (${HANDOFF_TOOLS.length - handWritten.length} from the manifest, ${handWritten.length} hand-written)`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
