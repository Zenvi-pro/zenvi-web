/**
 * A minimal Premiere Pro DOM for running the host scripts under Node
 * (`loadHostScript("ppro", mock.globals)`). It follows the Premiere Pro
 * ExtendScript DOM's names: 0-based collections with `numItems` /
 * `numSequences` / `numTracks`, times as `Time` objects whose `ticks` is a
 * string (254016000000 per second), nodeIds and sequenceIDs as strings.
 * `qe` is a recording stub that appears once `app.enableQE()` ran.
 *
 * Grow it with the tools: add the members a new tool touches, with the real
 * names and behaviour.
 */

import { BIND_REALM, type HostGlobals, type Realm } from "./realm.js";
import { createExtendScriptMock, type ExtendScriptMock, type ExtendScriptMockOptions } from "./extendscript-mock.js";

export const TICKS_PER_SECOND = 254016000000;

/** Whole ticks for `seconds`, as Premiere's string. */
export function ticks(seconds: number): string {
  return String(Math.round(seconds * TICKS_PER_SECOND));
}

/** Premiere's Time: `ticks` (string) is the truth, `seconds` a float view. Both are writable. */
export class Time {
  private value = 0;

  get ticks(): string {
    return String(this.value);
  }

  set ticks(value: string) {
    this.value = Math.round(Number(value));
  }

  get seconds(): number {
    return this.value / TICKS_PER_SECOND;
  }

  set seconds(value: number) {
    this.value = Math.round(value * TICKS_PER_SECOND);
  }

  static fromSeconds(seconds: number): Time {
    const time = new Time();
    time.seconds = seconds;
    return time;
  }
}

export const ProjectItemType = { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 } as const;

/** 0-based collection: `[i]` plus a count property (`numItems`, `numTracks`, …). */
function zeroBased<T extends object>(target: T, list: () => readonly unknown[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) return list()[Number(prop)];
      return Reflect.get(obj, prop, receiver);
    },
  });
}

export class PremiereMockState {
  private nextNode = 1000;
  private nextSequence = 1;
  /** Every `qe` call, as "method(args)". */
  readonly qeCalls: string[] = [];
  qeEnabled = false;

  constructor(readonly es: ExtendScriptMock) {}

  nodeId(): string {
    this.nextNode += 1;
    return `000f${this.nextNode.toString(16).padStart(4, "0")}`;
  }

