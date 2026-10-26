/**
 * ProjectDocument: the one place a project changes.
 *
 * A port of zenvi-core's UpdateManager + ProjectDataStore (src/classes/updates.py,
 * src/classes/project_data.py) with two deliberate differences:
 *
 * 1. Snapshots are immutable. Every change produces a new root object and copies
 *    only the containers along the changed key path, so unchanged clips keep
 *    their identity. React (and anything else) can compare by reference.
 * 2. Undo restores exactly. The desktop reverses an update by shallow-merging the
 *    old object back and re-inserts deleted items at the end of their list. Here
 *    undo puts back the exact previous value at its exact previous index. The
 *    *serialized* history still uses the desktop's action format, so a project
 *    saved here opens on the desktop with its undo stack intact.
 *
 * Transactions group actions into one undo step (desktop `nested_transaction`).
 * A transaction that throws is rolled back and leaves history untouched; a
 * transaction that changes nothing records nothing.
 */

import type { Project } from "../model/types.js";
import { type KeyPath, resolveKey, formatKey } from "./keypath.js";

export type ActionType = "insert" | "update" | "delete" | "load";

/** Serialized form, identical to zenvi-core `UpdateAction.json()`. */
export interface UpdateAction {
  type: ActionType;
  key: KeyPath;
  value: unknown;
  old_values: unknown;
  transaction: string;
}

/** In-memory record of an applied action, with what is needed to reverse it exactly. */
interface AppliedAction {
  action: UpdateAction;
  /** For delete: the index the item was removed from. For insert: the index it landed at. */
  index?: number;
  /** For update: the full previous value at the key (restored verbatim on undo). */
  previous?: unknown;
  /** For update: recorded with `replace` (no merge), so redo replaces again. */
  replace?: boolean;
}

interface HistoryEntry {
  transaction: string;
  label: string;
  actions: AppliedAction[];
}

export type ChangeSource = "apply" | "undo" | "redo" | "load" | "untracked";

export interface ChangeEvent {
  project: Project;
  previous: Project;
  source: ChangeSource;
  /** Actions in the order they were applied (inverse actions for undo). */
  actions: UpdateAction[];
  /**
   * Per action, in the same order: an update recorded with
   * `Transaction.replace` (the value replaced outright, not merged). Not
   * part of the desktop action format; set on "apply" and "redo".
   */
  replaced?: boolean[];
  /** For "untracked" from `setUntracked`: the key written (its value is in `project`). */
  untracked?: KeyPath;
  label?: string;
}

export type ChangeListener = (event: ChangeEvent) => void;

/** Recorder handed to transaction bodies. */
export interface Transaction {
  readonly id: string;
  /** Current snapshot, including changes made earlier in this transaction. */
  readonly project: Project;
  /** Append `value` to the list at `key` (e.g. `["clips"]`). */
  insert(key: KeyPath, value: unknown): void;
  /**
   * Update the value at `key`. When both the current value and `value` are
   * plain objects, fields are shallow-merged (desktop semantics); otherwise the
   * value is replaced.
   */
  update(key: KeyPath, value: unknown): void;
  /** Replace the value at `key` outright (no merge). */
  replace(key: KeyPath, value: unknown): void;
  /** Remove the item at `key` (e.g. `["clips", { id }]`). */
  delete(key: KeyPath): void;
}

export class KeyNotFoundError extends Error {
  constructor(readonly key: KeyPath) {
    super(`Key not found in project: ${formatKey(key)}`);
    this.name = "KeyNotFoundError";
  }
}

export interface ProjectDocumentOptions {
  /** Number of actions kept when serializing history (desktop `history-limit`). */
  historyLimit?: number;
  /** Id generator for transactions. */
  newTransactionId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (structuredClone(value) as T);
}

