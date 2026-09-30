import { Maximize, Minimize, Pause, Play, Repeat, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/Controls";
import { Select } from "@/ui/Select";
import { shortcutFor } from "../commands";
import { useRunCommand } from "../layout/commandsContext";
import { createPreviewEngine } from "../render";
import { usePlayback, useProjectSelector, useSession } from "../session/context";
import { LiveTimecode } from "../timeline/TimelineToolbar";

type Zoom = "fit" | "0.5" | "1";

function fitRect(stageW: number, stageH: number, aspect: number, zoom: Zoom, projectW: number, projectH: number) {
  if (zoom !== "fit") {
    const scale = Number(zoom);
    return { width: Math.round(projectW * scale), height: Math.round(projectH * scale) };
  }
  const w = Math.max(0, stageW);
  const h = Math.max(0, stageH);
  if (w / h > aspect) return { width: Math.round(h * aspect), height: Math.round(h) };
  return { width: Math.round(w), height: Math.round(w / aspect) };
}

export function PreviewPanel() {
  const session = useSession();
  const run = useRunCommand();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [fullscreen, setFullscreen] = useState(false);
  const [renders, setRenders] = useState(true);
  const size = useProjectSelector((p) => `${p.width}x${p.height}`);
  const [projectW, projectH] = size.split("x").map(Number) as [number, number];
  const hasClips = useProjectSelector((p) => p.clips.length > 0);
  const playing = usePlayback((s) => s.playing);
  const loop = usePlayback((s) => s.loop);
  const missing = useStore(session.media.status, (s) => Object.values(s).filter((e) => e.status === "missing" || e.status === "error").length);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // One engine per mounted canvas.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const engine = createPreviewEngine({ canvas: el, media: session.media });
    session.attachEngine(engine);
    setRenders(engine.renders);
    return () => {
      session.detachEngine();
      engine.dispose();
    };
  }, [session]);

  const frame = fitRect(stageSize.width - 24, stageSize.height - 24, projectW / projectH, zoom, projectW, projectH);


  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stage.current?.parentElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = stage.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col bg-canvas">
      <div ref={stage} className={cn("relative min-h-0 flex-1", zoom === "fit" ? "grid place-items-center overflow-hidden" : "overflow-auto p-3")} onDoubleClick={toggleFullscreen}>
        <div className="relative shrink-0 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" style={{ width: frame.width, height: frame.height }}>
          <canvas ref={canvas} className="block h-full w-full" aria-label="Video preview" />
          {!hasClips ? (
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-md text-fg-subtle">Your video appears here</p>
                <p className="mt-1 text-xs text-fg-faint">
                  {projectW} × {projectH}
                </p>
              </div>
            </div>
          ) : !renders ? (
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <span className="rounded-md bg-black/70 px-2.5 py-1 text-xs text-fg-muted backdrop-blur-sm">
                Preview rendering isn&apos;t available in this build yet. Timing, editing and shortcuts work.
              </span>
            </div>
          ) : null}
          {missing > 0 ? (
            <button
              type="button"
              onClick={() => session.ui.setState({ dialog: "relink" })}
              className="absolute left-3 top-3 rounded-md bg-warning/90 px-2 py-1 text-xs font-medium text-black shadow hover:bg-warning"
            >
              {missing === 1 ? "1 file is missing" : `${missing} files are missing`} · Relink
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-t border-line bg-base px-2">
        <div className="w-[132px]">
          <LiveTimecode className="text-sm text-fg" />
        </div>
        <div className="flex flex-1 items-center justify-center gap-0.5">
          <IconButton label="Jump to start" shortcut={shortcutFor("actionJumpStart")} onClick={() => run("actionJumpStart")}>
            <SkipBack size={15} />
          </IconButton>
          <IconButton label="Previous frame" shortcut={shortcutFor("seekPreviousFrame")} onClick={() => run("seekPreviousFrame")}>
            <StepBack size={15} />
          </IconButton>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={() => run("playToggle")}
            className="mx-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-black outline-none transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
          >
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
          </button>
          <IconButton label="Next frame" shortcut={shortcutFor("seekNextFrame")} onClick={() => run("seekNextFrame")}>
            <StepForward size={15} />
          </IconButton>
          <IconButton label="Jump to end" shortcut={shortcutFor("actionJumpEnd")} onClick={() => run("actionJumpEnd")}>
            <SkipForward size={15} />
          </IconButton>
        </div>
        <div className="flex w-[132px] items-center justify-end gap-0.5">
          <IconButton label={loop ? "Loop on" : "Loop off"} active={loop} onClick={() => session.setLoop(!loop)}>
            <Repeat size={14} />
          </IconButton>
          <Select<Zoom>
            ariaLabel="Preview zoom"
            value={zoom}
            onChange={setZoom}
            className="w-[64px]"
            options={[
              { value: "fit", label: "Fit" },
              { value: "0.5", label: "50%" },
              { value: "1", label: "100%" },
            ]}
          />
          <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </IconButton>
        </div>
      </div>
    </section>
  );
}
