/**
 * Keep the embedded editor in step with edits made elsewhere: the chat's
 * tools save the cloud project, and this loop takes each new revision into
 * the open session as one undo step (`EditorSession.adoptRemote`). It polls
 * the cheap revision endpoint (one blob HEAD) and loads the project only when
 * the revision moved; every few seconds while visible, rarely when hidden.
 */
import { parseProject } from "@zenvi/engine";
import type { CloudClient } from "@/lib/cloud";
import { currentStampForWebCopies } from "../editor/openProject";
import type { EditorSession } from "../editor/session/EditorSession";

export interface FollowOptions {
  visibleMs?: number;
  hiddenMs?: number;
  /** A remote change was taken into the session. */
  onAdopted?: () => void;
}

export function followRemote(session: EditorSession, cloud: CloudClient, projectId: string, options: FollowOptions = {}): () => void {
  const visibleMs = options.visibleMs ?? 2000;
  const hiddenMs = options.hiddenMs ?? 15000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(tick, document.visibilityState === "hidden" ? hiddenMs : visibleMs);
  };

  const tick = async () => {
    timer = null;
    try {
      const known = session.meta.getState().cloud?.revision;
      const revision = await cloud.projectRevision(projectId, controller.signal);
      if (revision && known && revision !== known) {
        const remote = await cloud.getProject(projectId, controller.signal);
        if (stopped) return;
        const project = parseProject(currentStampForWebCopies(remote.project));
        if (session.adoptRemote({ revision: remote.revision, project })) options.onAdopted?.();
      }
    } catch {
      // Offline, or the token ran out and could not be renewed: try again later.
    }
    schedule();
  };

  // Come back to the foreground: check right away.
  const onVisible = () => {
    if (document.visibilityState !== "visible" || stopped || timer === null) return;
    clearTimeout(timer);
    void tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller.abort();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
