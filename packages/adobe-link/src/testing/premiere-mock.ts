/**
 * A Premiere Pro DOM for running the host scripts under Node
 * (`loadHostScript("ppro", mock.globals)`). It follows the Premiere Pro
 * ExtendScript DOM's names: 0-based collections with `numItems` /
 * `numSequences` / `numTracks`, times as `Time` objects whose `ticks` is a
 * string (254016000000 per second), nodeIds and sequenceIDs as strings. `qe`
 * appears once `app.enableQE()` ran (ppro-qe.ts); components live in
 * ppro-components.ts.
 *
 * Behaviour the tools depend on is modelled on what the scripting guide,
 * PProPanel and live reports say (docs/PREMIERE_PRO.md): Track.overwriteClip /
 * insertClip place a project item's marked range and bring linked audio,
 * TrackItem.remove(ripple, ...) leaves the gap, getLinkedItems() is null for an
 * unlinked clip, Marker.end takes seconds. Every DOM change the mock treats as
 * undoable bumps `state.undoIndex` (what QE's undoStackIndex() reports).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BIND_REALM, type HostGlobals, type Realm } from "./realm.js";
import { createExtendScriptMock, type ExtendScriptMock, type ExtendScriptMockOptions } from "./extendscript-mock.js";
import { MockComponent, audioIntrinsics, collection, videoIntrinsics, type ComponentHost } from "./ppro-components.js";
import { TICKS_PER_SECOND, Time, frameTicksFor, ticksOf } from "./ppro-time.js";
import { createQe } from "./ppro-qe.js";

export { TICKS_PER_SECOND, Time, frameTicksFor, ticks, timecodeTicks } from "./ppro-time.js";

export const ProjectItemType = { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 } as const;

/** What a project item holds: picture and sound, one of them, a still, captions, a graphic, an XML-made sequence. */
export type MediaKind = "av" | "video" | "audio" | "still" | "caption" | "graphic" | "none";

/** Default still duration (Premiere's preference default is 5 s). */
export const STILL_SECONDS = 5;

/** The media kind for a file extension. */
export function mediaKindOf(file: string): MediaKind {
  const ext = path.extname(file).toLowerCase();
  if ([".mov", ".mp4", ".mxf", ".m4v", ".avi"].includes(ext)) return "av";
  if ([".wav", ".mp3", ".aif", ".aiff", ".m4a"].includes(ext)) return "audio";
  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".psd"].includes(ext)) return "still";
  if ([".srt", ".scc", ".xml.cc"].includes(ext)) return "caption";
  if (ext === ".mogrt") return "graphic";
  return "none";
}

/** A .mogrt the mock can "import": AE-authored templates expose an MGT component with these parameters. */
export interface MogrtSpec {
  /** Seconds. */
  duration: number;
  /** null = Premiere-authored (no MGT component). */
  params: readonly (readonly [string, unknown])[] | null;
}

export interface EncoderJob {
  id: string;
  sequence: string;
  output: string;
  preset: string;
  workArea: number;
  removeOnCompletion: number;
}

export class PremiereMockState implements ComponentHost {
  private nextNode = 1000;
  private nextSequence = 1;
  private nextGuid = 1;
  nextLink = 1;
  /** Every `qe` call, as "object.method(args)". */
  readonly qeCalls: string[] = [];
  qeEnabled = false;
  /** Undo stack position, as QE's undoStackIndex() reports it. */
  undoIndex = 0;
  readonly undoLog: string[] = [];
  /** Calls worth asserting: imports, exports, markers, settings, captions, reframes, detection, saves. */
  readonly calls: string[] = [];
  rejectLegacyEase = false;
  /** isDoneAnalyzingForVideoEffects(). */
  analysisDone = true;
  /** setSettings ignores frame-rate changes (to test the warning). */
  lockFrameRate = false;
  /** QE track items accept at most this many addTransition arguments (older builds took fewer). */
  qeTransitionArgs = 7;
  /** QE track items have setSpeed. */
  qeSetSpeed = true;
  /** QE sequences have exportFramePNG / write the file. */
  qeFrameExport: "writes" | "silent" | "missing" = "writes";
  /** QE project has undoStackIndex(). */
  qeUndoIndex = true;
  /** qe.project.getSequenceAt throws (reported for every index on Premiere 26). */
  qeSequenceAtThrows = false;
  /** BridgeTalk.getStatus("ame"). */
  ameStatus = "IDLE";
  /** TrackItem.move() also moves the clip's linked partners (as Premiere may with linked selection). */
  moveLinked = false;
  /** Effects QE cannot find by name (as if not installed). */
  readonly hiddenEffects = new Set<string>();
  /** setTimeVarying(true) leaves a key at source time 0, like turning animation on at the playhead. */
  keyOnAnimate = false;
  /** Effects added from now on get non-English parameter names (as on a German UI). */
  localizedParams = false;
  /** Appended to QE sequence guids, so they differ from the DOM sequenceID. */
  qeGuidSuffix = "";
  /** Templates by path for Sequence.importMGT. */
  readonly mogrts = new Map<string, MogrtSpec>();
  /** Media durations (seconds) by file name for imports; default 10 s. */
  readonly mediaSeconds = new Map<string, number>();
  /** Set by createPremiereMock. */
  project: PremiereProject | null = null;

