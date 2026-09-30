import type { Clip } from "@zenvi/engine";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useProjectSelector, useSession } from "../session/context";
import { WAVE_RESOLUTION } from "../session/previews";

export interface WaveformProps {
  fileId: string;
  clip: Clip;
  pxPerSecond: number;
  visibleFrom: number;
  visibleTo: number;
}

let waveColor: string | null = null;
function color(): string {
  if (!waveColor) waveColor = getComputedStyle(document.documentElement).getPropertyValue("--color-clip-wave").trim() || "rgba(255,255,255,0.6)";
  return waveColor;
}

/** Peak waveform for the visible part of a clip, drawn into one small canvas. */
export function Waveform({ fileId, clip, pxPerSecond, visibleFrom, visibleTo }: WaveformProps) {
  const session = useSession();
  const previews = session.previews;
  const peaks = useSyncExternalStore(
    (l) => previews.subscribe(l),
    () => previews.waveform(fileId),
  );
  const file = useProjectSelector((p) => p.files.find((f) => f.id === fileId), [fileId]);
  const status = useSyncExternalStore(
    (l) => session.media.status.subscribe(l),
    () => session.media.status.getState()[fileId]?.status,
  );
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!file || status !== "ready" || !file.has_audio) return;
    previews.requestWaveform(fileId, Number(file.duration) || 0);
  }, [file, fileId, previews, status]);

  const from = Math.max(0, Math.floor(visibleFrom));
  const width = Math.max(0, Math.ceil(visibleTo) - from);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !peaks || width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const h = el.clientHeight || 20;
    el.width = Math.ceil(width * dpr);
    el.height = Math.ceil(h * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);
    ctx.fillStyle = color();
    const mid = h / 2;
    const perPx = WAVE_RESOLUTION / pxPerSecond;
    for (let x = 0; x < width; x += 1) {
      const t0 = clip.start + (from + x) / pxPerSecond;
      const b0 = Math.floor(t0 * WAVE_RESOLUTION);
      const b1 = Math.max(b0 + 1, Math.floor(b0 + perPx));
      let peak = 0;
      for (let b = b0; b < b1 && b < peaks.length; b += 1) peak = Math.max(peak, peaks[b] ?? 0);
      const bar = Math.max(0.5, peak * (h - 2) * 0.5);
      ctx.fillRect(x, mid - bar, 1, bar * 2);
    }
  }, [peaks, width, from, pxPerSecond, clip.start]);

  if (!peaks || width <= 0) return null;
  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: from, width }} />;
}
