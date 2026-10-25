import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { HttpCloudClient, type CloudClient, type CloudMediaEntry } from "@/lib/cloud";
import { mediaStore } from "@/lib/storage/media";
import { MemoryProjectRepository } from "@/lib/storage/projects";
import { FullScreenLoader } from "@/app/FullScreenLoader";
import { ZenviMark } from "@/ui/Logo";
import { toast } from "@/ui/Toast";
import { openCloud } from "../editor/openProject";
import { bindRegistry, probe } from "../editor/render";
import { SessionProvider } from "../editor/session/context";
import { EditorSession } from "../editor/session/EditorSession";
import { MediaLibrary } from "../editor/session/media";
import { EmbedBridge, embedFetch, takeLaunch } from "./bridge";
import { EmbedLayout } from "./EmbedLayout";
import { followRemote } from "./followRemote";

type LoadState = { kind: "loading" } | { kind: "ready"; session: EditorSession } | { kind: "error"; title: string; body: string };

function newMediaLibrary(cloud: CloudClient, cloudMedia: CloudMediaEntry[]): MediaLibrary {
  const media = new MediaLibrary({ store: mediaStore, probe, cloud: () => cloud, cloudMedia });
  bindRegistry(media);
  return media;
}

/**
 * `/editor/embed/:projectId`: the editor inside a chat (ChatGPT, Claude), as
 * framed by Zenvi Cloud's MCP editor view. It is served by Zenvi Cloud, talks
 * to it on the same origin with the project token the chat's view passed in,
 * keeps nothing in this browser (the cloud copy is the project), and follows
 * the edits the chat's tools make.
 */
export default function EmbedRoute() {
  const { projectId = "" } = useParams();
  const bridge = useMemo(() => new EmbedBridge(takeLaunch()), []);
  const cloud = useMemo(
    () => new HttpCloudClient(window.location.origin, async () => bridge.currentToken(), embedFetch(bridge)),
    [bridge],
  );
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => bridge.start(), [bridge]);

  useEffect(() => {
    if (!bridge.currentToken()) {
      setState({ kind: "error", title: "Open this from the chat", body: "This editor opens from Zenvi in ChatGPT or Claude. Ask Zenvi to open the editor again." });
      return;
    }
    let cancelled = false;
    let session: EditorSession | null = null;
    let stopFollowing: (() => void) | null = null;
    (async () => {
      const repository = new MemoryProjectRepository();
      const opened = await openCloud(repository, cloud, projectId);
      if (cancelled) return;
      session = new EditorSession({
        meta: opened.meta,
        project: opened.project,
        repository,
        media: newMediaLibrary(cloud, opened.cloudMedia ?? []),
        cloud: () => cloud,
      });
      // Sizes for a chat panel, not this browser's remembered editor layout.
      const wide = window.innerWidth >= 1180;
      session.ui.setState({ panels: { left: 280, right: 300, timeline: 230, leftCollapsed: false, rightCollapsed: !wide } });
      document.title = `${opened.meta.name} · Zenvi`;
      stopFollowing = followRemote(session, cloud, projectId, {
        onAdopted: () => toast.success("Updated from the chat", { duration: 2000 }),
      });
      setState({ kind: "ready", session });
    })().catch((error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      const expired = /expired|revoked|invalid/i.test(message);
      setState({
        kind: "error",
        title: expired ? "This editor link expired" : "Could not open the project",
        body: expired ? "Ask Zenvi in the chat to open the editor again." : message,
      });
    });
    return () => {
      cancelled = true;
      stopFollowing?.();
      void session?.dispose();
    };
  }, [bridge, cloud, projectId]);

  if (state.kind === "loading") return <FullScreenLoader label="Opening the Zenvi editor" />;
  if (state.kind === "error") {
    return (
      <main className="grid h-full place-items-center bg-canvas px-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <ZenviMark size={22} className="mb-5 text-fg" />
          <h1 className="font-serif text-2xl text-fg">{state.title}</h1>
          <p className="mt-2 text-sm text-fg-subtle">{state.body}</p>
        </div>
      </main>
    );
  }
  return (
    <SessionProvider value={state.session}>
      <EmbedLayout bridge={bridge} cloud={cloud} projectId={projectId} />
    </SessionProvider>
  );
}
