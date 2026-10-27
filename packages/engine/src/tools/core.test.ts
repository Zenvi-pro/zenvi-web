import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatIssue, invalidArgumentsMessage, normalizeArgs, parsePythonFloat } from "./coerce.js";
import { durationFrames, keyframeX, quantizeSpan, roundHalfUp, snap, toFrame, toSeconds } from "./frame-time.js";
import type { JsonSchemaObject } from "./json-schema.js";
import { pyFixed, pyFloat, pyReprString, pySlice } from "./pyfmt.js";
import {
  applied,
  failed,
  fromHandlerText,
  isErrorResult,
  makeReceipt,
  parseReceipt,
  refused,
  unchanged,
} from "./receipt.js";
import { assistantWireForError, toAssistantWire } from "./wire.js";

describe("frame-time (frame_time.py)", () => {
  const ntsc = { num: 30000, den: 1001 };

  it("rounds half up like the desktop, not half to even", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(3.5)).toBe(4);
    expect(roundHalfUp(-2.5)).toBe(-3);
    // floor(v + 0.5) quirk kept: 0.49999999999999994 + 0.5 rounds to 1.0.
    expect(roundHalfUp(0.49999999999999994)).toBe(1);
  });

  it("converts seconds and frames", () => {
    expect(toFrame(1, { num: 30, den: 1 })).toBe(30);
    expect(toFrame(1 / 60, { num: 30, den: 1 })).toBe(1);
    expect(toSeconds(30, ntsc)).toBe(1.001);
    expect(snap(1.0, ntsc)).toBe(toSeconds(toFrame(1.0, ntsc), ntsc));
    expect(keyframeX(0, 30)).toBe(1);
  });

  it("counts duration frames and quantizes spans", () => {
    expect(durationFrames(0, 1, 30)).toBe(30);
    expect(durationFrames(5, 5, 30)).toBe(1);
    expect(durationFrames(5, 4, 30)).toBe(1);
    const [pos, start, end] = quantizeSpan(1.01, 0.02, 1.03, 30);
    expect([pos, start, end]).toEqual([1, 0.03333333333333333, 1.0333333333333334]);
  });
});

describe("receipts (receipt.py)", () => {
  it("serializes with the desktop key order and defaults", () => {
    const r = applied("add_track_tool", "Track added.");
    expect(Object.keys(r)).toEqual([
      "contract", "status", "tool", "summary", "clips", "shifted", "removedClipIds", "createdTracks",
      "markers", "removedMarkerIds", "warnings", "notes", "watchSuggested", "undoSteps",
    ]);
    expect(r).toMatchObject({ contract: 3, status: "applied", undoSteps: 1, watchSuggested: null });
  });

  it("prefixes failure summaries with Error: and zeroes undo steps", () => {
    expect(failed("t", "boom").summary).toBe("Error: boom");
    expect(refused("t", "Error: nope").summary).toBe("Error: nope");
    expect(makeReceipt("error", "t", "x", 3).undoSteps).toBe(0);
    expect(unchanged("t", "same").undoSteps).toBe(0);
  });

  it("only includes clipsNote and data when set", () => {
    const r = applied("t", "ok", { data: { a: 1 }, clipsNote: "n" });
    expect(r.data).toEqual({ a: 1 });
    expect(r.clipsNote).toBe("n");
    expect("data" in applied("t", "ok", { data: null })).toBe(false);
  });

  it("wraps legacy handler text like from_handler_str", () => {
    expect(fromHandlerText("t", "Error: bad", true).status).toBe("error");
    expect(fromHandlerText("t", "   ", false).summary).toBe("No changes.");
    expect(fromHandlerText("t", "Nothing to undo", false).status).toBe("unchanged");
    expect(fromHandlerText("t", "Track added.", true)).toMatchObject({ status: "applied", undoSteps: 1 });
    expect(fromHandlerText("t", "Seeked to start.", false)).toMatchObject({ status: "applied", undoSteps: 0 });
  });

  it("parses and classifies receipts", () => {
    const ok = JSON.stringify(applied("t", "fine"));
    const bad = JSON.stringify(refused("t", "no"));
    expect(parseReceipt(ok)?.status).toBe("applied");
    expect(parseReceipt("{\"contract\": 2}")).toBeNull();
    expect(parseReceipt("not json")).toBeNull();
    expect(isErrorResult(ok)).toBe(false);
    expect(isErrorResult(bad)).toBe(true);
    expect(isErrorResult("")).toBe(true);
    expect(isErrorResult("Error: x")).toBe(true);
    expect(isErrorResult("plain text")).toBe(false);
  });
});

