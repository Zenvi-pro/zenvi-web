import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "acorn";
import { describe, expect, test } from "vitest";
import { PACKAGE_ROOT } from "./host-bundle.js";

const EXTENSION = path.join(PACKAGE_ROOT, "extension");

function files(dir: string, extensions: string[]): string[] {
  return readdirSync(path.join(EXTENSION, dir))
    .filter((name) => extensions.some((extension) => name.endsWith(extension)))
    .map((name) => `${dir}/${name}`);
}

const scripts = [...files("server", [".js"]), ...files("panel", [".js"])];
const text = [...scripts, ...files("server", [".html"]), ...files("panel", [".html", ".css"]), "CSXS/manifest.xml", ".debug", "package.json"];

describe("CEP sources", () => {
  test.each(scripts)("%s is ES2017 (CEP's embedded Node and Chromium)", (file) => {
    expect(() => parse(readFileSync(path.join(EXTENSION, file), "utf8"), { ecmaVersion: 2017, sourceType: "script" })).not.toThrow();
  });

  test.each(text)("%s is ASCII", (file) => {
    const lines = readFileSync(path.join(EXTENSION, file), "utf8").split("\n");
    const line = lines.findIndex((candidate) => /[\u0080-\uffff]/.test(candidate));
    expect(line, `${file}:${line + 1}`).toBe(-1);
  });

  test("extension/package.json makes the .js files CommonJS wherever the folder is installed", () => {
    expect(JSON.parse(readFileSync(path.join(EXTENSION, "package.json"), "utf8"))).toEqual({ private: true, type: "commonjs" });
  });
});

describe("manifest.xml", () => {
  const manifest = readFileSync(path.join(EXTENSION, "CSXS", "manifest.xml"), "utf8");

  test("is well-formed (balanced tags)", () => {
    const stack: string[] = [];
    const body = manifest.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
    for (const match of body.matchAll(/<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g)) {
      const [, closing, name, , selfClosing] = match;
      if (selfClosing) continue;
      if (closing) expect(stack.pop(), `</${name}>`).toBe(name);
      else stack.push(name as string);
    }
    expect(stack).toEqual([]);
  });

  test("bundle pro.zenvi.link with a service and a panel for AEFT 18+ and PPRO 15+ on CSXS 9", () => {
    expect(manifest).toContain('ExtensionBundleId="pro.zenvi.link"');
    expect(manifest).toContain('<Extension Id="pro.zenvi.link.service" Version="__VERSION__" />');
    expect(manifest).toContain('<Extension Id="pro.zenvi.link.panel" Version="__VERSION__" />');
    expect(manifest).toContain('<Host Name="AEFT" Version="[18.0,99.9]" />');
    expect(manifest).toContain('<Host Name="PPRO" Version="[15.0,99.9]" />');
    expect(manifest).toContain('<RequiredRuntime Name="CSXS" Version="9.0" />');
  });

  test("each extension loads its host script per app, with Node enabled", () => {
    const dispatches = [...manifest.matchAll(/<DispatchInfo Host="(\w+)">([\s\S]*?)<\/DispatchInfo>/g)];
    expect(dispatches).toHaveLength(4);
    for (const [, host, body] of dispatches) {
      expect(body).toContain(`<ScriptPath>./host/${host === "AEFT" ? "aeft" : "ppro"}.jsx</ScriptPath>`);
      for (const flag of ["--enable-nodejs", "--mixed-context", "--allow-file-access", "--allow-file-access-from-files"]) {
        expect(body).toContain(`<Parameter>${flag}</Parameter>`);
      }
    }
  });

  test("the service is invisible and starts on activation; the panel is Window > Extensions > Zenvi Link, min 280x300", () => {
    const service = /<Extension Id="pro.zenvi.link.service">([\s\S]*?)<\/Extension>/.exec(manifest)?.[1] ?? "";
    const panel = /<Extension Id="pro.zenvi.link.panel">([\s\S]*?)<\/Extension>/.exec(manifest)?.[1] ?? "";
    expect(service).toContain("<Type>Custom</Type>");
    expect(service).toContain("<AutoVisible>false</AutoVisible>");
    expect(service).toContain("<Event>com.adobe.csxs.events.ApplicationActivate</Event>");
    expect(service).toContain("<Event>applicationActivate</Event>");
    expect(service).toContain("<MainPath>./server/service.html</MainPath>");
    expect(panel).toContain("<Type>Panel</Type>");
    expect(panel).toContain("<Menu>Zenvi Link</Menu>");
    expect(panel).toMatch(/<MinSize>\s*<Height>300<\/Height>\s*<Width>280<\/Width>\s*<\/MinSize>/);
    expect(panel).toContain("<MainPath>./panel/index.html</MainPath>");
  });

  test(".debug opens remote debugging on ports 8088-8091", () => {
    const debug = readFileSync(path.join(EXTENSION, ".debug"), "utf8");
    expect([...debug.matchAll(/Port="(\d+)"/g)].map((match) => match[1])).toEqual(["8088", "8089", "8090", "8091"]);
  });
});
