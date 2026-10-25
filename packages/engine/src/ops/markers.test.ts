import { describe, expect, it } from "vitest";
import { addMarker, markerColor, markerName, markersInTimeOrder, removeMarkers, updateMarker } from "./markers.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

describe("markers (track_ops.py update_marker / remove_markers)", () => {
  it("reads a colour from the vector, else the icon, else blue; a name from `name`, else `label`", () => {
    expect(markerColor({ vector: "Red", icon: "blue.png" })).toBe("red");
    expect(markerColor({ icon: "green.png" })).toBe("green");
    expect(markerColor({})).toBe("blue");
    expect(markerName({ name: "Drop", label: "x" } as never)).toBe("Drop");
    expect(markerName({ label: "Intro" })).toBe("Intro");
  });

  it("lists markers by time, then id", () => {
    const rows = markersInTimeOrder([
      { id: "B", position: 2 },
      { id: "A", position: 2, label: "two" },
      { id: "C", position: 1, vector: "red" },
    ]);
    expect(rows.map((r) => [r.id, r.name, r.color])).toEqual([
      ["C", "", "red"],
      ["A", "two", "blue"],
      ["B", "", "blue"],
    ]);
  });

  it("renames where the marker keeps its name, recolours and moves, as one undo step", () => {
    const doc = makeDoc();
    const desktop = doc.transaction("add", (tx) => {
      const m = addMarker(tx, 4, undefined, { id: "MDESKTOP01" });
      tx.update(["markers", { id: m.id }], { name: "Verse" });
      return m.id;
    });
    const web = doc.transaction("add web", (tx) => addMarker(tx, 8, "Intro", { id: "MWEB000001" }).id);
    const before = doc.project;
    const changed = doc.transaction("edit", (tx) => updateMarker(tx, desktop, { name: "Chorus", color: "yellow", position: 5 }));
    expect(changed).toEqual(["name", "color", "position"]);
    expect(doc.project.markers[0]).toMatchObject({ name: "Chorus", vector: "yellow", icon: "yellow.png", position: 5 });
    expect("label" in doc.project.markers[0]!).toBe(false);
    expectUndoRedo(doc, before);
    doc.transaction("rename web", (tx) => updateMarker(tx, web, { name: "Opening" }));
    expect(doc.project.markers[1]).toMatchObject({ label: "Opening" });
    expect("name" in doc.project.markers[1]!).toBe(false);
  });

  it("records nothing when nothing changes and refuses a bad colour", () => {
    const doc = makeDoc();
    doc.transaction("add", (tx) => addMarker(tx, 4, "A", { id: "M1" }));
    const steps = doc.undoLabels.length;
    expect(doc.transaction("same", (tx) => updateMarker(tx, "M1", { name: "A", color: "blue", position: 4 }))).toEqual([]);
    expect(doc.undoLabels.length).toBe(steps);
    expectRefused(doc, "invalid_argument", (tx) => updateMarker(tx, "M1", { color: "teal" as never }));
    expectRefused(doc, "not_found", (tx) => updateMarker(tx, "NOPE", { name: "x" }));
  });

  it("removes several markers in one step, skipping unknown ids", () => {
    const doc = makeDoc();
    doc.transaction("add", (tx) => {
      addMarker(tx, 1, "A", { id: "M1" });
      addMarker(tx, 2, "B", { id: "M2" });
    });
    const before = doc.project;
    expect(doc.transaction("rm", (tx) => removeMarkers(tx, ["M1", "M2", "M3"]))).toEqual(["M1", "M2"]);
    expect(doc.project.markers).toEqual([]);
    expectUndoRedo(doc, before);
  });
});
