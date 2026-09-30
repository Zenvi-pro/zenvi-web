/**
 * Printing for people and for programs.
 *
 * `--json` prints exactly one JSON document per command on stdout (contract-3
 * receipts for tool commands). Human output uses color only on a TTY and when
 * NO_COLOR is unset; progress and hints go to stderr so stdout stays clean.
 */

import type { Writable } from "node:stream";

export interface OutputOptions {
  json: boolean;
  quiet?: boolean;
  stdout?: Writable & { isTTY?: boolean };
  stderr?: Writable & { isTTY?: boolean };
  env?: NodeJS.ProcessEnv;
}

export type Style = "bold" | "dim" | "red" | "green" | "yellow" | "cyan";

const CODES: Record<Style, [number, number]> = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
};

export class Output {
  readonly json: boolean;
  readonly quiet: boolean;
  private readonly out: Writable & { isTTY?: boolean };
  private readonly err: Writable & { isTTY?: boolean };
  private readonly color: boolean;

  constructor(options: OutputOptions) {
    this.json = options.json;
    this.quiet = options.quiet ?? false;
    this.out = options.stdout ?? process.stdout;
    this.err = options.stderr ?? process.stderr;
    const env = options.env ?? process.env;
    this.color = Boolean(this.out.isTTY) && !env.NO_COLOR && env.TERM !== "dumb";
  }

  style(text: string, ...styles: Style[]): string {
    if (!this.color) return text;
    return styles.reduce((acc, s) => `\u001b[${CODES[s][0]}m${acc}\u001b[${CODES[s][1]}m`, text);
  }

  /** A line of human output (suppressed in JSON mode). */
  line(text = ""): void {
    if (this.json || this.quiet) return;
    this.out.write(`${text}\n`);
  }

  /** Always-visible diagnostics on stderr (hints, progress, warnings). */
  info(text: string): void {
    if (this.quiet) return;
    this.err.write(`${text}\n`);
  }

  warn(text: string): void {
    this.err.write(`${this.errStyle(`warning: ${text}`, "yellow")}\n`);
  }

  error(text: string): void {
    this.err.write(`${this.errStyle(`error: ${text}`, "red")}\n`);
  }

  private errStyle(text: string, style: Style): string {
    return this.err.isTTY && !process.env.NO_COLOR ? `\u001b[${CODES[style][0]}m${text}\u001b[${CODES[style][1]}m` : text;
  }

  /** The one JSON document of a `--json` run. */
  data(value: unknown): void {
    this.out.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  /** Plain aligned table for human output. */
  table(headers: string[], rows: Array<Array<string | number>>): void {
    if (this.json || this.quiet) return;
    const cells = rows.map((r) => r.map((c) => String(c)));
    const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? "").length)));
    const fmt = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");
    this.out.write(`${this.style(fmt(headers), "bold")}\n`);
    for (const r of cells) this.out.write(`${fmt(r)}\n`);
  }

  /** Progress on stderr, rewriting one line on a TTY. */
  progress(text: string): void {
    if (this.quiet) return;
    if (this.err.isTTY) this.err.write(`\r\u001b[2K${text}`);
  }

  endProgress(): void {
    if (!this.quiet && this.err.isTTY) this.err.write("\r\u001b[2K");
  }
}

/** A failure the CLI reports as `error: …` with an exit code. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;
