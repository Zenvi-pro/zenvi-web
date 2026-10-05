import path from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";
import { PACKAGE_ROOT, hostSources } from "../host-bundle.js";

/** `npm run typecheck:jsx:ppro` as a test, so the suite catches wrong DOM names too. */
test("the Premiere host scripts type-check against types-for-adobe Premiere/24.0", () => {
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(PACKAGE_ROOT, "tsconfig.jsx-ppro.json"), {}, host);
  if (!parsed) throw new Error("tsconfig.jsx-ppro.json did not parse");
  const scripts = parsed.fileNames.filter((file) => file.endsWith(".jsx")).map((file) => path.relative(path.join(PACKAGE_ROOT, "extension", "host"), file));
  expect(scripts.sort()).toEqual(hostSources("ppro").filter((source) => source.file.startsWith("ppro/")).map((source) => source.file).sort());
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const problems = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : null;
    return `${diagnostic.file ? path.relative(PACKAGE_ROOT, diagnostic.file.fileName) : "?"}:${where ? where.line + 1 : 0} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });
  expect(problems).toEqual([]);
}, 120_000);
