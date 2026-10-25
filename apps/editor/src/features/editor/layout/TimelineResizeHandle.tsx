import { useRef } from "react";
import { ResizeHandle } from "@/ui/ResizeHandle";
import { useSession } from "../session/context";
import { savePanels } from "../session/uiStore";

const LIMITS: readonly [number, number] = [150, 900];

function clamp(v: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * The bar between the preview and the timeline: drag it, nudge it with the arrow keys, double-click to reset.
 * `remember` keeps the height for the next visit (the editor does; the editor embedded in a chat does not).
 */
export function TimelineResizeHandle({ remember = true, onResized }: { remember?: boolean; onResized?: () => void }) {
  const session = useSession();
  const start = useRef(0);
  const set = (timeline: number) => session.ui.setState({ panels: { ...session.ui.getState().panels, timeline } });
  const done = () => {
    onResized?.();
    if (remember) savePanels(session.ui.getState().panels);
  };
  return (
    <ResizeHandle
      axis="y"
      label="Resize timeline"
      onResizeStart={() => (start.current = session.ui.getState().panels.timeline)}
      onResize={(d) => set(clamp(start.current - d, [LIMITS[0], Math.max(200, window.innerHeight - 260)]))}
      onResizeEnd={done}
      onNudge={(d) => {
        set(clamp(session.ui.getState().panels.timeline - d, LIMITS));
        done();
      }}
      onReset={() => {
        set(300);
        done();
      }}
    />
  );
}