describe("argument coercion (schema.py normalize_args)", () => {
  const schema: JsonSchemaObject = {
    type: "object",
    additionalProperties: false,
    properties: {
      trackIndex: { type: "integer" },
      start: { type: "number" },
      force: { type: "boolean" },
      points: { type: "array" },
      wordIndices: { type: "array" },
      position_seconds: { oneOf: [{ type: "string" }, { type: "number" }] },
      track: { type: "string" },
      value: { type: ["string", "number", "boolean", "null"] },
    },
  };

  it("drops hidden params and empty optionals", () => {
    expect(normalizeArgs(schema, { chat_session_id: "s", transaction_id: "t", trackIndex: "", force: null })).toEqual({});
  });

  it("coerces integer, number, boolean and array strings", () => {
    expect(
      normalizeArgs(schema, {
        trackIndex: " 2 ",
        start: "1.5",
        force: "False",
        points: '[{"frame": 1, "value": 0}]',
        wordIndices: "1, 2,3",
      }),
    ).toEqual({ trackIndex: 2, start: 1.5, force: false, points: [{ frame: 1, value: 0 }], wordIndices: [1, 2, 3] });
  });

  it("leaves oneOf props and unparseable values alone", () => {
    expect(normalizeArgs(schema, { position_seconds: "12", trackIndex: "1.5", start: "abc" })).toEqual({
      position_seconds: "12",
      trackIndex: "1.5",
      start: "abc",
    });
  });

  it("coerces numeric strings for type lists that include number, like the desktop", () => {
    expect(normalizeArgs(schema, { value: "1920" })).toEqual({ value: 1920 });
    expect(normalizeArgs(schema, { value: "h264" })).toEqual({ value: "h264" });
  });

  it("stringifies numbers for string-only props (MCP clients send track: 2)", () => {
    expect(normalizeArgs(schema, { track: 2 })).toEqual({ track: "2" });
  });

  it("keeps unknown keys so validation can refuse them", () => {
    expect(normalizeArgs(schema, { bogus: 1, other: "" })).toEqual({ bogus: 1 });
  });

  it("parses floats like Python float()", () => {
    expect(parsePythonFloat(" 1_000.5 ")).toBe(1000.5);
    expect(parsePythonFloat("0x10")).toBeNull();
    expect(parsePythonFloat("inf")).toBeNull();
    expect(parsePythonFloat("")).toBeNull();
  });

  it("phrases validation errors like jsonschema", () => {
    const s = z.strictObject({ query: z.string(), scope: z.enum(["auto", "clip"]).optional(), n: z.int().min(1).optional() });
    const cases: [unknown, string][] = [
      [{}, "Error: Invalid arguments for x_tool: 'query' is a required property (at (root))."],
      [{ query: "q", scope: "all" }, "Error: Invalid arguments for x_tool: 'all' is not one of ['auto', 'clip'] (at scope)."],
      [{ query: "q", zz: 1 }, "Error: Invalid arguments for x_tool: Additional properties are not allowed ('zz' was unexpected) (at (root))."],
      [{ query: 5 }, "Error: Invalid arguments for x_tool: 5 is not of type 'string' (at query)."],
      [{ query: "q", n: 0 }, "Error: Invalid arguments for x_tool: 0 is less than the minimum of 1 (at n)."],
    ];
    for (const [payload, message] of cases) {
      const r = s.safeParse(payload);
      expect(r.success).toBe(false);
      if (!r.success) expect(invalidArgumentsMessage("x_tool", r.error.issues[0]!, payload)).toBe(message);
    }
    const r = s.safeParse({ query: "q", n: 1.5 });
    if (!r.success) expect(formatIssue(r.error.issues[0]!, { query: "q", n: 1.5 }).message).toBe("1.5 is not of type 'integer'");
  });

  it("names the schema's argument for an unexpected one (W25a E2E bug 9: clip_id for timeline_clip_id)", () => {
    const s = z.strictObject({ timeline_clip_id: z.string(), text: z.string().optional() });
    const schema = { type: "object", properties: { timeline_clip_id: { type: "string" }, text: { type: "string" } }, additionalProperties: false } as JsonSchemaObject;
    const message = (payload: Record<string, unknown>) => {
      const r = s.safeParse(payload);
      return r.success ? "" : invalidArgumentsMessage("edit_title_tool", r.error.issues.find((i) => i.code === "unrecognized_keys")!, payload, schema);
    };
    expect(message({ timeline_clip_id: "A", clip_id: "A" })).toBe(
      "Error: Invalid arguments for edit_title_tool: Additional properties are not allowed ('clip_id' was unexpected) (at (root)). For this tool, pass 'timeline_clip_id' instead of 'clip_id'.",
    );
    expect(message({ timeline_clip_id: "A", txt: "x" })).toMatch(/pass 'text' instead of 'txt'\.$/);
    expect(message({ timeline_clip_id: "A", banana: 1 })).toMatch(/\(at \(root\)\)\.$/);
    // The missing required argument is reported first; the hint still names it.
    const missing = s.safeParse({ clip_id: "A" });
    if (!missing.success) {
      expect(invalidArgumentsMessage("edit_title_tool", missing.error.issues[0]!, { clip_id: "A" }, schema, missing.error.issues)).toBe(
        "Error: Invalid arguments for edit_title_tool: 'timeline_clip_id' is a required property (at (root)). For this tool, pass 'timeline_clip_id' instead of 'clip_id'.",
      );
    }
  });
});

