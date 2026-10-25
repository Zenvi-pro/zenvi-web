import { describe, expect, it } from "vitest";
import type { Project } from "../model/types.js";
import { ProjectDocument } from "./document.js";
import { getAt } from "./keypath.js";

function project(): Project {
  return {
    id: "T0",
    fps: { num: 30, den: 1 },
    display_ratio: { num: 16, den: 9 },
    pixel_ratio: { num: 1, den: 1 },
    width: 1280,
    height: 720,
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    settings: {},
    clips: [
      { id: "A", position: 0, layer: 1000000, start: 0, end: 5 } as never,
      { id: "B", position: 5, layer: 1000000, start: 0, end: 5 } as never,
    ],
    effects: [],
    files: [],
    duration: 300,
    scale: 15,
    tick_pixels: 100,
    playhead_position: 0,
    profile: "HD 720p 30 fps",
    export_settings: null,
    export_overrides: {},
    layers: [{ id: "L1", number: 1000000, label: "", y: 0, lock: false }],
    markers: [],
    progress: [],
    history: { undo: [], redo: [] },
    version: {},
  };
}

let seq = 0;
const ids = () => `t${++seq}`;

describe("ProjectDocument", () => {
  it("groups a transaction into one undo step", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("move and add", (tx) => {
      tx.update(["clips", { id: "A" }], { position: 2 });
      tx.insert(["clips"], { id: "C", position: 10, layer: 1000000, start: 0, end: 1 });
    });
    expect(doc.project.clips.map((c) => c.id)).toEqual(["A", "B", "C"]);
    expect(getAt(doc.project, ["clips", { id: "A" }, "position"])).toBe(2);
    expect(doc.undoLabels).toEqual(["move and add"]);

    doc.undo();
    expect(doc.project.clips.map((c) => c.id)).toEqual(["A", "B"]);
    expect(getAt(doc.project, ["clips", { id: "A" }, "position"])).toBe(0);

    doc.redo();
    expect(doc.project.clips.map((c) => c.id)).toEqual(["A", "B", "C"]);
    expect(getAt(doc.project, ["clips", { id: "A" }, "position"])).toBe(2);
  });

  it("rolls back and records nothing when the body throws", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    const before = doc.project;
    expect(() =>
      doc.transaction("bad", (tx) => {
        tx.update(["clips", { id: "A" }], { position: 9 });
        throw new Error("validation failed");
      }),
    ).toThrow("validation failed");
    expect(doc.project).toBe(before);
    expect(doc.canUndo).toBe(false);
  });

  it("records nothing for an empty transaction", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("noop", () => undefined);
    expect(doc.canUndo).toBe(false);
  });

  it("keeps identity of untouched objects (structural sharing)", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    const b = doc.project.clips[1];
    const layers = doc.project.layers;
    doc.transaction("move A", (tx) => tx.update(["clips", { id: "A" }], { position: 3 }));
    expect(doc.project.clips[1]).toBe(b);
    expect(doc.project.layers).toBe(layers);
  });

  it("restores a deleted item at its original index", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("delete A", (tx) => tx.delete(["clips", { id: "A" }]));
    expect(doc.project.clips.map((c) => c.id)).toEqual(["B"]);
    doc.undo();
    expect(doc.project.clips.map((c) => c.id)).toEqual(["A", "B"]);
  });

  it("undo of an update removes fields the update added", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("title", (tx) => tx.update(["clips", { id: "A" }], { title: "Intro" }));
    doc.undo();
    expect(doc.project.clips[0]).not.toHaveProperty("title");
  });

  it("redo of a replace replaces again (fields it dropped stay dropped)", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("ui", (tx) => tx.update(["clips", { id: "A" }], { ui: { audio_data: [1], keep: 1 } }));
    doc.transaction("drop", (tx) => tx.replace(["clips", { id: "A" }, "ui"], { keep: 1 }));
    doc.undo();
    expect(getAt(doc.project, ["clips", { id: "A" }, "ui"])).toEqual({ audio_data: [1], keep: 1 });
    doc.redo();
    expect(getAt(doc.project, ["clips", { id: "A" }, "ui"])).toEqual({ keep: 1 });
  });

  it("clearHistory forgets every step and keeps the project", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("one", (tx) => tx.update(["clips", { id: "A" }], { position: 1 }));
    doc.transaction("two", (tx) => tx.update(["clips", { id: "B" }], { position: 9 }));
    doc.undo();
    const sources: string[] = [];
    doc.subscribe((event) => sources.push(event.source));
    const revision = doc.revision;
    expect(doc.clearHistory()).toEqual({ undo: 1, redo: 1 });
    expect([doc.canUndo, doc.canRedo, doc.revision > revision]).toEqual([false, false, true]);
    expect(getAt(doc.project, ["clips", { id: "A" }, "position"])).toBe(1);
    expect(doc.toJSON().history).toMatchObject({ undo: [], redo: [] });
    expect(new ProjectDocument(doc.project).canUndo).toBe(false);
    expect(sources).toEqual(["untracked"]);
    expect(doc.clearHistory()).toEqual({ undo: 0, redo: 0 });
    expect(sources).toHaveLength(1);
  });

  it("nested transactions join the outer one", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("outer", (tx) => {
      tx.update(["clips", { id: "A" }], { position: 1 });
      doc.transaction("inner", (inner) => inner.update(["clips", { id: "B" }], { position: 7 }));
    });
    expect(doc.undoLabels).toEqual(["outer"]);
    doc.undo();
    expect(doc.project.clips.map((c) => c.position)).toEqual([0, 5]);
  });

  it("a new edit clears redo", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("one", (tx) => tx.update(["clips", { id: "A" }], { position: 1 }));
    doc.undo();
    expect(doc.canRedo).toBe(true);
    doc.transaction("two", (tx) => tx.update(["clips", { id: "B" }], { position: 1 }));
    expect(doc.canRedo).toBe(false);
  });

  it("serializes history in desktop format and reloads it", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.transaction("move", (tx) => tx.update(["clips", { id: "A" }], { position: 4 }));
    doc.transaction("add", (tx) => tx.insert(["clips"], { id: "C", position: 10, layer: 1000000, start: 0, end: 1 }));
    const saved = doc.toJSON();
    expect(saved.history.undo).toHaveLength(2);
    const first = saved.history.undo[0] as Record<string, unknown>;
    expect(Object.keys(first).sort()).toEqual(["key", "old_values", "transaction", "type", "value"]);

    const reopened = new ProjectDocument(JSON.parse(JSON.stringify(saved)) as Project, { newTransactionId: ids });
    expect(reopened.canUndo).toBe(true);
    reopened.undo();
    expect(reopened.project.clips.map((c) => c.id)).toEqual(["A", "B"]);
    reopened.undo();
    expect(getAt(reopened.project, ["clips", { id: "A" }, "position"])).toBe(0);
  });

  it("caps serialized history at historyLimit actions", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids, historyLimit: 3 });
    for (let i = 1; i <= 5; i += 1) {
      doc.transaction(`move ${i}`, (tx) => tx.update(["clips", { id: "A" }], { position: i }));
    }
    expect(doc.toJSON().history.undo).toHaveLength(3);
    expect(doc.undoLabels).toHaveLength(5);
  });

  it("setUntracked changes state without an undo step", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    doc.setUntracked(["playhead_position"], 12.5);
    expect(doc.project.playhead_position).toBe(12.5);
    expect(doc.canUndo).toBe(false);
  });

  it("notifies subscribers with the source of the change", () => {
    const doc = new ProjectDocument(project(), { newTransactionId: ids });
    const seen: string[] = [];
    doc.subscribe((e) => seen.push(e.source));
    doc.transaction("move", (tx) => tx.update(["clips", { id: "A" }], { position: 1 }));
    doc.undo();
    doc.redo();
    doc.setUntracked(["scale"], 20);
    expect(seen).toEqual(["apply", "undo", "redo", "untracked"]);
  });

  it("handles saved desktop inserts whose key carries the id", () => {
    const saved = project();
    saved.clips.push({ id: "C", position: 10, layer: 1000000, start: 0, end: 1 } as never);
    saved.history.undo = [
      { type: "insert", key: ["clips", { id: "C" }], value: saved.clips[2], old_values: null, transaction: "x1" },
    ];
    const doc = new ProjectDocument(saved, { newTransactionId: ids });
    doc.undo();
    expect(doc.project.clips.map((c) => c.id)).toEqual(["A", "B"]);
    doc.redo();
    expect(doc.project.clips.map((c) => c.id)).toEqual(["A", "B", "C"]);
  });
});
