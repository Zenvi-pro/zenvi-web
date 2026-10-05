/**
 * The ExtendScript globals both Adobe hosts share: `$`, `File` and `Folder`.
 * `File`/`Folder` work on the real file system (tests point them at a
 * `fs.mkdtemp` folder), with ExtendScript's naming: `fsName` is the
 * platform path, `name` and `path` are URI-encoded, `displayName` is not.
 * Both can be called with or without `new`, as in ExtendScript.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RealmLink } from "./realm.js";

export interface ExtendScriptMockOptions {
  /** `$.os` / `File.fs` flavour (default "mac"); paths always use this machine's file system. */
  os?: "mac" | "windows";
  /** `Folder.temp`. Use a per-test `fs.mkdtemp` folder. Default: os.tmpdir(). */
  tempDir?: string;
  /** `~`, `Folder.userData`, `Folder.myDocuments`, `Folder.desktop`. Default: tempDir. */
  homeDir?: string;
  /** What `$.getenv` returns (nothing from the real environment leaks in). */
  env?: Record<string, string>;
}

/** Shared by `File` and `Folder`. */
export class FsEntryMock {
  readonly fsName: string;
  error = "";

  constructor(
    protected readonly es: ExtendScriptMockState,
    target: string,
  ) {
    this.fsName = es.resolve(target);
  }

  get fullName(): string {
    return this.fsName.split(path.sep).join("/");
  }

  get absoluteURI(): string {
    return encodeURI(this.fullName);
  }

  /** URI-encoded base name, as ExtendScript returns it. */
  get name(): string {
    return encodeURIComponent(path.basename(this.fsName));
  }

  get displayName(): string {
    return path.basename(this.fsName);
  }

  /** URI-encoded parent folder path. */
  get path(): string {
    return encodeURI(path.dirname(this.fullName));
  }

  get parent(): FolderMock {
    return this.es.makeFolder(path.dirname(this.fsName));
  }

  get exists(): boolean {
    return existsSync(this.fsName);
  }

  get modified(): Date | null {
    return this.exists ? statSync(this.fsName).mtime : null;
  }

  rename(newName: string): boolean {
    try {
      renameSync(this.fsName, path.join(path.dirname(this.fsName), newName));
      return true;
    } catch (error) {
      this.error = String(error);
      return false;
    }
  }

  toString(): string {
    return this.absoluteURI;
  }
}

export class FileMock extends FsEntryMock {
  encoding = "UTF-8";
  lineFeed = "Unix";
  private mode: string | undefined;
  private buffer = "";
  private position = 0;

  get length(): number {
    return this.exists ? statSync(this.fsName).size : 0;
  }

  get eof(): boolean {
    return this.position >= this.buffer.length;
  }

  open(mode = "r"): boolean {
    this.mode = mode;
    this.position = 0;
    if (mode === "w") {
      this.buffer = "";
      return true;
    }
    if (!this.exists) {
      this.buffer = "";
      return mode === "e" || mode === "a";
    }
    // encoding "BINARY" keeps one character per byte, as in ExtendScript.
    this.buffer = readFileSync(this.fsName, /^binary$/i.test(this.encoding) ? "latin1" : "utf8");
    if (mode === "a") this.position = this.buffer.length;
    return true;
  }

  read(chars?: number): string {
    const end = chars === undefined ? this.buffer.length : this.position + chars;
    const text = this.buffer.slice(this.position, end);
    this.position = Math.min(end, this.buffer.length);
    return text;
  }

  /** Move the read position: mode 0 from the start (default), 1 from the current position, 2 from the end. */
  seek(pos: number, mode = 0): boolean {
    const base = mode === 1 ? this.position : mode === 2 ? this.buffer.length : 0;
    const target = base + pos;
    if (this.mode === undefined || target < 0 || target > this.buffer.length) return false;
    this.position = target;
    return true;
  }

  tell(): number {
    return this.position;
  }

