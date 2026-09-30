import { Check, Cloud, Copy, LogIn } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { useAuth } from "@/lib/auth";
import { cloudClient, cloudRouteId, uploadToSas } from "@/lib/cloud";
import { cloudEnabled, editorUrl } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { mediaStore } from "@/lib/storage/media";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { ProgressBar } from "@/ui/Spinner";
import { toast } from "@/ui/Toast";
import { useSession } from "../session/context";
import type { EditorSession } from "../session/EditorSession";
import { fileHash } from "../session/media";

type Phase = { kind: "idle" } | { kind: "uploading"; done: number; total: number; label: string } | { kind: "error"; message: string };

/** Upload missing media (deduped by full-file SHA-256), then create the cloud project and link it. */
async function pushToCloud(session: EditorSession, onProgress: (done: number, total: number, label: string) => void): Promise<{ id: string; skipped: number }> {
  const cloud = cloudClient();
  const store = await mediaStore();
  const files = session.project.files;
  const hashed = files.map((f) => ({ file: f, sha: fileHash(f) })).filter((x): x is { file: (typeof files)[number]; sha: string } => x.sha !== null);
  const skipped = files.length - hashed.length;
  const unique = [...new Map(hashed.map((x) => [x.sha, x])).values()];
  onProgress(0, 1, "Checking what Zenvi Cloud already has");
  const existing = await cloud.checkMedia(unique.map((x) => x.sha));
  const todo: { sha: string; blob: File; name: string; type: string }[] = [];
  for (const { sha, file } of unique) {
    if (existing.has(sha)) continue;
    const stored = await store.get(sha);
    if (!stored) continue;
    todo.push({ sha, blob: stored.file, name: String(file.cloud?.name ?? file.name ?? stored.file.name), type: String(file.cloud?.content_type ?? stored.file.type ?? "application/octet-stream") });
  }
  const total = todo.reduce((n, t) => n + t.blob.size, 0) || 1;
  let done = 0;
  for (const item of todo) {
    const ticket = await cloud.requestUpload({ sha256: item.sha, size: item.blob.size, name: item.name, contentType: item.type });
    if (!ticket.exists && ticket.uploadUrl) {
      const base = done;
      await uploadToSas(ticket.uploadUrl, item.blob, item.type, (f) => onProgress(base + f * item.blob.size, total, `Uploading ${item.name}`), undefined, ticket.uploadHeaders);
      await cloud.completeUpload(item.sha);
    }
    done += item.blob.size;
    onProgress(done, total, `Uploaded ${item.name}`);
  }
  onProgress(total, total, "Saving the project");
  await session.autosave.flush();
  const created = await cloud.createProject(session.meta.getState().name, session.snapshotForSave());
  await session.linkCloud(created.id, created.revision);
  return { id: created.id, skipped };
}

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const link = useStore(session.meta, (m) => m.cloud);
  const sync = useStore(session.cloudSync);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const url = link ? editorUrl(`/p/${cloudRouteId(link.id)}`) : null;
  const busy = phase.kind === "uploading";

  const start = async () => {
    setPhase({ kind: "uploading", done: 0, total: 1, label: "Preparing" });
    try {
      const { skipped } = await pushToCloud(session, (done, total, label) => setPhase({ kind: "uploading", done, total, label }));
      setPhase({ kind: "idle" });
      toast.success("Shared to Zenvi Cloud", skipped ? { description: `${skipped} file(s) were not in this browser and stay missing in the cloud copy.` } : {});
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.info(url);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()} dismissible={!busy} title="Share to Zenvi Cloud" description="Open this project on any device, from the desktop app, or let ChatGPT and Claude edit it." width={500}>
      {!cloudEnabled() ? (
        <p className="text-sm text-fg-subtle">Zenvi Cloud isn&apos;t configured in this build.</p>
      ) : status !== "signed-in" ? (
        <div className="space-y-3">
          <p className="text-sm text-fg-subtle">Sign in to upload this project. Your media uploads once; files you already uploaded are skipped.</p>
          <Button variant="white" icon={<LogIn size={14} />} onClick={() => navigate(`/login?next=${encodeURIComponent(`/p/${session.meta.getState().id}`)}`)}>
            Sign in
          </Button>
        </div>
      ) : link && url ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-elevated p-1.5 pl-3">
            <Cloud size={14} className="shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{url}</span>
            <Button size="sm" variant="secondary" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy()}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <div className="flex items-center justify-between text-xs text-fg-subtle">
            <span>
              {sync.state === "synced" ? "Changes sync automatically." : sync.state === "syncing" || sync.state === "pending" ? "Syncing…" : sync.error ?? "Not synced yet."}
            </span>
            <Button size="xs" variant="ghost" onClick={() => void session.saveCloud()}>
              Sync now
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">Only you can open this link. Sign in with the same account on another device.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {phase.kind === "uploading" ? (
            <div>
              <div className="mb-2 flex justify-between text-xs">
                <span className="truncate text-fg-muted">{phase.label}</span>
                <span className="tnum text-fg-subtle">
                  {formatBytes(phase.done)} / {formatBytes(phase.total)}
                </span>
              </div>
              <ProgressBar value={phase.total > 1 ? phase.done / phase.total : null} />
            </div>
          ) : (
            <p className="text-sm text-fg-subtle">
              Uploads the project and its media ({session.project.files.length} file{session.project.files.length === 1 ? "" : "s"}). Media already in your cloud is skipped.
            </p>
          )}
          {phase.kind === "error" ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{phase.message}</p> : null}
          <div className="flex justify-end">
            <Button variant="primary" icon={<Cloud size={14} />} loading={busy} onClick={() => void start()}>
              Upload to Zenvi Cloud
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
