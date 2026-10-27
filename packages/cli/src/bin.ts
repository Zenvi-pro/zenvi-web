#!/usr/bin/env node
/** `zenvi` entry point. */
import { runCli } from "./program.js";

// `zenvi … | head` closes the pipe before the output ends: stop quietly, as Unix tools do, instead of crashing on EPIPE.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
    process.exit(process.exitCode ?? 0);
  });
}

runCli({ args: process.argv.slice(2) }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`zenvi: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
