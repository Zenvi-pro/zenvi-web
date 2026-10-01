// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { normalizeUserCode } from "@/features/auth/DevicePage";
import { normalizeHex } from "@/ui/ColorField";
import { clampValue, parseNumberInput, roundTo } from "@/ui/NumberField";
import { safeNext } from "./auth";
import { backendPath, fetchModelCatalog } from "./backend";
import { chatSocketUrl } from "./env";
import { formatBytes, formatDuration, formatFps, formatRelativeTime, formatResolution } from "./format";
import { cleanFileName, COMMON_PRESETS, presetProfile, safeFileName } from "./projectFactory";

describe("auth redirects", () => {
  it("only allows same-app paths", () => {
    expect(safeNext("/p/abc")).toBe("/p/abc");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("device codes", () => {
  it("normalizes to XXXX-XXXX", () => {
    expect(normalizeUserCode("abcd efgh")).toBe("ABCD-EFGH");
    expect(normalizeUserCode("ab")).toBe("AB");
    expect(normalizeUserCode("ABCD-EFGH-IJ")).toBe("ABCD-EFGH");
  });
});

describe("backend client", () => {
  it("normalizes paths onto the /api/v1 proxy", () => {
    expect(backendPath("/api/v1/models")).toBe("/models");
    expect(backendPath("models")).toBe("/models");
    expect(backendPath("/pexels/search?query=x")).toBe("/pexels/search?query=x");
  });

  it("builds the chat socket URL from the backend origin", () => {
    expect(chatSocketUrl("https://api.zenvi.pro")).toBe("wss://api.zenvi.pro/api/v1/chat/ws");
    expect(chatSocketUrl("http://localhost:8500/")).toBe("ws://localhost:8500/api/v1/chat/ws");
  });

  it("sorts the model picker like the desktop: featured, rank, name; hides unavailable", async () => {
    const body = {
      default_model_id: "b",
      models: [
        { model_id: "c", display_name: "Charlie", rank: 1, featured: false },
        { model_id: "b", display_name: "Bravo", rank: 5, featured: true },
        { model_id: "a", display_name: "Alpha", rank: 5, featured: true },
        { model_id: "d", display_name: "Delta", available: false },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const catalog = await fetchModelCatalog();
    expect(catalog.models.map((m) => m.model_id)).toEqual(["a", "b", "c", "d"]);
    expect(catalog.models.find((m) => m.model_id === "d")?.available).toBe(false);
    expect(catalog.defaultModelId).toBe("b");
    vi.unstubAllGlobals();
  });
});

describe("number and color fields", () => {
  it("parses typed numbers and simple math", () => {
    expect(parseNumberInput("12.5")).toBe(12.5);
    expect(parseNumberInput("50%")).toBe(50);
    expect(parseNumberInput("1,5")).toBe(1.5);
    expect(parseNumberInput("10+5")).toBe(15);
    expect(parseNumberInput("10/4")).toBe(2.5);
    expect(parseNumberInput("1/0")).toBeNull();
    expect(parseNumberInput("abc")).toBeNull();
  });

  it("clamps and rounds", () => {
    expect(clampValue(5, 0, 1)).toBe(1);
    expect(clampValue(-5, 0)).toBe(0);
    expect(roundTo(0.1 + 0.2, 3)).toBe(0.3);
  });

  it("normalizes hex colors", () => {
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("3275f8")).toBe("#3275f8");
    expect(normalizeHex("#12345")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats durations, sizes, rates and resolutions", () => {
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatFps({ num: 30000, den: 1001 })).toBe("29.97 fps");
    expect(formatResolution(1920, 1080)).toBe("1080p");
    expect(formatResolution(3840, 2160)).toBe("4K");
    expect(formatResolution(1080, 1920)).toBe("1080×1920");
  });

  it("formats relative times", () => {
    const now = Date.UTC(2026, 8, 30, 12);
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(formatRelativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
  });
});

describe("project factory", () => {
  it("resolves every home-page preset to a real profile of the right size", () => {
    const sizes: Record<string, [number, number]> = {
      "1080p30": [1920, 1080],
      "4k30": [3840, 2160],
      vertical: [1080, 1920],
      square: [1080, 1080],
      "720p30": [1280, 720],
    };
    for (const preset of COMMON_PRESETS) {
      const p = presetProfile(preset);
      expect([p.width, p.height], preset.id).toEqual(sizes[preset.id]);
      expect(p.fps.num / p.fps.den, preset.id).toBeCloseTo(30, 1);
    }
  });

  it("makes safe file names", () => {
    expect(safeFileName('My: "Trip"/2026', "zvn")).toBe("My Trip 2026.zvn");
    expect(safeFileName("   ", "mp4")).toBe("Untitled.mp4");
    expect(cleanFileName("a\u0001b", "_")).toBe("a_b");
  });
});
