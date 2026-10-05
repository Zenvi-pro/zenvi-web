/**
 * Fixtures for Premiere host-script tests: a mock DOM loaded into the ES3
 * realm with per-test temp folders, media files on disk, a fake Premiere /
 * Media Encoder install (sequence and export presets), and a small edit.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HostReceipt } from "../receipt.js";
import { loadHostScript, type LoadedHostScript } from "./host-script.js";
import { createPremiereMock, type PremiereMock, type PremiereMockOptions, type ProjectItem, type Sequence, type TrackItem } from "./premiere-mock.js";

export interface PremiereFixture {
  mock: PremiereMock;
  host: LoadedHostScript;
  /** Per-test root folder. */
  dir: string;
  /** Write a file under <dir>/media and return its path. */
  file(name: string, content?: string | Buffer): string;
  /** host.dispatch with a typed receipt. */
  call(name: string, args?: Record<string, unknown>): HostReceipt;
}

export function loadPremiere(options: PremiereMockOptions = {}): PremiereFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zenvi-ppro-"));
  const tempDir = path.join(dir, "tmp");
  const homeDir = path.join(dir, "home");
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  const mock = createPremiereMock({ tempDir, homeDir, ...options });
  const host = loadHostScript("ppro", mock.globals);
  return {
    mock,
    host,
    dir,
    file(name, content = "media") {
      const target = path.join(dir, "media", name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
      return target;
    },
    call: (name, args = {}) => host.dispatch(name, args),
  };
}

export interface FakeInstall {
  /** app.path: the .app bundle (macOS layout), with a trailing slash as Premiere reports it. */
  appPath: string;
  /** Full paths of the files created, by their relative path. */
  files: Record<string, string>;
}

/**
 * A macOS-style install under <dir>/Applications: Premiere's bundle with
 * Settings/SequencePresets and MediaIO/systempresets, and optionally Media
 * Encoder next to it. Sequence preset files contain "width height fps" for
 * the mock's qe.project.newSequence.
 */
export function fakeInstall(
  fixture: PremiereFixture,
  options: { sequencePresets?: Record<string, string>; premierePresets?: string[]; encoderPresets?: string[]; userPresets?: string[] } = {},
): FakeInstall {
  const apps = path.join(fixture.dir, "Applications");
  const bundle = path.join(apps, "Adobe Premiere Pro 2026", "Adobe Premiere Pro 2026.app");
  const files: Record<string, string> = {};
  const write = (root: string, relative: string, content: string) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    files[relative] = target;
  };
  mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  for (const [relative, content] of Object.entries(options.sequencePresets ?? {})) {
    write(path.join(bundle, "Contents", "Settings", "SequencePresets"), relative, content);
  }
  for (const relative of options.premierePresets ?? []) write(path.join(bundle, "Contents", "MediaIO", "systempresets"), relative, "<epr/>");
  if (options.encoderPresets) {
    const ame = path.join(apps, "Adobe Media Encoder 2026", "Adobe Media Encoder 2026.app", "Contents", "MediaIO", "systempresets");
    for (const relative of options.encoderPresets) write(ame, relative, "<epr/>");
  }
  for (const relative of options.userPresets ?? []) {
    write(path.join(fixture.dir, "home", "Adobe", "Adobe Media Encoder", "26.0", "Presets"), relative, "<epr/>");
  }
  fixture.mock.app.path = `${bundle}/`;
  return { appPath: `${bundle}/`, files };
}

export interface StandardEdit {
  sequence: Sequence;
  items: { a: ProjectItem; b: ProjectItem; c: ProjectItem; music: ProjectItem };
  /** V1 clips a (0-4 s), b (4-9 s), c (9-12 s), each linked to its audio on A1; music on A2 (0-12 s). */
  v: { a: TrackItem; b: TrackItem; c: TrackItem };
  audio: { a: TrackItem; b: TrackItem; c: TrackItem; music: TrackItem };
}

/** "Main", 1920x1080 at 30 fps: three linked A/V clips on V1/A1 and music on A2. */
export function standardEdit(fixture: PremiereFixture): StandardEdit {
  const project = fixture.mock.project;
  const sequence = project.addSequence({ name: "Main", width: 1920, height: 1080, fps: 30 });
  const bin = project.addBin("Footage");
  const a = project.addMedia("a.mov", "/media/a.mov", 20, bin);
  const b = project.addMedia("b.mov", "/media/b.mov", 20, bin);
  const c = project.addMedia("c.mov", "/media/c.mov", 20, bin);
  const music = project.addMedia("music.wav", "/media/music.wav", 60, bin);
  const v1 = sequence.videoTrackList[0];
  const a1 = sequence.audioTrackList[0];
  const a2 = sequence.audioTrackList[1];
  if (!v1 || !a1 || !a2) throw new Error("tracks missing");
  const link = (video: TrackItem, sound: TrackItem) => {
    const group = fixture.mock.state.nextLink++;
    video.linkGroup = group;
    sound.linkGroup = group;
  };
  const va = v1.addClip(a, 0, 4, 2);
  const vb = v1.addClip(b, 4, 9, 1);
  const vc = v1.addClip(c, 9, 12, 5);
  const aa = a1.addClip(a, 0, 4, 2);
  const ab = a1.addClip(b, 4, 9, 1);
  const ac = a1.addClip(c, 9, 12, 5);
  link(va, aa);
  link(vb, ab);
  link(vc, ac);
  const am = a2.addClip(music, 0, 12, 0);
  return { sequence, items: { a, b, c, music }, v: { a: va, b: vb, c: vc }, audio: { a: aa, b: ab, c: ac, music: am } };
}
