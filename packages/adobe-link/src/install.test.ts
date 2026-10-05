import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { BUNDLE_ID, describeAction, planExtensionInstall, replaceInstall, runInstallAction, runInstallPlan, systemCommand, systemExtensionsDirs } from "./install.js";

function temp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "zenvi-link-install-"));
}

describe("planExtensionInstall", () => {
  test("installs a built extension without a build step (what the CLI ships)", () => {
    const plan = planExtensionInstall({ platform: "darwin", home: "/Users/me", source: "/opt/zenvi/adobe/pro.zenvi.link", copy: true });
    expect(plan.target).toBe(`/Users/me/Library/Application Support/Adobe/CEP/extensions/${BUNDLE_ID}`);
    expect(plan.actions.map(describeAction).slice(0, 3)).toEqual([
      `remove ${plan.target}`,
      `copy /opt/zenvi/adobe/pro.zenvi.link -> ${plan.target}`,
      "run defaults write com.adobe.CSXS.9 PlayerDebugMode 1",
    ]);
    expect(plan.actions.some((action) => action.kind === "build")).toBe(false);
  });

  test("Windows defaults %APPDATA% under the home folder", () => {
    const plan = planExtensionInstall({ platform: "win32", home: "C:\\Users\\me", source: "C:\\z\\pro.zenvi.link" });
    expect(plan.target).toBe("C:\\Users\\me\\AppData\\Roaming\\Adobe\\CEP\\extensions\\pro.zenvi.link");
    expect(plan.actions[1]).toMatchObject({ kind: "link", type: "junction" });
  });
});

test("system extension folders: macOS /Library, Windows Common Files (both Program Files)", () => {
  expect(systemExtensionsDirs("darwin")).toEqual(["/Library/Application Support/Adobe/CEP/extensions"]);
  expect(systemExtensionsDirs("win32", { ProgramFiles: "D:\\PF", "ProgramFiles(x86)": "D:\\PF86" })).toEqual([
    "D:\\PF86\\Common Files\\Adobe\\CEP\\extensions",
    "D:\\PF\\Common Files\\Adobe\\CEP\\extensions",
  ]);
  expect(systemExtensionsDirs("linux")).toEqual([]);
});

describe("runInstallAction", () => {
  test("copy replaces an installed folder; remove deletes a link but not what it points to", () => {
    const root = temp();
    const source = path.join(root, "build", BUNDLE_ID);
    mkdirSync(path.join(source, "CSXS"), { recursive: true });
    writeFileSync(path.join(source, "CSXS", "manifest.xml"), "<new/>");
    const target = path.join(root, "home", "extensions", BUNDLE_ID);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "stale.txt"), "old");
    for (const action of planExtensionInstall({ platform: "darwin", home: root, source, copy: true }).actions.slice(0, 2)) {
      runInstallAction({ ...action, ...(action.kind === "remove" ? { path: target } : action.kind === "copy" ? { to: target } : {}) } as typeof action);
    }
    expect(readFileSync(path.join(target, "CSXS", "manifest.xml"), "utf8")).toBe("<new/>");
    expect(existsSync(path.join(target, "stale.txt"))).toBe(false);

    const linked = path.join(root, "linked");
    runInstallAction({ kind: "link", from: source, to: linked, type: "dir" });
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
    runInstallAction({ kind: "remove", path: linked });
    expect(existsSync(linked)).toBe(false);
    expect(existsSync(path.join(source, "CSXS", "manifest.xml"))).toBe(true);
  });

  test("a failing command throws; deleting an absent value does not", () => {
    expect(() => runInstallAction({ kind: "run", command: process.execPath, args: ["-e", "process.exit(3)"] })).toThrow(/failed \(exit 3\)/);
    expect(() => runInstallAction({ kind: "run", command: process.execPath, args: ["-e", "process.exit(1)", "delete"] })).not.toThrow();
    expect(() => runInstallAction({ kind: "build", outDir: "/x" })).toThrow(/does not build/);
  });
});

describe("runInstallPlan (replace in place)", () => {
  function built(root: string, text: string): string {
    const dir = path.join(root, `build-${text}`, BUNDLE_ID);
    mkdirSync(path.join(dir, "CSXS"), { recursive: true });
    writeFileSync(path.join(dir, "CSXS", "manifest.xml"), text);
    return dir;
  }

  test("a new copy replaces the old one, leaving no staging folders", () => {
    const root = temp();
    const target = path.join(root, "extensions", BUNDLE_ID);
    runInstallPlan([{ kind: "remove", path: target }, { kind: "copy", from: built(root, "v1"), to: target }]);
    runInstallPlan([{ kind: "remove", path: target }, { kind: "copy", from: built(root, "v2"), to: target }]);
    expect(readFileSync(path.join(target, "CSXS", "manifest.xml"), "utf8")).toBe("v2");
    expect(readdirSync(path.dirname(target))).toEqual([BUNDLE_ID]);
  });

  test("a failed copy keeps the previous install (no remove-then-fail)", () => {
    const root = temp();
    const target = path.join(root, "extensions", BUNDLE_ID);
    runInstallPlan([{ kind: "remove", path: target }, { kind: "copy", from: built(root, "v1"), to: target }]);
    expect(() => runInstallPlan([{ kind: "remove", path: target }, { kind: "copy", from: path.join(root, "missing"), to: target }])).toThrow();
    expect(readFileSync(path.join(target, "CSXS", "manifest.xml"), "utf8")).toBe("v1");
    expect(readdirSync(path.dirname(target))).toEqual([BUNDLE_ID]);
  });

  test("refuses to install the installed copy over itself; a dev link to the build can be replaced", () => {
    const root = temp();
    const target = path.join(root, "extensions", BUNDLE_ID);
    runInstallPlan([{ kind: "remove", path: target }, { kind: "copy", from: built(root, "v1"), to: target }]);
    expect(() => replaceInstall({ kind: "copy", from: target, to: target })).toThrow(/is the installed copy itself/);
    expect(readFileSync(path.join(target, "CSXS", "manifest.xml"), "utf8")).toBe("v1");
    const build = built(root, "dev");
    runInstallPlan([{ kind: "remove", path: target }, { kind: "link", from: build, to: target, type: "dir" }]);
    runInstallPlan([{ kind: "remove", path: target }, { kind: "link", from: build, to: target, type: "dir" }]);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(build, "CSXS", "manifest.xml"), "utf8")).toBe("dev");
  });
});

test("system commands run by absolute path (no same-named program from the current folder)", () => {
  expect(systemCommand("reg", "win32", { SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\reg.exe");
  expect(systemCommand("REG", "win32", {})).toBe("C:\\Windows\\System32\\reg.exe");
  expect(systemCommand("defaults", "darwin")).toBe("/usr/bin/defaults");
  expect(systemCommand("mdfind", "darwin")).toBe("/usr/bin/mdfind");
  expect(systemCommand(process.execPath, "win32")).toBe(process.execPath);
  expect(systemCommand("defaults", "linux")).toBe("defaults");
});
