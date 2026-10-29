import { describe, expect, it } from "vitest";
import { statusColor } from "./status.js";

describe("data_table status chips", () => {
  it("colour a status by its word, negations included", () => {
    expect(statusColor("Done", "#000")).toBe("#2FBF71");
    expect(statusColor("In review", "#000")).toBe("#F2A93B");
    expect(statusColor("Blocked", "#000")).toBe("#EF5350");
    expect(statusColor("Unpaid", "#000")).toBe("#EF5350");
    expect(statusColor("Not ready", "#000")).toBe("#EF5350");
    expect(statusColor("Incomplete", "#000")).toBe("#EF5350");
    expect(statusColor("Not started", "#000")).toBe("#F2A93B");
    expect(statusColor("Piano", "#000")).toBe("#000");
    expect(statusColor("Translated", "#000")).toBe("#000");
  });
});