let fallbackCounter = 0;
function defaultTransactionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  fallbackCounter += 1;
  return `tx-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

/**
 * Apply `mutate` to the container at the end of `path`, copying every container
 * along the path. `path` addresses the *container* (its last part may be a
 * match or a string). Returns the new root.
 */
function writeThrough(
  root: Record<string, unknown>,
  path: KeyPath,
  mutate: (container: Record<string, unknown> | unknown[], slot: string | number) => void,
): Record<string, unknown> {
  const resolved = resolveKey(root, path);
  if (!resolved) throw new KeyNotFoundError(path);

  // Walk again, copying containers from the root down to the target's parent.
  const newRoot: Record<string, unknown> = { ...root };
  let src: unknown = root;
  let dst: Record<string, unknown> | unknown[] = newRoot;
  for (let i = 0; i < path.length; i += 1) {
    const partial = resolveKey(src as Record<string, unknown>, [path[i]!]);
    if (!partial) throw new KeyNotFoundError(path);
    const { slot, value } = partial;
    if (i === path.length - 1) {
      mutate(dst, slot);
      break;
    }
    const copy: Record<string, unknown> | unknown[] = Array.isArray(value)
      ? [...value]
      : { ...(value as Record<string, unknown>) };
    (dst as Record<string | number, unknown>)[slot] = copy;
    dst = copy;
    src = value;
  }
  return newRoot;
}

export class ProjectDocument {
  private current: Project;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<ChangeListener>();
  private open: { id: string; label: string; actions: AppliedAction[] } | null = null;
  private readonly historyLimit: number;
  private readonly newTransactionId: () => string;
  /** Incremented on every change (tracked or not). */
  revision = 0;

  constructor(project: Project, options: ProjectDocumentOptions = {}) {
    this.historyLimit = options.historyLimit ?? 50;
    this.newTransactionId = options.newTransactionId ?? defaultTransactionId;
    this.current = project;
    this.loadHistory(project.history);
  }

  get project(): Project {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Labels of undoable steps, most recent last. */
  get undoLabels(): string[] {
    return this.undoStack.map((e) => e.label);
  }

  get redoLabels(): string[] {
    return this.redoStack.map((e) => e.label);
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Run `body` as one undo step. Returns whatever `body` returns.
   * Throws (after rolling back) if `body` throws. Nested calls join the outer
   * transaction, like the desktop's `nested_transaction`.
   */
  transaction<T>(label: string, body: (tx: Transaction) => T): T {
    if (this.open) {
      return body(this.recorder(this.open));
    }
    const before = this.current;
    const beforeRevision = this.revision;
    const open = { id: this.newTransactionId(), label, actions: [] as AppliedAction[] };
    this.open = open;
    let result: T;
    try {
      result = body(this.recorder(open));
    } catch (error) {
      this.current = before;
      this.revision = beforeRevision;
      this.open = null;
      throw error;
    }
    this.open = null;
    if (open.actions.length === 0) return result;
    this.undoStack.push({ transaction: open.id, label, actions: open.actions });
    this.redoStack = [];
    this.emit({
      project: this.current,
      previous: before,
      source: "apply",
      actions: open.actions.map((a) => a.action),
      replaced: open.actions.map((a) => a.replace === true),
      label,
    });
    return result;
  }

  /** Change UI state saved with the project (playhead, zoom) without an undo step. */
  setUntracked(key: KeyPath, value: unknown): void {
    const before = this.current;
    this.current = writeThrough(this.current, key, (container, slot) => {
      (container as Record<string | number, unknown>)[slot] = clone(value);
    }) as Project;
    this.revision += 1;
    this.emit({ project: this.current, previous: before, source: "untracked", actions: [], untracked: key });
  }

  /** Replace the whole project (open/new). Clears history unless `keepHistory`. */
  load(project: Project, keepHistory = false): void {
    const before = this.current;
    this.current = project;
    if (!keepHistory) {
      this.undoStack = [];
      this.redoStack = [];
      this.loadHistory(project.history);
    }
    this.revision += 1;
    this.emit({
      project: this.current,
      previous: before,
      source: "load",
      actions: [{ type: "load", key: [], value: null, old_values: null, transaction: "load" }],
    });
  }

  /**
   * Forget every undo and redo step and keep the project as it is (Edit >
   * Clear > History, the desktop's `UpdateManager.reset`). Not an undo step;
   * listeners get an untracked change, so hosts save the project without the
   * old history. Returns how many steps each stack held.
   */
  clearHistory(): { undo: number; redo: number } {
    const counts = { undo: this.undoStack.length, redo: this.redoStack.length };
    if (counts.undo === 0 && counts.redo === 0) return counts;
    this.undoStack = [];
    this.redoStack = [];
    const before = this.current;
    // The loaded history slice would come back if this snapshot were opened again.
    this.current = { ...this.current, history: { ...(isRecord(this.current.history) ? this.current.history : {}), undo: [], redo: [] } };
    this.revision += 1;
    this.emit({ project: this.current, previous: before, source: "untracked", actions: [] });
    return counts;
  }

  /** Undo `steps` transactions. Returns the labels undone, most recent first. */
  undo(steps = 1): string[] {
    const done: string[] = [];
    for (let i = 0; i < steps && this.undoStack.length > 0; i += 1) {
      const entry = this.undoStack.pop()!;
      const before = this.current;
      const inverses: UpdateAction[] = [];
      for (const applied of [...entry.actions].reverse()) {
        inverses.push(this.reverse(applied));
      }
      this.redoStack.push(entry);
      this.revision += 1;
      done.push(entry.label);
      this.emit({ project: this.current, previous: before, source: "undo", actions: inverses, label: entry.label });
    }
    return done;
  }

  /** Redo `steps` transactions. Returns the labels redone, oldest first. */
  redo(steps = 1): string[] {
    const done: string[] = [];
    for (let i = 0; i < steps && this.redoStack.length > 0; i += 1) {
      const entry = this.redoStack.pop()!;
      const before = this.current;
      const reapplied: AppliedAction[] = [];
      for (const applied of entry.actions) {
        reapplied.push(this.perform(applied.action.type, applied.action.key, applied.action.value, entry.transaction, applied.index, applied.replace));
      }
      entry.actions = reapplied;
      this.undoStack.push(entry);
      this.revision += 1;
      done.push(entry.label);
      this.emit({
        project: this.current,
        previous: before,
        source: "redo",
        actions: reapplied.map((a) => a.action),
        replaced: reapplied.map((a) => a.replace === true),
        label: entry.label,
      });
    }
    return done;
  }

  /**
   * The project JSON to save: the current snapshot with the latest steps of
   * each stack, up to `historyLimit` actions, serialized in desktop format.
   * Steps are kept whole (the newest even when it alone is larger): a step
   * cut short would undo half an edit once reopened.
   */
  toJSON(): Project {
    const limit = this.historyLimit;
    const flatten = (stack: HistoryEntry[]): UpdateAction[] => {
      if (limit <= 0) return [];
      let first = stack.length;
      let count = 0;
      while (first > 0 && (first === stack.length || count + stack[first - 1]!.actions.length <= limit)) {
        first -= 1;
        count += stack[first]!.actions.length;
      }
      return stack.slice(first).flatMap((entry) => entry.actions.map((a) => stripHistory(a.action)));
    };
    const undo = flatten(this.undoStack);
    const redo = flatten(this.redoStack);
    return { ...this.current, history: { ...this.current.history, undo, redo } };
  }

  // -------------------------------------------------------------------------

  private recorder(open: { id: string; actions: AppliedAction[] }): Transaction {
    const current = (): Project => this.current;
    return {
      id: open.id,
      get project() {
        return current();
      },
      insert: (key, value) => {
        open.actions.push(this.perform("insert", key, value, open.id));
      },
      update: (key, value) => {
        open.actions.push(this.perform("update", key, value, open.id));
      },
      replace: (key, value) => {
        open.actions.push(this.perform("update", key, value, open.id, undefined, true));
      },
      delete: (key) => {
        open.actions.push(this.perform("delete", key, null, open.id));
      },
    };
  }

  /** Apply one action to `current`; return what is needed to reverse it. */
  private perform(
    type: ActionType,
    key: KeyPath,
    value: unknown,
    transaction: string,
    index?: number,
    replace = false,
  ): AppliedAction {
    const root = this.current as unknown as Record<string, unknown>;
    const target = resolveKey(root, key);
    if (!target) throw new KeyNotFoundError(key);

    if (type === "insert") {
      if (!Array.isArray(target.value)) {
        throw new TypeError(`insert target is not a list: ${formatKey(key)}`);
      }
      const item = clone(value);
      let landed = target.value.length;
      this.current = writeThrough(root, key, (container, slot) => {
        const list = [...((container as Record<string | number, unknown>)[slot] as unknown[])];
        landed = index !== undefined && index >= 0 && index <= list.length ? index : list.length;
        list.splice(landed, 0, item);
        (container as Record<string | number, unknown>)[slot] = list;
      }) as Project;
      this.revision += 1;
      return { action: { type, key, value: clone(value), old_values: null, transaction }, index: landed };
    }

    if (type === "delete") {
      const previous = clone(target.value);
      const at = target.slot;
      this.current = writeThrough(root, key.slice(0, -1), (container, slot) => {
        const holder = (container as Record<string | number, unknown>)[slot];
        if (Array.isArray(holder)) {
          const list = [...holder];
          list.splice(at as number, 1);
          (container as Record<string | number, unknown>)[slot] = list;
        } else if (isRecord(holder)) {
          const obj = { ...holder };
          delete obj[at as string];
          (container as Record<string | number, unknown>)[slot] = obj;
        }
      }) as Project;
      this.revision += 1;
      return {
        action: { type, key, value: null, old_values: previous, transaction },
        index: typeof at === "number" ? at : undefined,
        previous,
      };
    }

    if (type === "update") {
      const previous = clone(target.value);
      const merge = !replace && isRecord(target.value) && isRecord(value);
      const next = merge ? { ...(target.value as Record<string, unknown>), ...clone(value as Record<string, unknown>) } : clone(value);
      this.current = writeThrough(root, key, (container, slot) => {
        (container as Record<string | number, unknown>)[slot] = next;
      }) as Project;
      this.revision += 1;
      const applied: AppliedAction = { action: { type, key, value: clone(value), old_values: previous, transaction }, previous };
      if (replace) applied.replace = true;
      return applied;
    }

    throw new TypeError(`unsupported action type in transaction: ${type}`);
  }

  /** Exactly undo one applied action. Returns the inverse, in desktop action form. */
  private reverse(applied: AppliedAction): UpdateAction {
    const { action } = applied;
    const root = this.current as unknown as Record<string, unknown>;
    if (action.type === "insert") {
      const id = isRecord(action.value) ? action.value.id : undefined;
      const key: KeyPath = id !== undefined ? [...action.key, { id: id as string }] : action.key;
      const target = resolveKey(root, key);
      if (target) {
        this.current = writeThrough(root, action.key, (container, slot) => {
          const list = [...((container as Record<string | number, unknown>)[slot] as unknown[])];
          list.splice(target.slot as number, 1);
          (container as Record<string | number, unknown>)[slot] = list;
        }) as Project;
      }
      return { type: "delete", key, value: null, old_values: clone(action.value), transaction: action.transaction };
    }
    if (action.type === "delete") {
      const parentKey = action.key.slice(0, -1);
      this.current = writeThrough(root, parentKey, (container, slot) => {
        const holder = (container as Record<string | number, unknown>)[slot];
        if (Array.isArray(holder)) {
          const list = [...holder];
          const at = applied.index !== undefined && applied.index <= list.length ? applied.index : list.length;
          list.splice(at, 0, clone(applied.previous));
          (container as Record<string | number, unknown>)[slot] = list;
        } else if (isRecord(holder)) {
          const last = action.key[action.key.length - 1];
          if (typeof last === "string") {
            (container as Record<string | number, unknown>)[slot] = { ...holder, [last]: clone(applied.previous) };
          }
        }
      }) as Project;
      return { type: "insert", key: parentKey, value: clone(applied.previous), old_values: null, transaction: action.transaction };
    }
    // update: restore the exact previous value.
    this.current = writeThrough(root, action.key, (container, slot) => {
      (container as Record<string | number, unknown>)[slot] = clone(applied.previous);
    }) as Project;
    return { type: "update", key: action.key, value: clone(applied.previous), old_values: clone(action.value), transaction: action.transaction };
  }

  /** Rebuild undo/redo stacks from a saved project's history (desktop format). */
  private loadHistory(history: Project["history"] | undefined): void {
    this.undoStack = groupSaved(history?.undo);
    this.redoStack = groupSaved(history?.redo);
  }

  private emit(event: ChangeEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

function stripHistory(action: UpdateAction): UpdateAction {
  const strip = (v: unknown) => {
    if (isRecord(v) && "history" in v) {
      const { history: _history, ...rest } = v;
      return rest;
    }
    return v;
  };
  return { ...action, value: strip(action.value), old_values: strip(action.old_values) };
}

/**
 * Group saved actions by transaction id, preserving order (desktop
 * `_tail_transaction` groups by id across the whole stack). Saved desktop
 * history reverses with desktop semantics: update → merge old_values back,
 * delete → re-insert old_values.
 */
function groupSaved(saved: unknown[] | undefined): HistoryEntry[] {
  if (!Array.isArray(saved)) return [];
  const entries: HistoryEntry[] = [];
  const byId = new Map<string, HistoryEntry>();
  for (const raw of saved) {
    if (!isRecord(raw)) continue;
    const type = raw.type as ActionType;
    let key = raw.key as KeyPath;
    if (type === "load" || !Array.isArray(key) || key[0] === "history") continue;
    // The desktop's get_reverse_action appends {id} to an insert's key in place,
    // so saved inserts may address the item instead of its list (updates.py).
    const last = key[key.length - 1];
    if (type === "insert" && typeof last === "object" && last !== null && "id" in last) {
      key = key.slice(0, -1);
    }
    const transaction = typeof raw.transaction === "string" ? raw.transaction : defaultTransactionId();
    const action: UpdateAction = {
      type,
      key,
      value: raw.value ?? raw.values ?? null,
      old_values: raw.old_values ?? null,
      transaction,
    };
    const applied: AppliedAction = { action, previous: action.old_values };
    let entry = byId.get(transaction);
    if (!entry) {
      entry = { transaction, label: describeSaved(action), actions: [] };
      byId.set(transaction, entry);
      entries.push(entry);
    }
    entry.actions.push(applied);
  }
  return entries;
}

function describeSaved(action: UpdateAction): string {
  const collection = typeof action.key[0] === "string" ? action.key[0] : "project";
  return `${action.type} ${collection}`;
}
