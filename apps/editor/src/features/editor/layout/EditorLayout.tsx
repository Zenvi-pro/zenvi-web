import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createDispatcher } from "@/lib/keyboard/dispatcher";
import { importProjectFile } from "@/lib/projectFactory";
import { ResizeHandle } from "@/ui/ResizeHandle";
import { toast } from "@/ui/Toast";
import { importMedia } from "../actions/importMedia";
import { createCommands, keymap } from "../commands";
import { EditorDialogs } from "../dialogs/EditorDialogs";
import { LeftPanel } from "../panels/LeftPanel";
import { RightPanel } from "../panels/RightPanel";
import { PreviewPanel } from "../preview/PreviewPanel";
import { useSession, useUi } from "../session/context";
import { savePanels } from "../session/uiStore";
import { TimelinePanel } from "../timeline/TimelinePanel";
import { CommandsContext } from "./commandsContext";
import { MobileEditor } from "./MobileEditor";
import { TopBar } from "./TopBar";
import { useMediaQuery } from "./useMediaQuery";

const LIMITS = { left: [220, 560], right: [260, 600], timeline: [150, 900] } as const;

function clamp(v: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, v));
}

export function EditorLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const commands = useMemo(() => createCommands(session, { navigate }), [session, navigate]);
  const panels = useUi((s) => s.panels);
  const mobile = useMediaQuery("(max-width: 767px)");
  const mediaInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const start = useRef(panels);

  // Global shortcuts (desktop defaults), one listener for the whole editor.
  useEffect(() => {
    const dispatcher = createDispatcher({ keymap, commands: () => commands });
    const onKey = (e: KeyboardEvent) => {
      if (session.ui.getState().dialog && e.key !== "Escape") {
        // Dialogs own the keyboard, except Save.
        if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s")) return;
      }
      dispatcher.handle(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands, session]);

  useEffect(() => {
    session.views.pickMedia = () => mediaInput.current?.click();
    session.views.pickProject = () => projectInput.current?.click();
    return () => {
      session.views.pickMedia = null;
      session.views.pickProject = null;
    };
  }, [session]);

  const setPanels = (patch: Partial<typeof panels>) => session.ui.setState({ panels: { ...session.ui.getState().panels, ...patch } });
  const persist = () => savePanels(session.ui.getState().panels);

  if (mobile) {
    return (
      <CommandsContext.Provider value={commands}>
        <MobileEditor />
      </CommandsContext.Provider>
    );
  }

  return (
    <CommandsContext.Provider value={commands}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-fg">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <LeftPanel width={panels.leftCollapsed ? 0 : panels.left} />
          {panels.leftCollapsed ? null : (
            <ResizeHandle
              axis="x"
              label="Resize left panel"
              onResizeStart={() => (start.current = session.ui.getState().panels)}
              onResize={(d) => setPanels({ left: clamp(start.current.left + d, LIMITS.left) })}
              onResizeEnd={persist}
              onNudge={(d) => {
                setPanels({ left: clamp(session.ui.getState().panels.left + d, LIMITS.left) });
                persist();
              }}
              onReset={() => {
                setPanels({ left: 300 });
                persist();
              }}
            />
          )}
          <PreviewPanel />
          {panels.rightCollapsed ? null : (
            <ResizeHandle
              axis="x"
              label="Resize right panel"
              onResizeStart={() => (start.current = session.ui.getState().panels)}
              onResize={(d) => setPanels({ right: clamp(start.current.right - d, LIMITS.right) })}
              onResizeEnd={persist}
              onNudge={(d) => {
                setPanels({ right: clamp(session.ui.getState().panels.right - d, LIMITS.right) });
                persist();
              }}
              onReset={() => {
                setPanels({ right: 320 });
                persist();
              }}
            />
          )}
          <RightPanel width={panels.rightCollapsed ? 0 : panels.right} />
        </div>
        <ResizeHandle
          axis="y"
          label="Resize timeline"
          onResizeStart={() => (start.current = session.ui.getState().panels)}
          onResize={(d) => setPanels({ timeline: clamp(start.current.timeline - d, [LIMITS.timeline[0], Math.max(200, window.innerHeight - 260)]) })}
          onResizeEnd={persist}
          onNudge={(d) => {
            setPanels({ timeline: clamp(session.ui.getState().panels.timeline - d, LIMITS.timeline) });
            persist();
          }}
          onReset={() => {
            setPanels({ timeline: 300 });
            persist();
          }}
        />
        <TimelinePanel height={panels.timeline} />
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
      <input
        ref={projectInput}
        type="file"
        hidden
        accept=".zvn,.osp,.flow,application/json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          importProjectFile(file)
            .then((id) => navigate(`/p/${id}`))
            .catch((err: unknown) => toast.error("Could not open that file", { description: err instanceof Error ? err.message : String(err) }));
        }}
      />
    </CommandsContext.Provider>
  );
}
