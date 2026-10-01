import { colorHexAt, evaluate, Interpolation, keyframeFrames, type KeyframeLike, type KeyframePoint, type PropertyValue } from "@zenvi/engine";
import { ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/ui/cn";
import { ColorField } from "@/ui/ColorField";
import { Switch } from "@/ui/Controls";
import { TextInput } from "@/ui/Input";
import { ContextMenu, type MenuSpec } from "@/ui/Menu";
import { NumberField } from "@/ui/NumberField";
import { Select } from "@/ui/Select";
import { Tooltip } from "@/ui/Tooltip";
import { valueKind, type PropertyMeta } from "../catalog";
import { humanize, numberFormat } from "./groups";

export interface KeyframeAt {
  frame: number;
  interpolation?: Interpolation;
}

/** How a row writes its value; clips, transitions and effects each provide one. */
export interface PropertyWriter {
  /** Owner id (clip, transition or effect) for per-property UI state. */
  ownerId: string;
  /** Whether the person armed this property for animation (see ui `armedKeyframes`). */
  isArmed(key: string): boolean;
  arm(key: string): void;
  preview(key: string, value: PropertyValue, at?: KeyframeAt): void;
  endPreview(): void;
  commit(key: string, value: PropertyValue, at?: KeyframeAt): void;
  /** Remove the point at `frame` (undefined when the owner cannot, e.g. effects today). */
  removePoint?(key: string, frame: number): void;
  /** Jump the playhead to a keyframe (clip-local frame). */
  seekToFrame(frame: number): void;
}

export interface PropertyRowProps {
  propKey: string;
  meta: PropertyMeta | undefined;
  raw: unknown;
  /** Keyframe X at the playhead, in the owner's frame space. */
  frame: number;
  writer: PropertyWriter;
  label?: string;
  /** Plain properties still keyed by time (position/start/end) are numbers, not keyframes. */
  disabled?: boolean;
}

function pointsOf(raw: unknown): KeyframePoint[] {
  const pts = (raw as { Points?: unknown } | null)?.Points;
  return Array.isArray(pts) ? (pts as KeyframePoint[]) : [];
}

const INTERPOLATION_LABEL: Record<number, string> = {
  [Interpolation.BEZIER]: "Bezier",
  [Interpolation.LINEAR]: "Linear",
  [Interpolation.CONSTANT]: "Constant",
};

function KeyframeButton({ raw, frame, value, propKey, writer, label }: { raw: unknown; frame: number; value: number; propKey: string; writer: PropertyWriter; label: string }) {
  const frames = keyframeFrames(raw as KeyframeLike);
  const points = pointsOf(raw);
  // A single stored point is the property's value, not an animation keyframe.
  const animated = frames.length > 1 || writer.isArmed(propKey);
  const here = animated ? points.find((p) => Math.round(p.co.X) === frame) : undefined;
  const prev = [...frames].reverse().find((f) => f < frame);
  const next = frames.find((f) => f > frame);
  const toggle = () => {
    if (here) {
      if (points.length > 1) writer.removePoint?.(propKey, frame);
    } else if (!animated && points.some((p) => Math.round(p.co.X) === frame)) {
      // Already holds the value at this frame: arm it so the next change elsewhere animates.
      writer.arm(propKey);
    } else {
      writer.arm(propKey);
      writer.commit(propKey, value, { frame });
    }
  };
  const menu = (): MenuSpec[] =>
    here
      ? [
          { type: "label", label: `${label} · frame ${frame}` },
          ...[Interpolation.BEZIER, Interpolation.LINEAR, Interpolation.CONSTANT].map(
            (interpolation): MenuSpec => ({
              type: "check",
              label: INTERPOLATION_LABEL[interpolation]!,
              checked: here.interpolation === interpolation,
              onSelect: () => writer.commit(propKey, value, { frame, interpolation }),
            }),
          ),
          { type: "separator" },
          { type: "item", label: "Remove keyframe", disabled: points.length <= 1 || !writer.removePoint, onSelect: () => writer.removePoint?.(propKey, frame) },
        ]
      : [{ type: "item", label: "Insert keyframe", onSelect: () => writer.commit(propKey, value, { frame }) }];
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Previous keyframe"
        disabled={prev === undefined}
        onClick={() => prev !== undefined && writer.seekToFrame(prev)}
        className={cn("inline-flex h-6 w-3.5 items-center justify-center text-fg-faint outline-none hover:text-fg disabled:invisible", !animated && "invisible")}
      >
        <ChevronLeft size={11} />
      </button>
      <ContextMenu items={menu}>
        <Tooltip label={here ? "Remove keyframe (right-click for interpolation)" : animated ? "Add keyframe here" : "Animate: add a keyframe here"} side="left">
          <button
            type="button"
            aria-label={here ? `Remove ${label} keyframe` : `Add ${label} keyframe`}
            aria-pressed={Boolean(here)}
            onClick={toggle}
            className={cn(
              "inline-flex h-6 w-5 items-center justify-center rounded-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
              here ? "text-keyframe" : animated ? "text-keyframe/70 hover:text-keyframe" : "text-fg-faint hover:text-fg-muted",
            )}
          >
            <Diamond size={11} fill={here ? "currentColor" : "none"} strokeWidth={2} />
          </button>
        </Tooltip>
      </ContextMenu>
      <button
        type="button"
        aria-label="Next keyframe"
        disabled={next === undefined}
        onClick={() => next !== undefined && writer.seekToFrame(next)}
        className={cn("inline-flex h-6 w-3.5 items-center justify-center text-fg-faint outline-none hover:text-fg disabled:invisible", !animated && "invisible")}
      >
        <ChevronRight size={11} />
      </button>
    </div>
  );
}

