import { CheckCircle2, Cloud, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useStore } from "zustand";
import { formatBytes } from "@/lib/format";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Dialog } from "@/ui/Dialog";
import { ProgressBar } from "@/ui/Spinner";
import { importMedia, importState } from "../actions/importMedia";
import { isFileDrag } from "../dnd";
import { useSession } from "../session/context";

type Phase = { kind: "idle" } | { kind: "uploading"; done: number; total: number; label: string } | { kind: "done"; count: number } | { kind: "error"; message: string };

/**
 * "Add media to this project", opened by `?upload=1` (the MCP get_upload_link
 * tool sends people here). Files go into Project Files and, for a cloud
 * project, straight up to Zenvi Cloud so connected assistants can use them.
 */
export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const name = useStore(session.meta, (m) => m.name);
  const linked = useStore(session.meta, (m) => Boolean(m.cloud));
  const importing = useStore(importState);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const add = async (files: File[]) => {
    if (!files.length) return;
    const result = await importMedia(session, files);
    if (!result) return;
    if (!linked) {
      setPhase({ kind: "done", count: result.files.length });
      return;
    }
    setPhase({ kind: "uploading", done: 0, total: 1, label: "Uploading to Zenvi Cloud" });
    try {
      await session.uploadMedia((p) => setPhase({ kind: "uploading", ...p }));
      await session.autosave.flush();
      await session.saveCloud();
      setPhase({ kind: "done", count: result.files.length });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (isFileDrag(e)) void add([...e.dataTransfer.files]);
  };

  const busy = importing.active || phase.kind === "uploading";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      dismissible={!busy}
      title={`Add media to “${name}”`}
      description={linked ? "Files are saved in this browser and uploaded to Zenvi Cloud, where your assistant can use them." : "Files are saved in this browser."}
      width={520}
      footer={
        <Button variant={phase.kind === "done" ? "primary" : "secondary"} disabled={busy} onClick={onClose}>
          {phase.kind === "done" ? "Done" : "Close"}
        </Button>
      }
    >
      <div
        onDragOver={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          over ? "border-accent bg-accent/[0.08]" : "border-line-strong",
        )}
      >
        {linked ? <Cloud size={24} className="text-fg-subtle" /> : <Upload size={24} className="text-fg-subtle" />}
        <p className="text-md text-fg-muted">Drop video, audio or images here</p>
        <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}>
          Choose files
        </Button>
      </div>
      {importing.active ? (
        <div className="mt-4">
          <p className="mb-1.5 truncate text-xs text-fg-muted">Importing {importing.label}</p>
          <ProgressBar value={importing.fraction} />
        </div>
      ) : phase.kind === "uploading" ? (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="truncate text-fg-muted">{phase.label}</span>
            <span className="tnum text-fg-subtle">
              {formatBytes(phase.done)} / {formatBytes(phase.total)}
            </span>
          </div>
          <ProgressBar value={phase.total > 1 ? phase.done / phase.total : null} />
        </div>
      ) : phase.kind === "done" ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 size={15} /> Added {phase.count} file{phase.count === 1 ? "" : "s"}
          {linked ? " and uploaded them" : ""}. You can go back to your assistant now.
        </p>
      ) : phase.kind === "error" ? (
        <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{phase.message}</p>
      ) : null}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="video/*,audio/*,image/*"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void add(files);
        }}
      />
    </Dialog>
  );
}
