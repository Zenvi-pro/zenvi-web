import { describe, expect, test } from "vitest";
import { GENERATED_SECTION, HOST_APPS, HOST_OF_APP, bundleHostScript, hostSources } from "./host-bundle.js";
import { catalogFor } from "./catalog/index.js";
import { TASTE } from "./taste.js";
import { LINK_VERSION } from "./version.js";
import { checkEs3 } from "./testing/es3.js";
import { createAeMock } from "./testing/ae-mock.js";
import { loadHostScript } from "./testing/host-script.js";
import { createPremiereMock } from "./testing/premiere-mock.js";

function mockFor(app: "aeft" | "ppro") {
  return app === "aeft" ? createAeMock().globals : createPremiereMock().globals;
}

describe.each(HOST_APPS)("%s host script", (app) => {
  test("the bundle is ECMAScript 3", () => {
    expect(checkEs3(bundleHostScript(app).text)).toBeUndefined();
  });

  test.each(hostSources(app).map((source) => [source.file, source.text] as const))("%s is ES3 and ASCII", (file, text) => {
    const problem = checkEs3(text);
    expect(problem, problem && `${file}:${problem.line}:${problem.column} ${problem.message}`).toBeUndefined();
    const nonAscii = text.split("\n").findIndex((line) => /[\u0080-\uffff]/.test(line));
    expect(nonAscii, `${file}:${nonAscii + 1} has a non-ASCII character; use a \\u escape`).toBe(-1);
  });

  test("bundles common/* then the generated block then the app's files, each in name order", () => {
    const bundle = bundleHostScript(app);
    const files = bundle.sections.map((section) => section.file);
    const common = files.filter((file) => file.startsWith("common/"));
    const own = files.filter((file) => file.startsWith(`${app}/`));
    expect(files).toEqual([...common, GENERATED_SECTION, ...own]);
    expect(common).toEqual([...common].sort());
    expect(own).toEqual([...own].sort());
    expect(common.slice(0, 3)).toEqual(["common/00-json2.jsx", "common/01-polyfills.jsx", "common/10-zenvi.jsx"]);
  });

  test("every catalog tool is registered in JSX and vice versa, with the catalog's title and mutability", () => {
    const host = loadHostScript(app, mockFor(app));
    const registered = host.listTools();
    const catalog = catalogFor(HOST_OF_APP[app]);
    expect(registered.map((tool) => tool.name).sort()).toEqual(catalog.map((def) => def.name).sort());
    for (const def of catalog) {
      const tool = registered.find((candidate) => candidate.name === def.name);
      expect(tool?.title).toBe(def.title);
      expect(tool?.mutating).toBe(def.annotations.readOnlyHint !== true);
    }
  });

  test("injects version, TASTE and host identity", () => {
    const host = loadHostScript(app, mockFor(app));
    expect(host.evaluate("ZenviLink.version")).toBe(LINK_VERSION);
    expect(JSON.parse(host.evaluate("JSON.stringify(ZenviLink.TASTE)") as string)).toEqual(JSON.parse(JSON.stringify(TASTE)));
    expect(host.hostInfo()).toMatchObject({ host: HOST_OF_APP[app], version: LINK_VERSION, protocol: 1, tools: catalogFor(HOST_OF_APP[app]).length });
  });

  test("locate() maps a bundle line back to its source file", () => {
    const host = loadHostScript(app, mockFor(app));
    const zenvi = host.bundle.sections.find((section) => section.file === "common/10-zenvi.jsx");
    expect(zenvi).toBeDefined();
    expect(host.locate((zenvi?.startLine ?? 0) + 4)).toEqual({ file: "common/10-zenvi.jsx", line: 5 });
    const lines = host.bundle.text.split("\n");
    const source = hostSources(app).find((s) => s.file === "common/10-zenvi.jsx")?.text.split("\n") ?? [];
    expect(lines[(zenvi?.startLine ?? 0) + 4 - 1]).toBe(source[4]);
  });
});

describe("evaluating the host script again (CEP does when the panel opens)", () => {
  test.each(HOST_APPS)("%s keeps ZenviLink.state and registers every tool again", (app) => {
    const host = loadHostScript(app, mockFor(app));
    host.evaluate('ZenviLink.state.jobs = {render1: {status: "running"}};');
    const before = host.listTools();
    expect(host.hostInfo().loads).toBe(1);
    host.evaluate(host.bundle.text);
    expect(host.evaluate("ZenviLink.state.jobs.render1.status")).toBe("running");
    expect(host.listTools()).toEqual(before);
    expect(host.hostInfo().loads).toBe(2);
    expect(JSON.parse(host.dispatchRaw(app === "aeft" ? "ae_get_state" : "premiere_get_state", "{}")).contract).toBe(3);
  });
});

