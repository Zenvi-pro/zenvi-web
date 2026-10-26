/**
 * Replay real agent sessions: pull every Zenvi MCP call out of Claude Code
 * transcripts (bench runs' transcript.jsonl), run them again in order against
 * a fresh project on a fresh `zenvi mcp`, and count what fails by message.
 *
 * A replay has to stand in for the original world:
 * - ids: the new project mints its own ids, so ids in the original receipts
 *   are paired with the new receipts' ids at the same place (same JSON path,
 *   or the same order in the summary) and rewritten in later arguments;
 * - network: stock search and AI generation are not repeated (skipped);
 *   import_stock_media_tool imports the file the original run downloaded
 *   (`local_path`), keeping its placement arguments;
 * - the original folder: outputs and the project path move to the new one.
 * Calls whose arguments need an id the replay never produced are skipped as
 * dependent, so one missing download does not count as many tool failures.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toolStats, type ToolStats } from "./report.js";
import { startPortable, type CallOutcome } from "./targets.js";

const PREFIX = "mcp__zenvi__";
const ID = /^[A-Z0-9]{10}$/;
const ID_IN_TEXT = /\b[A-Z0-9]{10}\b/g;

/** Tools that need the network (stock search, AI generation, web video): not replayed. */
export const NETWORK_TOOLS = new Set([
  "search_pexels_videos_tool",
  "search_freesound_music_tool",
  "generate_tts_and_add_to_timeline_tool",
  "generate_image_and_add_to_timeline_tool",
  "generate_video_and_add_to_timeline_tool",
  "import_video_url_and_add_to_timeline_tool",
  "ingest_web_video_tool",
  "push_to_cloud",
]);

export interface TranscriptCall {
  index: number;
  tool: string;
  args: Record<string, unknown>;
  original: { ok: boolean; summary: string; receipt?: Record<string, unknown> };
}

function receiptFromText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: { type?: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : "")).join("");
  return "";
}

/** A receipt failed: isError, a failing status, or an "Error:" summary. */
function failedReceipt(isError: boolean, receipt: Record<string, unknown> | undefined, text: string): boolean {
  const status = receipt?.status;
  if (isError || status === "error" || status === "refused") return true;
  return String(receipt?.summary ?? text).startsWith("Error");
}

/** The Zenvi MCP calls in a Claude Code stream-json transcript, in call order, with what each answered. */
export function extractCalls(jsonl: string): { cwd?: string; calls: TranscriptCall[] } {
  const pending = new Map<string, { tool: string; args: Record<string, unknown> }>();
  const calls: TranscriptCall[] = [];
  let cwd: string | undefined;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let event: { type?: string; subtype?: string; cwd?: string; message?: { content?: unknown } };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") cwd = event.cwd;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<Record<string, unknown>>) {
      if (event.type === "assistant" && block.type === "tool_use" && String(block.name).startsWith(PREFIX)) {
        pending.set(String(block.id), { tool: String(block.name).slice(PREFIX.length), args: (block.input as Record<string, unknown>) ?? {} });
      } else if (event.type === "user" && block.type === "tool_result") {
        const use = pending.get(String(block.tool_use_id));
        if (!use) continue;
        pending.delete(String(block.tool_use_id));
        const text = resultText(block.content);
        const receipt = receiptFromText(text);
        const ok = !failedReceipt(Boolean(block.is_error), receipt, text);
        calls.push({ index: calls.length, ...use, original: { ok, summary: String(receipt?.summary ?? text).slice(0, 2000), receipt } });
      }
    }
  }
  return { cwd, calls };
}

// ---------------------------------------------------------------------------
// Id pairing and argument rewriting

/** Pair ids the original receipt named with the replay's at the same JSON path, then in summary order. */
export function pairIds(original: unknown, replayed: unknown, map: Map<string, string>): void {
  const walk = (a: unknown, b: unknown): void => {
    if (typeof a === "string" && typeof b === "string") {
      if (ID.test(a) && ID.test(b)) map.set(a, b);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) a.forEach((v, i) => walk(v, b[i]));
    else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      for (const [k, v] of Object.entries(a)) if (k !== "summary") walk(v, (b as Record<string, unknown>)[k]);
    }
  };
  walk(original, replayed);
  const ra = String((original as { summary?: unknown } | undefined)?.summary ?? "").match(ID_IN_TEXT) ?? [];
  const rb = String((replayed as { summary?: unknown } | undefined)?.summary ?? "").match(ID_IN_TEXT) ?? [];
  if (ra.length === rb.length) ra.forEach((id, i) => map.has(id) || map.set(id, rb[i]!));
}

