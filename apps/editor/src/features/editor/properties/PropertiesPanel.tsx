import {
  clipFrameAtTime,
  findClip,
  findTransition,
  itemEnd,
  moveEffect,
  removeEffect,
  setClipKeyframes,
  setClipProperty,
  setEffectProperty,
  setTransitionProperty,
  timeOfClipFrame,
  type Clip,
  type Effect,
  type KeyframePoint,
  type KeyframePointInput,
  type Project,
  type Timed,
  type Transition,
} from "@zenvi/engine";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, Film, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatDuration, formatFps } from "@/lib/format";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/Controls";
import { SearchInput } from "@/ui/Input";
import { clipProperties, effectEntry, transitionProperties, type PropertyMeta, type PropertyTable } from "../catalog";
import { useProject, useSession, useUi } from "../session/context";
import type { EditorSession } from "../session/EditorSession";
import { fileDisplayName } from "../session/media";
import { EMPTY_SELECTION } from "../session/uiStore";
import { CLIP_GROUPS, HIDDEN_EFFECT_KEYS, humanize, TRANSITION_GROUPS, type PropertyGroup } from "./groups";
import { PropertyRow, type KeyframeAt, type PropertyWriter } from "./PropertyRow";

/** The owner-local keyframe frame at the playhead; coarser while playing so the panel stays light. */
function usePlayheadFrame(item: Timed | undefined, project: Project): number {
  const session = useSession();
  const time = useSyncExternalStore(
    (l) => session.playback.subscribe(l),
    () => {
      const s = session.playback.getState();
      return s.playing ? Math.floor(s.time * 8) / 8 : s.time;
    },
  );
  return item ? clipFrameAtTime(item, time, project.fps) : 1;
}

function toInput(p: KeyframePoint): KeyframePointInput {
  return {
    frame: Math.round(p.co.X),
    value: p.co.Y,
    interpolation: p.interpolation,
    ...(p.handle_left ? { handleLeft: p.handle_left } : {}),
    ...(p.handle_right ? { handleRight: p.handle_right } : {}),
    ...(p.handle_type !== undefined ? { handleType: p.handle_type } : {}),
  };
}

function label(meta: PropertyMeta | undefined, key: string): string {
  return meta?.name ?? humanize(key);
}

function arming(session: EditorSession, ownerId: string): Pick<PropertyWriter, "ownerId" | "isArmed" | "arm"> {
  return {
    ownerId,
    isArmed: (key) => session.ui.getState().armedKeyframes.includes(`${ownerId}:${key}`),
    arm: (key) => {
      const id = `${ownerId}:${key}`;
      const list = session.ui.getState().armedKeyframes;
      if (!list.includes(id)) session.ui.setState({ armedKeyframes: [...list, id] });
    },
  };
}

function clipWriter(session: EditorSession, clipId: string, table: PropertyTable | null): PropertyWriter {
  const at = (a?: KeyframeAt) => (a ? { frame: a.frame, ...(a.interpolation !== undefined ? { interpolation: a.interpolation } : {}) } : {});
  return {
    ...arming(session, clipId),
    preview: (key, value, a) => session.preview((tx) => void setClipProperty(tx, clipId, key, value, at(a))),
    endPreview: () => session.endPreview(),
    commit: (key, value, a) => void session.edit(`Change ${label(table?.[key], key)}`, (tx) => setClipProperty(tx, clipId, key, value, at(a))),
    removePoint: (key, frame) =>
      void session.edit("Remove keyframe", (tx) => {
        const clip = findClip(tx.project, clipId);
        const points = ((clip?.[key] as { Points?: KeyframePoint[] } | undefined)?.Points ?? []).filter((p) => Math.round(p.co.X) !== frame);
        return setClipKeyframes(tx, clipId, key, points.map(toInput), { mode: "replace" });
      }),
    seekToFrame: (frame) => {
      const clip = findClip(session.project, clipId);
      if (clip) session.seek(timeOfClipFrame(clip, frame, session.project.fps));
    },
  };
}

function effectWriter(session: EditorSession, clip: Clip, effect: Effect, table: PropertyTable): PropertyWriter {
  const at = (a?: KeyframeAt) => (a ? { frame: a.frame, ...(a.interpolation !== undefined ? { interpolation: a.interpolation } : {}) } : {});
  return {
    ...arming(session, effect.id),
    preview: (key, value, a) => session.preview((tx) => void setEffectProperty(tx, effect.id, key, value, at(a))),
    endPreview: () => session.endPreview(),
    commit: (key, value, a) => void session.edit(`Change ${label(table[key], key)}`, (tx) => setEffectProperty(tx, effect.id, key, value, at(a))),
    seekToFrame: (frame) => session.seek(timeOfClipFrame(clip, frame, session.project.fps)),
  };
}

