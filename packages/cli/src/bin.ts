#!/usr/bin/env node
/** `zenvi` entry point. */
import { runCli } from "./program.js";

runCli({ args: process.argv.slice(2) }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`zenvi: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