  constructor(readonly es: ExtendScriptMock) {}

  get link() {
    return this.es.state.link;
  }

  nodeId(): string {
    this.nextNode += 1;
    return `000f${this.nextNode.toString(16).padStart(4, "0")}`;
  }

  sequenceId(): string {
    const n = this.nextSequence++;
    return `5a7b0c1d-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  }

  guid(): string {
    const n = this.nextGuid++;
    return `7e3f0000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;
  }

  array<T>(items: readonly T[]): T[] {
    return this.es.state.link.array(items);
  }

  undoable(label: string): void {
    this.undoIndex += 1;
    this.undoLog.push(label);
  }}

export class ProjectItemCollection {}

export class ProjectItem {
  readonly nodeId: string;
  readonly childList: ProjectItem[] = [];
  readonly children: ProjectItemCollection;
  parent: ProjectItem | null = null;
  mediaPath = "";
  media: MediaKind = "none";
  /** Seconds of media (Infinity for stills). */
  mediaDuration = 10;
  inMark: number | null = null;
  outMark: number | null = null;
  colorLabel = 0;
  offline = false;
  sequence: Sequence | null = null;
  readonly markers: MarkerCollection;
  /** setInPoint / setOutPoint calls, for assertions. */
  readonly markCalls: string[] = [];

  constructor(
    protected readonly mock: PremiereMockState,
    public name: string,
    public type: number,
  ) {
    this.nodeId = mock.nodeId();
    this.children = collection(new ProjectItemCollection(), () => this.childList);
    this.markers = new MarkerCollection(mock);
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
    this.mock.undoable(`createBin ${name}`);
    return this.addChild(new ProjectItem(this.mock, name, ProjectItemType.BIN));
  }

  moveBin(destination: ProjectItem): void {
    if (this.parent) this.parent.childList.splice(this.parent.childList.indexOf(this), 1);
    destination.addChild(this);
    this.mock.undoable(`moveBin ${this.name}`);
  }

  getMediaPath(): string {
    return this.mediaPath;
  }

  /** In mark, else the media start. */
  getInPoint(): Time {
    return Time.fromTicks(this.inMark ?? 0);
  }

  /** Out mark, else the media end (5 s for stills, the sequence end for sequences). */
  getOutPoint(_mediaType?: number): Time {
    if (this.outMark !== null) return Time.fromTicks(this.outMark);
    if (this.sequence) return Time.fromTicks(this.sequence.end);
    return Time.fromSeconds(Number.isFinite(this.mediaDuration) ? this.mediaDuration : STILL_SECONDS);
  }

  setInPoint(value: unknown, mediaType?: number): number {
    this.inMark = ticksOf(value);
    this.markCalls.push(`in=${this.inMark / TICKS_PER_SECOND}@${mediaType}`);
    return 0;
  }

  setOutPoint(value: unknown, mediaType?: number): number {
    this.outMark = ticksOf(value);
    this.markCalls.push(`out=${this.outMark / TICKS_PER_SECOND}@${mediaType}`);
    return 0;
  }

  clearInPoint(): number {
    this.inMark = null;
    return 0;
  }

  clearOutPoint(): number {
    this.outMark = null;
    return 0;
  }

  /** Seconds of the marked range. */
  rangeTicks(): { in: number; out: number } {
    return { in: Number(this.getInPoint().ticks), out: Number(this.getOutPoint().ticks) };
  }

  getMarkers(): MarkerCollection {
    return this.markers;
  }

  isSequence(): boolean {
    return this.sequence !== null;
  }

  isOffline(): boolean {
    return this.offline;
  }

  getColorLabel(): number {
    return this.colorLabel;
  }

  setColorLabel(label: number): void {
    this.colorLabel = label;
  }
}

export class TrackItemCollection {}

export class TrackItem {
  readonly nodeId: string;
  private startTicks: number;
  private endTicks: number;
  private inTicks: number;
  private outTicks: number;
  disabled = false;
  selected = false;
  speed = 1;
  reversed = false;
  linkGroup: number | null = null;
  readonly components: MockComponent[];
  readonly componentList: MockComponent[];
  mgt: MockComponent | null = null;
  /** Writes to start/end/inPoint/outPoint, for assertions. */
  readonly writes: string[] = [];

