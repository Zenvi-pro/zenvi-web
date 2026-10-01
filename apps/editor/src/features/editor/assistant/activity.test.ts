// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyToolEvent, newActivityLinks, summarize, type ToolActivity } from "./activity";

const receipt = JSON.stringify({ contract: 3, status: "applied", tool: "add_clip_to_timeline_tool", summary: "Added clip to timeline at position 0.0s on track 1." });

describe("Assistant tool activity", () => {
  it("shows a contract-3 receipt as its summary, even when the backend truncated it", () => {
    expect(summarize(receipt)).toBe("Added clip to timeline at position 0.0s on track 1.");
    expect(summarize('{"contract":3,"status":"applied","tool":"add_cl')).toBe("Done");
    expect(summarize('{"contract":3,"status":"applied","summary":"Moved \\"a\\" to 2 s","tool":"move_clip_tool","rec')).toBe('Moved "a" to 2 s');
    expect(summarize("Error: File not found")).toBe("Error: File not found");
  });

  it("merges the backend's report and the editor's run of one call into one row", () => {
    const links = newActivityLinks();
    let tools: ToolActivity[] = [];
    // Backend reports first, with its own id; then asks the editor to run the call.
    tools = applyToolEvent(tools, { type: "tool_started", callId: "srv-1", name: "add_clip_to_timeline_tool", args: {} }, links);
    tools = applyToolEvent(tools, { type: "tool_call", callId: "c1", name: "add_clip_to_timeline_tool", args: {} }, links);
    tools = applyToolEvent(tools, { type: "tool_started", callId: "srv-2", name: "add_clip_to_timeline_tool", args: {} }, links);
    tools = applyToolEvent(tools, { type: "tool_call", callId: "c2", name: "add_clip_to_timeline_tool", args: {} }, links);
    tools = applyToolEvent(tools, { type: "tool_result", callId: "c1", name: "add_clip_to_timeline_tool", ok: true, result: receipt }, links);
    tools = applyToolEvent(tools, { type: "tool_completed", callId: "srv-1", ok: true, summary: receipt.slice(0, 40) }, links);
    tools = applyToolEvent(tools, { type: "tool_result", callId: "c2", name: "add_clip_to_timeline_tool", ok: true, result: "Added clip at 4.0s" }, links);
    tools = applyToolEvent(tools, { type: "tool_completed", callId: "srv-2", ok: true, summary: '{"contract":3' }, links);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => [t.status, t.detail])).toEqual([
      ["done", "Added clip to timeline at position 0.0s on track 1."],
      ["done", "Added clip at 4.0s"],
    ]);
  });

  it("keeps backend-only tools as their own rows", () => {
    const links = newActivityLinks();
    let tools: ToolActivity[] = [];
    tools = applyToolEvent(tools, { type: "tool_started", callId: "s1", name: "search_clips_tool", args: {} }, links);
    tools = applyToolEvent(tools, { type: "tool_progress", callId: "s1", name: "search_clips_tool", line: "Looking at 3 files", detail: {} }, links);
    tools = applyToolEvent(tools, { type: "tool_completed", callId: "s1", ok: true, summary: "Found 2 moments" }, links);
    expect(tools).toEqual([expect.objectContaining({ label: "Search clips", status: "done", detail: "Found 2 moments", local: false })]);
  });
});
