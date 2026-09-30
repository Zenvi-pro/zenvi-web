import type { Project } from "@zenvi/engine";
import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { EditorSession } from "./EditorSession";
import type { EditorUiState } from "./uiStore";
import type { PlaybackState } from "./playback";

const SessionContext = createContext<EditorSession | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSession(): EditorSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside an editor session");
  return session;
}

/** The project the editor shows (live draft while previewing, else the document). */
export function useProject(): Project {
  const session = useSession();
  return useSyncExternalStore(session.subscribeDisplay, session.displayProject);
}

export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A value derived from the displayed project. Re-runs the selector when the
 * project or `deps` change, and re-renders only when the result changes by
 * `isEqual` (the document is immutable, so unchanged objects keep identity).
 */
export function useProjectSelector<T>(
  selector: (project: Project) => T,
  deps: readonly unknown[] = [],
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const session = useSession();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cache = useRef<{ project: Project; deps: readonly unknown[]; value: T } | null>(null);
  const getSnapshot = () => {
    const project = session.displayProject();
    const cached = cache.current;
    if (cached && cached.project === project && shallowArrayEqual(cached.deps, deps)) return cached.value;
    const value = selectorRef.current(project);
    if (cached && isEqual(cached.value, value)) {
      cache.current = { project, deps, value: cached.value };
      return cached.value;
    }
    cache.current = { project, deps, value };
    return value;
  };
  return useSyncExternalStore(session.subscribeDisplay, getSnapshot);
}

export function useUi<T>(selector: (state: EditorUiState) => T): T {
  return useStore(useSession().ui, selector);
}

export function usePlayback<T>(selector: (state: PlaybackState) => T): T {
  return useStore(useSession().playback, selector);
}

/** Undo/redo availability and labels, updated on every document change. */
export function useHistory(): { canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string } {
  const session = useSession();
  const snapshot = useCallback(() => {
    const doc = session.doc;
    return `${doc.canUndo ? 1 : 0}\u0000${doc.canRedo ? 1 : 0}\u0000${doc.undoLabels.at(-1) ?? ""}\u0000${doc.redoLabels.at(-1) ?? ""}`;
  }, [session]);
  const key = useSyncExternalStore(session.subscribeDisplay, snapshot);
  const [u, r, undoLabel, redoLabel] = key.split("\u0000");
  return { canUndo: u === "1", canRedo: r === "1", undoLabel: undoLabel || undefined, redoLabel: redoLabel || undefined };
}