/** Every id-shaped token an original receipt mentioned. */
function idsIn(value: unknown, into: Set<string>): void {
  for (const m of JSON.stringify(value ?? null).match(ID_IN_TEXT) ?? []) into.add(m);
}

const OUTPUT_KEYS = new Set(["path", "output", "output_path", "out", "project_path", "file_path"]);

/**
 * The arguments for the replay: ids mapped, the original folder moved to the
 * new one for outputs and for files that no longer exist. Returns the ids it
 * could not map (ids the original receipts minted that the replay never saw).
 */
export function rewriteArgs(args: Record<string, unknown>, ctx: { ids: Map<string, string>; known: Set<string>; fromDir?: string; toDir: string }): { args: Record<string, unknown>; unmapped: string[] } {
  const unmapped = new Set<string>();
  const fixString = (s: string, key: string | undefined): string => {
    const out = s.replace(ID_IN_TEXT, (id) => {
      const mapped = ctx.ids.get(id);
      if (mapped) return mapped;
      if (ctx.known.has(id)) unmapped.add(id);
      return id;
    });
    if (!ctx.fromDir) return out;
    if (out.startsWith(ctx.fromDir) && ((key && OUTPUT_KEYS.has(key)) || !existsSync(out))) return ctx.toDir + out.slice(ctx.fromDir.length);
    // Media named relative to the original folder ("inputs/a.mp4") stays there; outputs land in the new one.
    if (!(key && OUTPUT_KEYS.has(key)) && out && !path.isAbsolute(out) && !out.includes("\n") && existsSync(path.join(ctx.fromDir, out))) return path.join(ctx.fromDir, out);
    return out;
  };
  // Some tools take a JSON array as a string (import_files_tool paths='["a.mp4"]').
  const fixMaybeJson = (s: string, key: string | undefined): string => {
    if (!s.startsWith("[")) return fixString(s, key);
    try {
      const list: unknown = JSON.parse(s);
      if (Array.isArray(list) && list.every((x) => typeof x === "string")) return JSON.stringify(list.map((x: string) => fixString(x, key)));
    } catch {
      // Not JSON: an ordinary string that starts with "[".
    }
    return fixString(s, key);
  };
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return fixMaybeJson(v, key);
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return { args: walk(args) as Record<string, unknown>, unmapped: [...unmapped] };
}