  constructor(
    private readonly mock: PremiereMockState,
    public name: string,
    readonly projectItem: ProjectItem,
    readonly mediaType: "Video" | "Audio",
    startSeconds: number,
    endSeconds: number,
    inSeconds = 0,
    public track: Track | null = null,
  ) {
    this.nodeId = mock.nodeId();
    this.startTicks = Math.round(startSeconds * TICKS_PER_SECOND);
    this.endTicks = Math.round(endSeconds * TICKS_PER_SECOND);
    this.inTicks = Math.round(inSeconds * TICKS_PER_SECOND);
    this.outTicks = this.inTicks + this.endTicks - this.startTicks;
    this.componentList = mediaType === "Video" ? videoIntrinsics(mock) : audioIntrinsics(mock);
    this.components = collection(this.componentList as unknown as MockComponent[], () => this.componentList);
  }

  get type(): number {
    return this.mediaType === "Video" ? 1 : 2;
  }

  get start(): Time {
    return Time.fromTicks(this.startTicks);
  }

  set start(value: unknown) {
    this.startTicks = ticksOf(value);
    this.writes.push(`start=${this.startTicks / TICKS_PER_SECOND}`);
    this.mock.undoable(`start ${this.name}`);
    this.track?.sort();
  }

  get end(): Time {
    return Time.fromTicks(this.endTicks);
  }

  /** Premiere clamps the tail at the end of the media. */
  set end(value: unknown) {
    const wanted = ticksOf(value);
    const media = this.projectItem.mediaDuration;
    const maxEnd = Number.isFinite(media) ? this.startTicks + Math.round(media * TICKS_PER_SECOND) - this.inTicks : Infinity;
    this.endTicks = Math.min(wanted, maxEnd);
    this.writes.push(`end=${this.endTicks / TICKS_PER_SECOND}`);
    this.mock.undoable(`end ${this.name}`);
  }

  get inPoint(): Time {
    return Time.fromTicks(this.inTicks);
  }

  set inPoint(value: unknown) {
    this.inTicks = ticksOf(value);
    this.writes.push(`inPoint=${this.inTicks / TICKS_PER_SECOND}`);
  }

  get outPoint(): Time {
    return Time.fromTicks(this.outTicks);
  }

  set outPoint(value: unknown) {
    this.outTicks = ticksOf(value);
    this.writes.push(`outPoint=${this.outTicks / TICKS_PER_SECOND}`);
  }

  get duration(): Time {
    return Time.fromTicks(this.endTicks - this.startTicks);
  }

  /** Test helper: seconds as numbers. */
  get span(): { start: number; end: number; in: number; out: number } {
    const s = (value: number) => Math.round((value / TICKS_PER_SECOND) * 1e6) / 1e6;
    return { start: s(this.startTicks), end: s(this.endTicks), in: s(this.inTicks), out: s(this.outTicks) };
  }

  /** Shift without recording (mock internals). */
  shiftTicks(delta: number): void {
    this.startTicks += delta;
    this.endTicks += delta;
  }

  /** Set the timeline span without recording (mock internals). */
  setSpan(startTicks: number, endTicks: number, inTicks = this.inTicks): void {
    this.startTicks = startTicks;
    this.endTicks = endTicks;
    this.inTicks = inTicks;
    this.outTicks = inTicks + Math.round((endTicks - startTicks) * this.speed);
  }

  isSelected(): boolean {
    return this.selected;
  }

  setSelected(selected: boolean | number, _updateUI?: boolean | number): void {
    this.selected = Boolean(selected);
  }

  getSpeed(): number {
    return this.speed;
  }

  isSpeedReversed(): number {
    return this.reversed ? 1 : 0;
  }

  isAdjustmentLayer(): boolean {
    return false;
  }

  getMGTComponent(): MockComponent | null {
    return this.mgt;
  }

  /** The clips linked to this one; null when none (Premiere 25.2). */
  getLinkedItems(): TrackItemCollection | null {
    if (this.linkGroup === null || !this.track) return null;
    const others = this.track.sequence.allClips().filter((clip) => clip !== this && clip.linkGroup === this.linkGroup);
    return others.length ? collection(new TrackItemCollection(), () => others) : null;
  }

  /** Removes the clip and leaves the gap whatever `ripple` says (Premiere 25-26). */
  remove(_ripple: boolean | number, _alignToVideo: boolean | number): number {
    this.track?.detach(this);
    this.mock.undoable(`remove ${this.name}`);
    return 0;
  }

  /** Shift by `seconds` (TrackItem.move, Premiere 15.4+); with state.moveLinked its partners move too. */
  move(seconds: unknown): boolean {
    const delta = ticksOf(seconds);
    const partners = this.mock.moveLinked && this.linkGroup !== null && this.track ? this.track.sequence.allClips().filter((clip) => clip !== this && clip.linkGroup === this.linkGroup) : [];
    for (const clip of [this, ...partners]) {
      clip.shiftTicks(delta);
      clip.track?.sort();
    }
    this.mock.undoable(`move ${this.name}`);
    return true;
  }
}

export class MockTransition {
  selected = false;

  constructor(
    public name: string,
    readonly start: Time,
    readonly end: Time,
  ) {}

  isSelected(): boolean {
    return this.selected;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
  }
}

