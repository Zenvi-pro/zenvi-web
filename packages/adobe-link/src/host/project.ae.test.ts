import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { aeHarness } from "../testing/ae-harness.js";

describe("ae_save_project", () => {
  test("save as a path, then save in place; not an undo step", () => {
    const h = aeHarness();
    h.mock.addComp();
    const target = path.join(h.dir, "promo.aep");
    const receipt = h.callValidated("ae_save_project", { path: target });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 0, data: { path: target, previous_path: null, dirty: false } });
    h.mock.project.dirty = true;
    expect(h.callValidated("ae_save_project")).toMatchObject({ status: "applied", data: { path: target, dirty: false } });
    // Saving runs outside any undo group.
    expect(h.mock.state.undoCalls).toEqual([]);
  });

  test("refuses an untitled save without a path, a wrong extension, a missing folder and someone else's file", () => {
    const h = aeHarness();
    expect(h.callValidated("ae_save_project")).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(h.callValidated("ae_save_project", { path: path.join(h.dir, "promo.txt") })).toMatchObject({ status: "refused" });
    expect(h.callValidated("ae_save_project", { path: path.join(h.dir, "missing", "a.aep") })).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    const other = h.file("other.aep");
    expect(h.callValidated("ae_save_project", { path: other }).error?.message).toContain("already exists");
    expect(h.callValidated("ae_save_project", { path: other, overwrite: true }).status).toBe("applied");
  });
});

describe("ae_undo", () => {
  test("undoes the last Zenvi steps outside any open undo group and says which", () => {
    const h = aeHarness();
    h.callValidated("ae_create_comp", { name: "A" });
    h.callValidated("ae_add_text", { text: "Hello" });
    const receipt = h.callValidated("ae_undo", { steps: 2 });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 0, data: { steps: 2, command_id: 16 } });
    expect((receipt.data.undone as { title: string }[]).map((entry) => entry.title)).toEqual(["Zenvi: Add text", "Zenvi: Create comp"]);
    expect(receipt.summary).toBe("Undid 2 steps: Zenvi: Add text, Zenvi: Create comp");
    expect(h.mock.state.commands).toEqual([16, 16]);
    expect(h.mock.state.commandDepths).toEqual([0, 0]);
    expect(h.mock.state.undoDepth).toBe(0);
  });

  test("the journal survives the panel evaluating the host script again, and knows a render's two steps", () => {
    const h = aeHarness();
    h.mock.project.save(new h.mock.es.File(path.join(h.dir, "promo.aep")));
    h.callValidated("ae_create_comp", { name: "A" });
    h.callValidated("ae_render_for_zenvi");
    h.host.evaluate(h.host.bundle.text);
    expect(h.host.hostInfo().loads).toBe(2);
    const receipt = h.callValidated("ae_undo", { steps: 3 });
    expect(receipt.warnings.filter((w) => w.includes("recorded"))).toEqual([]);
    expect((receipt.data.undone as { title: string; summary: string }[]).map((entry) => [entry.title, entry.summary])).toEqual([
      ["Zenvi: Render for Zenvi", 'Removed the finished render queue item for "A"'],
      ["Zenvi: Render for Zenvi", 'Queued "A" for Zenvi'],
      ["Zenvi: Create comp", expect.stringContaining('"A"')],
    ]);
    expect(h.mock.state.commandDepths).toEqual([0, 0, 0]);
  });

  test("falls back to command 16 when the Undo menu item is renamed, and warns when it knows of no Zenvi step", () => {
    const h = aeHarness();
    h.mock.app.findMenuCommandId = () => 0;
    const receipt = h.callValidated("ae_undo");
    expect(receipt.data).toMatchObject({ command_id: 16, undone: [] });
    expect(receipt.warnings[0]).toContain("No Zenvi steps recorded in this session");
    expect(h.call("ae_undo", { steps: 0 })).toMatchObject({ status: "refused" });
  });
});

describe("ae_run_jsx_file", () => {
  test("runs a Zenvi export inside one undo step and returns its summary string", () => {
    const h = aeHarness();
    const file = h.file(
      "export.jsx",
      [
        "// Zenvi -> After Effects export v1",
        "(function () {",
        '  app.beginUndoGroup("Zenvi export");',
        '  var comp = app.project.items.addComp("Trip", 1920, 1080, 1, 5, 30);',
        "  app.endUndoGroup();",
        '  return "Built comp " + comp.name + " with 0 layers";',
        "}());",
      ].join("\n"),
    );
    const receipt = h.callValidated("ae_run_jsx_file", { path: file });
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1, data: { path: file, result: "Built comp Trip with 0 layers" } });
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Run JSX file"]);
    expect(h.mock.project.allItems.map((item) => item.name)).toEqual(["Trip"]);
  });

  test("refuses missing files and other extensions; a script error names the file", () => {
    const h = aeHarness();
    expect(h.callValidated("ae_run_jsx_file", { path: path.join(h.dir, "nope.jsx") })).toMatchObject({ status: "refused", error: { code: "NOT_FOUND" } });
    expect(h.callValidated("ae_run_jsx_file", { path: h.file("x.py") })).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    const broken = h.file("broken.jsx");
    writeFileSync(broken, "app.project.nothing.here;");
    const failed = h.callValidated("ae_run_jsx_file", { path: broken });
    expect(failed).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    expect(failed.summary).toContain("broken.jsx failed:");
  });
});

describe("ae_run_script", () => {
  test("returns the last expression as JSON; host objects that cannot be serialized come back as text", () => {
    const h = aeHarness();
    expect(h.callValidated("ae_run_script", { code: "1 + 2" })).toMatchObject({ status: "applied", undoSteps: 1, data: { result: 3, type: "number" } });
    expect(h.callValidated("ae_run_script", { code: '({a: [1, "two"], b: null})' }).data).toEqual({ result: { a: [1, "two"], b: null }, type: "object" });
    expect(h.callValidated("ae_run_script", { code: "var o = {}; o.self = o; o" }).data).toEqual({ result: "[object Object]", type: "object" });
    expect(h.callValidated("ae_run_script", { code: "var x = 1;" }).data).toEqual({ result: null, type: "undefined" });
    expect(h.mock.state.undoGroups).toEqual(["Zenvi: Run ExtendScript", "Zenvi: Run ExtendScript", "Zenvi: Run ExtendScript", "Zenvi: Run ExtendScript"]);
  });

  test("refuses an empty snippet before opening anything", () => {
    const h = aeHarness();
    expect(h.call("ae_run_script", { code: "   " })).toMatchObject({ status: "refused", undoSteps: 0, error: { code: "INVALID_ARGUMENT" } });
    expect(h.mock.state.undoDepth).toBe(0);
  });

  test("a failing snippet is an error with the message", () => {
    const h = aeHarness();
    const receipt = h.callValidated("ae_run_script", { code: "throw new Error('nope')" });
    expect(receipt).toMatchObject({ status: "error", error: { code: "HOST_ERROR", message: "The script failed: nope" } });
    expect(h.mock.state.undoDepth).toBe(0);
  });
});
