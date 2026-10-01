import { clipsUsingFile, removeFile, updateFile, type ProjectFile } from "@zenvi/engine";
import { AlertTriangle, FileAudio, FileImage, FileVideo, Plus, Upload } from "lucide-react";
import { memo, useEffect, useMemo, useState, useSyncExternalStore, type DragEvent } from "react";
import { useStore } from "zustand";
import { formatBytes, formatDuration, formatFps } from "@/lib/format";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/Controls";
import { Dialog } from "@/ui/Dialog";
import { SearchInput, TextInput } from "@/ui/Input";
import { ContextMenu, type MenuSpec } from "@/ui/Menu";
import { ProgressBar } from "@/ui/Spinner";
import { Button } from "@/ui/Button";
import { importMedia, importState } from "../actions/importMedia";
import { addFilesToTimeline } from "../actions/placement";
import { beginDrag, endDrag, isFileDrag } from "../dnd";
import { useProjectSelector, useSession } from "../session/context";
import { fileDisplayName, type MediaEntryState } from "../session/media";
import { EMPTY_SELECTION } from "../session/uiStore";
import { PanelEmpty, PanelHeader, Segmented } from "./PanelChrome";

type Filter = "all" | "video" | "audio" | "image";

function typeOf(file: ProjectFile): "video" | "audio" | "image" {
  if (file.media_type === "image" || file.has_single_image) return "image";
  if (file.media_type === "audio" || (!file.has_video && file.has_audio)) return "audio";
  return "video";
}

const TYPE_ICON = {
  video: <FileVideo size={20} />,
  audio: <FileAudio size={20} />,
  image: <FileImage size={20} />,
};

const TYPE_TINT = {
  video: "from-clip-video/60 to-clip-video/20",
  audio: "from-clip-audio/60 to-clip-audio/20",
  image: "from-clip-image/60 to-clip-image/20",
};

const FileTile = memo(function FileTile({
  file,
  status,
  selected,
  onSelect,
  onAdd,
  menu,
}: {
  file: ProjectFile;
  status: MediaEntryState | undefined;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  onAdd: () => void;
  menu: () => MenuSpec[];
}) {
  const session = useSession();
  const kind = typeOf(file);
  const sprite = useSyncExternalStore(
    (l) => session.previews.subscribe(l),
    () => session.previews.sprite(file.id),
  );
  const missing = status?.status === "missing" || status?.status === "error";
  const ready = status?.status === "ready";
  useEffect(() => {
    if (ready && kind !== "audio") session.previews.requestSprite(file.id, Number(file.duration) || 0, kind === "image");
  }, [ready, kind, file.id, file.duration, session]);
  const name = fileDisplayName(file);
  const tileIndex = sprite ? Math.floor(sprite.times.length / 3) : 0;
  return (
    <ContextMenu items={menu}>
      <div
        role="button"
        tabIndex={0}
        aria-label={name}
        aria-pressed={selected}
        draggable={!missing}
        onDragStart={(e) => {
          onSelect(false);
          beginDrag(e, { kind: "files", fileIds: [file.id], durations: [kind === "image" ? 10 : Number(file.duration) || 5] });
        }}
        onDragEnd={endDrag}
        onClick={(e) => onSelect(e.shiftKey || e.metaKey || e.ctrlKey)}
        onDoubleClick={onAdd}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAdd();
        }}
        className={cn("group relative min-w-0 rounded-lg p-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent", selected ? "bg-accent/15" : "hover:bg-white/[0.04]")}
      >
        <div className={cn("relative aspect-video overflow-hidden rounded-md bg-gradient-to-br", TYPE_TINT[kind], selected && "ring-[1.5px] ring-accent")}>
          {sprite ? (
            <div
              aria-hidden
              className="absolute inset-0 bg-cover"
              style={{
                backgroundImage: `url(${sprite.url})`,
                backgroundSize: `${sprite.times.length * 100}% 100%`,
                backgroundPosition: sprite.times.length > 1 ? `${(tileIndex / (sprite.times.length - 1)) * 100}% 0` : "0 0",
              }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-white/60">{TYPE_ICON[kind]}</div>
          )}
          {missing ? (
            <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-[3px] bg-danger px-1 py-px text-[10px] font-medium text-white">
              <AlertTriangle size={9} /> Missing
            </span>
          ) : null}
          {kind !== "image" && Number(file.duration) > 0 ? (
            <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/70 px-1 text-[10px] font-medium tnum text-fg-muted">{formatDuration(Number(file.duration))}</span>
          ) : null}
          <button
            type="button"
            aria-label={`Add ${name} to the timeline`}
            title="Add to timeline"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white opacity-0 shadow outline-none transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Plus size={14} />
          </button>
        </div>
        <p className="mt-1 truncate px-0.5 text-xs text-fg-muted" title={name}>
          {name}
        </p>
      </div>
    </ContextMenu>
  );
});