/** The file an original import_stock_media_tool call downloaded, when it is still on disk. */
export function downloadedFile(call: TranscriptCall, fromDir: string | undefined): string | undefined {
  const named = /(?:Added to project|File already in project \(file_id=\w+\)):\s+(.+?\.(?:mp4|mov|webm|mp3|ogg|wav|m4a|jpg|jpeg|png))\b/i.exec(call.original.summary)?.[1];
  if (named && existsSync(named)) return named;
  if (!fromDir) return undefined;
  const stem = call.args.source === "pexels" ? `pexels_${String(call.args.video_id ?? "")}` : call.args.source === "freesound" ? `freesound_${String(call.args.sound_id ?? "")}` : "";
  if (!stem || stem.endsWith("_")) return undefined;
  for (const dir of readdirSync(fromDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.endsWith("_assets"))) {
    const media = path.join(fromDir, dir.name, "media");
    if (!existsSync(media)) continue;
    const hit = readdirSync(media).find((f) => f.startsWith(`${stem}.`));
    if (hit) return path.join(media, hit);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Running and ranking

export type ReplayOutcome = "ok" | "failed" | "skipped";

export interface ReplayCall {
  run: string;
  index: number;
  tool: string;
  args: string;
  originalOk: boolean;
  originalSummary: string;
  outcome: ReplayOutcome;
  /** Why skipped, or the failure summary. */
  summary: string;
  ms: number;
}

export interface FailureGroup {
  tool: string;
  /** The summary with numbers and ids generalised. */
  message: string;
  count: number;
  /** How many of these calls had failed in the original session too. */
  failedOriginally: number;
  runs: string[];
  example: { run: string; args: string; summary: string };
  proposal?: string;
}

export interface ReplayReport {
  kind: "zenvi-replay";
  version: 1;
  generatedAt: string;
  runsDir: string;
  totals: {
    runs: number;
    calls: number;
    replayed: number;
    ok: number;
    failed: number;
    skipped: number;
    /** Failed now but succeeded in the original session. */
    regressions: number;
    /** Failed in the original session, succeed now. */
    fixedSince: number;
    originalFailed: number;
    originalSuccessRate: number | null;
  };
  tools: Record<string, ToolStats>;
  topFailures: FailureGroup[];
  originalTopFailures: FailureGroup[];
  calls: ReplayCall[];
}

/** A failure message with the variable parts generalised so like failures group. */
export function normaliseMessage(summary: string): string {
  return summary
    .split("\n")[0]!
    .replace(ID_IN_TEXT, "<id>")
    .replace(/'[^']{1,80}\.(mp4|mp3|ogg|wav|png|jpg|mov)'/g, "'<file>'")
    .replace(/\d+(\.\d+)?/g, "N")
    .slice(0, 220);
}

/**
 * What would make a failure group succeed, for the ones seen in the bench
 * transcripts. Keyed by tool + a pattern on the generalised message.
 */
const PROPOSALS: Array<{ tool?: string; pattern: RegExp; proposal: string }> = [
  {
    pattern: /Unknown track or layer 'N'/,
    proposal:
      "Agents name a track one past the stack (track=\"10\" with 9 tracks) to mean 'a new track on top'. Either add the missing track(s) like add_track_tool would (one undo step with the edit) when the number is exactly stack+1..stack+3, or say how many tracks exist and that add_track_tool makes one, in the refusal.",
  },
  {
    pattern: /SUPABASE_JWT_SECRET|server misconfigured/,
    proposal: "Backend configuration (zenvi-backend), not a tool bug: the bench server had no SUPABASE_JWT_SECRET/JWKS. Tools should refuse up front when the backend health check fails, naming the setting.",
  },
  {
    pattern: /runs N-N s \(got N\)/,
    proposal: "Clamp duration_seconds into the block's min-max and warn instead of refusing (the agent wanted 'about this long'); the receipt says the length used.",
  },
  {
    pattern: /already has .* during .*pick another track/,
    proposal: "When the agent names an occupied track for a title/overlay, place it on the first free track above (as with an empty track) and warn, instead of refusing.",
  },
  {
    pattern: /audio placement needs position_seconds .*duration_seconds/,
    proposal: "Default duration_seconds to the rest of the source (or the timeline's length for music) when position_seconds is given for audio.",
  },
  {
    pattern: /would overlap .* pass ripple=true/,
    proposal: "Clear refusal; consider defaulting duplicate_clips_tool to the first free track when the copies would overlap, like add_clip_to_timeline_tool does.",
  },
  {
    pattern: /no (video )?effect matches/,
    proposal: "list_effects_tool should fall back to Zenvi FX / look ids for words it lacks (vignette, invert are apply_fx_tool / apply_look ids) and say which tool has them.",
  },
  { pattern: /Unknown lookId/, proposal: "Map common look names (teal_orange, teal_orange_cinema) to the nearest look preset id, or list the closest ids in the refusal." },
  { pattern: /size must be at least N|radius must be at most N/, proposal: "A block default outside its own range (word_rotator size 0, logo_reveal_end radius 999): fixed in zenvi-web #43 (the manifest test checks filled defaults now)." },
  { pattern: /shape must be one of/, proposal: "particle_burst v2 renamed its shapes: fixed in zenvi-web #43 (enum aliases for the v1 names, and a wrong plural is taken)." },
  { pattern: /grid with N tiles needs at least N s/, proposal: "Fit the tiles to the duration given (fewer tiles, or a faster fill) and say so in a warning, instead of refusing." },
  { pattern: /needs text \(or subtitle \/ lines\)/, proposal: "Agents make white flash frames as a blank title (text=' ', background_color='#FFFFFF', 0.1 s): accept blank text when a background_color is given, or name apply_motion_transition_tool flash_white in the refusal." },
  { pattern: /Additional properties are not allowed \('bpm'/, proposal: "build_reel_tool: accept bpm (beats every 60/bpm s from the first downbeat) or refuse naming beats=, which it does take." },
  {
    pattern: /must be one of/,
    proposal: "Accept near-miss enum values the agent clearly meant (plural 'dots' for 'dot', 'bottom' for 'lower', 'ui_light' for 'light') through per-param aliases, and list the valid values in the refusal (already done).",
  },
  { pattern: /Provide startFrame, or clipId\+start\+end/, proposal: "inspect_timeline_tool: accept start/end in seconds without clipId (the agent's reading of the watchSuggested names)." },
];

function proposalFor(tool: string, message: string): string | undefined {
  return PROPOSALS.find((p) => (!p.tool || p.tool === tool) && p.pattern.test(message))?.proposal;
}

export function groupFailures(rows: ReadonlyArray<{ run: string; tool: string; args: string; summary: string; failedOriginally: boolean }>, limit = 10): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const r of rows) {
    const message = normaliseMessage(r.summary);
    const key = `${r.tool}\u0000${message}`;
    const g = groups.get(key) ?? { tool: r.tool, message, count: 0, failedOriginally: 0, runs: [], example: { run: r.run, args: r.args, summary: r.summary.slice(0, 400) }, proposal: proposalFor(r.tool, message) };
    g.count += 1;
    if (r.failedOriginally) g.failedOriginally += 1;
    if (!g.runs.includes(r.run)) g.runs.push(r.run);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool)).slice(0, limit);
}

