/**
 * Generate docs/TOOLS.md from the engine's tool catalog: every tool with its
 * description, arguments, surfaces and where it works (web editor, CLI / local
 * MCP, Zenvi Cloud remote MCP, Zenvi desktop).
 *
 *   npx tsx packages/engine/scripts/gen-tools-doc.ts          # write
 *   npx tsx packages/engine/scripts/gen-tools-doc.ts --check  # fail when stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_PROFILES, availabilityMatrix, type Availability } from "../src/tools/availability.js";
import type { CatalogTool } from "../src/tools/define.js";
import type { JsonSchema } from "../src/tools/json-schema.js";
import { allTools } from "../src/tools/registry.js";
import { CONTRACT_REF } from "../src/tools/schemas.gen.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = path.join(ROOT, "docs", "TOOLS.md");

/**
 * Deliberate differences from the desktop handlers (zenvi-core
 * src/classes/tool_handlers.py at the contract ref unless noted).
 */
const DIVERGENCES: [string, string][] = [
  [
    "add_title_tool",
    "The text also replaces every line whose placeholder matches the first line's. Reflection templates (Bar_1, the default) draw a mirrored copy first; the desktop's `_set_svg_text` (agent_tools/titles.py:32) fills only that copy and blanks the real line, so its titles render upside down.",
  ],
  [
    "add_clip_to_timeline_tool",
    "Appending (no position_seconds) butts the clip against the last clip on the track. The desktop places it at `last_end + _one_frame` (tool_handlers.py:2365, develop :2394), leaving a one-frame black/silent gap.",
  ],
  [
    "add_clip_to_timeline_tool and the tools that place through it",
    "A host that cannot watch frames (no frame rendering or no Zenvi backend) counts as \"not watched\": a duration-only trim of a full video is refused instead of placing the first N seconds, and the result never says \"(watched)\". The desktop's watch falls back softly and places the window.",
  ],
  [
    "watch (add_clip_to_timeline_tool, slice_clip_at_best_match_tool, search_clip_scenes_tool, watch_clip_window_tool)",
    "Up to 12 frames rendered by the host; no ffmpeg scene-cut detection (shot cuts are always reported as none) and no near-duplicate frame dedupe (watch_window.py extract_watch_window).",
  ],
  [
    "apply_transition_tool",
    "The contract schema's own arguments are honoured (the desktop handler ignores them): name/transition, timeline_clip_id, clip_query, position_seconds (the cut between two clips), track, duration_seconds, brightness/contrast. clip2 defaults to the next clip on clip1's track instead of `Error: clip2_id is required` (tool_handlers.py:6002); no name means fade (the desktop took the first file in its transitions folder).",
  ],
  [
    "reindex_project_file_tool",
    "\"Already indexed\" reads the current `ai_metadata.index` block (legacy `twelvelabs` as fallback); the desktop reads only `twelvelabs` (tool_handlers.py:6704). Re-uploading for indexing is not available on the web.",
  ],
  [
    "list_markers_tool",
    "A marker's `label` (set by the web editor and add_marker_tool) is shown as its name; desktop markers have none (tool_handlers.py:1121).",
  ],
  [
    "add_title_tool / add_captions_tool",
    "Templates are the bundled catalog, read by basename only (the desktop joined a bare template name into its titles folder unchecked, agent_tools/titles.py:81); an absolute .svg path is read through the host's storage.",
  ],
  [
    "get_transcript_tool, export_captions_tool, add_captions_tool",
    "Transcripts come from the indexed `ai_metadata.transcript_cues`; word timings inside a cue are estimated by character count (`transcriptionSource: \"index_cues\"`, `wordTiming: \"estimated\"`). The desktop runs on-device ASR.",
  ],
  [
    "remove_silence_tool",
    "Speech windows come from the desktop's energy VAD run on the host's RMS envelope (AudioHost.analyzeAudio), not from on-device VAD models.",
  ],
  [
    "argument coercion",
    "As zenvi-core normalize_args, plus numbers/booleans become strings for string-only properties (MCP clients send typed JSON).",
  ],
  [
    "summary previews",
    "`…` is written as U+2026; the desktop's file had the mojibake `ΓÇª` (ai_metadata_utils.build_summary_preview).",
  ],
];

const LEVEL: Record<Availability, string> = { yes: "yes", partial: "partial", no: "—" };

function typeOf(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" \\| ");
  const branches = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])];
  if (branches.length > 0) return [...new Set(branches.map(typeOf))].join(" \\| ");
  if (Array.isArray(schema.type)) return schema.type.join(" \\| ");
  if (schema.type === "array" && schema.items) return `${typeOf(schema.items)}[]`;
  return String(schema.type ?? "any");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function oneLine(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  const end = flat.search(/(?<=[.!?])\s/);
  return end > 0 ? flat.slice(0, end) : flat;
}

