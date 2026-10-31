import { describe, expect, it } from "vitest";
import { unavailableAssistantTools } from "./registry.js";
import { CONTRACT_TOOL_NAMES } from "./schemas.gen.js";
import { fakeHost } from "./test-support/fake-host.js";

const COMFYUI = ["list_comfyui_templates_tool", "list_comfyui_jobs_tool", "create_media_with_comfyui_tool", "enhance_file_with_comfyui_tool", "cancel_comfyui_job_tool"];

describe("unavailableAssistantTools", () => {
  it("names the desktop-only tools a web editor's Assistant must not be offered", () => {
    const names = unavailableAssistantTools("editor");
    for (const name of [...COMFYUI, "prepare_recording_tool", "open_project_tool"]) expect(names).toContain(name);
    // What the web editor runs stays offered.
    for (const name of ["split_clip_tool", "import_stock_media_tool", "export_video_tool", "add_clip_to_timeline_tool"]) expect(names).not.toContain(name);
    expect(names.every((n) => (CONTRACT_TOOL_NAMES as readonly string[]).includes(n))).toBe(true);
  });

  it("adds the tools this host cannot run (a browser without video export)", () => {
    expect(unavailableAssistantTools("editor", fakeHost())).not.toContain("list_export_presets_tool");
    expect(unavailableAssistantTools("editor", fakeHost({ without: ["exporter"] }))).toContain("list_export_presets_tool");
  });
});
