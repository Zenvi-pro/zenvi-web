import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";

describe("premiere_list_items", () => {
  test("a flat list in tree order with kinds, bin paths, media paths and marked ranges", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.items.a.setInPoint(1, 4);
    edit.items.a.setOutPoint(3.5, 4);
    const receipt = fx.call("premiere_list_items");
    expect(receipt.status).toBe("ok");
    const items = receipt.data.items as Record<string, unknown>[];
    expect(items.map((item) => item.name)).toEqual(["Main", "Footage", "a.mov", "b.mov", "c.mov", "music.wav"]);
    expect(items[0]).toMatchObject({ kind: "sequence", sequence_id: edit.sequence.sequenceID, bin: "/", duration: 12 });
    expect(items[1]).toMatchObject({ kind: "bin", bin: "/" });
    expect(items[2]).toMatchObject({ kind: "media", bin: "Footage", media_path: "/media/a.mov", in_point: 1, out_point: 3.5, duration: 2.5, offline: false });
    expect(receipt.summary).toBe("Listed 6 project items (1 bin, 1 sequence, 4 media, 0 other clips)");
  });

  test("filters by kind, name and bin, and says when the limit cut the list", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const nested = fx.mock.project.addBin("Footage/Day 1");
    fx.mock.project.addMedia("day1.mov", "/media/day1.mov", 5, nested);
    expect((fx.call("premiere_list_items", { kind: "bin" }).data.items as { name: string }[]).map((item) => item.name)).toEqual(["Footage", "Day 1"]);
    expect((fx.call("premiere_list_items", { name_contains: "MUSIC" }).data.items as { name: string }[]).map((item) => item.name)).toEqual(["music.wav"]);
    const inBin = fx.call("premiere_list_items", { bin: "Footage/Day 1" });
    expect(inBin.data.items).toEqual([expect.objectContaining({ name: "day1.mov", bin: "Footage/Day 1" })]);
    const shallow = fx.call("premiere_list_items", { bin: "Footage", recursive: false });
    expect((shallow.data.items as { name: string }[]).map((item) => item.name)).toEqual(["a.mov", "b.mov", "c.mov", "music.wav", "Day 1"]);
    const limited = fx.call("premiere_list_items", { kind: "media", limit: 2 });
    expect(limited.data).toMatchObject({ total: 5, truncated: true });
    expect(limited.warnings[0]).toContain("Listed the first 2 of 5 matching items");
  });

  test("refusals: no project, unknown bin, bad kind", () => {
    const fx = loadPremiere();
    expect(fx.call("premiere_list_items", { bin: "Nope" }).error).toMatchObject({ code: "NOT_FOUND", message: 'No bin "Nope" in the project' });
    expect(fx.call("premiere_list_items", { kind: "files" }).error?.code).toBe("INVALID_ARGUMENT");
    fx.mock.app.documentOpen = false;
    expect(fx.call("premiere_list_items").error?.code).toBe("NO_PROJECT");
  });
});

