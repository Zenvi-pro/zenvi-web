import { describe, expect, test } from "vitest";
import { createAeMock } from "./testing/ae-mock.js";
import { loadHostScript, type LoadedHostScript } from "./testing/host-script.js";
import { createPremiereMock } from "./testing/premiere-mock.js";

/** Register an extra tool in the loaded realm (test-only; real tools live in extension/host). */
function register(host: LoadedHostScript, name: string, body: string, options = "{}"): void {
  host.evaluate(`ZenviLink.register(${JSON.stringify(name)}, function (args, ctx) { ${body} }, ${options});`);
}

function loadAe() {
  const mock = createAeMock();
  const host = loadHostScript("aeft", mock.globals);
  return { mock, host };
}

describe("dispatch", () => {
  test("refuses unknown tools", () => {
    const { host } = loadAe();
    const receipt = host.dispatch("ae_missing");
    expect(receipt).toMatchObject({ contract: 3, status: "refused", tool: "ae_missing", host: "aftereffects", undoSteps: 0 });
    expect(receipt.summary).toMatch(/^Error: Unknown tool ae_missing/);
    expect(receipt.error?.code).toBe("NOT_FOUND");
  });

  test.each([
    ["not JSON", "{oops"],
    ["an array", "[1]"],
    ["a string", '"x"'],
  ])("refuses arguments that are %s", (_label, raw) => {
    const { host } = loadAe();
    const receipt = JSON.parse(host.dispatchRaw("ae_get_state", raw));
    expect(receipt.status).toBe("refused");
    expect(receipt.error.code).toBe("INVALID_ARGUMENT");
  });

  test("empty arguments are an empty object", () => {
    const { host } = loadAe();
    expect(JSON.parse(host.dispatchRaw("ae_get_state", "")).status).toBe("ok");
  });

  test("ZenviLink.refuse becomes a refused receipt with its code", () => {
    const { host } = loadAe();
    register(host, "ae_t_refuse", 'throw ZenviLink.refuse("NO_ACTIVE_COMP", "No comp is active");');
    const receipt = host.dispatch("ae_t_refuse");
    expect(receipt).toMatchObject({ status: "refused", summary: "Error: No comp is active", undoSteps: 0 });
    expect(receipt.error).toEqual({ code: "NO_ACTIVE_COMP", message: "No comp is active" });
  });

  test("ZenviLink.fail becomes an error receipt; unknown codes become HOST_ERROR", () => {
    const { host } = loadAe();
    register(host, "ae_t_fail", 'throw ZenviLink.fail("UNSUPPORTED", "Error: needs AE 2024");');
    register(host, "ae_t_badcode", 'throw ZenviLink.refuse("WHATEVER", "x");');
    expect(host.dispatch("ae_t_fail")).toMatchObject({ status: "error", summary: "Error: needs AE 2024", error: { code: "UNSUPPORTED", message: "needs AE 2024" } });
    expect(host.dispatch("ae_t_badcode").error?.code).toBe("HOST_ERROR");
  });

  test("any other exception is HOST_ERROR with its message", () => {
    const { host } = loadAe();
    register(host, "ae_t_throw", "return app.project.nothing.here;");
    const receipt = host.dispatch("ae_t_throw");
    expect(receipt.status).toBe("error");
    expect(receipt.error?.code).toBe("HOST_ERROR");
    expect(receipt.summary).toMatch(/^Error: .*here/);
  });

  test("a tool that returns no receipt is an error", () => {
    const { host } = loadAe();
    register(host, "ae_t_noreceipt", "return {status: 'ok'};");
    const receipt = host.dispatch("ae_t_noreceipt");
    expect(receipt.status).toBe("error");
    expect(receipt.summary).toContain("returned no receipt");
  });

  test("warnings and data travel in the receipt; non-ASCII text arrives escaped and intact", () => {
    const { host } = loadAe();
    register(host, "ae_t_ok", 'ctx.warn("Snapped 1.01 s"); return ZenviLink.ok("Caf\\u00e9 \\u2014 ok", {n: 1, s: "\\u2028"});');
    const raw = host.dispatchRaw("ae_t_ok", "{}");
    expect(raw).not.toMatch(/[\u0080-\uffff]/);
    expect(JSON.parse(raw)).toMatchObject({ status: "ok", summary: "Café — ok", data: { n: 1, s: " " }, warnings: ["Snapped 1.01 s"], undoSteps: 0 });
  });

  test("register rejects bad names and duplicates", () => {
    const { host } = loadAe();
    expect(() => register(host, "bad name", "return ZenviLink.ok('x');")).toThrow(/bad tool name/);
    expect(() => register(host, "ae_get_state", "return ZenviLink.ok('x');")).toThrow(/registered twice/);
  });
});