function TextValue({ value, onCommit, ariaLabel, disabled }: { value: string; onCommit: (v: string) => void; ariaLabel: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextInput
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      className="h-7"
    />
  );
}

export function Row({ label, children, trailing, title }: { label: ReactNode; children: ReactNode; trailing?: ReactNode; title?: string }) {
  return (
    <div className="grid min-h-[30px] grid-cols-[92px_minmax(0,1fr)_44px] items-center gap-x-1.5 px-3 py-[3px]" title={title}>
      <span className="truncate text-xs text-fg-subtle">{label}</span>
      <div className="min-w-0">{children}</div>
      <div className="flex justify-end">{trailing}</div>
    </div>
  );
}

/** One property: the right control for its kind, plus keyframe controls when keyframable. */
export function PropertyRow({ propKey, meta, raw, frame, writer, label, disabled }: PropertyRowProps) {
  const name = label ?? meta?.name ?? humanize(propKey);
  const readonly = disabled || meta?.readonly === true;
  const kind = valueKind(meta, raw);
  const choices = meta?.choices ?? [];

  if (kind === "keyframe") {
    const value = evaluate(raw as KeyframeLike, frame, 0);
    if (choices.length > 0) {
      const current = choices.find((c) => Number(c.value) === Math.round(value)) ?? choices[0]!;
      return (
        <Row label={name} trailing={<KeyframeButton raw={raw} frame={frame} value={Number(current.value)} propKey={propKey} writer={writer} label={name} />}>
          <Select<number>
            ariaLabel={name}
            value={Number(current.value)}
            disabled={readonly}
            options={choices.map((c) => ({ value: Number(c.value), label: c.name }))}
            onChange={(v) => writer.commit(propKey, v, keyframeTarget(raw, frame, writer.isArmed(propKey)))}
            className="w-full"
          />
        </Row>
      );
    }
    const fmt = numberFormat(meta?.min ?? null, meta?.max ?? null, propKey);
    const at = keyframeTarget(raw, frame, writer.isArmed(propKey));
    return (
      <Row label={name} trailing={readonly ? null : <KeyframeButton raw={raw} frame={frame} value={value} propKey={propKey} writer={writer} label={name} />}>
        <NumberField
          ariaLabel={name}
          value={value}
          min={meta?.min ?? undefined}
          max={meta?.max ?? undefined}
          step={fmt.step}
          precision={fmt.precision}
          scale={fmt.scale}
          unit={fmt.unit}
          disabled={readonly}
          animated={keyframeFrames(raw as KeyframeLike).length > 1 || writer.isArmed(propKey)}
          onScrub={(v) => writer.preview(propKey, v, at)}
          onScrubCancel={() => writer.endPreview()}
          onCommit={(v) => writer.commit(propKey, v, at)}
        />
      </Row>
    );
  }

  if (kind === "color") {
    const hex = colorHexAt(raw as never, frame);
    const channels = raw as { red?: unknown };
    const animated = keyframeFrames(channels?.red as KeyframeLike).length > 1;
    return (
      <Row label={name}>
        <ColorField
          ariaLabel={name}
          value={hex.slice(0, 7)}
          animated={animated}
          disabled={readonly}
          onScrub={(v) => writer.preview(propKey, v, animated ? { frame } : undefined)}
          onCommit={(v) => writer.commit(propKey, v, animated ? { frame } : undefined)}
        />
      </Row>
    );
  }

  if (kind === "bool") {
    return (
      <Row label={name}>
        <Switch label={name} checked={Boolean(raw)} disabled={readonly} onCheckedChange={(v) => writer.commit(propKey, v)} />
      </Row>
    );
  }

  if (kind === "number") {
    if (choices.length > 0) {
      const current = choices.find((c) => Number(c.value) === Number(raw)) ?? { value: Number(raw), name: String(raw) };
      return (
        <Row label={name}>
          <Select<number>
            ariaLabel={name}
            value={Number(current.value)}
            disabled={readonly}
            options={choices.map((c) => ({ value: Number(c.value), label: c.name }))}
            onChange={(v) => writer.commit(propKey, v)}
            className="w-full"
          />
        </Row>
      );
    }
    const fmt = numberFormat(meta?.min ?? null, meta?.max ?? null, propKey);
    return (
      <Row label={name}>
        <NumberField
          ariaLabel={name}
          value={Number(raw) || 0}
          min={meta?.min ?? undefined}
          max={meta?.max ?? undefined}
          step={fmt.step}
          precision={fmt.precision}
          scale={fmt.scale}
          unit={fmt.unit}
          disabled={readonly}
          onScrub={(v) => writer.preview(propKey, v)}
          onScrubCancel={() => writer.endPreview()}
          onCommit={(v) => writer.commit(propKey, v)}
        />
      </Row>
    );
  }

  if (kind === "string") {
    return (
      <Row label={name}>
        <TextValue ariaLabel={name} value={String(raw ?? "")} disabled={readonly} onCommit={(v) => writer.commit(propKey, v)} />
      </Row>
    );
  }

  return null;
}

/**
 * Where an edit lands: an animated property gets a point at this frame; a
 * constant one stays constant (the new value replaces it). The desktop always
 * writes a point at the current frame; the web editor asks for an explicit
 * keyframe (the diamond) before animating, which is what new users expect.
 */
function keyframeTarget(raw: unknown, frame: number, armed: boolean): KeyframeAt | undefined {
  return armed || keyframeFrames(raw as KeyframeLike).length > 1 ? { frame } : undefined;
}
