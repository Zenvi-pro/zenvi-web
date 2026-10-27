import { describe, expect, it } from "vitest";
import type { Project } from "../model/types.js";
import { toDesktopActions, toDesktopUntracked, type DesktopAction } from "./desktop.js";
import { ProjectDocument, type ChangeEvent, type Transaction } from "./document.js";
import type { KeyPath } from "./keypath.js";

function project(): Project {
  return {
    id: "T0",
    fps: { num: 30, den: 1 },
    width: 1280,
    height: 720,
    settings: { snap: true },
    clips: [
      { id: "A", position: 0, layer: 1000000, start: 0, end: 5, alpha: { Points: [] }, effects: [{ id: "E1", class_name: "Blur", objects: { o1: { x: 1, y: 2 } } }] },
      { id: "B", position: 5, layer: 1000000, start: 0, end: 5, title: "b", reader: { path: "/b.mp4", fps: 30 } },
    ],
    effects: [],
    files: [],
    layers: [{ id: "L1", number: 1000000, label: "", y: 0, lock: false }],
    markers: [],
    export_settings: null,
    history: { undo: [], redo: [] },
  } as unknown as Project;
}

/**
 * zenvi-core ProjectDataStore._set (src/classes/project_data.py:220), the
 * oracle the translation must satisfy: lower-cased lookups, parent tracking,
 * append on insert, merge on update (objects per id), root write for non-objects.
 */
function desktopSet(data: Record<string, unknown>, action: DesktopAction): void {
  let obj: unknown = data;
  let parent: unknown = null;
  let myKey = "" as string | number;
  action.key.forEach((part, index) => {
    if (typeof part === "object") {
      const list = obj as Record<string, unknown>[];
      const at = list.findIndex((item) => Object.entries(part).every(([k, v]) => k.toLowerCase() in item && item[k.toLowerCase()] === v));
      if (at < 0) throw new Error(`desktop: no match for ${JSON.stringify(part)}`);
      obj = list[at];
      myKey = at;
    } else {
      const k = part.toLowerCase();
      if (!(k in (obj as Record<string, unknown>))) throw new Error(`desktop: key ${k} not found`);
      obj = (obj as Record<string, unknown>)[k];
      myKey = k;
    }
    if (index < action.key.length - 1 || index === 0) parent = obj;
  });
  if (action.type === "delete") {
    if (Array.isArray(parent)) parent.splice(myKey as number, 1);
    else delete (parent as Record<string, unknown>)[myKey as string];
  } else if (action.type === "insert" && Array.isArray(parent)) {
    parent.push(structuredClone(action.value));
  } else if (typeof action.value === "object" && action.value !== null && !Array.isArray(action.value)) {
    const values = structuredClone(action.value) as Record<string, unknown>;
    const target = obj as Record<string, unknown>;
    if (target.objects && typeof target.objects === "object" && values.objects && typeof values.objects === "object") {
      const updates = values.objects as Record<string, Record<string, unknown>>;
      delete values.objects;
      const tracked = target.objects as Record<string, Record<string, unknown>>;
      for (const [id, v] of Object.entries(updates)) tracked[id] = tracked[id] ? { ...tracked[id], ...v } : v;
    }
    Object.assign(target, values);
  } else {
    data[myKey as string] = structuredClone(action.value);
  }
}

/** What `_set` returns for `key` (the desktop keeps it as the action's old value): a copy of the value there. */
function desktopGet(data: Record<string, unknown>, key: KeyPath): unknown {
  let obj: unknown = data;
  for (const part of key) {
    if (typeof part === "object") obj = (obj as Record<string, unknown>[]).find((item) => Object.entries(part).every(([k, v]) => item[k.toLowerCase()] === v));
    else obj = (obj as Record<string, unknown>)[part.toLowerCase()];
  }
  return structuredClone(obj);
}

/** Apply `actions` on the desktop oracle, then undo them as UpdateManager.undo does (reversed, old values merged back). */
function desktopUndo(data: Record<string, unknown>, actions: DesktopAction[]): void {
  const done = actions.map((action) => {
    const old = action.type === "insert" ? undefined : desktopGet(data, action.key);
    desktopSet(data, action);
    return { action, old };
  });
  for (const { action, old } of done.reverse()) {
    if (action.type === "insert") {
      const id = (action.value as { id: string }).id;
      desktopSet(data, { type: "delete", key: [...action.key, { id }] });
    } else if (action.type === "delete") {
      desktopSet(data, { type: "insert", key: action.key.slice(0, -1), value: old });
    } else {
      desktopSet(data, { type: "update", key: action.key, value: old });
    }
  }
}