function transitionWriter(session: EditorSession, transition: Transition, table: PropertyTable | null): PropertyWriter {
  const at = (a?: KeyframeAt) => (a ? { frame: a.frame, ...(a.interpolation !== undefined ? { interpolation: a.interpolation } : {}) } : {});
  return {
    ...arming(session, transition.id),
    preview: (key, value, a) => session.preview((tx) => void setTransitionProperty(tx, transition.id, key, value, at(a))),
    endPreview: () => session.endPreview(),
    commit: (key, value, a) => void session.edit(`Change ${label(table?.[key], key)}`, (tx) => setTransitionProperty(tx, transition.id, key, value, at(a))),
    seekToFrame: (frame) => session.seek(timeOfClipFrame(transition, frame, session.project.fps)),
  };
}

function Section({ title, children, defaultOpen = true, actions }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line py-1">
      <div className="flex items-center pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 flex-1 items-center gap-1 px-3 text-left text-2xs font-semibold uppercase tracking-wider text-fg-subtle outline-none hover:text-fg-muted focus-visible:text-fg"
        >
          <ChevronDown size={12} className={cn("transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
        {actions}
      </div>
      {open ? <div className="pb-1.5">{children}</div> : null}
    </section>
  );
}

function Groups({
  groups,
  table,
  item,
  frame,
  writer,
  filter,
  readonlyKeys,
}: {
  groups: readonly PropertyGroup[];
  table: PropertyTable | null;
  item: Record<string, unknown>;
  frame: number;
  writer: PropertyWriter;
  filter: string;
  readonlyKeys?: ReadonlySet<string>;
}) {
  const q = filter.trim().toLowerCase();
  return (
    <>
      {groups.map((group) => {
        const keys = group.keys.filter((k) => k in item && (!q || label(table?.[k], k).toLowerCase().includes(q)));
        if (keys.length === 0) return null;
        return (
          <Section key={group.title} title={group.title} defaultOpen={q ? true : !group.collapsed}>
            {keys.map((key) => (
              <PropertyRow key={key} propKey={key} meta={table?.[key]} raw={item[key]} frame={frame} writer={writer} disabled={readonlyKeys?.has(key)} />
            ))}
          </Section>
        );
      })}
    </>
  );
}

function EffectsSection({ clip }: { clip: Clip }) {
  const session = useSession();
  const effects = clip.effects ?? [];
  return (
    <Section title={`Effects${effects.length ? ` (${effects.length})` : ""}`}>
      {effects.length === 0 ? (
        <p className="px-3 pb-1 text-xs text-fg-subtle">Drag an effect from the Effects library onto this clip.</p>
      ) : (
        <ul className="px-1.5">
          {effects.map((effect, index) => (
            <li key={effect.id} className="group flex items-center gap-1 rounded-md pr-1 hover:bg-white/[0.04]">
              <button
                type="button"
                onClick={() => session.ui.setState({ selection: { ...session.ui.getState().selection, effect: effect.id } })}
                className="flex h-8 min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Sparkles size={13} className="shrink-0 text-accent-hover" />
                <span className="truncate">{effect.name || effectEntry(effect.class_name)?.name || effect.class_name}</span>
              </button>
              <IconButton size="xs" label="Move up" disabled={index === 0} onClick={() => session.edit("Reorder effects", (tx) => moveEffect(tx, effect.id, "down"))}>
                <ArrowUp size={12} />
              </IconButton>
              <IconButton size="xs" label="Move down" disabled={index === effects.length - 1} onClick={() => session.edit("Reorder effects", (tx) => moveEffect(tx, effect.id, "up"))}>
                <ArrowDown size={12} />
              </IconButton>
              <IconButton size="xs" label={`Remove ${effect.name || effect.class_name}`} onClick={() => session.edit("Remove effect", (tx) => removeEffect(tx, effect.id))}>
                <Trash2 size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ClipInspector({ clip, project, filter }: { clip: Clip; project: Project; filter: string }) {
  const session = useSession();
  const frame = usePlayheadFrame(clip, project);
  const table = clipProperties();
  const writer = useMemo(() => clipWriter(session, clip.id, table), [session, clip.id, table]);
  const file = project.files.find((f) => f.id === clip.file_id);
  const item = { ...clip, duration: clip.end - clip.start } as Record<string, unknown>;
  return (
    <>
      <div className="flex items-start gap-2.5 border-b border-line px-3 py-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-clip-video-head/40 text-fg-muted">
          <Film size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{(typeof clip.title === "string" && clip.title) || (file ? fileDisplayName(file) : "Clip")}</p>
          <p className="truncate text-xs text-fg-subtle">
            {formatDuration(clip.end - clip.start)} · at {formatDuration(clip.position)} · frame {frame}
          </p>
        </div>
      </div>
      <Groups groups={CLIP_GROUPS} table={table} item={item} frame={frame} writer={writer} filter={filter} readonlyKeys={new Set(["duration"])} />
      {!filter ? <EffectsSection clip={clip} /> : null}
    </>
  );
}

function EffectInspector({ clip, effect, project, filter }: { clip: Clip; effect: Effect; project: Project; filter: string }) {
  const session = useSession();
  const frame = usePlayheadFrame(clip, project);
  const entry = effectEntry(effect.class_name);
  const table = entry?.properties ?? {};
  const writer = useMemo(() => effectWriter(session, clip, effect, table), [session, clip, effect, table]);
  const q = filter.trim().toLowerCase();
  const keys = Object.keys(effect).filter((k) => !HIDDEN_EFFECT_KEYS.has(k) && !k.startsWith("mask_") && (!q || label(table[k], k).toLowerCase().includes(q)));
  const maskKeys = Object.keys(effect).filter((k) => k.startsWith("mask_") && k !== "mask_reader" && k !== "mask_source_id");
  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-line px-1.5 py-2">
        <IconButton size="sm" label="Back to clip" onClick={() => session.ui.setState({ selection: { ...session.ui.getState().selection, effect: null } })}>
          <ChevronLeft size={15} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{effect.name || entry?.name || effect.class_name}</p>
          <p className="truncate text-xs text-fg-subtle">{entry?.description ?? effect.class_name}</p>
        </div>
      </div>
      <Section title="Parameters">
        {keys.length === 0 ? <p className="px-3 text-xs text-fg-subtle">This effect has no parameters.</p> : null}
        {keys.map((key) => (
          <PropertyRow key={key} propKey={key} meta={table[key]} raw={effect[key]} frame={frame} writer={writer} />
        ))}
      </Section>
      {maskKeys.length && !q ? (
        <Section title="Mask" defaultOpen={false}>
          {maskKeys.map((key) => (
            <PropertyRow key={key} propKey={key} meta={table[key]} raw={effect[key]} frame={frame} writer={writer} />
          ))}
        </Section>
      ) : null}
    </>
  );
}

function TransitionInspector({ transition, project, filter }: { transition: Transition; project: Project; filter: string }) {
  const session = useSession();
  const frame = usePlayheadFrame(transition, project);
  const table = transitionProperties();
  const writer = useMemo(() => transitionWriter(session, transition, table), [session, transition, table]);
  const item = { ...transition, duration: transition.end - transition.start } as Record<string, unknown>;
  return (
    <>
      <div className="border-b border-line px-3 py-3">
        <p className="truncate text-sm font-semibold text-fg">{(typeof transition.title === "string" && transition.title) || "Transition"}</p>
        <p className="truncate text-xs text-fg-subtle">
          {formatDuration(transition.end - transition.start)} · {formatDuration(transition.position)}–{formatDuration(itemEnd(transition))}
        </p>
      </div>
      <Groups groups={TRANSITION_GROUPS} table={table} item={item} frame={frame} writer={writer} filter={filter} readonlyKeys={new Set(["duration", "layer"])} />
    </>
  );
}

function ProjectSummary({ project }: { project: Project }) {
  const session = useSession();
  return (
    <div className="flex flex-col gap-4 px-3 py-4">
      <div>
        <p className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">Project format</p>
        <p className="mt-1 text-sm text-fg">{project.profile || `${project.width} × ${project.height}`}</p>
        <p className="text-xs text-fg-subtle">
          {project.width} × {project.height} · {formatFps(project.fps)} · {project.sample_rate} Hz
        </p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => session.ui.setState({ dialog: "profile" })}>
          Change format…
        </Button>
      </div>
      <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-fg-subtle">
        Select a clip or transition on the timeline to edit its properties.
      </p>
    </div>
  );
}

export function PropertiesPanel() {
  const project = useProject();
  const selection = useUi((s) => s.selection);
  useUi((s) => s.armedKeyframes);
  const [filter, setFilter] = useState("");
  const session = useSession();

  const clip = selection.clips.length === 1 ? findClip(project, selection.clips[0]!) : undefined;
  const effect = clip && selection.effect ? clip.effects?.find((e) => e.id === selection.effect) : undefined;
  const transition = !clip && selection.transitions.length === 1 && selection.clips.length === 0 ? findTransition(project, selection.transitions[0]!) : undefined;
  const count = selection.clips.length + selection.transitions.length;

  let body: ReactNode;
  if (clip && effect) body = <EffectInspector clip={clip} effect={effect} project={project} filter={filter} />;
  else if (clip) body = <ClipInspector clip={clip} project={project} filter={filter} />;
  else if (transition) body = <TransitionInspector transition={transition} project={project} filter={filter} />;
  else if (count > 1)
    body = (
      <div className="px-3 py-6 text-center">
        <p className="text-sm text-fg-muted">{count} items selected</p>
        <p className="mt-1 text-xs text-fg-subtle">Right-click a clip for fades, motion and speed presets that apply to all of them.</p>
        <Button size="sm" variant="ghost" className="mt-3" onClick={() => session.ui.setState({ selection: EMPTY_SELECTION })}>
          Clear selection
        </Button>
      </div>
    );
  else body = <ProjectSummary project={project} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {clip || transition ? (
        <div className="shrink-0 border-b border-line px-3 py-2">
          <SearchInput value={filter} onValueChange={setFilter} placeholder="Filter properties" aria-label="Filter properties" />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}

