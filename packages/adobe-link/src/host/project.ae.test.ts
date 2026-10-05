import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { aeHarness, type AeHarness } from "../testing/ae-harness.js";

/** Folders whose names File() would URI-decode if the % were passed as is. */
const PERCENT_FOLDERS = ["Project%20files", "100% done", "a%25b"];

function percentFolder(h: AeHarness, name: string): string {
  const dir = path.join(h.dir, name);
  mkdirSync(dir);
  return dir;
}

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

  test("a literal % in the folder name is kept (File() would read %20 as a space)", () => {
    const h = aeHarness();
    for (const name of PERCENT_FOLDERS) {
      const target = path.join(percentFolder(h, name), "promo.aep");
      expect(h.callValidated("ae_save_project", { path: target }), name).toMatchObject({ status: "applied", data: { path: target } });
      expect(existsSync(target), name).toBe(true);
    }
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

  // How a Zenvi export written for people ends (zenvi-core after_effects_runtime: quietRun()).
  const EXPORT_END = [
    "(function () {",
    "  var quiet = !!($.global && $.global.ZENVI_AE_QUIET === true);",
    "  if (!quiet) {",
    '    alert("Built comp Promo with 3 layers.");',
    "  }",
    '  return "quiet=" + quiet;',
    "}());",
  ].join("\n");

  test("runs with $.global.ZENVI_AE_QUIET true, so an export's closing alert cannot hold the call; the flag is gone afterwards", () => {
    const h = aeHarness();
    const file = h.file("export.jsx", EXPORT_END);
    expect(h.callValidated("ae_run_jsx_file", { path: file })).toMatchObject({ status: "applied", data: { result: "quiet=true" } });
    expect(h.mock.state.alerts).toEqual([]);
    expect(h.host.evaluate("typeof ZENVI_AE_QUIET")).toBe("undefined");
    // Run by hand afterwards (File > Scripts), the same export still says it is done.
    expect(h.host.evaluate(`$.evalFile(new File(${JSON.stringify(file)}))`)).toBe("quiet=false");
    expect(h.mock.state.alerts).toEqual(["Built comp Promo with 3 layers."]);
  });

  test("the flag is cleared when the script fails, clears one left over from elsewhere, and is never set by a refusal", () => {
    const h = aeHarness();
    const broken = h.file("broken.jsx", "$.global.seen = $.global.ZENVI_AE_QUIET; throw new Error('nope');");
    expect(h.callValidated("ae_run_jsx_file", { path: broken })).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    expect(h.host.evaluate("seen")).toBe(true);
    expect(h.host.evaluate("typeof ZENVI_AE_QUIET")).toBe("undefined");

    h.host.evaluate("$.global.ZENVI_AE_QUIET = true;");
    expect(h.callValidated("ae_run_jsx_file", { path: h.file("one.jsx", "1") }).status).toBe("applied");
    expect(h.host.evaluate("typeof ZENVI_AE_QUIET")).toBe("undefined");

    expect(h.callValidated("ae_run_jsx_file", { path: path.join(h.dir, "missing.jsx") })).toMatchObject({ status: "refused" });
    expect(h.host.evaluate("typeof ZENVI_AE_QUIET")).toBe("undefined");
  });

  test("a literal % in the path is found: File() reads %XX as an escape, so the tool passes % as %25", () => {
    const h = aeHarness();
    for (const name of PERCENT_FOLDERS) {
      const file = path.join(percentFolder(h, name), "export.jsx");
      writeFileSync(file, '"ran"');
      expect(h.callValidated("ae_run_jsx_file", { path: file }), name).toMatchObject({ status: "applied", data: { path: file, result: "ran" } });
    }
    // What the tool works around: "Project%20files" passed as is names "Project files".
    expect(h.host.evaluate(`new File(${JSON.stringify(path.join(h.dir, "Project%20files", "export.jsx"))}).exists`)).toBe(false);
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