function compactArgs(args: Record<string, unknown>): string {
  const s = JSON.stringify(args);
  return s.length > 400 ? `${s.slice(0, 397)}...` : s;
}

function outcomeOf(call: CallOutcome): { ok: boolean; summary: string } {
  if (call.transportError) return { ok: false, summary: `transport: ${call.transportError}` };
  const summary = String(call.receipt?.summary ?? call.text);
  return { ok: !failedReceipt(!call.ok, call.receipt, call.text), summary };
}

/** Replay one transcript on a fresh server. */
export async function replayTranscript(run: string, file: string, options: { bundle?: string; keep?: boolean; skipTools?: ReadonlySet<string> } = {}): Promise<ReplayCall[]> {
  const { cwd, calls } = extractCalls(await readFile(file, "utf8"));
  const work = await mkdtemp(path.join(os.tmpdir(), "zenvi-replay-"));
  const target = await startPortable({ work, home: path.join(work, ".home"), bundle: options.bundle });
  const ids = new Map<string, string>();
  const known = new Set<string>();
  const out: ReplayCall[] = [];
  try {
    for (const call of calls) {
      const base = { run, index: call.index, tool: call.tool, originalOk: call.original.ok, originalSummary: call.original.summary.slice(0, 400) };
      const skip = (summary: string): void => {
        out.push({ ...base, args: compactArgs(call.args), outcome: "skipped", summary, ms: 0 });
        idsIn(call.original.receipt, known);
      };
      if (NETWORK_TOOLS.has(call.tool)) {
        skip("network tool: not replayed");
        continue;
      }
      if (options.skipTools?.has(call.tool)) {
        skip("skipped by --skip-tools");
        continue;
      }
      let args = call.args;
      if (call.tool === "import_stock_media_tool" && !args.local_path) {
        const local = downloadedFile(call, cwd);
        if (!local) {
          skip("the original download is not on disk");
          continue;
        }
        args = { ...args, local_path: local };
      }
      const rewritten = rewriteArgs(args, { ids, known, fromDir: cwd, toDir: work });
      if (rewritten.unmapped.length > 0) {
        skip(`needs ids the replay did not produce (${rewritten.unmapped.slice(0, 3).join(", ")})`);
        continue;
      }
      const res = await target.call(call.tool, rewritten.args, 600_000);
      const got = outcomeOf(res);
      out.push({ ...base, args: compactArgs(rewritten.args), outcome: got.ok ? "ok" : "failed", summary: got.summary.slice(0, 1000), ms: res.ms });
      idsIn(call.original.receipt, known);
      if (got.ok && call.original.receipt && res.receipt) pairIds(call.original.receipt, res.receipt, ids);
      if (res.transportError) break;
    }
  } finally {
    await target.close();
    if (!options.keep) await rm(work, { recursive: true, force: true });
  }
  return out;
}