describe("After Effects undo groups", () => {
  test("a mutating call runs inside exactly one undo group named after the tool", () => {
    const { mock, host } = loadAe();
    register(host, "ae_t_mutate", 'ctx.changed(); app.project.activeItem.name = "B"; return ZenviLink.applied("Renamed", {});', '{mutating: true, undoTitle: "Rename comp"}');
    mock.addComp({ name: "A" });
    const receipt = host.dispatch("ae_t_mutate");
    expect(receipt).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(mock.state.undoGroups).toEqual(["Zenvi: Rename comp"]);
    expect(mock.state.undoCalls.map((call) => call.kind)).toEqual(["begin", "end"]);
  });

  test("read-only calls open no undo group", () => {
    const { mock, host } = loadAe();
    host.dispatch("ae_get_state");
    expect(mock.state.undoCalls).toEqual([]);
  });

  test("a failure after a change closes the group and reports the partial change", () => {
    const { mock, host } = loadAe();
    register(host, "ae_t_partial", 'ctx.changed(); app.project.activeItem.name = "B"; throw new Error("boom");', '{mutating: true, undoTitle: "Two steps"}');
    mock.addComp({ name: "A" });
    const receipt = host.dispatch("ae_t_partial");
    expect(receipt).toMatchObject({ status: "error", undoSteps: 1 });
    expect(receipt.warnings.join(" ")).toContain('Undo "Zenvi: Two steps"');
    expect(mock.state.undoDepth).toBe(0);
  });

  test("a refusal before any change reports no undo step", () => {
    const { mock, host } = loadAe();
    register(host, "ae_t_validate", 'ZenviLink.required(args, "name", "string"); return ZenviLink.applied("x", {});', "{mutating: true}");
    const receipt = host.dispatch("ae_t_validate", {});
    expect(receipt).toMatchObject({ status: "refused", undoSteps: 0, warnings: [] });
    expect(mock.state.undoDepth).toBe(0);
  });

  test("unchanged results report no undo step", () => {
    const { host } = loadAe();
    register(host, "ae_t_same", 'return ZenviLink.unchanged("Already so", {});', "{mutating: true}");
    expect(host.dispatch("ae_t_same")).toMatchObject({ status: "unchanged", undoSteps: 0 });
  });
});

describe("Premiere undo reporting", () => {
  test("no undo grouping; undoSteps is what the tool says, else unknown (null)", () => {
    const mock = createPremiereMock();
    const host = loadHostScript("ppro", mock.globals);
    register(host, "premiere_t_two", 'return ZenviLink.applied("Moved two clips", {}, 2);', "{mutating: true}");
    register(host, "premiere_t_unknown", 'return ZenviLink.applied("Did something", {});', "{mutating: true}");
    register(host, "premiere_t_partial", 'ctx.changed(); throw new Error("half way");', "{mutating: true}");
    expect(host.dispatch("premiere_t_two")).toMatchObject({ status: "applied", undoSteps: 2, host: "premiere" });
    expect(host.dispatch("premiere_t_unknown").undoSteps).toBeNull();
    const partial = host.dispatch("premiere_t_partial");
    expect(partial).toMatchObject({ status: "error", undoSteps: null });
    expect(partial.warnings.join(" ")).toContain("its own undo step");
  });
});

describe("argument helpers", () => {
  const cases: [string, string, Record<string, unknown>, string][] = [
    ["required missing", 'ZenviLink.required(args, "name", "string")', {}, "`name` is required"],
    ["required null", 'ZenviLink.required(args, "name", "string")', { name: null }, "`name` is required"],
    ["required wrong type", 'ZenviLink.required(args, "name", "string")', { name: 3 }, "`name` must be a string, got number"],
    ["integer", 'ZenviLink.required(args, "n", "integer")', { n: 1.5 }, "`n` must be an integer, got number"],
    ["object", 'ZenviLink.optional(args, "o", "object", {})', { o: [1] }, "`o` must be an object, got array"],
    ["oneOf", 'ZenviLink.oneOf("preset", args.preset, ["1080p", "4k"])', { preset: "8k" }, "`preset` must be one of 1080p, 4k; got 8k"],
    ["inRange", 'ZenviLink.inRange("opacity", args.opacity, 0, 100)', { opacity: 120 }, "`opacity` must be a number >= 0 and <= 100; got 120"],
  ];
  test.each(cases)("%s", (_label, call, args, message) => {
    const { host } = loadAe();
    register(host, "ae_t_args", `${call}; return ZenviLink.ok("fine");`);
    const receipt = host.dispatch("ae_t_args", args);
    expect(receipt.status).toBe("refused");
    expect(receipt.error).toEqual({ code: "INVALID_ARGUMENT", message });
  });

  test("optional falls back; present values pass through", () => {
    const { host } = loadAe();
    register(host, "ae_t_opt", 'return ZenviLink.ok("x", {a: ZenviLink.optional(args, "a", "number", 0.6), b: ZenviLink.optional(args, "b", "number", 0.6)});');
    expect(host.dispatch("ae_t_opt", { b: 2 }).data).toEqual({ a: 0.6, b: 2 });
  });
});

describe("time and colour helpers", () => {
  test("snapToFrame snaps and warns only when the value moved", () => {
    const { host } = loadAe();
    register(host, "ae_t_snap", 'return ZenviLink.ok("x", {a: ZenviLink.snapToFrame(1.01, 30, ctx, "start"), b: ZenviLink.snapToFrame(1.0001, 30, ctx, "end")});');
    const receipt = host.dispatch("ae_t_snap");
    expect(receipt.data).toEqual({ a: 1, b: 1 });
    expect(receipt.warnings).toEqual(["Snapped start 1.01 s to the frame grid: 1 s (frame 30 at 30 fps)"]);
  });

  test("colours convert between hex and 0–1 arrays and refuse anything else", () => {
    const { host } = loadAe();
    expect(host.evaluate('ZenviLink.color.toRgb("#FF8000").join(",")')).toBe(`1,${128 / 255},0`);
    expect(host.evaluate("ZenviLink.color.toHex([1, 0.5, 0])")).toBe("#FF8000");
    expect(host.evaluate('ZenviLink.color.toRgb([0, 0.2, 1]).join(",")')).toBe("0,0.2,1");
    register(host, "ae_t_color", 'ZenviLink.color.toRgb(args.c, "fill"); return ZenviLink.ok("x");');
    expect(host.dispatch("ae_t_color", { c: [255, 0, 0] }).error?.message).toContain("`fill` must be");
  });
});
