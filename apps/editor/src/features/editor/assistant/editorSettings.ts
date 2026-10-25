/**
 * The web editor's panels and settings as the layout and preferences tools
 * see them (get/set_editor_layout_tool, get_preferences_tool,
 * set_preference_tool). The engine owns the tools' rules (names, aliases,
 * validation); this module says what the editor has and applies a change.
 *
 * Panels: the library on the left shows one of its tabs at a time, the
 * inspector on the right Properties or the Assistant; the preview and the
 * timeline always stay. The "simple" view is how the editor starts: Project
 * Files and Properties open.
 *
 * Settings: timeline snapping can change; the rest describe how the web
 * editor works (it saves every change, keeps 50 undo steps with the project
 * like the desktop's default, talks to the backend it was built for, and
 * uses Zenvi desktop's default shortcuts) and are read-only.
 */

import type { EditorLayout, EditorPanel, LayoutChange, PreferenceEntry, PreferenceValue } from "@zenvi/engine";
import { DESKTOP_KEYMAP, WEB_KEYMAP } from "@/lib/keyboard/keymap";
import type { EditorUiState, LeftTab, RightTab } from "../session/uiStore";

const LEFT: Readonly<Record<LeftTab, string>> = {
  files: "Project Files",
  effects: "Effects",
  transitions: "Transitions",
  titles: "Titles",
  stock: "Stock",
  generate: "Generate",
};
const RIGHT: Readonly<Record<RightTab, string>> = { properties: "Properties", assistant: "Assistant" };
const FIXED = ["Video Preview", "Timeline"];

function isSimple(ui: EditorUiState): boolean {
  return !ui.panels.leftCollapsed && !ui.panels.rightCollapsed && ui.leftTab === "files" && ui.rightTab === "properties";
}

/** The editor's panels (the desktop's docks) and window state. */
export function editorLayout(ui: EditorUiState, fullscreen: boolean): EditorLayout {
  const panels: EditorPanel[] = [
    ...(Object.entries(LEFT) as [LeftTab, string][]).map(([id, name]) => ({ name, open: !ui.panels.leftCollapsed && ui.leftTab === id, closable: true, group: "left" })),
    ...(Object.entries(RIGHT) as [RightTab, string][]).map(([id, name]) => ({ name, open: !ui.panels.rightCollapsed && ui.rightTab === id, closable: true, group: "right" })),
    ...FIXED.map((name) => ({ name, open: true, closable: false })),
  ];
  return { view: isSimple(ui) ? "simple" : "", panels, toolbarVisible: true, fullscreen };
}

const leftTabOf = (name: string): LeftTab | undefined => (Object.entries(LEFT) as [LeftTab, string][]).find(([, n]) => n === name)?.[0];
const rightTabOf = (name: string): RightTab | undefined => (Object.entries(RIGHT) as [RightTab, string][]).find(([, n]) => n === name)?.[0];

/** The UI state after a layout change (panel names as `editorLayout` reports them). */
export function withLayout(ui: EditorUiState, change: LayoutChange): Pick<EditorUiState, "leftTab" | "rightTab" | "panels"> {
  let { leftTab, rightTab } = ui;
  const panels = { ...ui.panels };
  if (change.view === "simple") {
    leftTab = "files";
    rightTab = "properties";
    panels.leftCollapsed = false;
    panels.rightCollapsed = false;
  }
  for (const name of change.show ?? []) {
    const left = leftTabOf(name);
    const right = rightTabOf(name);
    if (left) {
      leftTab = left;
      panels.leftCollapsed = false;
    } else if (right) {
      rightTab = right;
      panels.rightCollapsed = false;
    }
  }
  for (const name of change.hide ?? []) {
    if (leftTabOf(name) === leftTab) panels.leftCollapsed = true;
    if (rightTabOf(name) === rightTab) panels.rightCollapsed = true;
  }
  return { leftTab, rightTab, panels };
}

/** "actionAddMarker" → "Add Marker". */
function shortcutTitle(action: string): string {
  return action
    .replace(/^action/, "")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

const SHORTCUTS_FIXED = "the web editor uses Zenvi desktop's default shortcuts, which cannot be changed here yet";

/** The editor's settings, shaped like the desktop's Preferences entries. */
export function editorPreferences(ui: EditorUiState, backendUrl: string): PreferenceEntry[] {
  const keys: PreferenceEntry[] = Object.entries({ ...DESKTOP_KEYMAP, ...WEB_KEYMAP }).map(([action, combos]) => ({
    key: action,
    title: shortcutTitle(action),
    tab: "Keyboard",
    type: "text",
    value: combos,
    default: combos,
    readOnly: SHORTCUTS_FIXED,
  }));
  return [
    { key: "snapping", title: "Snapping", tab: "Timeline", type: "bool", value: ui.snapping, default: true },
    {
      key: "enable-auto-save",
      title: "Enable Autosave",
      tab: "Autosave",
      type: "bool",
      value: true,
      default: true,
      readOnly: "the web editor saves every change as it is made (to this browser, and to Zenvi Cloud for a cloud project)",
    },
    {
      key: "history-limit",
      title: "History Limit (# of undo/redo)",
      tab: "Autosave",
      type: "spinner-int",
      value: 50,
      default: 50,
      readOnly: "the web editor keeps the last 50 undo steps with the project, Zenvi desktop's default",
    },
    {
      key: "zenvi-backend-url",
      title: "Backend URL",
      tab: "AI",
      type: "text",
      value: backendUrl,
      default: backendUrl,
      readOnly: "it decides where your sign-in token is sent; the web editor is built for one backend",
    },
    ...keys,
  ];
}

/** The UI state that stores a setting (only the ones `editorPreferences` lists without readOnly). */
export function withPreference(key: string, value: PreferenceValue): Partial<EditorUiState> {
  if (key === "snapping") return { snapping: Boolean(value) };
  throw new Error(`${key} cannot be changed in the web editor`);
}