export class Track {
  readonly id: number;
  readonly clipList: TrackItem[] = [];
  readonly clips: TrackItemCollection;
  readonly transitionList: MockTransition[] = [];
  readonly transitions: TrackItemCollection;
  muted = false;
  locked = false;
  targeted = true;

  constructor(
    private readonly mock: PremiereMockState,
    public name: string,
    readonly mediaType: "Video" | "Audio",
    readonly index: number,
    readonly sequence: Sequence,
  ) {
    this.id = index;
    this.clips = collection(new TrackItemCollection(), () => this.clipList);
    this.transitions = collection(new TrackItemCollection(), () => this.transitionList);
  }

  sort(): void {
    this.clipList.sort((a, b) => Number(a.start.ticks) - Number(b.start.ticks));
  }

  detach(clip: TrackItem): void {
    const index = this.clipList.indexOf(clip);
    if (index >= 0) this.clipList.splice(index, 1);
    clip.track = null;
  }

  attach(clip: TrackItem): TrackItem {
    clip.track = this;
    this.clipList.push(clip);
    this.sort();
    return clip;
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

  setTargeted(targeted: boolean, _shouldBroadcast?: boolean): boolean {
    this.targeted = targeted;
    return true;
  }

  /** Test helper: a clip of `item` on this track from `start` to `end` seconds (no undo step). */
  addClip(item: ProjectItem, start: number, end: number, inPoint = 0): TrackItem {
    return this.attach(new TrackItem(this.mock, item.name, item, this.mediaType, start, end, inPoint, this));
  }

  /** Test helper: a transition on this track from `start` to `end` seconds. */
  addTransition(name: string, start: number, end: number): MockTransition {
    const transition = new MockTransition(name, Time.fromSeconds(start), Time.fromSeconds(end));
    this.transitionList.push(transition);
    return transition;
  }

  /** Split the clip spanning `at` (ticks) into two; returns the right-hand piece. */
  splitAt(at: number): TrackItem | null {
    const clip = this.clipList.find((candidate) => Number(candidate.start.ticks) < at && Number(candidate.end.ticks) > at);
    if (!clip) return null;
    const span = { start: Number(clip.start.ticks), end: Number(clip.end.ticks), in: Number(clip.inPoint.ticks) };
    const right = new TrackItem(this.mock, clip.name, clip.projectItem, clip.mediaType, 0, 0, 0, this);
    right.speed = clip.speed;
    right.setSpan(at, span.end, span.in + Math.round((at - span.start) * clip.speed));
    clip.setSpan(span.start, at, span.in);
    return this.attach(right);
  }

  /** Overwrite: clips fully inside [start, end) go, clips across its edges are cut back. */
  clearRange(start: number, end: number): void {
    for (const clip of [...this.clipList]) {
      const s = Number(clip.start.ticks);
      const e = Number(clip.end.ticks);
      if (e <= start || s >= end) continue;
      if (s >= start && e <= end) this.detach(clip);
      else if (s < start && e > end) {
        this.splitAt(end);
        clip.setSpan(s, start);
      } else if (s < start) clip.setSpan(s, start);
      else clip.setSpan(end, e, Number(clip.inPoint.ticks) + Math.round((end - s) * clip.speed));
    }
  }

  /** Insert: split at `at`, then push every clip from there right by `length`. */
  makeRoom(at: number, length: number): void {
    this.splitAt(at);
    for (const clip of this.clipList) if (Number(clip.start.ticks) >= at) clip.shiftTicks(length);
    this.sort();
  }

  private place(item: ProjectItem, time: unknown, mode: "overwrite" | "insert"): boolean {
    const at = ticksOf(time);
    const range = item.rangeTicks();
    const length = range.out - range.in;
    const kinds: ("Video" | "Audio")[] = [];
    if (item.media === "av" || item.sequence) kinds.push("Video", "Audio");
    else if (item.media === "audio") kinds.push("Audio");
    else if (item.media !== "none" && item.media !== "caption") kinds.push("Video");
    const wanted = kinds.filter((kind) => kind === this.mediaType || (this.mediaType === "Video" && kind === "Audio"));
    if (!wanted.includes(this.mediaType)) return false;
    const tracks = wanted.map((kind) => (kind === this.mediaType ? this : this.sequence.trackList(kind)[this.index])).filter((track): track is Track => Boolean(track && !track.locked));
    const group = tracks.length > 1 ? this.mock.nextLink++ : null;
    for (const track of tracks) {
      if (mode === "insert") track.makeRoom(at, length);
      else track.clearRange(at, at + length);
      const clip = new TrackItem(this.mock, item.name, item, track.mediaType, 0, 0, 0, track);
      clip.setSpan(at, at + length, range.in);
      clip.linkGroup = group;
      track.attach(clip);
    }
    this.mock.undoable(`${mode}Clip ${item.name}`);
    return true;
  }

  /** Overwrite `item` (its marked range) at `time` (seconds, Time or ticks string). Video tracks bring linked audio. */
  overwriteClip(item: ProjectItem, time: unknown): boolean {
    return this.place(item, time, "overwrite");
  }

  /** Insert `item` at `time`, pushing later clips right. */
  insertClip(item: ProjectItem, time: unknown): boolean {
    return this.place(item, time, "insert");
  }
}

export class TrackCollection {}

export class MockMarker {
  readonly guid: string;
  private startTicks: number;
  private endTicks: number;
  name = "";
  comments = "";
  type = "Comment";
  colorIndex = 0;