function FileInfoDialog({ file, onClose }: { file: ProjectFile | null; onClose: () => void }) {
  if (!file) return null;
  const rows: [string, string][] = [
    ["Type", typeOf(file)],
    ["Duration", typeOf(file) === "image" ? "Still image" : formatDuration(Number(file.duration) || 0)],
    ...(file.has_video && typeOf(file) !== "audio" ? ([["Size", `${file.width} × ${file.height}`]] as [string, string][]) : []),
    ...(file.has_video && typeOf(file) === "video" ? ([["Frame rate", formatFps(file.fps)]] as [string, string][]) : []),
    ...(file.has_audio ? ([["Audio", `${file.sample_rate} Hz · ${file.channels} ch`]] as [string, string][]) : []),
    ...(file.vcodec ? ([["Video codec", String(file.vcodec)]] as [string, string][]) : []),
    ...(file.acodec ? ([["Audio codec", String(file.acodec)]] as [string, string][]) : []),
    ...(file.fingerprint?.size ? ([["File size", formatBytes(Number(file.fingerprint.size))]] as [string, string][]) : []),
    ["Path", String(file.path)],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={fileDisplayName(file)} description="File properties" width={440}>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-subtle">{k}</dt>
            <dd className="min-w-0 break-words text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

export function ProjectFilesPanel() {
  const session = useSession();
  const files = useProjectSelector((p) => p.files);
  const status = useStore(session.media.status);
  const importing = useStore(importState);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [info, setInfo] = useState<ProjectFile | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ProjectFile | null>(null);
  const [renaming, setRenaming] = useState<{ file: ProjectFile; name: string } | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => (filter === "all" || typeOf(f) === filter) && (!q || fileDisplayName(f).toLowerCase().includes(q)));
  }, [files, query, filter]);

  const addToTimeline = (ids: string[]) => {
    void addFilesToTimeline(session, ids).then((created) => {
      if (!created.length) return;
      session.ui.setState({ selection: { ...EMPTY_SELECTION, clips: created } });
      const last = session.project.clips.find((c) => c.id === created[created.length - 1]);
      if (last) session.views.timeline?.reveal(last.position);
    });
  };

  const remove = (file: ProjectFile) => {
    setConfirmRemove(null);
    session.edit("Remove file", (tx) => removeFile(tx, file.id, { removeClips: true }));
  };

  const menuFor = (file: ProjectFile) => (): MenuSpec[] => {
    const missing = status[file.id]?.status === "missing" || status[file.id]?.status === "error";
    const ids = selected.includes(file.id) ? selected : [file.id];
    return [
      { type: "item", label: ids.length > 1 ? `Add ${ids.length} files to timeline` : "Add to timeline", onSelect: () => addToTimeline(ids), disabled: missing },
      { type: "separator" },
      {
        type: "item",
        label: "Rename",
        onSelect: () => setRenaming({ file, name: fileDisplayName(file) }),
      },
      { type: "item", label: "File properties", onSelect: () => setInfo(file) },
      ...(missing ? ([{ type: "item", label: "Relink…", onSelect: () => session.ui.setState({ dialog: "relink" }) }] as MenuSpec[]) : []),
      { type: "separator" },
      {
        type: "item",
        label: "Remove from project",
        danger: true,
        onSelect: () => (clipsUsingFile(session.project, file.id).length > 0 ? setConfirmRemove(file) : remove(file)),
      },
    ];
  };

  const onDrop = (e: DragEvent) => {
    setDragOver(false);
    if (!isFileDrag(e)) return;
    e.preventDefault();
    void importMedia(session, [...e.dataTransfer.files]);
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <PanelHeader title="Project files">
        <IconButton label="Import media" shortcut="Ctrl+I" onClick={() => session.views.pickMedia?.()}>
          <Upload size={15} />
        </IconButton>
      </PanelHeader>
      {files.length > 0 ? (
        <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-2.5">
          <SearchInput value={query} onValueChange={setQuery} placeholder="Search files" aria-label="Search project files" />
          <Segmented<Filter>
            label="Filter by type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "video", label: "Video" },
              { value: "audio", label: "Audio" },
              { value: "image", label: "Images" },
            ]}
          />
        </div>
      ) : null}
      {importing.active ? (
        <div className="mx-3 mb-2 rounded-md border border-line bg-elevated px-2.5 py-2" role="status">
          <p className="mb-1.5 truncate text-xs text-fg-muted">Importing {importing.label}</p>
          <ProgressBar value={importing.fraction} />
        </div>
      ) : null}
      {files.length === 0 ? (
        <PanelEmpty icon={<Upload size={22} />} title="Import your media" body="Video, audio and images stay in this browser. Drop files here or anywhere on the timeline.">
          <Button variant="primary" size="md" onClick={() => session.views.pickMedia?.()}>
            Import media
          </Button>
        </PanelEmpty>
      ) : (
        <div
          className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1 overflow-y-auto px-2 pb-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected([]);
          }}
        >
          {visible.map((file) => (
            <FileTile
              key={file.id}
              file={file}
              status={status[file.id]}
              selected={selected.includes(file.id)}
              onSelect={(additive) =>
                setSelected((current) => (additive ? (current.includes(file.id) ? current.filter((x) => x !== file.id) : [...current, file.id]) : [file.id]))
              }
              onAdd={() => addToTimeline([file.id])}
              menu={menuFor(file)}
            />
          ))}
          {visible.length === 0 ? <p className="col-span-full py-8 text-center text-xs text-fg-subtle">No files match.</p> : null}
        </div>
      )}
      {dragOver ? (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-accent/70 bg-accent/[0.08]">
          <p className="text-sm font-medium text-fg">Drop to import</p>
        </div>
      ) : null}
      <FileInfoDialog file={info} onClose={() => setInfo(null)} />
      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename file"
        width={380}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!renaming?.name.trim()}
              onClick={() => {
                if (!renaming) return;
                const name = renaming.name.trim();
                setRenaming(null);
                session.edit("Rename file", (tx) => updateFile(tx, renaming.file.id, { name }));
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        <TextInput
          autoFocus
          aria-label="File name"
          value={renaming?.name ?? ""}
          onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renaming?.name.trim()) {
              const name = renaming.name.trim();
              const id = renaming.file.id;
              setRenaming(null);
              session.edit("Rename file", (tx) => updateFile(tx, id, { name }));
            }
          }}
        />
      </Dialog>
      <Dialog
        open={confirmRemove !== null}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
        title="Remove this file?"
        description={confirmRemove ? `${clipsUsingFile(session.project, confirmRemove.id).length} clip(s) on the timeline use “${fileDisplayName(confirmRemove)}”. They are removed too. You can undo this.` : undefined}
        width={420}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => confirmRemove && remove(confirmRemove)}>
              Remove
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}