/** `<runsDir>/<benchmark>/<stamp>/transcript.jsonl`, sorted. */
export async function findTranscripts(runsDir: string): Promise<Array<{ run: string; file: string }>> {
  const found: Array<{ run: string; file: string }> = [];
  for (const bench of (await readdir(runsDir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    for (const stamp of (await readdir(path.join(runsDir, bench.name), { withFileTypes: true })).filter((d) => d.isDirectory())) {
      const file = path.join(runsDir, bench.name, stamp.name, "transcript.jsonl");
      if (existsSync(file)) found.push({ run: `${bench.name}/${stamp.name}`, file });
    }
  }
  return found.sort((a, b) => a.run.localeCompare(b.run));
}

export interface ReplayRunsOptions {
  runsDir: string;
  only?: string;
  jobs: number;
  bundle?: string;
  keep?: boolean;
  /** Tools not to replay (renders take most of a replay's time and rarely fail). */
  skipTools?: ReadonlySet<string>;
  log?: (line: string) => void;
  /** Each session's calls as soon as it is replayed (a long replay keeps what it did if stopped). */
  onRun?: (calls: ReplayCall[]) => Promise<void>;
}

export async function replayRuns(options: ReplayRunsOptions): Promise<ReplayReport> {
  const transcripts = (await findTranscripts(options.runsDir)).filter((t) => !options.only || t.run.includes(options.only));
  const results: ReplayCall[][] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < transcripts.length) {
      const t = transcripts[next++]!;
      const started = performance.now();
      const calls = await replayTranscript(t.run, t.file, options).catch((error: Error): ReplayCall[] => {
        options.log?.(`${t.run}: replay crashed: ${error.message}`);
        return [];
      });
      results.push(calls);
      await options.onRun?.(calls);
      const failed = calls.filter((c) => c.outcome === "failed").length;
      options.log?.(`${t.run}: ${calls.length} calls, ${failed} failed (${((performance.now() - started) / 1000).toFixed(0)} s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.jobs, transcripts.length) }, worker));
  const calls = results.flat().sort((a, b) => a.run.localeCompare(b.run) || a.index - b.index);
  return buildReplayReport(options.runsDir, transcripts.length, calls);
}

export function buildReplayReport(runsDir: string, runs: number, calls: ReplayCall[], now: Date = new Date()): ReplayReport {
  const replayed = calls.filter((c) => c.outcome !== "skipped");
  const failed = replayed.filter((c) => c.outcome === "failed");
  const originalFailed = calls.filter((c) => !c.originalOk);
  const byTool = new Map<string, ReplayCall[]>();
  for (const c of calls) byTool.set(c.tool, [...(byTool.get(c.tool) ?? []), c]);
  const asRecord = (c: ReplayCall) => ({ outcome: c.outcome === "ok" ? ("pass" as const) : c.outcome === "failed" ? ("fail" as const) : ("skip" as const), ms: c.ms });
  return {
    kind: "zenvi-replay",
    version: 1,
    generatedAt: now.toISOString(),
    runsDir,
    totals: {
      runs,
      calls: calls.length,
      replayed: replayed.length,
      ok: replayed.length - failed.length,
      failed: failed.length,
      skipped: calls.length - replayed.length,
      regressions: failed.filter((c) => c.originalOk).length,
      fixedSince: replayed.filter((c) => c.outcome === "ok" && !c.originalOk).length,
      originalFailed: originalFailed.length,
      originalSuccessRate: calls.length ? Math.round((1 - originalFailed.length / calls.length) * 1000) / 1000 : null,
    },
    tools: Object.fromEntries([...byTool.keys()].sort().map((t) => [t, toolStats(byTool.get(t)!.map(asRecord))])),
    topFailures: groupFailures(failed.map((c) => ({ run: c.run, tool: c.tool, args: c.args, summary: c.summary, failedOriginally: !c.originalOk }))),
    originalTopFailures: groupFailures(originalFailed.map((c) => ({ run: c.run, tool: c.tool, args: c.args, summary: c.originalSummary, failedOriginally: true }))),
    calls,
  };
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 240);

function failureTable(title: string, groups: FailureGroup[]): string[] {
  const lines = [`## ${title}`, "", "| # | count | tool | message | proposed fix |", "| --- | --- | --- | --- | --- |"];
  groups.forEach((g, i) => lines.push(`| ${i + 1} | ${g.count} | ${g.tool} | ${cell(g.message)} | ${cell(g.proposal ?? "")} |`));
  return [...lines, ""];
}

export function replayMarkdown(report: ReplayReport): string {
  const t = report.totals;
  const pct = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
  return [
    "# Zenvi MCP transcript replay",
    "",
    `${t.runs} sessions, ${t.calls} Zenvi calls. Originally ${t.calls - t.originalFailed}/${t.calls} succeeded (${pct(t.calls - t.originalFailed, t.calls)}).`,
    `Replayed ${t.replayed} (${t.skipped} skipped: network tools, missing downloads and calls that need their ids): ${t.ok} ok, ${t.failed} failed (${pct(t.ok, t.replayed)} success); ` +
      `${t.regressions} failed that had succeeded, ${t.fixedSince} succeed that had failed.`,
    "",
    ...failureTable("Top failures now (replay)", report.topFailures),
    ...failureTable("Top failures in the original sessions", report.originalTopFailures),
  ].join("\n");
}