  constructor(mock: PremiereMockState, seconds: number) {
    this.guid = mock.guid();
    this.startTicks = Math.round(seconds * TICKS_PER_SECOND);
    this.endTicks = this.startTicks;
  }

  get start(): Time {
    return Time.fromTicks(this.startTicks);
  }

  set start(value: unknown) {
    this.startTicks = ticksOf(value);
  }

  get end(): Time {
    return Time.fromTicks(this.endTicks);
  }

  /** Takes seconds (scripting guide: "pass a Seconds value, not a complete replacement Time"). */
  set end(value: unknown) {
    this.endTicks = ticksOf(value);
  }

  setTypeAsChapter(): number {
    this.type = "Chapter";
    return 0;
  }

  setTypeAsComment(): number {
    this.type = "Comment";
    return 0;
  }

  setTypeAsSegmentation(): number {
    this.type = "Segmentation";
    return 0;
  }

  getColorByIndex(): number {
    return this.colorIndex;
  }

  setColorByIndex(index: number): void {
    this.colorIndex = index;
  }
}

export class MarkerCollection {
  readonly list: MockMarker[] = [];

  constructor(private readonly mock: PremiereMockState) {}

  get numMarkers(): number {
    return this.list.length;
  }

  createMarker(seconds: number): MockMarker {
    const marker = new MockMarker(this.mock, Number(seconds));
    this.list.push(marker);
    this.list.sort((a, b) => Number(a.start.ticks) - Number(b.start.ticks));
    this.mock.calls.push(`createMarker(${seconds})`);
    return marker;
  }