function sortedById(p: Record<string, unknown>): unknown {
  const out = structuredClone(p);
  for (const list of ["clips", "files", "effects", "layers", "markers"]) {
    const items = out[list] as { id: string }[] | undefined;
    items?.sort((a, b) => a.id.localeCompare(b.id));
  }
  delete out.history;
  return out;
}

/** Run `body` in the engine, replay its desktop form on the desktop oracle, compare. */
function roundTrip(body: (tx: Transaction) => void): { desktop: DesktopAction[] } {
  const doc = new ProjectDocument(project());
  let event: ChangeEvent | undefined;
  doc.subscribe((e) => {
    event = e;
  });
  doc.transaction("t", body);
  const desktop = toDesktopActions(event!.previous, event!.actions, event!.replaced);
  const data = structuredClone(project()) as unknown as Record<string, unknown>;
  for (const action of desktop) desktopSet(data, action);
  expect(sortedById(data)).toEqual(sortedById(doc.project as unknown as Record<string, unknown>));
  return { desktop };
}

describe("toDesktopActions", () => {
  it("keeps inserts, deletes and object merges as they are", () => {
    const { desktop } = roundTrip((tx) => {
      tx.insert(["clips"], { id: "C", position: 10, layer: 1000000, start: 0, end: 1 });
      tx.update(["clips", { id: "A" }], { position: 2, end: 4 });
      tx.delete(["clips", { id: "B" }]);
      tx.delete(["clips", { id: "A" }, "effects", { id: "E1" }]);
    });
    expect(desktop.map((a) => a.type)).toEqual(["insert", "update", "delete", "delete"]);
    expect(desktop[1]).toEqual({ type: "update", key: ["clips", { id: "A" }], value: { position: 2, end: 4 } });
  });

  it("adds a field to a list item by delete + insert, so the desktop's undo takes it away again", () => {
    const body = (tx: Transaction) => {
      tx.update(["clips", { id: "A" }], { position: 2, zenvi_tag: [{ id: "T1" }] });
      tx.update(["clips", { id: "B" }, "reader", "fps"], 24);
      tx.update(["clips", { id: "B" }, "reader"], { codec: "h264" });
    };
    const { desktop } = roundTrip(body);
    expect(desktop.map((a) => a.type)).toEqual(["delete", "insert", "update", "update"]);
    expect(desktop[2]).toEqual({ type: "update", key: ["clips", { id: "B" }, "reader"], value: { fps: 24 } });
    // The field new to the reader goes with the whole reader, which the desktop's undo puts back whole.
    expect(desktop[3]).toEqual({ type: "update", key: ["clips", { id: "B" }], value: { reader: { path: "/b.mp4", fps: 24, codec: "h264" } } });
    const data = structuredClone(project()) as unknown as Record<string, unknown>;
    desktopUndo(data, desktop);
    expect(sortedById(data)).toEqual(sortedById(project() as unknown as Record<string, unknown>));
  });

  it("sends a nested scalar or list as an update of its parent", () => {
    const { desktop } = roundTrip((tx) => {
      tx.update(["clips", { id: "A" }, "position"], 7);
      tx.update(["clips", { id: "A" }, "effects"], []);
      tx.update(["settings", "snap"], false);
    });
    expect(desktop).toEqual([
      { type: "update", key: ["clips", { id: "A" }], value: { position: 7 } },
      { type: "update", key: ["clips", { id: "A" }], value: { effects: [] } },
      { type: "update", key: ["settings"], value: { snap: false } },
    ]);
  });

  it("writes root scalars directly", () => {
    const { desktop } = roundTrip((tx) => {
      tx.update(["width"], 1920);
      tx.replace(["export_settings"], null);
    });
    expect(desktop).toEqual([
      { type: "update", key: ["width"], value: 1920 },
      { type: "update", key: ["export_settings"], value: null },
    ]);
  });

  it("replaces an object through its parent, and a list item by delete + insert", () => {
    const { desktop } = roundTrip((tx) => {
      tx.replace(["clips", { id: "B" }, "reader"], { path: "/c.mp4", duration: 3 });
      tx.replace(["clips", { id: "B" }], { id: "B", position: 6, layer: 1000000, start: 0, end: 2 });
    });
    expect(desktop[0]).toEqual({ type: "update", key: ["clips", { id: "B" }], value: { reader: { path: "/c.mp4", duration: 3 } } });
    expect(desktop.slice(1).map((a) => a.type)).toEqual(["delete", "insert"]);
  });

  it("keeps a replace that overwrites every field as a merge", () => {
    const { desktop } = roundTrip((tx) => tx.replace(["clips", { id: "B" }, "reader"], { path: "/d.mp4", fps: 24 }));
    expect(desktop).toEqual([{ type: "update", key: ["clips", { id: "B" }, "reader"], value: { path: "/d.mp4", fps: 24 } }]);
  });

  it("lifts a merge the desktop would merge per tracked object to the list that holds it", () => {
    const { desktop } = roundTrip((tx) => tx.update(["clips", { id: "A" }, "effects", { id: "E1" }], { objects: { o2: { x: 3 } } }));
    expect(desktop).toEqual([{ type: "update", key: ["clips", { id: "A" }], value: { effects: [{ id: "E1", class_name: "Blur", objects: { o2: { x: 3 } } }] } }]);
  });

  it("lifts a change under an upper-case key to the field above it", () => {
    const { desktop } = roundTrip((tx) => tx.update(["clips", { id: "A" }, "alpha", "Points"], [{ co: { X: 1, Y: 0.5 } }]));
    expect(desktop).toEqual([{ type: "update", key: ["clips", { id: "A" }], value: { alpha: { Points: [{ co: { X: 1, Y: 0.5 } }] } } }]);
  });

  it("merges a lower-case spelling of an upper-case field into the field as stored", () => {
    // Engine lookups ignore case, so `points` writes `Points`; the desktop would look for `points` and find nothing.
    const { desktop } = roundTrip((tx) => tx.update(["clips", { id: "A" }, "alpha", "points"], [{ co: { X: 2, Y: 1 } }]));
    expect(desktop).toEqual([{ type: "update", key: ["clips", { id: "A" }], value: { alpha: { Points: [{ co: { X: 2, Y: 1 } }] } } }]);
  });

  it("refuses what the desktop cannot address", () => {
    const refusal = (key: KeyPath, value: unknown) => {
      const doc = new ProjectDocument(project());
      let event: ChangeEvent | undefined;
      doc.subscribe((e) => {
        event = e;
      });
      doc.transaction("t", (tx) => tx.update(key, value));
      return () => toDesktopActions(event!.previous, event!.actions, event!.replaced);
    };
    expect(refusal(["history", "undo"], [])).toThrow(/undo history/);
    expect(refusal(["fps"], { num: 24, den: 1 })).toThrow(/frame rate/);
    // Lifted, a nested change would reach the desktop as an update of root `fps` too.
    expect(refusal(["fps", "num"], 24)).toThrow(/frame rate/);
  });
});