function argsTable(tool: CatalogTool): string[] {
  const props = Object.entries(tool.inputSchema.properties);
  if (props.length === 0) return ["No arguments."];
  const required = new Set(tool.inputSchema.required ?? []);
  const rows = ["| Argument | Type | Required | Description |", "| --- | --- | --- | --- |"];
  for (const [name, schema] of props) {
    const extras: string[] = [];
    if (schema.default !== undefined) extras.push(`default ${JSON.stringify(schema.default)}`);
    if (schema.minimum !== undefined) extras.push(`min ${schema.minimum}`);
    if (schema.maximum !== undefined) extras.push(`max ${schema.maximum}`);
    const desc = [schema.description ?? "", extras.length ? `(${extras.join(", ")})` : ""].filter(Boolean).join(" ");
    rows.push(`| \`${name}\` | ${typeOf(schema)} | ${required.has(name) ? "yes" : ""} | ${cell(desc)} |`);
  }
  return rows;
}

function render(): string {
  const matrix = availabilityMatrix(allTools);
  const contract = allTools.filter((t) => t.contract).length;
  const direct = allTools.length - contract;
  const count = (surface: "editor" | "cli" | "cloud", level: Availability): number => matrix.filter((m) => m.availability[surface] === level).length;
  const out: string[] = [
    "# Zenvi tools",
    "",
    "<!-- Generated by packages/engine/scripts/gen-tools-doc.ts from @zenvi/engine/tools. Do not edit by hand. -->",
    "",
    `One tool catalog for every Zenvi surface: the Zenvi Assistant in the web editor, the local MCP server (\`zenvi mcp\`), the Zenvi Cloud remote MCP server, and the CLI. ` +
      `${allTools.length} tools: the ${contract} contract-3 tools of Zenvi desktop (zenvi-core \`${CONTRACT_REF}\`, same names, arguments and receipts) and ${direct} direct tools for coding agents.`,
    "",
    "Every call returns a contract-3 receipt (`{contract: 3, status, tool, summary, clips, …, undoSteps}`); a failure's summary starts with `Error:`, " +
      "and a surface limitation says `Error: <tool> is not available in this Zenvi surface: …` (do not retry). One call is at most one undo step.",
    "",
    "## Where tools work",
    "",
    "| Surface | Host | Works | Partial | Not available |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const surface of ["editor", "cli", "cloud"] as const) {
    const p = SURFACE_PROFILES[surface];
    out.push(`| ${p.title} | \`${p.host}\` | ${count(surface, "yes")} | ${count(surface, "partial")} | ${count(surface, "no")} |`);
  }
  out.push(`| Zenvi desktop | zenvi-core | ${contract} | 0 | ${direct} (direct tools are web-only) |`, "");
  out.push(
    "Availability follows each tool's required host capabilities and the host methods it calls at run time; the hosts are described in `SURFACE_PROFILES` (packages/engine/src/tools/availability.ts). " +
      "Capabilities a session may lack (signed out of Zenvi, no WebCodecs export) are noted per tool.",
    "",
  );
  for (const surface of ["editor", "cli", "cloud"] as const) {
    const p = SURFACE_PROFILES[surface];
    const conditional = Object.entries(p.conditional ?? {}).map(([cap, why]) => `${cap} (${why})`);
    out.push(
      `- **${p.title}**: ${p.capabilities.join(", ")}; methods ${p.methods.join(", ") || "none"}` +
        `${conditional.length ? `; only sometimes: ${conditional.join(", ")}` : ""}${p.hidden?.length ? `; hides ${p.hidden.length} local-app tools` : ""}.`,
    );
  }
  out.push("", "## Matrix", "", "| Tool | Surfaces | Editor | CLI / local MCP | Cloud MCP | Desktop |", "| --- | --- | --- | --- | --- | --- |");
  for (const { tool, availability: a } of matrix) {
    const name = tool.deprecated ? `\`${tool.name}\` (deprecated)` : `[\`${tool.name}\`](#${tool.name})`;
    out.push(`| ${name} | ${tool.surfaces.join(", ")} | ${LEVEL[a.editor]} | ${LEVEL[a.cli]} | ${LEVEL[a.cloud]} | ${LEVEL[a.desktop]} |`);
  }
  out.push("", "## Tools", "");
  for (const { tool, availability: a } of matrix) {
    out.push(`### ${tool.name}`, "");
    out.push(`**${tool.title}**${tool.contract ? "" : " (direct tool)"}${tool.deprecated ? " — deprecated, kept for stored plans" : ""}. ${oneLine(tool.description)}`, "");
    const hints = [
      tool.annotations?.readOnlyHint ? "read-only" : "edits",
      tool.annotations?.destructiveHint ? "destructive" : "",
      tool.annotations?.openWorldHint ? "open world" : "",
    ].filter(Boolean);
    out.push(`Surfaces: ${tool.surfaces.join(", ")}. ${hints.join(", ")}.${tool.requires?.length ? ` Needs: ${tool.requires.join(", ")}.` : ""}`, "");
    const notes = (["editor", "cli", "cloud", "desktop"] as const).map((s) => `${s} ${LEVEL[a[s]]}${a.notes[s] ? ` (${a.notes[s]})` : ""}`);
    out.push(`Availability: ${notes.join("; ")}.`, "");
    out.push(...argsTable(tool), "");
  }
  out.push("## Divergences from the desktop", "", "Deliberate differences from the zenvi-core handlers:", "");
  for (const [what, why] of DIVERGENCES) out.push(`- **${what}**: ${why}`);
  out.push("");
  return out.join("\n");
}

const text = render();
if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(OUT, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== text) {
    console.error("docs/TOOLS.md is stale: run npx tsx packages/engine/scripts/gen-tools-doc.ts");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${allTools.length} tools`);
}