  deleteMarker(marker: MockMarker): boolean {
    const index = this.list.indexOf(marker);
    if (index >= 0) this.list.splice(index, 1);
    return index >= 0;
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

/** Sequence.getSettings(): the fields the tools touch. */
export interface MockSequenceSettings {
  videoFrameRate: Time;
  videoFrameWidth: number;
  videoFrameHeight: number;
  videoDisplayFormat: number;
}

export class Sequence {
  readonly sequenceID: string;
  readonly projectItem: ProjectItem;
  frameSizeHorizontal: number;
  frameSizeVertical: number;
  /** Ticks per frame, as a string. */
  timebase: string;
  private baseEnd: number;
  videoDisplayFormat = 104;
  readonly videoTrackList: Track[] = [];
  readonly audioTrackList: Track[] = [];
  readonly videoTracks: TrackCollection;
  readonly audioTracks: TrackCollection;
  readonly markers: MarkerCollection;
  playerPosition = new Time();
  inPoint = new Time();
  outPoint = new Time();
  /** createCaptionTrack calls. */
  readonly captionTracks: { item: string; start: number; format: number | undefined }[] = [];

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
    this.timebase = String(frameTicksFor(options.fps ?? 30));
    this.baseEnd = Math.round((options.duration ?? 0) * TICKS_PER_SECOND);
    this.outPoint = Time.fromSeconds(options.duration ?? 0);
    this.markers = new MarkerCollection(mock);
    for (let i = 0; i < (options.videoTracks ?? 3); i += 1) this.videoTrackList.push(new Track(mock, `Video ${i + 1}`, "Video", i, this));
    for (let i = 0; i < (options.audioTracks ?? 3); i += 1) this.audioTrackList.push(new Track(mock, `Audio ${i + 1}`, "Audio", i, this));
    this.videoTracks = collection(new TrackCollection(), () => this.videoTrackList);
    this.audioTracks = collection(new TrackCollection(), () => this.audioTrackList);
    Object.defineProperty(this.videoTracks, "numTracks", { get: () => this.videoTrackList.length });
    Object.defineProperty(this.audioTracks, "numTracks", { get: () => this.audioTrackList.length });
  }

  /** Sequence end in ticks, as a string: the longer of its set duration and its last clip. */
  get end(): string {
    const last = this.allClips().reduce((max, clip) => Math.max(max, Number(clip.end.ticks)), 0);
    return String(Math.max(this.baseEnd, last));
  }

  trackList(kind: "Video" | "Audio"): Track[] {
    return kind === "Video" ? this.videoTrackList : this.audioTrackList;
  }

  allClips(): TrackItem[] {
    return [...this.videoTrackList, ...this.audioTrackList].flatMap((track) => track.clipList);
  }

  getPlayerPosition(): Time {
    return this.playerPosition;
  }

  setPlayerPosition(tickString: string): void {
    this.playerPosition = Time.fromTicks(tickString);
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
    return this.mock.array(this.allClips().filter((clip) => clip.selected));
  }

  getSettings(): MockSequenceSettings {
    return {
      videoFrameRate: Time.fromTicks(this.timebase),
      videoFrameWidth: this.frameSizeHorizontal,
      videoFrameHeight: this.frameSizeVertical,
      videoDisplayFormat: this.videoDisplayFormat,
    };
  }

  setSettings(settings: MockSequenceSettings): boolean {
    this.frameSizeHorizontal = settings.videoFrameWidth;
    this.frameSizeVertical = settings.videoFrameHeight;
    if (!this.mock.lockFrameRate) this.timebase = String(settings.videoFrameRate.ticks);
    this.videoDisplayFormat = settings.videoDisplayFormat;
    this.mock.calls.push(`setSettings(${this.name}: ${settings.videoFrameWidth}x${settings.videoFrameHeight} @ ${settings.videoFrameRate.ticks})`);
    this.mock.undoable(`setSettings ${this.name}`);
    return true;
  }

  getExportFileExtension(presetPath: string): string {
    return /4d6f6f56|prores|quicktime/i.test(presetPath) ? "mov" : "mp4";
  }

  exportAsFinalCutProXML(output: string, suppressUI?: number): boolean {
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="${this.sequenceID}"><name>${this.name}</name></sequence></xmeml>\n`);
    this.mock.calls.push(`exportAsFinalCutProXML(${output}, ${suppressUI})`);
    return true;
  }

  exportAsMediaDirect(output: string, presetPath: string, workArea?: number): string {
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, "rendered");
    this.mock.calls.push(`exportAsMediaDirect(${output}, ${path.basename(presetPath)}, ${workArea})`);
    return "";
  }

  createCaptionTrack(item: ProjectItem, start: number, format?: number): boolean {
    this.captionTracks.push({ item: item.nodeId, start, format });
    this.mock.undoable(`createCaptionTrack ${item.name}`);
    return true;
  }

  isDoneAnalyzingForVideoEffects(): boolean {
    return this.mock.analysisDone;
  }

  /** Keeps the source height (9:16 of 1080p gives 608x1080, premiere-pro-mcp on 25.2). */
  autoReframeSequence(numerator: number, denominator: number, motion: string, name: string, nest: boolean): Sequence {
    const project = this.mock.project;
    if (!project) throw new Error("no project");
    const width = Math.round((this.frameSizeVertical * numerator) / denominator / 2) * 2;
    const created = project.addSequence({ name, width, height: this.frameSizeVertical, fps: TICKS_PER_SECOND / Number(this.timebase), active: false });
    created.timebase = this.timebase;
    this.mock.calls.push(`autoReframeSequence(${numerator}, ${denominator}, ${motion}, ${name}, ${nest})`);
    this.mock.undoable(`autoReframe ${name}`);
    return created;
  }

  /** Cuts each selected video clip in the middle (or marks its source item there). */
  performSceneEditDetectionOnSelection(action: string, linkedAudio: boolean, sensitivity: string): boolean {
    this.mock.calls.push(`performSceneEditDetectionOnSelection(${action}, ${linkedAudio}, ${sensitivity})`);
    for (const clip of this.videoTrackList.flatMap((track) => track.clipList).filter((candidate) => candidate.selected)) {
      const middle = Math.round((Number(clip.start.ticks) + Number(clip.end.ticks)) / 2);
      if (action === "ApplyCuts") {
        clip.track?.splitAt(middle);
        if (linkedAudio) {
          const linked = clip.getLinkedItems();
          for (let i = 0; linked && i < (linked as { numItems: number }).numItems; i += 1) {
            (linked as unknown as TrackItem[])[i]?.track?.splitAt(middle);
          }
        }
        this.mock.undoable("scene cut");
      } else {
        clip.projectItem.markers.createMarker((Number(clip.inPoint.ticks) + middle - Number(clip.start.ticks)) / TICKS_PER_SECOND).type = "Segmentation";
      }
    }
    return true;
  }

  /** Inserts a template as a graphic clip on video track vOffset; AE-authored ones get an MGT component. */
  importMGT(mogrtPath: string, timeTicks: string, videoTrackOffset: number, _audioTrackOffset: number): TrackItem | null {
    const spec = this.mock.mogrts.get(mogrtPath);
    const track = this.videoTrackList[videoTrackOffset];
    if (!spec || !track) return null;
    const project = this.mock.project;
    const item = project?.findByMediaPath(mogrtPath) ?? project?.addMedia(path.basename(mogrtPath, ".mogrt"), mogrtPath, spec.duration, project.rootItem, "graphic");
    if (!item) return null;
    const at = Number(timeTicks);
    track.clearRange(at, at + Math.round(spec.duration * TICKS_PER_SECOND));
    const clip = new TrackItem(this.mock, item.name, item, "Video", at / TICKS_PER_SECOND, at / TICKS_PER_SECOND + spec.duration, 0, track);
    if (spec.params) clip.mgt = new MockComponent(this.mock, "Graphic Parameters", "AE.ADBE Capsule", spec.params);
    track.attach(clip);
    this.mock.calls.push(`importMGT(${path.basename(mogrtPath)}, ${timeTicks}, ${videoTrackOffset})`);
    this.mock.undoable(`importMGT ${item.name}`);
    return clip;
  }
}

export class SequenceCollection {}

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
    this.sequences = collection(new SequenceCollection(), () => this.sequenceList);
    Object.defineProperty(this.sequences, "numSequences", { get: () => this.sequenceList.length });
  }

  openSequence(sequenceID: string): boolean {
    const sequence = this.sequenceList.find((candidate) => candidate.sequenceID === sequenceID);
    if (!sequence) return false;
    this.activeSequence = sequence;
    this.mock.calls.push(`openSequence(${sequence.name})`);
    return true;
  }

  /** Test helper: a sequence (and its project item in the root bin). */
  addSequence(options: SequenceOptions = {}): Sequence {
    const name = options.name ?? `Sequence ${this.sequenceList.length + 1}`;
    const item = this.rootItem.addChild(new ProjectItem(this.mock, name, ProjectItemType.CLIP));
    const sequence = new Sequence(this.mock, name, item, options);
    item.sequence = sequence;
    item.media = "av";
    this.sequenceList.push(sequence);
    if (options.active !== false) this.activeSequence = sequence;
    return sequence;
  }

  /** Test helper: a media item in `bin` (default root); kind from the path's extension unless given. */
  addMedia(name: string, mediaPath: string, durationSeconds = 10, bin: ProjectItem = this.rootItem, kind?: MediaKind): ProjectItem {
    const item = bin.addChild(new ProjectItem(this.mock, name, ProjectItemType.CLIP));
    item.mediaPath = mediaPath;
    item.media = kind ?? (mediaKindOf(mediaPath) === "none" ? "av" : mediaKindOf(mediaPath));
    item.mediaDuration = item.media === "still" ? Infinity : durationSeconds;
    return item;
  }

  /** Test helper: a bin path ("A/B") under the root, created as needed. */
  addBin(binPath: string): ProjectItem {
    let current = this.rootItem;
    for (const part of binPath.split("/").filter(Boolean)) {
      current = current.childList.find((child) => child.type === ProjectItemType.BIN && child.name === part) ?? current.addChild(new ProjectItem(this.mock, part, ProjectItemType.BIN));
    }
    return current;
  }

  /** Every item, depth first. */
  allItems(from: ProjectItem = this.rootItem): ProjectItem[] {
    return from.childList.flatMap((child) => [child, ...this.allItems(child)]);
  }

  findByMediaPath(mediaPath: string): ProjectItem | undefined {
    return this.allItems().find((item) => item.mediaPath === mediaPath);
  }

  getInsertionBin(): ProjectItem {
    return this.rootItem;
  }

  /** Imports files that exist on disk; an .xml becomes a bin holding one sequence (as an FCP XML import does). */
  importFiles(paths: unknown, suppressUI?: boolean, bin?: ProjectItem, asNumberedStills?: boolean): boolean {
    const list = Array.from(paths as ArrayLike<string>).map(String);
    const target = bin ?? this.rootItem;
    this.mock.calls.push(`importFiles(${list.map((file) => path.basename(file)).join(", ")}, ${suppressUI}, ${target.name}, ${asNumberedStills})`);
    let imported = 0;
    for (const file of list) {
      if (!existsSync(file)) continue;
      if (path.extname(file).toLowerCase() === ".xml") {
        const text = readFileSync(file, "utf8");
        const name = /<name>([^<]+)<\/name>/.exec(text)?.[1] ?? path.basename(file, ".xml");
        const xmlBin = target.addChild(new ProjectItem(this.mock, path.basename(file), ProjectItemType.BIN));
        const sequence = this.addSequence({ name, active: false, duration: 12 });
        this.rootItem.childList.splice(this.rootItem.childList.indexOf(sequence.projectItem), 1);
        xmlBin.addChild(sequence.projectItem);
        for (const match of text.matchAll(/<pathurl>([^<]+)<\/pathurl>/g)) {
          const media = this.addMedia(path.basename(decodeURI(match[1] ?? "")), decodeURI((match[1] ?? "").replace(/^file:\/\//, "")), 10, xmlBin);
          media.offline = !existsSync(media.mediaPath);
        }
        imported += 1;
        continue;
      }
      const kind = mediaKindOf(file);
      const item = this.addMedia(path.basename(file), file, this.mock.mediaSeconds.get(path.basename(file)) ?? 10, target, kind === "none" ? "av" : kind);
      if (asNumberedStills) item.mediaDuration = 2;
      imported += 1;
    }
    if (imported) this.mock.undoable("importFiles");
    return imported > 0;
  }

  /** A sequence with the items one after another on V1/A1, at the first item's size (1920x1080 at 25 in the mock). */
  createNewSequenceFromClips(name: string, items: unknown, bin?: ProjectItem): Sequence {
    const list = Array.from(items as ArrayLike<ProjectItem>);
    const sequence = this.addSequence({ name, fps: 25, active: true });
    if (bin && bin !== this.rootItem) sequence.projectItem.moveBin(bin);
    let at = 0;
    for (const item of list) {
      const range = item.rangeTicks();
      sequence.videoTrackList[0]?.overwriteClip(item, Time.fromTicks(at));
      at += range.out - range.in;
    }
    this.mock.calls.push(`createNewSequenceFromClips(${name}, ${list.length})`);
    this.mock.undoable(`createNewSequenceFromClips ${name}`);
    return sequence;
  }

  /** A sequence from a .sqpreset; the mock reads `width height fps` from the file (default 1920 1080 25). */
  newSequenceFromPreset(name: string, presetPath: string): Sequence {
    let width = 1920;
    let height = 1080;
    let fps = 25;
    try {
      const match = /(\d+)\s+(\d+)\s+([\d.]+)/.exec(readFileSync(presetPath, "utf8"));
      if (match) {
        width = Number(match[1]);
        height = Number(match[2]);
        fps = Number(match[3]);
      }
    } catch {
      // A preset the mock cannot read: defaults.
    }
    const sequence = this.addSequence({ name, width, height, fps });
    this.mock.calls.push(`newSequence(${name}, ${path.basename(presetPath)})`);
    this.mock.undoable(`newSequence ${name}`);
    return sequence;
  }

  deleteSequence(sequence: Sequence): boolean {
    const index = this.sequenceList.indexOf(sequence);
    if (index >= 0) this.sequenceList.splice(index, 1);
    return index >= 0;
  }

  save(): void {
    this.mock.calls.push("save()");
  }

  saveAs(target: string): boolean {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "prproj");
    this.path = target;
    this.name = path.basename(target);
    this.mock.calls.push(`saveAs(${target})`);
    return true;
  }
}

export class MockEncoder {
  readonly ENCODE_ENTIRE = 0;
  readonly ENCODE_IN_TO_OUT = 1;
  readonly ENCODE_WORKAREA = 2;
  readonly jobs: EncoderJob[] = [];
  launched = 0;
  started = 0;

  constructor(private readonly mock: PremiereMockState) {}

  encodeSequence(sequence: Sequence, output: string, preset: string, workArea?: number, removeOnCompletion?: number): string {
    const id = String(this.jobs.length + 101);
    this.jobs.push({ id, sequence: sequence.sequenceID, output, preset, workArea: workArea ?? 0, removeOnCompletion: removeOnCompletion ?? 0 });
    this.mock.calls.push(`encodeSequence(${sequence.name}, ${path.basename(output)}, ${path.basename(preset)}, ${workArea})`);
    return id;
  }

  launchEncoder(): number {
    this.launched += 1;
    return 0;
  }

  startBatch(): number {
    this.started += 1;
    return 0;
  }
}

export class PremiereApp {
  version: string;
  build = "64";
  project: PremiereProject;
  documentOpen = true;
  /** The Premiere app: the .app bundle on macOS, the install folder on Windows ("" = unknown). */
  path = "";
  encoder: MockEncoder | undefined;

  constructor(
    private readonly mock: PremiereMockState,
    version: string,
  ) {
    this.version = version;
    this.project = new PremiereProject(mock);
    this.encoder = new MockEncoder(mock);
  }

  isDocumentOpen(): boolean {
    return this.documentOpen;
  }

  /** Defines the `qe` global, like Premiere does. */
  enableQE(): boolean {
    this.mock.qeEnabled = true;
    const realmGlobal = this.mock.es.state.link.global;
    if (realmGlobal) realmGlobal.qe = createQe(this.mock, this);
    return true;
  }
}

/** The 0-based sequence and track collections expose their counts like the DOM. */
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
  const app = new PremiereApp(state, options.version ?? "26.0.0");
  state.project = app.project;
  const globals: HostGlobals = {
    $: es.$,
    File: es.File,
    Folder: es.Folder,
    Time,
    ProjectItemType,
    Sequence: {
      CAPTION_FORMAT_SUBTITLE: 0,
      CAPTION_FORMAT_608: 1,
      CAPTION_FORMAT_708: 2,
      CAPTION_FORMAT_TELETEXT: 3,
      CAPTION_FORMAT_OPEN_EBU: 4,
      CAPTION_FORMAT_OP42: 5,
      CAPTION_FORMAT_OP47: 6,
    },
    BridgeTalk: { getStatus: (_target: string) => state.ameStatus },
  };
  globals.app = app;
  globals[BIND_REALM] = (realm: Realm) => es.state.link.bind(realm);
  return { globals, app, project: app.project, state, es, log: es.state.log };
}
