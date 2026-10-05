/**
 * The QE DOM for the Premiere mock (the `qe` global after app.enableQE()).
 * QE is undocumented; this follows what the tools rely on and what PProPanel,
 * pymiere and live-tested projects report: sequences carry `guid` (= DOM
 * sequenceID); track items include "Empty" gaps between clips and expose
 * start/end {ticks, secs, timecode}; razor(timecode) on a track;
 * addVideoEffect / addAudioEffect(effect); addTransition(transition, atStart,
 * duration timecode, offset, alignment, singleSided, alignToVideo);
 * setSpeed(multiplier, duration ticks, reverse, maintainPitch, ripple) (fewer
 * arguments throw); exportFramePNG(timecode, path without extension) appends
 * ".png" and cuts the name at its first dot; project.undoStackIndex().
 *
 * Every call is recorded in `state.qeCalls` as "object.method(args)".
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EFFECTS, TRANSITIONS, createEffect } from "./ppro-components.js";
import { TICKS_PER_SECOND, Time, timecodeTicks } from "./ppro-time.js";
import type { PremiereApp, PremiereMockState, Sequence, Track, TrackItem } from "./premiere-mock.js";

interface QeNamed {
  qeKind: "video" | "audio";
  qeWhat: "effect" | "transition";
  name: string;
}

function isNamed(value: unknown, what: QeNamed["qeWhat"], kind: QeNamed["qeKind"]): value is QeNamed {
  return Boolean(value && typeof value === "object" && (value as QeNamed).qeWhat === what && (value as QeNamed).qeKind === kind);
}

function describeArg(value: unknown): string {
  if (value && typeof value === "object" && "qeWhat" in value) return (value as QeNamed).name;
  return String(value);
}

/** A minimal PNG head: signature, IHDR (width, height, 8-bit RGBA), IEND. Enough for size readers and MIME sniffing. */
export function pngHead(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16);
  ihdr.writeUInt8(6, 17);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, iend]);
}