  readln(): string {
    const newline = this.buffer.indexOf("\n", this.position);
    const end = newline < 0 ? this.buffer.length : newline;
    const line = this.buffer.slice(this.position, end).replace(/\r$/, "");
    this.position = newline < 0 ? this.buffer.length : newline + 1;
    return line;
  }

  write(...texts: unknown[]): boolean {
    if (this.mode === undefined || this.mode === "r") return false;
    this.buffer += texts.map(String).join("");
    return true;
  }

  writeln(...texts: unknown[]): boolean {
    return this.write(...texts, "\n");
  }

  close(): boolean {
    if (this.mode === "w" || this.mode === "e" || this.mode === "a") writeFileSync(this.fsName, this.buffer, /^binary$/i.test(this.encoding) ? "latin1" : "utf8");
    this.mode = undefined;
    return true;
  }

  copy(target: string | FsEntryMock): boolean {
    try {
      copyFileSync(this.fsName, typeof target === "string" ? this.es.resolve(target) : target.fsName);
      return true;
    } catch (error) {
      this.error = String(error);
      return false;
    }
  }

  remove(): boolean {
    try {
      unlinkSync(this.fsName);
      return true;
    } catch (error) {
      this.error = String(error);
      return false;
    }
  }

  /** Opening a file with its default app: recorded, not run. */
  execute(): boolean {
    this.es.executed.push(this.fsName);
    return true;
  }
}

export class FolderMock extends FsEntryMock {
  create(): boolean {
    mkdirSync(this.fsName, { recursive: true });
    return true;
  }