describe("toDesktopUntracked", () => {
  /** Run `body` on a document, replay its untracked change on the desktop oracle, compare. */
  function untracked(body: (doc: ProjectDocument) => void, base: Project = project()): DesktopAction[] {
    const doc = new ProjectDocument(base);
    const events: ChangeEvent[] = [];
    doc.subscribe((e) => events.push(e));
    body(doc);
    const [event] = events;
    expect(event?.source).toBe("untracked");
    const desktop = toDesktopUntracked(event!.previous, event!.project, event!.untracked!);
    const data = structuredClone(base) as unknown as Record<string, unknown>;
    for (const action of desktop) desktopSet(data, { ...action, type: "update" });
    expect(sortedById(data)).toEqual(sortedById(doc.project as unknown as Record<string, unknown>));
    expect(doc.canUndo).toBe(false);
    return desktop;
  }

  it("sends a root scalar as update_untracked", () => {
    expect(untracked((doc) => doc.setUntracked(["playhead_position"], 2.5), { ...project(), playhead_position: 0 } as Project)).toEqual([
      { type: "update_untracked", key: ["playhead_position"], value: 2.5 },
    ]);
  });

  it("sends a replaced list item that keeps every field as a merge", () => {
    const file = { id: "F1", path: "/a.mp4", media_type: "video", ai_metadata: { tags: ["x"] } };
    const transcript = { language: "en", words: [] };
    const desktop = untracked((doc) => doc.setUntracked(["files", { id: "F1" }], { ...file, ai_metadata: { ...file.ai_metadata, asr: transcript } }), {
      ...project(),
      files: [file],
    } as unknown as Project);
    expect(desktop).toEqual([{ type: "update_untracked", key: ["files", { id: "F1" }], value: { ...file, ai_metadata: { tags: ["x"], asr: transcript } } }]);
  });

  it("refuses what the desktop has no untracked form of", () => {
    const base = { ...project(), export_overrides: { a: 1, b: 2 } } as unknown as Project;
    const doc = new ProjectDocument(base);
    const events: ChangeEvent[] = [];
    doc.subscribe((e) => events.push(e));
    // Removing a key needs a delete; an untracked merge cannot remove it.
    doc.setUntracked(["export_overrides"], { a: 1 });
    doc.setUntracked(["fps"], { num: 24, den: 1 });
    expect(() => toDesktopUntracked(events[0]!.previous, events[0]!.project, events[0]!.untracked!)).toThrow(/export_overrides/);
    expect(() => toDesktopUntracked(events[1]!.previous, events[1]!.project, events[1]!.untracked!)).toThrow(/frame rate/);
  });
});
