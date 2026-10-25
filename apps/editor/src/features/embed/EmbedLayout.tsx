import { useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import type { CloudClient } from "@/lib/cloud";
import { createDispatcher } from "@/lib/keyboard/dispatcher";
import { importMedia } from "../editor/actions/importMedia";
import { createCommands, keymap } from "../editor/commands";
import { EditorDialogs } from "../editor/dialogs/EditorDialogs";
import { CommandsContext } from "../editor/layout/commandsContext";
import { useMediaQuery } from "../editor/layout/useMediaQuery";
import { LeftPanel } from "../editor/panels/LeftPanel";
import { RightPanel } from "../editor/panels/RightPanel";
import { PreviewPanel } from "../editor/preview/PreviewPanel";
import { TimelineResizeHandle } from "../editor/layout/TimelineResizeHandle";
import { useSession, useUi } from "../editor/session/context";
import { type LeftTab, TRACK_HEIGHT } from "../editor/session/uiStore";
import { TimelinePanel } from "../editor/timeline/TimelinePanel";
import type { EmbedBridge } from "./bridge";
import { EmbedTopBar } from "./EmbedTopBar";

/** The embed has no Zenvi sign-in, so no stock search or AI generation (the chat does those through its tools). */
const EMBED_TABS: readonly LeftTab[] = ["files", "titles", "effects", "transitions"];

/** Inline in the conversation: the cut at a glance. */
const INLINE_TIMELINE = 150;
/** Track heights the timeline fits its tracks within: inline, small enough that a reel's few tracks all show. */
const INLINE_TRACK_HEIGHTS: readonly [number, number] = [28, TRACK_HEIGHT];
const FULL_TRACK_HEIGHTS: readonly [number, number] = [44, TRACK_HEIGHT];

/** Full screen in a chat panel: a timeline that grows with the window. */
function fullTimelineHeight(windowHeight: number): number {
  return Math.round(Math.min(380, Math.max(230, windowHeight * 0.32)));
}

/**
 * The editor inside a chat. Full screen it is the whole editor (library,
 * preview, properties, timeline), like an app panel beside the conversation;
 * inline it is the preview with a compact timeline and a button to expand.
 */
export function EmbedLayout({ bridge, cloud, projectId }: { bridge: EmbedBridge; cloud: CloudClient; projectId: string }) {
  const session = useSession();
  // The embed never leaves this project: "New project" and friends do nothing.
  const commands = useMemo(() => createCommands(session, { navigate: () => undefined }), [session]);
  const mode = useStore(bridge.view, (v) => v.mode);
  const panels = useUi((s) => s.panels);
  const wide = useMediaQuery("(min-width: 900px)");
  const roomy = useMediaQuery("(min-width: 1180px)");
  const full = mode === "fullscreen" || !bridge.inChat;
  const mediaInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dispatcher = createDispatcher({ keymap, commands: () => commands });
    const onKey = (e: KeyboardEvent) => {
      if (session.ui.getState().dialog) return;
      dispatcher.handle(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands, session]);

  // A chat panel shows the whole cut: fit it on open and whenever the layout changes size.
  useEffect(() => {
    const frame = requestAnimationFrame(() => session.views.timeline?.zoomToFit());
    return () => cancelAnimationFrame(frame);
  }, [session, full, wide]);

  // The tracks share the timeline's height (inline: every track of a reel shows); full screen, the timeline follows the
  // window until the person drags its edge.
  const sized = useRef(false);
  useEffect(() => {
    session.ui.setState({ trackFit: full ? FULL_TRACK_HEIGHTS : INLINE_TRACK_HEIGHTS });
    if (!full) return;
    const fit = () => {
      if (!sized.current) session.ui.setState({ panels: { ...session.ui.getState().panels, timeline: fullTimelineHeight(window.innerHeight) } });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [session, full]);

  useEffect(() => {
    session.views.pickMedia = () => mediaInput.current?.click();
    return () => {
      session.views.pickMedia = null;
    };
  }, [session]);

  return (
    <CommandsContext.Provider value={commands}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-fg">
        <EmbedTopBar bridge={bridge} cloud={cloud} projectId={projectId} full={full} />
        {full && wide ? (
          <>
            <div className="flex min-h-0 flex-1">
              <LeftPanel width={panels.leftCollapsed ? 0 : panels.left} tabs={EMBED_TABS} labeled />
              <PreviewPanel />
              {roomy ? <RightPanel width={panels.right} assistant={false} /> : null}
            </div>
            <TimelineResizeHandle remember={false} onResized={() => (sized.current = true)} />
            <TimelinePanel height={panels.timeline} />
          </>
        ) : (
          <>
            <div className="flex min-h-0 flex-1">
              <PreviewPanel />
            </div>
            <TimelinePanel height={INLINE_TIMELINE} />
          </>
        )}
        <EditorDialogs />
      </div>
      <input
        ref={mediaInput}
        type="file"
        hidden
        multiple
        accept="video/*,audio/*,image/*,.mkv,.mov,.webm,.svg"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void importMedia(session, files);
        }}
      />
    </CommandsContext.Provider>
  );
}
