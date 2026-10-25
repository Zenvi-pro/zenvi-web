/**
 * Editor settings and layout: get_preferences_tool, set_preference_tool,
 * get_editor_layout_tool, set_editor_layout_tool.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export_prefs.py and
 * project_export_views.py. The engine keeps the desktop's rules (lookups by
 * key or title with suggestions, typed validation, ranges, choices,
 * shortcut syntax and conflicts, panel names and aliases); the editor host
 * (UiHost.preferences / layout) lists what it has and applies a change. Only
 * an editor window has settings and panels: the CLI and Zenvi Cloud refuse.
 * Nothing here is project data, so no call is an undo step.
 */

import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { pyFloat, pyRepr, pyReprString } from "../pyfmt.js";
import type { EditorLayout, EditorPanel, PreferenceEntry, PreferenceValue } from "../types.js";
import { text } from "./common.js";
import { editorRun, nothingChanged, ok, ToolError } from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const SETTINGS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

const NO_SETTINGS =
  "there is no editor window here, so no editor settings: Zenvi desktop's Preferences and the web editor's own settings belong to those editors";
const NO_LAYOUT = "there is no editor window here, so no panels to arrange: the layout belongs to Zenvi desktop and the web editor";

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function preferenceList(call: ToolCall): PreferenceEntry[] | null {
  const ui = call.host.ui;
  return ui?.preferences ? ui.preferences() : null;
}

/** A value as the desktop's `{value!r}` prints it (spinner values are floats). */
function reprValue(entry: Pick<PreferenceEntry, "type">, value: unknown): string {
  return entry.type === "spinner" && typeof value === "number" ? pyFloat(value) : pyRepr(value);
}

/** `_find`: by key, then by title (case-insensitive); else suggestions. */
function findPreference(items: readonly PreferenceEntry[], key: string): PreferenceEntry {
  const wanted = key.trim().toLowerCase();
  const byKey = items.find((d) => d.key.toLowerCase() === wanted);
  if (byKey) return byKey;
  const byTitle = items.find((d) => d.title.trim().toLowerCase() === wanted);
  if (byTitle) return byTitle;
  const close = items.filter((d) => wanted && (d.key.toLowerCase().includes(wanted) || d.title.toLowerCase().includes(wanted))).map((d) => d.key);
  const hint = close.length > 0 ? ` Did you mean: ${close.slice(0, 6).join(", ")}?` : " Use get_preferences_tool to list them.";
  throw new ToolError(`no preference named '${key}' in this editor.${hint}`);
}

/** `_describe`: what get_preferences_tool reports for one entry. */
function describePreference(entry: PreferenceEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    key: entry.key,
    title: entry.title,
    tab: entry.tab,
    type: entry.type,
    value: entry.value,
    default: entry.default,
    restart_required: Boolean(entry.restartRequired),
  };
  if (entry.min !== undefined) out.min = entry.min;
  if (entry.max !== undefined) out.max = entry.max;
  if (entry.type === "dropdown") out.choices = entry.choices ?? [];
  if (entry.readOnly) {
    out.read_only = true;
    out.read_only_reason = entry.readOnly;
  }
  return out;
}

const SHORTCUT_RE =
  /^((Ctrl|Shift|Alt|Meta|Cmd)\+)*([A-Za-z0-9]|F\d{1,2}|[^\s+]|Left|Right|Up|Down|Home|End|PgUp|PgDown|Space|Tab|Return|Enter|Esc|Escape|Del|Delete|Backspace|Ins|Insert)$/;

