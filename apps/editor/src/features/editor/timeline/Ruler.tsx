import type { Fraction, Marker } from "@zenvi/engine";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { cn } from "@/ui/cn";
import { RULER_HEIGHT, rulerLabel, rulerScale, rulerTicks, visibleRange } from "./geometry";

export interface RulerHandle {
  /** Redraw ticks for a scroll offset (called on scroll, cheap). */
  draw(scrollLeft: number): void;
}

export interface RulerProps {
  pxPerSecond: number;
  fps: Fraction;
  markers: readonly Marker[];
  selectedMarkers: readonly string[];
  width: number;
  /** Timeline content width, px (for the marker layer). */
  contentWidth: number;
  onScrubStart: (seconds: number) => void;
  onScrub: (seconds: number) => void;
  onScrubEnd: () => void;
  onMarkerPointerDown: (marker: Marker, event: ReactPointerEvent) => void;
  onMarkerContextMenu: (marker: Marker) => void;
  /** Receives the element that follows the playhead (the head). */
  headRef: RefObject<HTMLDivElement | null>;
  /** Receives the layer translated by -scrollLeft. */
  layerRef: RefObject<HTMLDivElement | null>;
}

const MARKER_COLORS: Record<string, string> = {
  blue: "var(--color-marker-blue)",
  green: "var(--color-marker-green)",
  red: "var(--color-marker-red)",
  yellow: "var(--color-marker-yellow)",
  purple: "var(--color-marker-purple)",
  orange: "var(--color-marker-orange)",
  cyan: "var(--color-marker-cyan)",
  pink: "var(--color-marker-pink)",
};

export function markerColor(marker: Marker): string {
  const name = typeof marker.vector === "string" ? marker.vector : String(marker.icon ?? "blue").replace(/\.png$/, "");
  return MARKER_COLORS[name] ?? MARKER_COLORS.blue!;
}

let fontFamily: string | null = null;

export const Ruler = forwardRef<RulerHandle, RulerProps>(function Ruler(
  { pxPerSecond, fps, markers, selectedMarkers, width, contentWidth, onScrubStart, onScrub, onScrubEnd, onMarkerPointerDown, onMarkerContextMenu, headRef, layerRef },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastScroll = useRef(0);
  const scrubbing = useRef(false);

  const draw = useCallback(
    (scrollLeft: number) => {
      lastScroll.current = scrollLeft;
      const el = canvas.current;
      if (!el || width <= 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(RULER_HEIGHT * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(RULER_HEIGHT * dpr);
      }
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, RULER_HEIGHT);
      const scale = rulerScale(pxPerSecond, fps);
      const ticks = rulerTicks(visibleRange(scrollLeft, width, pxPerSecond, 80), scale);
      if (!fontFamily) fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";
      ctx.font = `500 10px ${fontFamily}`;
      ctx.textBaseline = "top";
      for (const tick of ticks) {
        const x = Math.round(tick.t * pxPerSecond - scrollLeft) + 0.5;
        if (x < -60 || x > width + 1) continue;
        if (tick.major) {
          ctx.fillStyle = "rgba(255,255,255,0.32)";
          ctx.fillRect(x, RULER_HEIGHT - 11, 1, 11);
          ctx.fillStyle = "rgba(255,255,255,0.52)";
          ctx.fillText(rulerLabel(tick.t, scale, fps), x + 4, 5);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.16)";
          ctx.fillRect(x, RULER_HEIGHT - 5, 1, 5);
        }
      }
    },
    [pxPerSecond, fps, width],
  );

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  useEffect(() => draw(lastScroll.current), [draw]);

  const timeAt = (e: ReactPointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left + lastScroll.current) / pxPerSecond);
  };

  return (
    <div
      className="relative h-[28px] shrink-0 cursor-text select-none overflow-hidden border-b border-line bg-raised"
      style={{ height: RULER_HEIGHT }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubbing.current = true;
        onScrubStart(timeAt(e));
      }}
      onPointerMove={(e) => {
        if (scrubbing.current) onScrub(timeAt(e));
      }}
      onPointerUp={() => {
        if (!scrubbing.current) return;
        scrubbing.current = false;
        onScrubEnd();
      }}
      onPointerCancel={() => {
        scrubbing.current = false;
        onScrubEnd();
      }}
      role="slider"
      aria-label="Timeline ruler: click or drag to move the playhead"
      aria-valuemin={0}
    >
      <canvas ref={canvas} aria-hidden className="absolute inset-0" style={{ width, height: RULER_HEIGHT }} />
      <div ref={layerRef} className="absolute inset-y-0 left-0 will-change-transform" style={{ width: contentWidth }}>
        {markers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            aria-label={`Marker at ${marker.position.toFixed(2)} s${marker.label ? `: ${marker.label}` : ""}`}
            title={marker.label ? String(marker.label) : undefined}
            onPointerDown={(e) => {
              e.stopPropagation();
              onMarkerPointerDown(marker, e);
            }}
            onContextMenu={() => onMarkerContextMenu(marker)}
            data-kind="marker"
            data-id={marker.id}
            className={cn(
              "absolute bottom-0 z-[2] h-[13px] w-[11px] -translate-x-1/2 outline-none",
              "[clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)] transition-transform hover:scale-110",
              selectedMarkers.includes(marker.id) && "ring-0 brightness-125",
            )}
            style={{ left: marker.position * pxPerSecond, background: markerColor(marker) }}
          />
        ))}
        <div ref={headRef} aria-hidden className="pointer-events-none absolute bottom-0 left-0 z-[3] will-change-transform">
          <div className="-ml-[5.5px] h-[11px] w-[11px] rounded-t-[2px] bg-playhead [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)]" />
        </div>
      </div>
    </div>
  );
});
