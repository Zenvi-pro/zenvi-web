import { parseBindings } from "./combo";

/**
 * Desktop default shortcuts, verbatim from zenvi-core
 * `src/settings/_default.settings` (category "Keyboard"). Keys are the
 * desktop action names; the editor's command ids use the same names so a
 * desktop user's muscle memory carries over.
 *
 * Browser-reserved combos (Ctrl+N, Ctrl+T, Ctrl+W) are kept for parity; the
 * browser may not deliver them to the page.
 */
export const DESKTOP_KEYMAP: Readonly<Record<string, string>> = {
  actionAddMarker: "M",
  actionRazorTool: "C | B | R",
  actionPreviousMarker: "Ctrl+Shift+M | Alt+Left",
  actionNextMarker: "Shift+M | Alt+Right",
  actionCenterOnPlayhead: "Shift+C|Alt+Up",
  actionAdd_to_Timeline: "Ctrl+Alt+A",
  actionProfile: "Ctrl+Alt+P",
  actionExportVideo: "Ctrl+E | Ctrl+M",
  actionFile_Properties: "Alt+I",
  actionImportFiles: "Ctrl+I",
  actionNew: "Ctrl+N",
  actionOpen: "Ctrl+O",
  actionRedo: "Ctrl+Shift+Z",
  actionSave: "Ctrl+S",
  actionSaveAs: "Ctrl+Shift+S",
  actionSplitFile: "Alt+S",
  actionTitle: "Ctrl+T",
  actionUndo: "Ctrl+Z",
  actionTimelineZoomIn: "= | Ctrl+=",
  actionTimelineZoomOut: "- | Ctrl+-",
  actionZoomToTimeline: "\\ | Shift+\\",
  seekPreviousFrame: "Left | ,",
  seekNextFrame: "Right | .",
  actionRewind: "J",
  actionFastForward: "L",
  playToggle: "Space | Up | Down | K",
  deleteItem: "Delete | Backspace",
  sliceAllKeepBothSides: "Ctrl+Shift+K",
  sliceAllKeepLeftSide: "Ctrl+Shift+J",
  sliceAllKeepRightSide: "Ctrl+Shift+L",
  sliceSelectedKeepBothSides: "Ctrl+K",
  sliceSelectedKeepLeftSide: "Ctrl+J",
  sliceSelectedKeepRightSide: "Ctrl+L",
  copyAll: "Ctrl+C",
  cutAll: "Ctrl+X",
  pasteAll: "Ctrl+V",
  selectAll: "Ctrl+A",
  selectNone: "Ctrl+Shift+A",
  actionAddTrack: "Ctrl+Y",
  actionSnappingTool: "S",
  actionTimingTool: "T",
  actionJumpStart: "Home",
  actionJumpEnd: "End",
  actionProperties: "U",
  actionTransform: "Ctrl+Alt+T",
  actionInsertKeyframe: "Alt+Shift+K",
  actionInsertKeyframePosition: "Alt+Shift+P",
  actionInsertKeyframeScale: "Alt+Shift+S",
  actionInsertKeyframeRotation: "Alt+Shift+R",
  actionInsertKeyframeAlpha: "Alt+Shift+T",
  actionSaveFrame: "Shift+E",
  nudgeLeft: "Ctrl+Left",
  nudgeLeftBig: "Shift+Ctrl+Left",
  nudgeRight: "Ctrl+Right",
  nudgeRightBig: "Shift+Ctrl+Right",
  actionEditTitle: "Alt+T",
  actionPreview_File: "Alt+P",
  actionDuplicate: "Ctrl+Shift+/",
  actionClearHistory: "Ctrl+Shift+H",
  actionRippleDelete: "Shift+Delete",
  actionRippleSelect: "Alt+A",
  actionRippleSliceKeepLeft: "W",
  actionRippleSliceKeepRight: "Q",
};

/** Web-only additions (no desktop equivalent). */
export const WEB_KEYMAP: Readonly<Record<string, string>> = {
  showShortcuts: "Shift+/",
  commandPalette: "Ctrl+Shift+P",
  escape: "Esc",
};

export type Keymap = ReadonlyMap<string, readonly string[]>;

/** action id → canonical combos. */
export function buildKeymap(
  overrides: Readonly<Record<string, string>> = {},
): Map<string, string[]> {
  const merged: Record<string, string> = { ...DESKTOP_KEYMAP, ...WEB_KEYMAP, ...overrides };
  const map = new Map<string, string[]>();
  for (const [action, bindings] of Object.entries(merged)) map.set(action, parseBindings(bindings));
  return map;
}

/** canonical combo → action ids bound to it (first wins at dispatch). */
export function invertKeymap(keymap: Keymap): Map<string, string[]> {
  const byCombo = new Map<string, string[]>();
  for (const [action, combos] of keymap) {
    for (const combo of combos) {
      const list = byCombo.get(combo) ?? [];
      list.push(action);
      byCombo.set(combo, list);
    }
  }
  return byCombo;
}

/** The first binding of an action, for menus and tooltips. */
export function primaryShortcut(keymap: Keymap, action: string): string | undefined {
  return keymap.get(action)?.[0];
}
