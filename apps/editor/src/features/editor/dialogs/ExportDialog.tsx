import { defaultExportEnd, timelineEnd } from "@zenvi/engine";
import { Cloud, Download, FileVideo, Monitor, RectangleHorizontal, RectangleVertical, Square, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { useAuth } from "@/lib/auth";
import { cloudClient, type RenderStatus } from "@/lib/cloud";
import { cloudEnabled } from "@/lib/env";
import { formatBytes, formatDuration } from "@/lib/format";
import { downloadBlob, safeFileName } from "@/lib/projectFactory";
import { secondsToTimecode } from "@/lib/timecode";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Switch } from "@/ui/Controls";
import { Dialog } from "@/ui/Dialog";
import { NumberField } from "@/ui/NumberField";
import { Select } from "@/ui/Select";
import { ProgressBar } from "@/ui/Spinner";
import { exportAvailable, exportFailure, extensionForMime, startExport, type ExportJob } from "../render";
import { useProject, useSession } from "../session/context";
import {
  activePick,
  choiceFor,
  cloudRenderOptions,
  describeChoice,
  exportOptionsFor,
  presetById,
  profileOptions,
  projectTypeOptions,
  QUICK_PICKS,
  qualityOptions,
  targetHasSound,
  targetOptions,
  targetSupport,
  type ExportChoice,
  type QuickPick,
} from "./exportPlan";

const PICK_ICONS: Record<QuickPick["shape"], ReactNode> = {
  project: <Monitor size={16} />,
  landscape: <RectangleHorizontal size={16} />,
  portrait: <RectangleVertical size={16} />,
  square: <Square size={16} />,
  file: <FileVideo size={16} />,
};

type Phase =
  | { kind: "setup" }
  | { kind: "running"; fraction: number; stage: string; startedAt: number; target: "browser" | "cloud" }
  | { kind: "done"; blob?: Blob; url?: string; name: string; seconds: number; notes: string[] }
  /** The browser has no audio encoder: the person decides (never drop sound silently). */
  | { kind: "noAudio" }
  | { kind: "error"; message: string; cloudHint?: boolean };

