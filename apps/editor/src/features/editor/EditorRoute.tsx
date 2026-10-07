import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { cloudClient, parseCloudRouteId, type CloudMediaEntry } from "@/lib/cloud";
import { takeQueuedImports } from "@/lib/projectFactory";
import { mediaStore } from "@/lib/storage/media";
import { projectRepository } from "@/lib/storage/projects";
import { FullScreenLoader } from "@/app/FullScreenLoader";
import { Button } from "@/ui/Button";
import { ZenviMark } from "@/ui/Logo";
import { importMedia } from "./actions/importMedia";
import { EditorLayout } from "./layout/EditorLayout";
import { bindRegistry, probe } from "./render";
import { SessionProvider } from "./session/context";
import { EditorSession } from "./session/EditorSession";
import { MediaLibrary } from "./session/media";
import { openCloud, openLocal } from "./openProject";

/**
 * With `localStorage["zenvi.debug"] = "1"`, expose the open session and the
 * engine on `window.__zenvi` (end-to-end stress tests, bug reports).
 */
function exposeForDebugging(session: EditorSession): void {
  try {
    if (localStorage.getItem("zenvi.debug") !== "1") return;
    void import("@zenvi/engine").then((engine) => {
      (window as unknown as { __zenvi?: unknown }).__zenvi = { session, engine };
    });
  } catch {
    // Storage blocked: no debug handle.
  }
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; session: EditorSession }
  | { kind: "missing" }
  | { kind: "signin" }
  | { kind: "error"; message: string };

function newMediaLibrary(cloudMedia: CloudMediaEntry[] = []): MediaLibrary {
  const media = new MediaLibrary({
    store: mediaStore,
    probe,
    cloud: () => (useAuth.getState().status === "signed-in" ? cloudClient() : null),
    cloudMedia,
  });
  bindRegistry(media);
  return media;
}

export default function EditorRoute() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const wantsUpload = params.get("upload") === "1";
  const authStatus = useAuth((s) => s.status);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const cloudId = parseCloudRouteId(projectId);
  // Local projects never wait for (or reload on) auth; cloud projects need a session.
  const gate = cloudId === null ? "local" : authStatus === "loading" ? "wait" : authStatus === "signed-in" ? "in" : "out";
  const waitingForAuth = gate === "wait";

  useEffect(() => {
    if (gate === "wait") return;
    let cancelled = false;
    let session: EditorSession | null = null;
    setState({ kind: "loading" });
    (async () => {
      if (gate === "out") {
        setState({ kind: "signin" });
        return;
      }
      const opened = cloudId !== null ? await openCloud(projectRepository(), cloudClient(), cloudId) : await openLocal(projectRepository(), projectId);
      if (cancelled) return;
      if (!opened) {
        setState({ kind: "missing" });
        return;
      }
      session = new EditorSession({
        meta: opened.meta,
        project: opened.project,
        repository: projectRepository(),
        media: newMediaLibrary(opened.cloudMedia),
        cloud: () => (useAuth.getState().status === "signed-in" ? cloudClient() : null),
      });
      // This browser's unsynced edits sit on an older cloud revision: the person decides, nothing is dropped.
      if (opened.conflict) session.markConflict(opened.conflict.cloudRevision, "Zenvi Cloud has a newer version than the changes you made in this browser.");
      document.title = `${opened.meta.name} · Zenvi`;
      exposeForDebugging(session);
      setState({ kind: "ready", session });
      const queued = takeQueuedImports(projectId);
      if (queued.length) void importMedia(session, queued, "end");
      // Desktop projects point at files on another computer: ask for them once.
      void session.mediaReady.then(() => {
        if (cancelled || !session || session.ui.getState().dialog) return;
        if (session.media.missing(session.project).length > 0) session.ui.setState({ dialog: "relink" });
      });
      // `?upload=1` (MCP get_upload_link): open the media upload panel right away.
      if (wantsUpload) {
        session.ui.setState({ dialog: "upload" });
        setParams((p) => {
          p.delete("upload");
          return p;
        }, { replace: true });
      }
    })().catch((error: unknown) => {
      if (!cancelled) setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
      void session?.dispose();
    };
  }, [projectId, cloudId, gate]);

  if (state.kind === "loading" || waitingForAuth) return <FullScreenLoader label="Opening project" />;
  if (state.kind === "ready") {
    return (
      <SessionProvider value={state.session}>
        <EditorLayout />
      </SessionProvider>
    );
  }
  const copy = {
    missing: { title: "Project not found", body: "It may have been deleted, or it was created in another browser. Projects are stored per browser unless you sync them to Zenvi Cloud." },
    signin: { title: "Sign in to open this project", body: "This project lives in Zenvi Cloud. Sign in with the account that owns it." },
    error: { title: "Could not open the project", body: state.kind === "error" ? state.message : "" },
  }[state.kind];
  return (
    <main className="grid h-full place-items-center bg-canvas px-4">
      <div className="flex max-w-md flex-col items-center text-center">
        <ZenviMark size={26} className="mb-6 text-fg" />
        <h1 className="font-serif text-3xl text-fg">{copy.title}</h1>
        <p className="mt-3 text-md text-fg-subtle">{copy.body}</p>
        <div className="mt-8 flex gap-2">
          {state.kind === "signin" ? (
            <Link to={`/login?next=${encodeURIComponent(`/p/${projectId}`)}`}>
              <Button variant="white" size="lg">
                Sign in
              </Button>
            </Link>
          ) : null}
          <Link to="/">
            <Button variant={state.kind === "signin" ? "secondary" : "white"} size="lg">
              Go to projects
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
