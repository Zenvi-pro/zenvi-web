import { Download, ExternalLink, Maximize2, Minimize2, Redo2, Undo2, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { CloudClient } from "@/lib/cloud";
import { Button } from "@/ui/Button";
import { IconButton } from "@/ui/Controls";
import { ZenviMark } from "@/ui/Logo";
import { toast } from "@/ui/Toast";
import { SaveStatus } from "../editor/layout/TopBar";
import { useHistory, useSession } from "../editor/session/context";
import type { EmbedBridge } from "./bridge";

type RenderState = { kind: "idle" } | { kind: "rendering"; progress: number } | { kind: "done"; url: string };

/**
 * Export from the embed renders in Zenvi Cloud (a download from inside a
 * chat's sandboxed frame may be blocked) and hands the finished file to the
 * chat host to open.
 */
function useCloudRender(cloud: CloudClient, projectId: string) {
  const session = useSession();
  const [state, setState] = useState<RenderState>({ kind: "idle" });
  const stopped = useRef(false);
  useEffect(() => () => void (stopped.current = true), []);

  const start = async () => {
    setState({ kind: "rendering", progress: 0 });
    try {
      // Render what is on screen: save local edits to the cloud first.
      await session.autosave.flush();
      await session.saveCloud();
      let status = await cloud.startRender(projectId, { preset: "mp4" });
      while (!stopped.current && (status.status === "queued" || status.status === "running")) {
        setState({ kind: "rendering", progress: status.progress ?? 0 });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        status = await cloud.getRender(projectId, status.renderId);
      }
      if (status.status === "done" && status.url) setState({ kind: "done", url: status.url });
      else throw new Error(status.error || "The render did not finish.");
    } catch (error) {
      setState({ kind: "idle" });
      toast.error("Export failed", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  return { state, start, reset: () => setState({ kind: "idle" }) };
}

export function EmbedTopBar({ bridge, cloud, projectId, full }: { bridge: EmbedBridge; cloud: CloudClient; projectId: string; full: boolean }) {
  const session = useSession();
  const name = useStore(session.meta, (m) => m.name);
  const history = useHistory();
  const render = useCloudRender(cloud, projectId);
  const openUrl = bridge.openUrl;

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-base px-2.5">
      <ZenviMark size={15} className="shrink-0 text-fg" />
      <h1 className="min-w-0 truncate text-sm font-medium text-fg" title={name}>
        {name}
      </h1>
      <SaveStatus />
      <div className="ml-1 flex items-center">
        <IconButton label={history.undoLabel ? `Undo ${history.undoLabel}` : "Undo"} disabled={!history.canUndo} onClick={() => session.undo()}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label={history.redoLabel ? `Redo ${history.redoLabel}` : "Redo"} disabled={!history.canRedo} onClick={() => session.redo()}>
          <Redo2 size={15} />
        </IconButton>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <IconButton label="Make a reel" onClick={() => session.ui.setState({ dialog: "reel" })}>
          <WandSparkles size={15} />
        </IconButton>
        {render.state.kind === "done" ? (
          <Button
            size="sm"
            variant="primary"
            icon={<Download size={14} />}
            onClick={() => {
              if (render.state.kind === "done") bridge.openExternal(render.state.url);
              render.reset();
            }}
          >
            Download MP4
          </Button>
        ) : (
          <Button size="sm" variant="primary" loading={render.state.kind === "rendering"} onClick={() => void render.start()}>
            {render.state.kind === "rendering" ? `Exporting ${Math.round(render.state.progress * 100)}%` : "Export"}
          </Button>
        )}
        {openUrl ? (
          <IconButton label="Open in Zenvi (full editor)" onClick={() => bridge.openExternal(openUrl)} className="max-sm:hidden">
            <ExternalLink size={15} />
          </IconButton>
        ) : null}
        {bridge.inChat ? (
          <IconButton label={full ? "Back to the chat" : "Edit full screen"} onClick={() => bridge.requestDisplayMode(full ? "inline" : "fullscreen")}>
            {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}