  /** Entries, optionally filtered by a `*.ext` style mask. */
  getFiles(mask?: string): FsEntryMock[] {
    if (!this.exists) return [];
    const pattern = mask ? new RegExp(`^${mask.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i") : undefined;
    return readdirSync(this.fsName)
      .filter((name) => !pattern || pattern.test(name))
      .map((name) => {
        const full = path.join(this.fsName, name);
        return statSync(full).isDirectory() ? this.es.makeFolder(full) : this.es.makeFile(full);
      });
  }

  /** ExtendScript only removes empty folders. */
  remove(): boolean {
    try {
      rmdirSync(this.fsName);
      return true;
    } catch (error) {
      this.error = String(error);
      return false;
    }
  }
}

/** Per-mock state behind `$`, `File` and `Folder`. */
export class ExtendScriptMockState {
  readonly log: string[] = [];
  readonly executed: string[] = [];
  /** Called on every `$.sleep` (mocks finish asynchronous host work there, e.g. a frame still being written). */
  readonly sleepHooks: (() => void)[] = [];
  /** Total milliseconds scripts asked `$.sleep` for. */
  sleptMs = 0;
  readonly link = new RealmLink();
  readonly tempDir: string;
  readonly homeDir: string;
  /** Entries created internally (parent, getFiles) come from the realm's own classes, so instanceof File/Folder holds. */
  makeFile: (target: string) => FileMock = (target) => new FileMock(this, target);
  makeFolder: (target: string) => FolderMock = (target) => new FolderMock(this, target);

  constructor(readonly options: ExtendScriptMockOptions) {
    this.tempDir = options.tempDir ?? os.tmpdir();
    this.homeDir = options.homeDir ?? this.tempDir;
  }

  /** ExtendScript path (`~/x`, URI-encoded, relative) → absolute platform path. */
  resolve(target: string): string {
    let value = String(target);
    try {
      value = decodeURI(value);
    } catch {
      // Not URI-encoded: use as is.
    }
    if (value === "~" || value.startsWith("~/")) value = path.join(this.homeDir, value.slice(1));
    return path.resolve(value);
  }
}

/** ExtendScript preprocessor directive lines: #target, #targetengine, #include, #includepath, #strict, #script. */
const DIRECTIVE_LINE = /^[ \t]*#(?:target|targetengine|include|includepath|strict|script)\b[^\r\n]*/gm;

/** Source with its preprocessor directive lines blanked (line numbers unchanged). */
export function stripDirectives(source: string): string {
  return source.replace(DIRECTIVE_LINE, "");
}

export class DollarMock {
  os: string;
  version = "4.5.5";
  engineName = "main";
  level = 0;
  fileName = "";
  line = 0;
  locale = "en_US";

  constructor(private readonly es: ExtendScriptMockState) {
    this.os = es.options.os === "windows" ? "Windows/64 10.0.22631" : "Macintosh OS 15.6.0/64";
  }

  writeln(...texts: unknown[]): void {
    this.es.log.push(texts.map(String).join(""));
  }

  write(...texts: unknown[]): void {
    this.es.log.push(texts.map(String).join(""));
  }

  /**
   * Runs the file in the script realm and returns its completion value, like
   * ExtendScript. The engine consumes preprocessor directives itself
   * (`#target aftereffects` opens every Zenvi export), so their lines are
   * blanked, keeping line numbers. `#include` is not followed here.
   */
  evalFile(file: string | FsEntryMock, _timeout?: number): unknown {
    const target = typeof file === "string" ? this.es.resolve(file) : file.fsName;
    return this.es.link.evaluate(stripDirectives(readFileSync(target, "utf8")), target);
  }

  get global(): Record<string, unknown> | undefined {
    return this.es.link.global;
  }

  getenv(name: string): string | null {
    return this.es.options.env?.[name] ?? null;
  }

  sleep(milliseconds: number): void {
    this.es.sleptMs += milliseconds;
    for (const hook of [...this.es.sleepHooks]) hook();
  }

  gc(): void {}
}

/** ExtendScript's `File`: callable with or without `new`. */
export interface FileConstructorMock {
  new (target?: string): FileMock;
  (target?: string): FileMock;
  readonly fs: string;
  decode(text: string): string;
  encode(text: string): string;
}

/** ExtendScript's `Folder`: callable with or without `new`. */
export interface FolderConstructorMock {
  new (target?: string): FolderMock;
  (target?: string): FolderMock;
  readonly fs: string;
  readonly temp: FolderMock;
  readonly userData: FolderMock;
  readonly myDocuments: FolderMock;
  readonly desktop: FolderMock;
  readonly current: FolderMock;
}

export interface ExtendScriptMock {
  state: ExtendScriptMockState;
  $: DollarMock;
  File: FileConstructorMock;
  Folder: FolderConstructorMock;
}

/** `$`, `File` and `Folder` for one host realm. */
export function createExtendScriptMock(options: ExtendScriptMockOptions = {}): ExtendScriptMock {
  const state = new ExtendScriptMockState(options);
  const fs = options.os === "windows" ? "Windows" : "Macintosh";

  class File extends FileMock {
    static fs = fs;
    constructor(target?: string) {
      super(state, target ?? ".");
    }
    static decode(text: string): string {
      return decodeURIComponent(text);
    }
    static encode(text: string): string {
      return encodeURI(text);
    }
  }

  class Folder extends FolderMock {
    static fs = fs;
    constructor(target?: string) {
      super(state, target ?? ".");
    }
    static get temp(): Folder {
      return new Folder(state.tempDir);
    }
    static get userData(): Folder {
      return new Folder(state.homeDir);
    }
    static get myDocuments(): Folder {
      return new Folder(state.homeDir);
    }
    static get desktop(): Folder {
      return new Folder(state.homeDir);
    }
    static get current(): Folder {
      return new Folder(state.tempDir);
    }
  }

  state.makeFile = (target) => new File(target);
  state.makeFolder = (target) => new Folder(target);

  // ExtendScript allows `File(path)` as well as `new File(path)`.
  const callable = <T extends new (target?: string) => unknown>(cls: T): unknown =>
    new Proxy(cls, {
      apply(target, _this, args: [string?]) {
        return new target(...args);
      },
    });

  return {
    state,
    $: new DollarMock(state),
    File: callable(File) as FileConstructorMock,
    Folder: callable(Folder) as FolderConstructorMock,
  };
}
