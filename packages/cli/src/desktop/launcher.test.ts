import { describe, expect, it } from "vitest";
import { findDesktopApp, launchArgv, parseDesktopExec, splitCommand, WINDOWS_APP_ID, type LauncherDeps } from "./launcher.js";

function deps(over: Partial<LauncherDeps> & { files?: Record<string, string> }): LauncherDeps {
  const files = over.files ?? {};
  return {
    platform: "linux",
    env: { PATH: "/usr/bin:/home/me/.local/bin" },
    home: "/home/me",
    exists: async (f) => f in files,
    readText: async (f) => files[f],
    listDir: async (dir) => Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes("/")).map((f) => f.slice(dir.length + 1)),
    run: async () => ({ code: 1, stdout: "" }),
    spawnDetached: async () => undefined,
    selfPaths: [],
    ...over,
  };
}

describe("command splitting", () => {
  it("handles quotes and escapes like a shell", () => {
    expect(splitCommand(`"/opt/my py/python" src/launch.py --flag 'a b'`)).toEqual(["/opt/my py/python", "src/launch.py", "--flag", "a b"]);
    expect(parseDesktopExec("env FOO=1 /opt/zenvi/zenvi %F")).toEqual(["env", "FOO=1", "/opt/zenvi/zenvi"]);
    expect(parseDesktopExec('flatpak run org.zenvi.Zenvi %U')).toEqual(["flatpak", "run", "org.zenvi.Zenvi"]);
  });
});

describe("findDesktopApp", () => {
  it("honours ZENVI_DESKTOP_CMD (dev checkouts)", async () => {
    const app = await findDesktopApp(deps({ env: { ZENVI_DESKTOP_CMD: "/src/zenvi/.venv/bin/python /src/zenvi/src/launch.py" } }));
    expect(app).toMatchObject({ kind: "override", command: "/src/zenvi/.venv/bin/python", args: ["/src/zenvi/src/launch.py"] });
    expect(launchArgv(app!, "/p/cut.zvn")).toEqual({ command: "/src/zenvi/.venv/bin/python", args: ["/src/zenvi/src/launch.py", "/p/cut.zvn"] });
  });

  it("macOS: Zenvi.app, else Spotlight by bundle id", async () => {
    const inApps = await findDesktopApp(deps({ platform: "darwin", files: { "/Applications/Zenvi.app": "" } }));
    expect(launchArgv(inApps!, "/p/a.zvn")).toEqual({ command: "open", args: ["-a", "/Applications/Zenvi.app", "--args", "/p/a.zvn"] });
    const viaMdfind = await findDesktopApp(
      deps({
        platform: "darwin",
        run: async (command, args) => (command === "mdfind" && args[0]!.includes("org.zenvi.Zenvi") ? { code: 0, stdout: "/Volumes/Apps/Zenvi.app\n" } : { code: 1, stdout: "" }),
      }),
    );
    expect(viaMdfind?.location).toBe("/Volumes/Apps/Zenvi.app");
  });

  it("Windows: the Inno Setup uninstall key's InstallLocation", async () => {
    const app = await findDesktopApp(
      deps({
        platform: "win32",
        env: { ProgramFiles: "C:\\Program Files" },
        files: { "C:\\Users\\me\\AppData\\Local\\Programs\\Zenvi\\zenvi.exe": "" },
        run: async (command, args) =>
          command === "reg" && args[1]!.startsWith("HKCU") && args[1]!.includes(WINDOWS_APP_ID)
            ? { code: 0, stdout: `\r\n${args[1]}\r\n    InstallLocation    REG_SZ    C:\\Users\\me\\AppData\\Local\\Programs\\Zenvi\\\r\n` }
            : { code: 1, stdout: "" },
      }),
    );
    expect(app).toMatchObject({ kind: "windows-exe", command: "C:\\Users\\me\\AppData\\Local\\Programs\\Zenvi\\zenvi.exe" });
    const fromAssoc = await findDesktopApp(
      deps({
        platform: "win32",
        env: {},
        files: { "D:\\Apps\\Zenvi\\zenvi.exe": "" },
        run: async (_c, args) => (args[1]!.startsWith("HKCR") ? { code: 0, stdout: '    (Standard)    REG_SZ    "D:\\Apps\\Zenvi\\zenvi.exe" "%1"\r\n' } : { code: 1, stdout: "" }),
      }),
    );
    expect(fromAssoc?.command).toBe("D:\\Apps\\Zenvi\\zenvi.exe");
    const programFiles = await findDesktopApp(deps({ platform: "win32", env: { ProgramFiles: "C:\\Program Files" }, files: { "C:\\Program Files\\Zenvi\\zenvi.exe": "" } }));
    expect(programFiles?.command).toBe("C:\\Program Files\\Zenvi\\zenvi.exe");
  });

  it("Linux: zenvi-desktop, then an AppImage, then the desktop entry", async () => {
    expect((await findDesktopApp(deps({ files: { "/usr/bin/zenvi-desktop": "#!/bin/sh\n" } })))?.command).toBe("/usr/bin/zenvi-desktop");
    expect((await findDesktopApp(deps({ files: { "/home/me/Applications/Zenvi-1.2.0-x86_64.AppImage": "" } })))?.kind).toBe("linux-appimage");
    const entry = await findDesktopApp(
      deps({ files: { "/usr/share/applications/org.zenvi.Zenvi.desktop": "[Desktop Entry]\nName=Zenvi\nExec=/opt/zenvi/launch.sh %F\n", "/opt/zenvi/launch.sh": "#!/bin/sh\n" } }),
    );
    expect(entry).toMatchObject({ kind: "linux-desktop-entry", command: "/opt/zenvi/launch.sh", args: [] });
  });

  it("never launches this CLI when the desktop entry's `zenvi` resolves to it", async () => {
    const app = await findDesktopApp(
      deps({
        files: {
          "/usr/share/applications/org.zenvi.Zenvi.desktop": "[Desktop Entry]\nExec=zenvi %F\n",
          "/home/me/.local/bin/zenvi": "#!/usr/bin/env node\nimport './zenvi.mjs'\n",
        },
      }),
    );
    expect(app).toBeUndefined();
  });
});