describe("premiere_import_files", () => {
  test("imports into a new Zenvi Imports bin and returns each item's nodeId", () => {
    const fx = loadPremiere();
    const clip = fx.file("shot.mov");
    const still = fx.file("logo.png");
    const before = fx.mock.state.undoIndex;
    const receipt = fx.call("premiere_import_files", { paths: [clip, still] });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Imported 2 files into bin "Zenvi Imports" (created bin Zenvi Imports)');
    const items = receipt.data.items as { path: string; status: string; node_id: string }[];
    expect(items.map((item) => item.status)).toEqual(["imported", "imported"]);
    const bin = fx.mock.project.rootItem.childList.find((item) => item.name === "Zenvi Imports");
    expect(bin?.childList.map((item) => item.nodeId)).toEqual(items.map((item) => item.node_id));
    expect(fx.mock.state.calls).toContain("importFiles(shot.mov, logo.png, true, Zenvi Imports, false)");
    // createBin + importFiles, measured from the undo stack.
    expect(receipt.undoSteps).toBe(fx.mock.state.undoIndex - before);
    expect(receipt.undoSteps).toBe(2);
  });

  test("dedupe returns the existing item instead of importing again; all known is unchanged", () => {
    const fx = loadPremiere();
    const clip = fx.file("shot.mov");
    const fresh = fx.file("new.wav");
    const existing = fx.mock.project.addMedia("shot.mov", clip);
    const mixed = fx.call("premiere_import_files", { paths: [clip, fresh], bin: "Audio/Music" });
    expect(mixed.status).toBe("applied");
    expect(mixed.data.items).toEqual([
      { path: clip, status: "existing", node_id: existing.nodeId, name: "shot.mov" },
      expect.objectContaining({ path: fresh, status: "imported" }),
    ]);
    expect(mixed.data.created_bins).toEqual(["Audio", "Audio/Music"]);
    const again = fx.call("premiere_import_files", { paths: [clip, fresh, clip] });
    expect(again).toMatchObject({ status: "unchanged", undoSteps: 0 });
    expect(again.summary).toBe("All 2 files are already in the project");
  });

  test("missing files are refused before anything is imported", () => {
    const fx = loadPremiere();
    const clip = fx.file("shot.mov");
    const receipt = fx.call("premiere_import_files", { paths: [clip, "/nope/missing.mov"] });
    expect(receipt.error).toMatchObject({ code: "NOT_FOUND" });
    expect(receipt.summary).toContain("1 file not found, nothing imported: /nope/missing.mov");
    expect(fx.mock.state.calls).toEqual([]);
    expect(fx.mock.project.rootItem.childList).toEqual([]);
  });

  test("a file Premiere does not take is reported", () => {
    const fx = loadPremiere();
    const clip = fx.file("shot.mov");
    const odd = fx.file("notes.xyz");
    fx.mock.project.importFiles = function (paths: unknown, ...rest: unknown[]) {
      return Object.getPrototypeOf(this).importFiles.call(this, Array.from(paths as string[]).filter((p) => p.endsWith(".mov")), ...rest);
    };
    const receipt = fx.call("premiere_import_files", { paths: [clip, odd] });
    expect(receipt.status).toBe("applied");
    expect((receipt.data.items as { status: string }[]).map((item) => item.status)).toEqual(["imported", "failed"]);
    expect(receipt.warnings.join(" ")).toContain(`Premiere did not import ${odd}`);
  });
});

describe("premiere_save_project", () => {
  test("saves in place", () => {
    const fx = loadPremiere();
    fx.mock.project.path = path.join(fx.dir, "trip.prproj");
    fx.mock.project.name = "trip.prproj";
    expect(fx.call("premiere_save_project")).toMatchObject({ status: "applied", summary: 'Saved project "trip.prproj"', undoSteps: 0 });
    expect(fx.mock.state.calls).toEqual(["save()"]);
  });

  test("save as writes the copy and reports the new path", () => {
    const fx = loadPremiere();
    fx.mock.project.path = path.join(fx.dir, "trip.prproj");
    const target = path.join(fx.dir, "copies", "trip v2.prproj");
    const receipt = fx.call("premiere_save_project", { path: target });
    expect(receipt).toMatchObject({ status: "applied", data: { path: target, previous_path: path.join(fx.dir, "trip.prproj"), saved_as: true } });
    expect(existsSync(target)).toBe(true);
  });

  test("refuses a non-.prproj path and an existing file", () => {
    const fx = loadPremiere();
    expect(fx.call("premiere_save_project", { path: path.join(fx.dir, "trip.mov") }).error?.code).toBe("INVALID_ARGUMENT");
    const taken = fx.file("other.prproj");
    expect(fx.call("premiere_save_project", { path: taken }).summary).toContain("already exists");
  });
});
