/**
 * After Effects tool tests in one line: a fresh temp folder, the mock DOM,
 * and the real host script. `call` dispatches like CEP's evalScript does;
 * `callValidated` first runs the arguments through the host server's catalog
 * validation and default filling, exactly as `tools/call` does.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AE_TOOLS } from "../catalog/aftereffects.js";
import { inputSchemaFor } from "../catalog/types.js";
import type { HostReceipt } from "../receipt.js";
import { createAeMock, type AeMock, type AeMockOptions } from "./ae-mock.js";
import { loadHostScript, type LoadedHostScript } from "./host-script.js";
import { schemaModule } from "./link-server.js";

export interface AeHarness {
  mock: AeMock;
  host: LoadedHostScript;
  /** This test's temp folder (also `Folder.temp` and `~`). */
  dir: string;
  call(name: string, args?: Record<string, unknown>): HostReceipt;
  /** Validate and default `args` against the catalog schema, then call. Throws when the schema refuses them. */
  callValidated(name: string, args?: Record<string, unknown>): HostReceipt;
  /** Write a file in the temp folder; returns its absolute path. */
  file(name: string, content?: string | Buffer): string;
}

export function aeHarness(options: AeMockOptions = {}): AeHarness {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zenvi-link-ae-"));
  const mock = createAeMock({ tempDir: dir, ...options });
  const host = loadHostScript("aeft", mock.globals);
  const call = (name: string, args: Record<string, unknown> = {}): HostReceipt => host.dispatch(name, args);
  return {
    mock,
    host,
    dir,
    call,
    callValidated(name, args = {}) {
      const def = AE_TOOLS.find((tool) => tool.name === name);
      if (!def) throw new Error(`${name} is not in the After Effects catalog`);
      const result = schemaModule.validateArguments(inputSchemaFor(def), args);
      if (!result.ok) throw new Error(`catalog schema refused ${name} arguments: ${result.message}`);
      return call(name, result.args);
    },
    file(name, content = "x") {
      const file = path.join(dir, name);
      writeFileSync(file, content);
      return file;
    },
  };
}
