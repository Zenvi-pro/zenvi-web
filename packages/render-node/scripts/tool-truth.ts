/**
 * `npm run tool-truth [-- <dir>] [--report-only]`: the tool truth matrix in
 * full mode (every choice of every effect parameter, and the libopenshot
 * oracle when the desktop's bindings are installed), then a report a person
 * can read without the code:
 *
 *   <dir>/report.md, report.json   coverage by class, failures, known bugs, parity warnings
 *   <dir>/sheet-*.png              default | changed frame pairs, one row per case
 *   <dir>/frames/, sounds/         every case's two frames (PNG) or mixes (WAV)
 *
 * Default <dir>: tool-truth-report/ in the current folder.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodePng } from "../src/image/png.js";
import { rasterizeSvg } from "../src/svg/rasterize.js";
import { allCases } from "../src/tool-truth/cases/index.js";
import { catalogParams, classify, provenIndex, type ParamClass } from "../src/tool-truth/coverage.js";
import { caseSlug } from "../src/tool-truth/harness.js";

interface CaseLine {
  id: string;
  tool: string;
  param: string;
  probe: "picture" | "sound";
  pass: boolean;
  known: string | null;
  failures: string[];
  change: number | null;
  desktop: { checked: boolean; change?: number; correlation?: number; warnings?: string[] } | null;
}

const args = process.argv.slice(2);
const reportOnly = args.includes("--report-only");
const dir = path.resolve(args.find((a) => !a.startsWith("--")) ?? "tool-truth-report");

if (!reportOnly) {
  // Only what an earlier report wrote: <dir> is the caller's folder and may hold anything else.
  if (existsSync(dir)) {
    const owned = (name: string): boolean => ["cases.jsonl", "report.md", "report.json", "frames", "sounds"].includes(name) || /^sheet-.*\.png$/.test(name);
    for (const name of (await readdir(dir)).filter(owned)) await rm(path.join(dir, name), { recursive: true, force: true });
  }
  const run = spawnSync("npx", ["vitest", "run", "--project", "render-node", "packages/render-node/src/tool-truth"], {
    stdio: "inherit",
    // npx is npx.cmd on Windows: spawning it needs a shell there.
    shell: process.platform === "win32",
    env: { ...process.env, ZENVI_TOOL_TRUTH_FULL: "1", ZENVI_TOOL_TRUTH_REPORT: dir },
  });
  process.exitCode = run.status ?? 1;
}

const lines: CaseLine[] = (await readFile(path.join(dir, "cases.jsonl"), "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as CaseLine);

// Coverage of the catalog's arguments.
const index = provenIndex(allCases());
const classes: Record<ParamClass["kind"] | "unclassified", number> = { proven: 0, selector: 0, inert: 0, offscreen: 0, backlog: 0, unclassified: 0 };
const backlog: string[] = [];
for (const { tool, param } of catalogParams()) {
  const c = classify(tool, param, index);
  classes[c?.kind ?? "unclassified"] += 1;
  if (c?.kind === "backlog") backlog.push(`${tool}.${param}: ${c.reason}`);
}

const failing = lines.filter((l) => !l.pass && !l.known);
const known = lines.filter((l) => l.known);
const warnings = lines.filter((l) => l.pass && l.desktop?.warnings?.length);
const desktopChecked = lines.filter((l) => l.desktop?.checked).length;
const summary = {
  cases: lines.length,
  passed: lines.filter((l) => l.pass).length,
  failing: failing.length,
  known: known.length,
  desktopChecked,
  parityWarnings: warnings.length,
  catalogArguments: classes,
};
await writeFile(
  path.join(dir, "report.json"),
  JSON.stringify({ summary, failing, known: known.map((l) => ({ id: l.id, issue: l.known, failures: l.failures })), warnings: warnings.map((l) => ({ id: l.id, warning: l.desktop!.warnings![0] })), backlog }, null, 2),
);

const md = [
  "# Tool truth report",
  "",
  `${summary.cases} cases: ${summary.passed} pass, ${summary.failing} fail, ${summary.known} known bugs; ${desktopChecked} also checked against libopenshot.`,
  "",
  "Catalog arguments (mutating tools): " + Object.entries(classes).map(([k, v]) => `${k} ${v}`).join(", ") + ".",
  "",
  "## Failing (new)",
  ...(failing.length ? failing.map((l) => `- \`${l.id}\`: ${l.failures.join("; ")}`) : ["- none"]),
  "",
  "## Known bugs (ledger.ts)",
  ...known.map((l) => `- \`${l.id}\`: ${l.known}`),
  "",
  "## Parity warnings (both renderers change, different pixels)",
  ...warnings.map((l) => `- \`${l.id}\`: ${l.desktop!.warnings![0]}`),
  "",
  "## Backlog (should change the picture or the sound, not proven yet)",
  ...backlog.map((b) => `- ${b}`),
  "",
].join("\n");
await writeFile(path.join(dir, "report.md"), md);

// Contact sheets: default | changed, one row per case.
const W = 160;
const H = 90;
const LABEL = 14;
const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 80 rows per page: `<name>.png`, then `<name>-2.png` … so no case is left off. */
async function sheet(name: string, rows: CaseLine[]): Promise<void> {
  const all = rows.filter((l) => l.probe === "picture" && existsSync(path.join(dir, "frames", `${caseSlug(l.id)}.base.png`)));
  for (let page = 0; page * 80 < all.length; page += 1) await sheetPage(page === 0 ? name : `${name}-${page + 1}`, all.slice(page * 80, (page + 1) * 80));
}