/** `_shortcut_conflicts`: sequences another shortcut already uses. */
function shortcutConflicts(items: readonly PreferenceEntry[], key: string, sequences: readonly string[]): string[] {
  const clashes: string[] = [];
  for (const d of items) {
    if (d.tab !== "Keyboard" || d.key === key) continue;
    const theirs = new Set(
      String(d.value ?? "")
        .split("|")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    for (const seq of sequences) if (theirs.has(seq.toLowerCase())) clashes.push(`${seq} is already ${d.title || d.key}`);
  }
  return clashes;
}

/** `_parse_value`: the typed value for an entry, or the desktop's refusal. */
function parsePreferenceValue(items: readonly PreferenceEntry[], entry: PreferenceEntry, value: string): PreferenceValue {
  const key = entry.key;
  const t = value.trim();
  if (entry.type === "bool") {
    const low = t.toLowerCase();
    if (["true", "1", "yes", "on"].includes(low)) return true;
    if (["false", "0", "no", "off"].includes(low)) return false;
    throw new ToolError(`${key} is on/off: give true or false`);
  }
  if (entry.type === "spinner" || entry.type === "spinner-int") {
    const num = t === "" ? Number.NaN : Number(t);
    if (!Number.isFinite(num)) throw new ToolError(`${key} needs a number, got ${pyReprString(value)}`);
    if (entry.type === "spinner-int" && num !== Math.trunc(num)) throw new ToolError(`${key} needs a whole number, got ${pyReprString(value)}`);
    const lo = entry.min;
    const hi = entry.max;
    if ((lo !== undefined && num < lo) || (hi !== undefined && num > hi)) {
      const bound = (n: number | undefined) => (n === undefined ? "None" : entry.type === "spinner" ? pyFloat(n) : String(n));
      throw new ToolError(`${key} must be between ${bound(lo)} and ${bound(hi)}, got ${pyReprString(value)}`);
    }
    return num;
  }
  if (entry.type === "dropdown") {
    const choices = entry.choices ?? [];
    for (const c of choices) {
      if (String(c.value).toLowerCase() === t.toLowerCase() || String(c.name ?? "").toLowerCase() === t.toLowerCase()) return c.value;
    }
    throw new ToolError(`${key} must be one of: ${choices.map((c) => `${String(c.value)} (${c.name})`).join(", ")}`);
  }
  if (entry.tab === "Keyboard") {
    const sequences = t
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of sequences) {
      if (!SHORTCUT_RE.test(s)) throw new ToolError(`'${s}' is not a key sequence like 'Ctrl+Shift+K' or 'F5'`);
    }
    const clashes = shortcutConflicts(items, key, sequences);
    if (clashes.length > 0) throw new ToolError(`shortcut conflict: ${clashes.join("; ")}`);
    return sequences.join(" | ");
  }
  if (entry.type === "text" || entry.type === "browse") return value;
  throw new ToolError(`${key} (${String(entry.type)}) cannot be changed here`);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** project_export_views._VIEW_ALIASES. */
const VIEW_ALIASES: Record<string, string> = {
  default: "simple",
  editing: "simple",
  edit: "simple",
  "color grade": "color",
  "color grading": "color",
  colour: "color",
  grading: "color",
  record: "recording",
  "recording view": "recording",
  "color view": "color",
  "simple view": "simple",
};

/** The desktop's dock aliases (project_export_views._DOCK_ALIASES) for the panels both editors have, by panel name. */
const PANEL_ALIASES: Record<string, string> = {
  files: "Project Files",
  "project files": "Project Files",
  media: "Project Files",
  preview: "Video Preview",
  video: "Video Preview",
  "video preview": "Video Preview",
  viewer: "Video Preview",
  timeline: "Timeline",
  transitions: "Transitions",
  effects: "Effects",
  properties: "Properties",
  chat: "Assistant",
  assistant: "Assistant",
  agents: "Assistant",
  "ai chat": "Assistant",
  titles: "Titles",
  stock: "Stock",
  generate: "Generate",
};

const pyCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `_find_dock`: a panel by name, alias or a unique part of its name. */
function findPanel(layout: EditorLayout, name: string): EditorPanel {
  const wanted = name.trim().toLowerCase();
  const exact = layout.panels.find((p) => p.name.toLowerCase() === wanted);
  if (exact) return exact;
  const alias = PANEL_ALIASES[wanted];
  const aliased = alias ? layout.panels.find((p) => p.name === alias) : undefined;
  if (aliased) return aliased;
  const hits = layout.panels.filter((p) => wanted && p.name.toLowerCase().includes(wanted));
  if (hits.length === 1) return hits[0]!;
  const names = [...new Set(layout.panels.map((p) => p.name))].sort(pyCompare);
  throw new ToolError(`no panel named '${name}'; panels: ${names.join(", ")}`);
}

/** `layout_report`. */
function layoutReport(layout: EditorLayout): Record<string, unknown> {
  return {
    active_view: layout.view,
    custom_views: [],
    open_panels: layout.panels.filter((p) => p.open).map((p) => p.name).sort(pyCompare),
    closed_panels: layout.panels.filter((p) => !p.open).map((p) => p.name).sort(pyCompare),
    toolbar_visible: layout.toolbarVisible,
    fullscreen: layout.fullscreen,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const projectPrefsTools: CatalogTool[] = [
  contractTool("get_preferences_tool", {
    annotations: READ,
    run: (call, input) =>
      editorRun(() => {
        const items = preferenceList(call);
        if (!items) return unavailable(call.tool, NO_SETTINGS);
        const key = text(input.key);
        if (key) {
          const item = findPreference(items, key);
          return ok(call, `${item.title} = ${reprValue(item, item.value)} (default ${reprValue(item, item.default)}).`, { preference: describePreference(item) });
        }
        const tab = input.tab ?? "";
        const tokens = (input.query ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
        const rows: Record<string, unknown>[] = [];
        for (const d of items) {
          if (tab && d.tab !== tab) continue;
          if (d.tab === "Keyboard" && !(tab === "Keyboard" || tokens.length > 0)) continue;
          const words = `${d.key} ${d.title}`.toLowerCase();
          if (tokens.length > 0 && !tokens.every((t) => words.includes(t))) continue;
          rows.push(describePreference(d));
        }
        return ok(call, `${rows.length} preference(s)${tab ? ` on ${tab}` : ""}.`, { preferences: rows });
      }),
  }),

  contractTool("set_preference_tool", {
    annotations: SETTINGS,
    run: (call, input) =>
      editorRun(() => {
        const items = preferenceList(call);
        const ui = call.host.ui;
        if (!items || !ui?.setPreference) return unavailable(call.tool, NO_SETTINGS);
        const key = text(input.key);
        const tab = input.restore_tab ?? "";
        if (tab) {
          if (key) throw new ToolError("give either key/value or restore_tab, not both");
          let restart = false;
          const restored: string[] = [];
          for (const d of items) {
            if (d.tab !== tab || d.readOnly || d.default === null || d.value === d.default) continue;
            ui.setPreference(d.key, d.default);
            restored.push(d.key);
            restart ||= Boolean(d.restartRequired);
          }
          return ok(call, `Restored the ${tab} preferences to their defaults${restart ? "; restart Zenvi for all of them to take effect." : "."}`, {
            tab,
            restored,
            restart_required: restart,
          });
        }
        if (!key) throw new ToolError("give key and value (see get_preferences_tool), or restore_tab");
        const item = findPreference(items, key);
        if (item.readOnly) throw new ToolError(`'${item.key}' is protected: ${item.readOnly}`);
        const next = parsePreferenceValue(items, item, input.value ?? "");
        const previous = item.value;
        const label = item.title || item.key;
        if (next === previous) return nothingChanged(call, `${label} is already ${reprValue(item, next)}.`, { key: item.key, value: next });
        try {
          ui.setPreference(item.key, next);
        } catch (error) {
          throw new ToolError(`could not apply ${item.key}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const restart = Boolean(item.restartRequired);
        return ok(call, `Set ${label} to ${reprValue(item, next)} (was ${reprValue(item, previous)})${restart ? "; restart Zenvi for it to take effect." : "."}`, {
          key: item.key,
          value: next,
          previous,
          changed: true,
          restart_required: restart,
        });
      }),
  }),

  contractTool("get_editor_layout_tool", {
    annotations: READ,
    run: (call) =>
      editorRun(() => {
        const ui = call.host.ui;
        if (!ui?.layout) return unavailable(call.tool, NO_LAYOUT);
        const report = layoutReport(ui.layout());
        const open = (report.open_panels as string[]).length;
        return ok(call, `View '${String(report.active_view) || "custom"}' with ${open} open panel(s).`, report);
      }),
  }),

  contractTool("set_editor_layout_tool", {
    annotations: SETTINGS,
    run: (call, input) =>
      editorRun(() => {
        const view = text(input.view);
        const show = (input.show_panels ?? []).map(String).filter((s) => s.trim());
        const hide = (input.hide_panels ?? []).map(String).filter((s) => s.trim());
        const scopes = input.scopes ?? "";
        const toolbar = input.toolbar ?? "";
        const fullscreen = input.fullscreen ?? "";
        const saveAs = text(input.save_view_as);
        const deleteView = text(input.delete_view);
        if (!view && show.length === 0 && hide.length === 0 && !scopes && !toolbar && !fullscreen && !input.dock_all && !saveAs && !input.update_active_view && !deleteView) {
          throw new ToolError(
            "say what to change (view, show_panels, hide_panels, scopes, toolbar, fullscreen, dock_all, save_view_as, update_active_view, delete_view); " +
              "get_editor_layout_tool reads it",
          );
        }
        const ui = call.host.ui;
        if (!ui?.layout || !ui.setLayout) return unavailable(call.tool, NO_LAYOUT);
        const before = ui.layout();
        // Everything is checked before anything moves.
        let builtin: "simple" | undefined;
        if (view) {
          const wanted = view.trim().toLowerCase();
          const key = VIEW_ALIASES[wanted] ?? wanted;
          if (key === "simple") builtin = "simple";
          else if (key === "color") throw new ToolError("this editor has no Color Grade view (no scopes or Color Wheels); views: simple");
          else if (key === "recording") throw new ToolError("this editor has no Recording view; views: simple");
          else throw new ToolError(`no view named '${view}'; views: simple`);
        }
        const toShow = show.map((n) => findPanel(before, n));
        const toHide = hide.map((n) => findPanel(before, n));
        for (const panel of toHide) {
          if (!panel.closable) throw new ToolError(`the ${panel.name} panel always stays open in this editor`);
        }
        if (scopes) throw new ToolError("this editor has no scopes (Histogram, Luma Waveform, Vectorscope, Audio Levels)");
        if (toolbar === "hide") throw new ToolError("this editor's toolbar cannot be hidden");
        if (fullscreen && (fullscreen === "on") !== before.fullscreen) {
          throw new ToolError("a browser enters or leaves fullscreen only from a click or a key press: press F11 or use the browser's fullscreen button");
        }
        if (saveAs || input.update_active_view || deleteView) throw new ToolError("this editor has no saved custom views");

        const done: string[] = [];
        let after = before;
        if (builtin || toShow.length > 0 || toHide.length > 0) {
          after = ui.setLayout({
            ...(builtin ? { view: builtin } : {}),
            show: toShow.map((p) => p.name),
            hide: toHide.map((p) => p.name),
          });
        }
        if (builtin) done.push(`${builtin} view`);
        if (input.dock_all) done.push("docked all panels");
        if (toShow.length > 0) done.push(`opened ${toShow.map((p) => p.name).join(", ")}`);
        if (toHide.length > 0) done.push(`closed ${toHide.map((p) => p.name).join(", ")}`);
        if (toolbar === "show") done.push("toolbar shown");
        if (fullscreen) done.push(`fullscreen ${fullscreen}`);
        const warnings: string[] = [];
        for (const panel of toShow) {
          const now = after.panels.find((p) => p.name === panel.name);
          if (now && !now.open) {
            const winner = after.panels.find((p) => p.open && p.group !== undefined && p.group === now.group);
            warnings.push(`${panel.name} shares its place with ${winner ? winner.name : "another panel"}, which is shown instead.`);
          }
        }
        const receipt = ok(call, `Layout: ${done.join("; ")}.`, layoutReport(after));
        receipt.warnings = warnings;
        return receipt;
      }),
  }),
];