describe("ES3 realm", () => {
  test("lacks what ExtendScript lacks; Zenvi Link adds only static polyfills and json2", () => {
    const host = loadHostScript("aeft", createAeMock().globals);
    for (const missing of ["[].map", "[].forEach", "[].indexOf", "''.trim", "Object.assign", "''.startsWith", "Function.prototype.bind", "Object.create"]) {
      expect(host.evaluate(`typeof ${missing}`), missing).toBe("undefined");
    }
    for (const present of ["Object.keys", "Array.isArray", "Date.now", "JSON.parse", "JSON.stringify", "ZenviLink.indexOf", "ZenviLink.trim"]) {
      expect(host.evaluate(`typeof ${present}`), present).toBe("function");
    }
    expect(host.evaluate(`ZenviLink.indexOf([3, 4, 5], 4)`)).toBe(1);
    expect(host.evaluate(`ZenviLink.indexOf([3, 4, 5], "4")`)).toBe(-1);
    expect(host.evaluate(`ZenviLink.trim("  x\\u00a0")`)).toBe("x");
    expect(host.evaluate(`JSON.parse(JSON.stringify({a: [1, "caf\\u00e9", null], b: true})).a[1]`)).toBe("caf\u00e9");
  });

  test("built-in prototypes stay untouched, so other scripts' for-in loops see only their own keys", () => {
    const host = loadHostScript("aeft", createAeMock().globals);
    expect(
      host.evaluate(`(function () {
        var found = [], k;
        var samples = [[], {}, new String("ab"), new Number(1), new Boolean(true), new Date(0), function () {}, /x/];
        for (var i = 0; i < samples.length; i += 1) {
          for (k in samples[i]) { if (!Object.prototype.hasOwnProperty.call(samples[i], k)) { found.push(k); } }
        }
        return found.join(",");
      }())`),
    ).toBe("");
    // A typical third-party After Effects loop in the shared engine.
    expect(host.evaluate(`var names = []; var layers = ["Title", "BG"]; for (var i in layers) { names.push(i); } names.join(",")`)).toBe("0,1");
  });

  test("json2 writes Dates as ISO 8601 with milliseconds and unboxes primitives", () => {
    const host = loadHostScript("aeft", createAeMock().globals);
    expect(host.evaluate("JSON.stringify({d: new Date(Date.UTC(2026, 9, 4, 21, 0, 5, 7))})")).toBe('{"d":"2026-10-04T21:00:05.007Z"}');
    expect(host.evaluate("JSON.stringify([new String('x'), new Number(2), new Boolean(false), new Date(NaN)])")).toBe('["x",2,false,null]');
  });

  test("realm arrays from the mock DOM lack ES5 methods too", () => {
    const mock = createAeMock();
    const comp = mock.addComp();
    comp.layers.addNull().selected = true;
    const host = loadHostScript("aeft", mock.globals);
    expect(host.evaluate("typeof app.project.activeItem.selectedLayers.map")).toBe("undefined");
    expect(host.evaluate("app.project.activeItem.selectedLayers.length")).toBe(1);
  });
});

describe("checkEs3", () => {
  test.each([
    ["let", "let a = 1;"],
    ["const", "const a = 1;"],
    ["arrow function", "var f = function () { return [1].map(x => x); };"],
    ["template string", "var s = `x`;"],
    ["trailing comma in an object", "var o = {a: 1,};"],
    ["trailing comma in an array", "var a = [1, 2,];"],
    ["reserved word as a property", "var o = {}; o.default = 1;"],
    ["keyword as an object key", "var o = {delete: 1};"],
    ["getter", "var o = {get x() { return 1; }};"],
    ["catch without binding", "try { x(); } catch { }"],
  ])("rejects %s", (_label, source) => {
    expect(checkEs3(source)).toBeDefined();
  });

  test("accepts quoted keys and bracket access", () => {
    expect(checkEs3('var o = {"default": 1, "in": 2}; var x = o["in"];')).toBeUndefined();
  });
});