async function sheetPage(name: string, picture: CaseLine[]): Promise<void> {
  const cols = 2;
  const cellW = 2 * W + 12;
  const cellH = H + LABEL + 8;
  const perCol = Math.ceil(picture.length / cols);
  const width = cols * cellW;
  const height = perCol * cellH;
  const png = async (file: string): Promise<string> => `data:image/png;base64,${(await readFile(path.join(dir, "frames", file))).toString("base64")}`;
  const cells = await Promise.all(
    picture.map(async (l, i) => {
      const x = Math.floor(i / perCol) * cellW;
      const y = (i % perCol) * cellH;
      const slug = caseSlug(l.id);
      const color = l.known ? "#ffb000" : l.pass ? "#9be29b" : "#ff6b6b";
      return [
        `<text x="${x + 2}" y="${y + 11}" font-family="Lato" font-size="10" fill="${color}">${escape(l.id.slice(0, 60))}</text>`,
        `<image href="${await png(`${slug}.base.png`)}" x="${x}" y="${y + LABEL}" width="${W}" height="${H}"/>`,
        `<image href="${await png(`${slug}.variant.png`)}" x="${x + W + 4}" y="${y + LABEL}" width="${W}" height="${H}"/>`,
      ].join("");
    }),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#202020"/>${cells.join("")}</svg>`;
  const image = await rasterizeSvg(svg);
  await writeFile(path.join(dir, `${name}.png`), encodePng(image));
}

await mkdir(dir, { recursive: true });
await sheet("sheet-failing-and-known", [...failing, ...known]);
const firstPerTool = new Map<string, CaseLine>();
for (const l of lines) if (l.pass && l.probe === "picture" && l.tool !== "add_effect_tool" && !firstPerTool.has(`${l.tool} ${l.param}`)) firstPerTool.set(`${l.tool} ${l.param}`, l);
await sheet("sheet-tools", [...firstPerTool.values()]);
await sheet("sheet-effects", lines.filter((l) => l.id.startsWith("add_effect_tool effect=") || l.id.startsWith("apply_fx_tool effects=")));

console.log(`tool truth: ${summary.passed}/${summary.cases} pass, ${summary.failing} failing, ${summary.known} known; report in ${dir}`);
