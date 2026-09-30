import { timelineEnd, type ExportOptions } from "@zenvi/engine";
import { Cloud, Download, Monitor, RectangleHorizontal, RectangleVertical, Settings2, Square } from "lucide-react";
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
import { Dialog } from "@/ui/Dialog";
import { NumberField } from "@/ui/NumberField";
import { Select } from "@/ui/Select";
import { ProgressBar } from "@/ui/Spinner";
import { exportAvailable, startExport, type ExportJob } from "../render";
import { useProject, useSession } from "../session/context";

type PresetId = "project" | "1080p" | "4k" | "vertical" | "square" | "custom";

interface Preset {
  id: PresetId;
  label: string;
  hint: string;
  icon: ReactNode;
  size?: { width: number; height: number };
  cloudPreset?: string;
}

const PRESETS: Preset[] = [
  { id: "project", label: "Match project", hint: "Same size as the timeline", icon: <Monitor size={16} /> },
  { id: "1080p", label: "YouTube 1080p", hint: "1920 × 1080", icon: <RectangleHorizontal size={16} />, size: { width: 1920, height: 1080 }, cloudPreset: "mp4-1080p" },
  { id: "4k", label: "4K", hint: "3840 × 2160", icon: <RectangleHorizontal size={16} />, size: { width: 3840, height: 2160 }, cloudPreset: "mp4-2160p" },
  { id: "vertical", label: "Vertical", hint: "TikTok · Reels · Shorts", icon: <RectangleVertical size={16} />, size: { width: 1080, height: 1920 } },
  { id: "square", label: "Square", hint: "1080 × 1080", icon: <Square size={16} />, size: { width: 1080, height: 1080 } },
  { id: "custom", label: "Custom", hint: "Size, frame rate, quality", icon: <Settings2 size={16} /> },
];

type Quality = NonNullable<ExportOptions["quality"]>;

