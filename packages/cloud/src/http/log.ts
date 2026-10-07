/**
 * Structured JSON logs on stdout (Azure Container Apps ships them to Log
 * Analytics). Never log tokens, codes, query strings or signed URLs.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel = "info", write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const emit = (at: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[at] < ORDER[level]) return;
    write(JSON.stringify({ t: new Date().toISOString(), level: at, msg: message, ...fields }));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
