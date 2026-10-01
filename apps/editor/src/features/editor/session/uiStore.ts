/**
 * Per-session UI state (selection, tools, zoom, panels, dialogs). Project data
 * never lives here: it lives in the ProjectDocument.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

export type Tool = "select" | "razor";
export type LeftTab = "files" | "effects" | "transitions" | "titles" | "stock" | "generate";
export type RightTab = "properties" | "assistant";
export type DialogId = "export" | "shortcuts" | "relink" | "profile" | "title" | "palette" | "share" | "cloudConflict" | "upload";

export interface Selection {
  clips: string[];
  transitions: string[];
  markers: string[];
  /** A clip effect shown in Properties (child of a selected clip). */
  effect: string | null;
}

export const EMPTY_SELECTION: Selection = { clips: [], transitions: [], markers: [], effect: null };

export interface EditorUiState {
  selection: Selection;
  tool: Tool;
  snapping: boolean;
  /** Timeline zoom, pixels per second. */
  pxPerSecond: number;
  trackHeight: number;
  leftTab: LeftTab;
  rightTab: RightTab;
  dialog: DialogId | null;
  /** Title being edited (file id) when the title dialog is open for an existing title. */
  editingTitleFileId: string | null;
  /** Template the title dialog starts from. */
  titleTemplate: string | null;
  panels: { left: number; right: number; timeline: number; leftCollapsed: boolean; rightCollapsed: boolean };
  /**
   * Properties the person chose to animate (`<ownerId>:<prop>`) while they
   * still hold one value: the next edit at another frame adds a keyframe.
   */
  armedKeyframes: string[];
}

export const MIN_PX_PER_SECOND = 0.5;
export const MAX_PX_PER_SECOND = 1200;

const PANEL_KEY = "zenvi.editor.panels.v1";

/** Defaults that leave the preview room on a 1280×720 laptop and on tablets. */
function defaultPanels(): EditorUiState["panels"] {
  const w = typeof window === "undefined" ? 1440 : window.innerWidth;
  const h = typeof window === "undefined" ? 900 : window.innerHeight;
  return {
    left: w < 1200 ? 250 : 300,
    right: w < 1200 ? 270 : 320,
    timeline: Math.round(Math.min(340, Math.max(190, h * 0.36))),
    leftCollapsed: false,
    rightCollapsed: w < 1000,
  };
}

function loadPanels(): EditorUiState["panels"] {
  const fallback = defaultPanels();
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<EditorUiState["panels"]>;
    return {
      left: typeof parsed.left === "number" ? parsed.left : fallback.left,
      right: typeof parsed.right === "number" ? parsed.right : fallback.right,
      timeline: typeof parsed.timeline === "number" ? parsed.timeline : fallback.timeline,
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
    };
  } catch {
    return fallback;
  }
}

export function savePanels(panels: EditorUiState["panels"]): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(panels));
  } catch {
    // Private mode or blocked storage: sizes just are not remembered.
  }
}

export type UiStore = StoreApi<EditorUiState>;

export function createUiStore(initial: Partial<EditorUiState> = {}): UiStore {
  return createStore<EditorUiState>(() => ({
    selection: EMPTY_SELECTION,
    tool: "select",
    snapping: true,
    pxPerSecond: 100 / 15,
    trackHeight: 64,
    leftTab: "files",
    rightTab: "properties",
    dialog: null,
    editingTitleFileId: null,
    titleTemplate: null,
    panels: loadPanels(),
    armedKeyframes: [],
    ...initial,
  }));
}

// ---------------------------------------------------------------------------
// Selection helpers (pure)
// ---------------------------------------------------------------------------

export function selectionIsEmpty(s: Selection): boolean {
  return s.clips.length === 0 && s.transitions.length === 0 && s.markers.length === 0;
}

export function selectedItemIds(s: Selection): string[] {
  return [...s.clips, ...s.transitions];
}

export type SelectableKind = "clip" | "transition" | "marker";

/** Click selection: replace, or toggle with a modifier (Shift/Ctrl/⌘). */
export function clickSelect(current: Selection, kind: SelectableKind, id: string, additive: boolean): Selection {
  const key = kind === "clip" ? "clips" : kind === "transition" ? "transitions" : "markers";
  if (!additive) {
    return { ...EMPTY_SELECTION, [key]: [id] };
  }
  const list = current[key];
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return { ...current, [key]: next, effect: kind === "clip" ? null : current.effect };
}

/** Drop ids that no longer exist (after undo, delete, remote change). */
export function pruneSelection(
  s: Selection,
  exists: { clip: (id: string) => boolean; transition: (id: string) => boolean; marker: (id: string) => boolean; effect: (id: string) => boolean },
): Selection {
  const clips = s.clips.filter(exists.clip);
  const transitions = s.transitions.filter(exists.transition);
  const markers = s.markers.filter(exists.marker);
  const effect = s.effect && exists.effect(s.effect) ? s.effect : null;
  if (clips.length === s.clips.length && transitions.length === s.transitions.length && markers.length === s.markers.length && effect === s.effect) {
    return s;
  }
  return { clips, transitions, markers, effect };
}