export function createQe(mock: PremiereMockState, app: PremiereApp): Record<string, unknown> {
  const record = (call: string): void => {
    mock.qeCalls.push(call);
  };

  function qeTime(ticks: number, sequence: Sequence): { ticks: string; secs: number; timecode: string } {
    return {
      ticks: String(ticks),
      secs: ticks / TICKS_PER_SECOND,
      timecode: Time.fromTicks(ticks).getFormatted(Time.fromTicks(sequence.timebase), sequence.videoDisplayFormat),
    };
  }

  function named(what: QeNamed["qeWhat"], kind: QeNamed["qeKind"], name: string): QeNamed & { toString(): string } {
    return { qeWhat: what, qeKind: kind, name, toString: () => `${what}:${name}` };
  }

  function clipItem(clip: TrackItem, sequence: Sequence): Record<string, unknown> {
    const item: Record<string, unknown> = {
      type: "Clip",
      name: clip.name,
      start: qeTime(Number(clip.start.ticks), sequence),
      end: qeTime(Number(clip.end.ticks), sequence),
      addVideoEffect(effect: unknown): boolean {
        record(`item.addVideoEffect(${describeArg(effect)})`);
        if (!isNamed(effect, "effect", "video") || clip.mediaType !== "Video") throw new Error("Illegal Parameter type");
        clip.componentList.push(createEffect(mock, effect.name));
        mock.undoable(`addVideoEffect ${effect.name}`);
        return true;
      },
      addAudioEffect(effect: unknown): boolean {
        record(`item.addAudioEffect(${describeArg(effect)})`);
        if (!isNamed(effect, "effect", "audio") || clip.mediaType !== "Audio") throw new Error("Illegal Parameter type");
        clip.componentList.push(createEffect(mock, effect.name));
        mock.undoable(`addAudioEffect ${effect.name}`);
        return true;
      },
      addTransition(...args: unknown[]): boolean {
        record(`item.addTransition(${args.map(describeArg).join(", ")})`);
        if (args.length > mock.qeTransitionArgs) throw new Error("Illegal Parameter count");
        const [transition, atStart, duration] = args;
        if (!isNamed(transition, "transition", clip.mediaType === "Video" ? "video" : "audio")) throw new Error("Illegal Parameter type");
        const track = clip.track;
        if (!track) throw new Error("The clip is not on a track");
        const frame = Number(sequence.timebase);
        const length = typeof duration === "string" && duration !== "" ? timecodeTicks(duration, frame) : TICKS_PER_SECOND;
        const edge = Number(atStart ? clip.start.ticks : clip.end.ticks);
        const neighbour = track.clipList.some(
          (other) => other !== clip && Math.abs(Number(atStart ? other.end.ticks : other.start.ticks) - edge) < frame / 2,
        );
        const start = neighbour ? edge - length / 2 : atStart ? edge : edge - length;
        // A transition already at this edge is replaced, as in Premiere.
        for (const existing of [...track.transitionList]) {
          if (Number(existing.start.ticks) <= edge && Number(existing.end.ticks) >= edge) track.transitionList.splice(track.transitionList.indexOf(existing), 1);
        }
        track.addTransition(transition.name, start / TICKS_PER_SECOND, (start + length) / TICKS_PER_SECOND);
        mock.undoable(`addTransition ${transition.name}`);
        return true;
      },
    };
    if (mock.qeSetSpeed) {
      item.setSpeed = (...args: unknown[]): boolean => {
        record(`item.setSpeed(${args.map(describeArg).join(", ")})`);
        if (args.length < 5) throw new Error("Not Enough Parameters");
        const [ratio, durationTicks, reverse, , ripple] = args;
        const start = Number(clip.start.ticks);
        const oldEnd = Number(clip.end.ticks);
        const length = durationTicks ? Number(durationTicks) : Math.round(((oldEnd - start) * clip.speed) / Number(ratio));
        clip.speed = Number(ratio);
        clip.reversed = Boolean(reverse);
        clip.setSpan(start, start + length, Number(clip.inPoint.ticks));
        if (ripple && clip.track) {
          for (const other of clip.track.clipList) if (other !== clip && Number(other.start.ticks) >= oldEnd) other.shiftTicks(start + length - oldEnd);
        }
        mock.undoable(`setSpeed ${clip.name}`);
        return true;
      };
    }
    return item;
  }

  function trackObject(track: Track, sequence: Sequence): Record<string, unknown> {
    const items = (): Record<string, unknown>[] => {
      const out: Record<string, unknown>[] = [];
      let at = 0;
      for (const clip of track.clipList) {
        const start = Number(clip.start.ticks);
        if (start > at) out.push({ type: "Empty", name: "", start: qeTime(at, sequence), end: qeTime(start, sequence) });
        out.push(clipItem(clip, sequence));
        at = Math.max(at, Number(clip.end.ticks));
      }
      return out;
    };
    return {
      get numItems(): number {
        return items().length;
      },
      getItemAt(index: number): Record<string, unknown> | undefined {
        return items()[index];
      },
      razor(timecode: string): boolean {
        record(`track.razor(${timecode})`);
        if (track.splitAt(timecodeTicks(timecode, Number(sequence.timebase)))) mock.undoable("razor");
        return true;
      },
    };
  }

  function sequenceObject(sequence: Sequence): Record<string, unknown> {
    const object: Record<string, unknown> = {
      guid: sequence.sequenceID + mock.qeGuidSuffix,
      name: sequence.name,
      get numVideoTracks(): number {
        return sequence.videoTrackList.length;
      },
      get numAudioTracks(): number {
        return sequence.audioTrackList.length;
      },
      getVideoTrackAt(index: number): Record<string, unknown> | null {
        const track = sequence.videoTrackList[index];
        return track ? trackObject(track, sequence) : null;
      },
      getAudioTrackAt(index: number): Record<string, unknown> | null {
        const track = sequence.audioTrackList[index];
        return track ? trackObject(track, sequence) : null;
      },
    };
    if (mock.qeFrameExport !== "missing") {
      object.exportFramePNG = (timecode: string, base: string): boolean => {
        record(`sequence.exportFramePNG(${timecode}, ${path.basename(base)})`);
        if (mock.qeFrameExport === "silent") return true;
        const target = path.join(path.dirname(base), `${path.basename(base).split(".")[0]}.png`);
        const png = pngHead(sequence.frameSizeHorizontal, sequence.frameSizeVertical);
        mkdirSync(path.dirname(target), { recursive: true });
        if (mock.qeFrameExport === "writes") {
          writeFileSync(target, png);
          return true;
        }
        // Signature and IHDR only: what a reader sees while QE is still writing.
        writeFileSync(target, png.subarray(0, png.length - 12));
        if (mock.qeFrameExport === "async") mock.afterSleeps(mock.frameWriteSleeps, () => writeFileSync(target, png));
        return true;
      };
    }
    return object;
  }

  function project(): Record<string, unknown> {
    const list = (what: QeNamed["qeWhat"], kind: QeNamed["qeKind"]): unknown =>
      mock.array(
        what === "effect"
          ? Object.entries(EFFECTS).filter(([, spec]) => spec.kind === kind).map(([name]) => name)
          : Object.entries(TRANSITIONS).filter(([, transitionKind]) => transitionKind === kind).map(([name]) => name),
      );
    const object: Record<string, unknown> = {
      getActiveSequence(): Record<string, unknown> | null {
        record("project.getActiveSequence()");
        return app.project.activeSequence ? sequenceObject(app.project.activeSequence) : null;
      },
      get numSequences(): number {
        return app.project.sequenceList.length;
      },
      getSequenceAt(index: number): Record<string, unknown> | null {
        if (mock.qeSequenceAtThrows) throw new Error("Unknown error exception");
        const sequence = app.project.sequenceList[index];
        return sequence ? sequenceObject(sequence) : null;
      },
      getVideoEffectByName(name: string): unknown {
        record(`project.getVideoEffectByName(${name})`);
        return EFFECTS[name]?.kind === "video" && !mock.hiddenEffects.has(name) ? named("effect", "video", name) : null;
      },
      getAudioEffectByName(name: string): unknown {
        record(`project.getAudioEffectByName(${name})`);
        return EFFECTS[name]?.kind === "audio" ? named("effect", "audio", name) : null;
      },
      getVideoTransitionByName(name: string): unknown {
        record(`project.getVideoTransitionByName(${name})`);
        return TRANSITIONS[name] === "video" ? named("transition", "video", name) : null;
      },
      getAudioTransitionByName(name: string): unknown {
        record(`project.getAudioTransitionByName(${name})`);
        return TRANSITIONS[name] === "audio" ? named("transition", "audio", name) : null;
      },
      getVideoEffectList: () => list("effect", "video"),
      getAudioEffectList: () => list("effect", "audio"),
      getVideoTransitionList: () => list("transition", "video"),
      getAudioTransitionList: () => list("transition", "audio"),
      newSequence(name: string, presetPath: string): boolean {
        record(`project.newSequence(${name}, ${path.basename(presetPath)})`);
        app.project.newSequenceFromPreset(name, presetPath);
        return true;
      },
    };
    if (mock.qeUndoIndex) object.undoStackIndex = (): number => mock.undoIndex;
    return object;
  }

  return {
    name: "QE",
    get project(): Record<string, unknown> {
      return project();
    },
    get activeSequenceName(): string | null {
      return app.project.activeSequence?.name ?? null;
    },
  };
}