  sequenceId(): string {
    const n = this.nextSequence++;
    return `5a7b0c1d-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  }

  array<T>(items: readonly T[]): T[] {
    return this.es.state.link.array(items);
  }
}

export class ProjectItemCollection {
  constructor(private readonly owner: ProjectItem) {}

  get numItems(): number {
    return this.owner.childList.length;
  }

  get length(): number {
    return this.owner.childList.length;
  }
}

export class ProjectItem {
  readonly nodeId: string;
  readonly childList: ProjectItem[] = [];
  readonly children: ProjectItemCollection;
  parent: ProjectItem | null = null;
  mediaPath = "";
  inPoint = new Time();
  outPoint = new Time();
  colorLabel = 0;
  sequence: Sequence | null = null;

  constructor(
    protected readonly mock: PremiereMockState,
    public name: string,
    public type: number,
  ) {
    this.nodeId = mock.nodeId();
    this.children = zeroBased(new ProjectItemCollection(this), () => this.childList);
  }

  get treePath(): string {
    return this.parent ? `${this.parent.treePath}\\${this.name}` : `\\${this.name}`;
  }

  addChild(item: ProjectItem): ProjectItem {
    item.parent = this;
    this.childList.push(item);
    return item;
  }

  createBin(name: string): ProjectItem {
    return this.addChild(new ProjectItem(this.mock, name, ProjectItemType.BIN));
  }

  getMediaPath(): string {
    return this.mediaPath;
  }

  getInPoint(): Time {
    return this.inPoint;
  }

  getOutPoint(): Time {
    return this.outPoint;
  }

  isSequence(): boolean {
    return this.sequence !== null;
  }

  getColorLabel(): number {
    return this.colorLabel;
  }

  setColorLabel(label: number): void {
    this.colorLabel = label;
  }
}

export class TrackItem {
  readonly nodeId: string;
  start: Time;
  end: Time;
  inPoint: Time;
  outPoint: Time;
  disabled = false;
  selected = false;
  readonly type = 1;

  constructor(
    mock: PremiereMockState,
    public name: string,
    readonly projectItem: ProjectItem,
    readonly mediaType: "Video" | "Audio",
    startSeconds: number,
    endSeconds: number,
    inSeconds = 0,
  ) {
    this.nodeId = mock.nodeId();
    this.start = Time.fromSeconds(startSeconds);
    this.end = Time.fromSeconds(endSeconds);
    this.inPoint = Time.fromSeconds(inSeconds);
    this.outPoint = Time.fromSeconds(inSeconds + endSeconds - startSeconds);
  }

  get duration(): Time {
    const time = new Time();
    time.ticks = String(Number(this.end.ticks) - Number(this.start.ticks));
    return time;
  }

  isSelected(): boolean {
    return this.selected;
  }

  setSelected(selected: boolean, _updateUI?: boolean): void {
    this.selected = selected;
  }
}

export class TrackItemCollection {
  constructor(private readonly track: Track) {}

  get numItems(): number {
    return this.track.clipList.length;
  }

  get length(): number {
    return this.track.clipList.length;
  }
}

export class Track {
  readonly id: number;
  readonly clipList: TrackItem[] = [];
  readonly clips: TrackItemCollection;
  muted = false;
  locked = false;
  targeted = true;

  constructor(
    private readonly mock: PremiereMockState,
    public name: string,
    readonly mediaType: "Video" | "Audio",
    index: number,
  ) {
    this.id = index;
    this.clips = zeroBased(new TrackItemCollection(this), () => this.clipList);
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMute(muted: number): void {
    this.muted = muted === 1;
  }

  isLocked(): boolean {
    return this.locked;
  }

  setLocked(locked: number): void {
    this.locked = locked === 1;
  }

  isTargeted(): boolean {
    return this.targeted;
  }

  setTargeted(targeted: boolean, _shouldBroadcast?: boolean): void {
    this.targeted = targeted;
  }

  /** Test helper: a clip of `item` on this track from `start` to `end` seconds. */
  addClip(item: ProjectItem, start: number, end: number, inPoint = 0): TrackItem {
    const clip = new TrackItem(this.mock, item.name, item, this.mediaType, start, end, inPoint);
    this.clipList.push(clip);
    this.clipList.sort((a, b) => Number(a.start.ticks) - Number(b.start.ticks));
    return clip;
  }
}

export class TrackCollection {
  constructor(private readonly list: Track[]) {}

  get numTracks(): number {
    return this.list.length;
  }

  get length(): number {
    return this.list.length;
  }
}

export interface MockMarker {
  start: Time;
  end: Time;
  name: string;
  comments: string;
  type: string;
}

export class MarkerCollection {
  readonly list: MockMarker[] = [];

  get numMarkers(): number {
    return this.list.length;
  }

  createMarker(seconds: number): MockMarker {
    const marker: MockMarker = { start: Time.fromSeconds(seconds), end: Time.fromSeconds(seconds), name: "", comments: "", type: "Comment" };
    this.list.push(marker);
    this.list.sort((a, b) => Number(a.start.ticks) - Number(b.start.ticks));
    return marker;
  }

  getFirstMarker(): MockMarker | undefined {
    return this.list[0];
  }

  getNextMarker(marker: MockMarker): MockMarker | undefined {
    return this.list[this.list.indexOf(marker) + 1];
  }
}

export interface SequenceOptions {
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  /** Seconds. */
  duration?: number;
  videoTracks?: number;
  audioTracks?: number;
  /** Make it the active sequence (default true). */
  active?: boolean;
}

export class Sequence {
  readonly sequenceID: string;
  readonly projectItem: ProjectItem;
  frameSizeHorizontal: number;
  frameSizeVertical: number;
  /** Ticks per frame, as a string. */
  timebase: string;
  /** Sequence end in ticks, as a string. */
  end: string;
  readonly videoTrackList: Track[] = [];
  readonly audioTrackList: Track[] = [];
  readonly videoTracks: TrackCollection;
  readonly audioTracks: TrackCollection;
  readonly markers = new MarkerCollection();
  playerPosition = new Time();
  inPoint = new Time();
  outPoint = new Time();

  constructor(
    private readonly mock: PremiereMockState,
    public name: string,
    projectItem: ProjectItem,
    options: SequenceOptions,
  ) {
    this.sequenceID = mock.sequenceId();
    this.projectItem = projectItem;
    this.frameSizeHorizontal = options.width ?? 1920;
    this.frameSizeVertical = options.height ?? 1080;
    this.timebase = String(Math.round(TICKS_PER_SECOND / (options.fps ?? 30)));
    this.end = ticks(options.duration ?? 0);
    this.outPoint = Time.fromSeconds(options.duration ?? 0);
    for (let i = 0; i < (options.videoTracks ?? 3); i += 1) this.videoTrackList.push(new Track(mock, `Video ${i + 1}`, "Video", i));
    for (let i = 0; i < (options.audioTracks ?? 3); i += 1) this.audioTrackList.push(new Track(mock, `Audio ${i + 1}`, "Audio", i));
    this.videoTracks = zeroBased(new TrackCollection(this.videoTrackList), () => this.videoTrackList);
    this.audioTracks = zeroBased(new TrackCollection(this.audioTrackList), () => this.audioTrackList);
  }

  getPlayerPosition(): Time {
    return this.playerPosition;
  }

  setPlayerPosition(tickString: string): void {
    this.playerPosition = new Time();
    this.playerPosition.ticks = tickString;
  }

  getInPointAsTime(): Time {
    return this.inPoint;
  }

  getOutPointAsTime(): Time {
    return this.outPoint;
  }

  setInPoint(seconds: number): void {
    this.inPoint = Time.fromSeconds(seconds);
  }

  setOutPoint(seconds: number): void {
    this.outPoint = Time.fromSeconds(seconds);
  }

  /** Selected clips on every track (a realm Array, like the DOM's). */
  getSelection(): TrackItem[] {
    const all = [...this.videoTrackList, ...this.audioTrackList].flatMap((track) => track.clipList);
    return this.mock.array(all.filter((clip) => clip.selected));
  }

  getSettings(): { videoFrameRate: Time; videoFrameWidth: number; videoFrameHeight: number } {
    const frame = new Time();
    frame.ticks = this.timebase;
    return { videoFrameRate: frame, videoFrameWidth: this.frameSizeHorizontal, videoFrameHeight: this.frameSizeVertical };
  }
}

export class SequenceCollection {
  constructor(private readonly list: Sequence[]) {}

  get numSequences(): number {
    return this.list.length;
  }

  get length(): number {
    return this.list.length;
  }
}

export class PremiereProject {
  name = "Untitled";
  /** Full path of the .prproj; "" until saved. */
  path = "";
  readonly rootItem: ProjectItem;
  readonly sequenceList: Sequence[] = [];
  readonly sequences: SequenceCollection;
  activeSequence: Sequence | null = null;

  constructor(private readonly mock: PremiereMockState) {
    this.rootItem = new ProjectItem(mock, "Root", ProjectItemType.ROOT);
    this.sequences = zeroBased(new SequenceCollection(this.sequenceList), () => this.sequenceList);
  }

  openSequence(sequenceID: string): boolean {
    const sequence = this.sequenceList.find((candidate) => candidate.sequenceID === sequenceID);
    if (!sequence) return false;
    this.activeSequence = sequence;
    return true;
  }

  /** Test helper: a sequence (and its project item in the root bin). */
  addSequence(options: SequenceOptions = {}): Sequence {
    const name = options.name ?? `Sequence ${this.sequenceList.length + 1}`;
    const item = this.rootItem.addChild(new ProjectItem(this.mock, name, ProjectItemType.CLIP));
    const sequence = new Sequence(this.mock, name, item, options);
    item.sequence = sequence;
    this.sequenceList.push(sequence);
    if (options.active !== false) this.activeSequence = sequence;
    return sequence;
  }

  /** Test helper: a media clip item in `bin` (default root). */
  addMedia(name: string, mediaPath: string, durationSeconds = 10, bin: ProjectItem = this.rootItem): ProjectItem {
    const item = bin.addChild(new ProjectItem(this.mock, name, ProjectItemType.CLIP));
    item.mediaPath = mediaPath;
    item.outPoint = Time.fromSeconds(durationSeconds);
    return item;
  }
}

export class PremiereApp {
  version: string;
  build = "64";
  project: PremiereProject;
  documentOpen = true;

  constructor(
    private readonly mock: PremiereMockState,
    version: string,
  ) {
    this.version = version;
    this.project = new PremiereProject(mock);
  }

  isDocumentOpen(): boolean {
    return this.documentOpen;
  }

  /** Defines the `qe` global, like Premiere does. */
  enableQE(): boolean {
    this.mock.qeEnabled = true;
    const realmGlobal = this.mock.es.state.link.global;
    if (realmGlobal) realmGlobal.qe = createQeStub(this.mock, this);
    return true;
  }
}

/**
 * The QE DOM: undocumented and large, so this stub records every call
 * ("project.getActiveSequence()", "sequence.razor(00;00;01;00)") and
 * returns further recording stubs. Tools that read QE values extend it.
 */
export function createQeStub(mock: PremiereMockState, app: PremiereApp): Record<string, unknown> {
  const recorder = (path: string): unknown =>
    new Proxy(function () {}, {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        return recorder(`${path}.${prop}`);
      },
      apply(_target, _this, args: unknown[]) {
        // `args` is a script-realm array (no ES5 methods): copy it first.
        mock.qeCalls.push(`${path}(${Array.from(args, String).join(", ")})`);
        return recorder(`${path}()`);
      },
    });
  return {
    name: "QE",
    project: recorder("project"),
    get activeSequenceName(): string | null {
      return app.project.activeSequence?.name ?? null;
    },
  };
}

export interface PremiereMockOptions extends ExtendScriptMockOptions {
  /** `app.version` (default "26.0.0"). */
  version?: string;
}

export interface PremiereMock {
  /** Pass to loadHostScript("ppro", mock.globals). */
  globals: HostGlobals;
  app: PremiereApp;
  project: PremiereProject;
  state: PremiereMockState;
  es: ExtendScriptMock;
  log: string[];
}

export function createPremiereMock(options: PremiereMockOptions = {}): PremiereMock {
  const es = createExtendScriptMock(options);
  const state = new PremiereMockState(es);
  const globals: HostGlobals = {
    $: es.$,
    File: es.File,
    Folder: es.Folder,
    Time,
    ProjectItemType,
  };
  const app = new PremiereApp(state, options.version ?? "26.0.0");
  globals.app = app;
  globals[BIND_REALM] = (realm: Realm) => es.state.link.bind(realm);
  return { globals, app, project: app.project, state, es, log: es.state.log };
}