describe("Python formatting", () => {
  it("repr() quoting", () => {
    expect(pyReprString("abc")).toBe("'abc'");
    expect(pyReprString("Tom's")).toBe('"Tom\'s"');
    expect(pyReprString(`it's "x"`)).toBe(`'it\\'s "x"'`);
    expect(pyReprString("a\nb\tc")).toBe("'a\\nb\\tc'");
    expect(pyReprString("Música 🎬")).toBe("'Música 🎬'");
    expect(pyReprString("nbsp ")).toBe("'nbsp\\xa0'");
  });

  it(".Nf rounds exact binary ties to even (JS toFixed rounds up)", () => {
    expect(pyFixed(0.125, 2)).toBe("0.12");
    expect(pyFixed(0.375, 2)).toBe("0.38");
    expect(pyFixed(2.5, 0)).toBe("2");
    expect(pyFixed(1.005, 2)).toBe("1.00");
    expect(pyFixed(-0.001, 2)).toBe("-0.00");
    expect(pyFixed(12.5, 1)).toBe("12.5");
  });

  it("str(float)", () => {
    expect(pyFloat(12)).toBe("12.0");
    expect(pyFloat(0.1)).toBe("0.1");
    expect(pyFloat(1e-5)).toBe("1e-05");
    expect(pyFloat(1e16)).toBe("1e+16");
    expect(pyFloat(123456.789)).toBe("123456.789");
    expect(pyFloat(-0)).toBe("-0.0");
  });

  it("slices by code point", () => {
    expect(pySlice("🎬abc", 0, 2)).toBe("🎬a");
  });
});

describe("Assistant wire (api_client.py tool_result)", () => {
  it("sends the full receipt JSON on success, with the images sidecar", () => {
    const receipt = applied("inspect_timeline_tool", "Rendered 1 inspect image(s).", { data: { mode: "frames" } }, 0);
    const text = JSON.stringify(receipt);
    const wire = toAssistantWire({ ok: true, text, data: receipt, images: [{ mimeType: "image/jpeg", data: "QUJD" }] });
    expect(wire).toEqual({ result: text, images: [{ mimeType: "image/jpeg", data: "QUJD" }] });
  });

  it("sends only the Error: summary for error/refused receipts, without images", () => {
    const receipt = refused("play_tool", "play_tool needs playback, which this Zenvi surface does not provide.");
    const wire = toAssistantWire({ ok: false, text: JSON.stringify(receipt), data: receipt, images: [{ mimeType: "image/png", data: "x" }] });
    expect(wire).toEqual({ result: "Error: play_tool needs playback, which this Zenvi surface does not provide." });
  });

  it("passes non-receipt text through and omits empty images", () => {
    expect(toAssistantWire({ ok: false, text: "Error: legacy" })).toEqual({ result: "Error: legacy" });
    expect(toAssistantWire({ ok: true, text: "plain", images: [] })).toEqual({ result: "plain" });
  });

  it("reports exceptions with the desktop prefix", () => {
    expect(assistantWireForError(new Error("boom"))).toEqual({ result: "Error: tool execution failed: boom" });
  });
});