type Phase =
  | { kind: "setup" }
  | { kind: "running"; fraction: number; stage: string; startedAt: number; target: "browser" | "cloud" }
  | { kind: "done"; blob?: Blob; url?: string; name: string; seconds: number }
  | { kind: "error"; message: string };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const project = useProject();
  const signedIn = useAuth((s) => s.status === "signed-in");
  const cloudLink = useStore(session.meta, (m) => m.cloud);
  const end = timelineEnd(project);
  const [preset, setPreset] = useState<PresetId>("project");
  const [custom, setCustom] = useState({ width: project.width, height: project.height, fps: `${project.fps.num}/${project.fps.den}`, quality: "high" as Quality });
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

  useEffect(() => () => {
    job.current?.cancel();
    if (poll.current) clearInterval(poll.current);
  }, []);

  const size = (() => {
    const p = PRESETS.find((x) => x.id === preset)!;
    if (preset === "custom") return { width: even(custom.width), height: even(custom.height) };
    return p.size ?? { width: project.width, height: project.height };
  })();
  const fps = (() => {
    if (preset !== "custom") return project.fps;
    const [num, den] = custom.fps.split("/").map(Number);
    return { num: num || project.fps.num, den: den || 1 };
  })();
  const quality: Quality = preset === "custom" ? custom.quality : "high";
  const exportRange = range === "custom" ? { start: Math.max(0, rangeValue.start), end: Math.max(rangeValue.start + 0.04, rangeValue.end) } : undefined;
  const options: ExportOptions = { format: "mp4", width: size.width, height: size.height, fps, quality, ...(exportRange ? { range: exportRange } : {}) };
  const length = exportRange ? exportRange.end - exportRange.start : end;
  const name = session.meta.getState().name;

  const runBrowser = () => {
    const startedAt = performance.now();
    setPhase({ kind: "running", fraction: 0, stage: "Rendering video", startedAt, target: "browser" });
    const current = startExport(
      session.project,
      options,
      (fraction, stage) =>
        setPhase({ kind: "running", fraction, stage: stage === "audio" ? "Mixing audio" : stage === "finalizing" ? "Finishing file" : "Rendering video", startedAt, target: "browser" }),
      session.media,
    );
    job.current = current;
    current.promise
      .then((blob) => {
        job.current = null;
        const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("quicktime") ? "mov" : "mp4";
        const fileName = safeFileName(name, ext);
        downloadBlob(blob, fileName);
        setPhase({ kind: "done", blob, name: fileName, seconds: (performance.now() - startedAt) / 1000 });
      })
      .catch((error: unknown) => {
        job.current = null;
        if ((error as { name?: string }).name === "AbortError") setPhase({ kind: "setup" });
        else setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      });
  };

  const runCloud = async () => {
    if (!cloudLink) return;
    const startedAt = performance.now();
    setPhase({ kind: "running", fraction: 0, stage: "Queued in Zenvi Cloud", startedAt, target: "cloud" });
    try {
      await session.saveCloud();
      const p = PRESETS.find((x) => x.id === preset);
      const request = p?.cloudPreset && !exportRange ? { preset: p.cloudPreset } : { options: { format: "mp4", width: size.width, height: size.height, fps, quality, ...(exportRange ? { range: exportRange } : {}) } };
      const started = await cloudClient().startRender(cloudLink.id, request);
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
          setPhase({ kind: "done", url: status.url, name: safeFileName(name, "mp4"), seconds: (performance.now() - startedAt) / 1000 });
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
  const cloudPossible = signedIn && cloudEnabled();

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
  } else {
    footer = (
      <>
        {cloudPossible ? (
          <Button variant="secondary" icon={<Cloud size={14} />} disabled={!cloudLink || end <= 0} onClick={() => void runCloud()} title={cloudLink ? undefined : "Share the project to Zenvi Cloud first"}>
            Render in Zenvi Cloud
          </Button>
        ) : null}
        <Button variant="primary" icon={<Download size={14} />} disabled={!exportAvailable || end <= 0} onClick={runBrowser}>
          Export
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !running && onClose()} dismissible={!running} title="Export video" description={`${formatDuration(length)} · ${size.width} × ${size.height} · ${(fps.num / fps.den).toFixed(fps.den === 1 ? 0 : 2)} fps`} width={560} footer={footer}>
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
        </div>
      ) : (
        <div className="space-y-5">
          {phase.kind === "error" ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{phase.message}</p> : null}
          {!exportAvailable ? (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              This browser can&apos;t encode video. {cloudPossible ? "Render in Zenvi Cloud instead." : "Sign in to render in Zenvi Cloud, or use Chrome or Edge."}
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset === p.id}
                onClick={() => setPreset(p.id)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  preset === p.id ? "border-accent bg-accent/[0.12]" : "border-line-strong hover:border-line-bright hover:bg-white/[0.03]",
                )}
              >
                <span className={cn(preset === p.id ? "text-accent-hover" : "text-fg-subtle")}>{p.icon}</span>
                <span className="text-sm font-medium text-fg">{p.label}</span>
                <span className="text-xs text-fg-subtle">{p.id === "project" ? `${project.width} × ${project.height}` : p.hint}</span>
              </button>
            ))}
          </div>

          {preset === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-fg-subtle">Width</span>
                <NumberField ariaLabel="Width" value={custom.width} min={16} max={7680} step={2} precision={0} unit="px" onCommit={(v) => setCustom((c) => ({ ...c, width: Math.round(v) }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-fg-subtle">Height</span>
                <NumberField ariaLabel="Height" value={custom.height} min={16} max={4320} step={2} precision={0} unit="px" onCommit={(v) => setCustom((c) => ({ ...c, height: Math.round(v) }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-fg-subtle">Frame rate</span>
                <Select<string>
                  ariaLabel="Frame rate"
                  value={custom.fps}
                  onChange={(v) => setCustom((c) => ({ ...c, fps: v }))}
                  className="w-full"
                  options={[
                    { value: `${project.fps.num}/${project.fps.den}`, label: "Match project" },
                    { value: "24/1", label: "24 fps" },
                    { value: "25/1", label: "25 fps" },
                    { value: "30000/1001", label: "29.97 fps" },
                    { value: "30/1", label: "30 fps" },
                    { value: "50/1", label: "50 fps" },
                    { value: "60/1", label: "60 fps" },
                  ]}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-fg-subtle">Quality</span>
                <Select<Quality>
                  ariaLabel="Quality"
                  value={custom.quality}
                  onChange={(v) => setCustom((c) => ({ ...c, quality: v }))}
                  className="w-full"
                  options={[
                    { value: "low", label: "Low (small file)" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                    { value: "lossless", label: "Very high" },
                  ]}
                />
              </label>
            </div>
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
          {cloudPossible && !cloudLink ? <p className="text-xs text-fg-subtle">To render in Zenvi Cloud, share this project to the cloud first (Share, top right).</p> : null}
        </div>
      )}
    </Dialog>
  );
}