/** The exporter's own note when sound was dropped on request (the person already chose it). */
const VIDEO_ONLY_NOTE = /no audio encoder is available; exporting video only/i;

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const project = useProject();
  const signedIn = useAuth((s) => s.status === "signed-in");
  const cloudLink = useStore(session.meta, (m) => m.cloud);
  const end = timelineEnd(project);
  const [choice, setChoice] = useState<ExportChoice>(() => choiceFor(project, presetById(QUICK_PICKS[0]!.presetId)));
  const [range, setRange] = useState<"all" | "custom">("all");
  const [rangeValue, setRangeValue] = useState({ start: 0, end });
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const job = useRef<ExportJob | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase({ kind: "setup" });
    setRangeValue({ start: 0, end: timelineEnd(session.project) });
  }, [open, session]);

  useEffect(
    () => () => {
      job.current?.cancel();
      if (poll.current) clearInterval(poll.current);
    },
    [],
  );

  const preset = presetById(choice.presetId);
  const support = targetSupport(preset);
  const cloudPossible = signedIn && cloudEnabled();
  const exportRange = range === "custom" ? { start: Math.max(0, rangeValue.start), end: Math.max(rangeValue.start + 0.04, rangeValue.end) } : undefined;
  const effective: ExportChoice = { ...choice, ...(exportRange ? { range: exportRange } : {}) };
  const options = exportOptionsFor(project, effective);
  const summary = describeChoice(project, effective);
  // "All" stops at the last picture, as the exporter does (sound past it is left out).
  const length = exportRange ? exportRange.end - exportRange.start : defaultExportEnd(project, options.format !== "wav").end;
  const name = session.meta.getState().name;
  const browserOk = support.browser && exportAvailable;

  const pickPreset = (presetId: string) => setChoice((c) => ({ ...choiceFor(project, presetById(presetId)), sound: c.sound }));

  const runBrowser = (allowVideoOnly = false) => {
    const startedAt = performance.now();
    const notes: string[] = [];
    const soundOff = !effective.sound || allowVideoOnly;
    setPhase({ kind: "running", fraction: 0, stage: "Rendering video", startedAt, target: "browser" });
    const current = startExport(
      session.project,
      options,
      (fraction, stage) =>
        setPhase({ kind: "running", fraction, stage: stage === "audio" ? "Mixing audio" : stage === "finalizing" ? "Finishing file" : "Rendering video", startedAt, target: "browser" }),
      session.media,
      {
        // "No sound" uses channels 0; the exporter then needs leave to skip audio.
        allowVideoOnly: soundOff,
        onNotes: (n) => notes.push(...n.filter((note) => !(soundOff && VIDEO_ONLY_NOTE.test(note)))),
      },
    );
    job.current = current;
    current.promise
      .then((blob) => {
        job.current = null;
        const fileName = safeFileName(name, extensionForMime(blob.type));
        downloadBlob(blob, fileName);
        if (allowVideoOnly) notes.unshift("Exported without sound: this browser cannot encode audio.");
        setPhase({ kind: "done", blob, name: fileName, seconds: (performance.now() - startedAt) / 1000, notes });
      })
      .catch((error: unknown) => {
        job.current = null;
        const failure = exportFailure(error);
        if (failure === "aborted") setPhase({ kind: "setup" });
        else if (failure === "no-audio-encoder") setPhase({ kind: "noAudio" });
        else setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error), cloudHint: failure === "no-encoder" });
      });
  };

  const runCloud = async () => {
    if (!cloudLink) return;
    const startedAt = performance.now();
    setPhase({ kind: "running", fraction: 0, stage: "Queued in Zenvi Cloud", startedAt, target: "cloud" });
    try {
      await session.saveCloud();
      const started = await cloudClient().startRender(cloudLink.id, { options: cloudRenderOptions(options) });
      const check = async () => {
        let status: RenderStatus;
        try {
          status = await cloudClient().getRender(cloudLink.id, started.renderId);
        } catch (error) {
          if (poll.current) clearInterval(poll.current);
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
          return;
        }
        if (status.status === "done" && status.url) {
          if (poll.current) clearInterval(poll.current);
          setPhase({ kind: "done", url: status.url, name: safeFileName(name, options.format), seconds: (performance.now() - startedAt) / 1000, notes: [] });
        } else if (status.status === "error") {
          if (poll.current) clearInterval(poll.current);
          setPhase({ kind: "error", message: status.error ?? "The cloud render failed." });
        } else {
          setPhase({ kind: "running", fraction: status.progress ?? 0, stage: status.status === "queued" ? "Queued in Zenvi Cloud" : "Rendering in Zenvi Cloud", startedAt, target: "cloud" });
        }
      };
      poll.current = setInterval(() => void check(), 2000);
      void check();
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const cancel = () => {
    job.current?.cancel();
    if (poll.current) clearInterval(poll.current);
    setPhase({ kind: "setup" });
  };

  const running = phase.kind === "running";
  const cloudButton = cloudPossible && support.cloud ? (
    <Button variant={browserOk ? "secondary" : "primary"} icon={<Cloud size={14} />} disabled={!cloudLink || end <= 0} onClick={() => void runCloud()} title={cloudLink ? undefined : "Share the project to Zenvi Cloud first"}>
      Render in Zenvi Cloud
    </Button>
  ) : null;

  let footer: ReactNode;
  if (phase.kind === "running") {
    footer = (
      <Button variant="secondary" onClick={cancel}>
        Cancel
      </Button>
    );
  } else if (phase.kind === "done") {
    footer = (
      <>
        {phase.blob ? (
          <Button variant="secondary" icon={<Download size={14} />} onClick={() => phase.blob && downloadBlob(phase.blob, phase.name)}>
            Download again
          </Button>
        ) : phase.url ? (
          <Button variant="secondary" icon={<Download size={14} />} onClick={() => window.open(phase.url, "_blank", "noopener")}>
            Download
          </Button>
        ) : null}
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </>
    );
  } else if (phase.kind === "noAudio") {
    footer = (
      <>
        <Button variant="secondary" onClick={() => setPhase({ kind: "setup" })}>
          Back
        </Button>
        {cloudButton}
        <Button variant={cloudButton ? "secondary" : "primary"} icon={<VolumeX size={14} />} onClick={() => runBrowser(true)}>
          Export without sound
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        {cloudButton}
        {support.browser ? (
          <Button variant="primary" icon={<Download size={14} />} disabled={!exportAvailable || end <= 0} onClick={() => runBrowser()}>
            Export
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !running && onClose()}
      dismissible={!running}
      title="Export video"
      description={`${formatDuration(length)} · ${preset.title}`}
      width={600}
      footer={footer}
    >
      {phase.kind === "running" ? (
        <div className="py-6">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-fg">{phase.stage}…</span>
            <span className="tnum text-fg-subtle">{Math.round(phase.fraction * 100)}%</span>
          </div>
          <ProgressBar value={phase.fraction > 0 ? phase.fraction : null} />
          <p className="mt-3 text-xs text-fg-subtle">
            {phase.target === "browser" ? "Keep this tab open. Rendering happens on your computer." : "You can close this dialog; the render keeps going in the cloud."}
          </p>
        </div>
      ) : phase.kind === "done" ? (
        <div className="py-4 text-sm">
          <p className="text-fg">{phase.blob ? `Saved ${phase.name}` : "Your render is ready."}</p>
          <p className="mt-1 text-xs text-fg-subtle">
            {phase.blob ? `${formatBytes(phase.blob.size)} · ` : ""}took {formatDuration(phase.seconds)}
          </p>
          {phase.notes.length > 0 ? (
            <ul className="mt-3 space-y-1 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
              {phase.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : phase.kind === "noAudio" ? (
        <div className="space-y-2 py-2 text-sm">
          <p className="text-fg">This browser can&apos;t encode sound.</p>
          <p className="text-fg-subtle">
            It has no AAC, Opus or Vorbis encoder, so neither MP4 nor WebM can carry your audio. Export the picture without sound, or
            {cloudPossible ? " render the full file in Zenvi Cloud." : " sign in to render the full file in Zenvi Cloud, or use Chrome or Edge."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {phase.kind === "error" ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {phase.message}
              {phase.cloudHint && cloudPossible ? " Render in Zenvi Cloud instead." : ""}
            </p>
          ) : null}
          {support.browser && !exportAvailable ? (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              This browser can&apos;t encode video. {cloudPossible ? "Render in Zenvi Cloud instead." : "Sign in to render in Zenvi Cloud, or use Chrome or Edge."}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Quick targets">
            {QUICK_PICKS.map((pick) => {
              const active = activePick(choice) === pick.id;
              return (
                <button
                  key={pick.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickPreset(pick.presetId)}
                  className={cn(
                    "flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                    active ? "border-accent bg-accent/[0.12]" : "border-line-strong hover:border-line-bright hover:bg-white/[0.03]",
                  )}
                >
                  <span className={cn(active ? "text-accent-hover" : "text-fg-subtle")}>{PICK_ICONS[pick.shape]}</span>
                  <span className="text-sm font-medium text-fg">{pick.label}</span>
                  <span className="text-xs text-fg-subtle">{pick.shape === "project" ? `${project.width} × ${project.height}` : pick.hint}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-fg-subtle">Project type</span>
              <Select<string>
                ariaLabel="Project type"
                value={preset.type}
                options={projectTypeOptions()}
                onChange={(type) => {
                  const first = targetOptions(type, cloudPossible).find((o) => !o.disabled) ?? targetOptions(type, cloudPossible)[0];
                  if (first) pickPreset(first.value);
                }}
                className="w-full"
                size="md"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-fg-subtle">Target</span>
              <Select<string> ariaLabel="Target" value={preset.id} options={targetOptions(preset.type, cloudPossible)} onChange={pickPreset} className="w-full" size="md" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-fg-subtle">Video profile</span>
              <Select<string>
                ariaLabel="Video profile"
                value={choice.profile}
                options={profileOptions(project, preset)}
                onChange={(profile) => setChoice((c) => ({ ...c, profile }))}
                className="w-full"
                size="md"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-fg-subtle">Quality</span>
              <Select<string>
                ariaLabel="Quality"
                value={choice.quality}
                options={qualityOptions(preset)}
                onChange={(quality) => setChoice((c) => ({ ...c, quality: quality as ExportChoice["quality"] }))}
                className="w-full"
                size="md"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg bg-white/[0.03] px-3 py-2.5">
            <p className="min-w-0 truncate text-xs text-fg-muted" title={summary}>
              {summary}
            </p>
            {targetHasSound(preset) ? (
              <span className="flex shrink-0 items-center gap-2 text-xs text-fg-subtle">
                Sound
                <Switch label="Include sound" checked={choice.sound} onCheckedChange={(sound) => setChoice((c) => ({ ...c, sound }))} />
              </span>
            ) : null}
          </div>

          {!support.browser ? (
            <p className="rounded-md bg-white/[0.04] px-3 py-2 text-xs text-fg-subtle">
              {support.cloud
                ? cloudPossible
                  ? cloudLink
                    ? `${preset.title} renders in Zenvi Cloud.`
                    : `${preset.title} renders in Zenvi Cloud. Share the project to the cloud first (Share, top right).`
                  : `${preset.title} renders in Zenvi Cloud. Sign in to use it.`
                : `${preset.title} needs the Zenvi desktop app.`}
            </p>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs text-fg-subtle">Range</p>
            <div className="flex gap-2">
              {(["all", "custom"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={range === r}
                  onClick={() => setRange(r)}
                  className={cn(
                    "h-8 rounded-md border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                    range === r ? "border-accent bg-accent/[0.12] text-fg" : "border-line-strong text-fg-muted hover:border-line-bright",
                  )}
                >
                  {r === "all" ? `Whole timeline (${formatDuration(end)})` : "Part of it"}
                </button>
              ))}
            </div>
            {range === "custom" ? (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="space-y-1">
                  <span className="text-xs text-fg-subtle">From ({secondsToTimecode(rangeValue.start, project.fps)})</span>
                  <NumberField ariaLabel="Range start" value={rangeValue.start} min={0} max={end} step={0.1} precision={2} unit="s" onCommit={(v) => setRangeValue((r) => ({ ...r, start: v }))} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-fg-subtle">To ({secondsToTimecode(rangeValue.end, project.fps)})</span>
                  <NumberField ariaLabel="Range end" value={rangeValue.end} min={0} step={0.1} precision={2} unit="s" onCommit={(v) => setRangeValue((r) => ({ ...r, end: v }))} />
                </label>
              </div>
            ) : null}
          </div>
          {cloudPossible && !cloudLink && support.browser ? <p className="text-xs text-fg-subtle">To render in Zenvi Cloud, share this project to the cloud first (Share, top right).</p> : null}
        </div>
      )}
    </Dialog>
  );
}
