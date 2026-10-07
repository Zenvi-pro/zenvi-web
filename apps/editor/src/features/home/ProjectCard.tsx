import { Cloud, Copy, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration, formatRelativeTime, formatResolution } from "@/lib/format";
import { cn } from "@/ui/cn";
import { DropdownMenu, type MenuSpec } from "@/ui/Menu";

export interface ProjectCardData {
  id: string;
  name: string;
  updatedAt: number | null;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail?: string;
  cloud?: boolean;
}

export interface ProjectCardProps {
  project: ProjectCardData;
  onOpen: () => void;
  onRename?: (name: string) => void;
  onDuplicate?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}

function Placeholder({ width = 16, height = 9 }: { width?: number; height?: number }) {
  const ratio = width / height;
  const w = ratio >= 16 / 9 ? 64 : Math.round(36 * ratio);
  const h = ratio >= 16 / 9 ? Math.round(64 / ratio) : 36;
  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.04),transparent_70%)]">
      <span className="rounded-[4px] border border-white/15" style={{ width: w, height: h }} />
    </div>
  );
}

export function ProjectCard({ project, onOpen, onRename, onDuplicate, onDownload, onDelete }: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const items: MenuSpec[] = [{ type: "item", label: "Open", onSelect: onOpen }];
  if (onRename) items.push({ type: "item", label: "Rename", icon: <Pencil size={14} />, onSelect: () => { setDraft(project.name); setRenaming(true); } });
  if (onDuplicate) items.push({ type: "item", label: "Duplicate", icon: <Copy size={14} />, onSelect: onDuplicate });
  if (onDownload) items.push({ type: "item", label: "Download .zvn", icon: <Download size={14} />, onSelect: onDownload });
  if (onDelete) items.push({ type: "separator" }, { type: "item", label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: onDelete });

  const commit = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== project.name) onRename?.(name);
  };

  const meta = [
    project.updatedAt ? `Edited ${formatRelativeTime(project.updatedAt)}` : null,
    project.width && project.height ? formatResolution(project.width, project.height) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${project.name}`}
        className={cn(
          "relative block aspect-video w-full overflow-hidden rounded-xl border border-line bg-raised outline-none",
          "transition-[border-color,transform] duration-150 group-hover:-translate-y-px group-hover:border-line-bright focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        {project.thumbnail ? (
          <img src={project.thumbnail} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        ) : (
          <Placeholder width={project.width} height={project.height} />
        )}
        {project.duration ? (
          <span className="absolute bottom-2 right-2 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-2xs font-medium tnum text-fg-muted backdrop-blur-sm">
            {formatDuration(project.duration)}
          </span>
        ) : null}
        {project.cloud ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-2xs font-medium text-fg-muted backdrop-blur-sm">
            <Cloud size={11} /> Cloud
          </span>
        ) : null}
      </button>
      <div className="mt-2.5 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              aria-label="Project name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="-ml-1 w-full rounded-sm bg-white/[0.06] px-1 text-md font-medium text-fg outline-none ring-1 ring-accent"
            />
          ) : (
            <p className="truncate text-md font-medium text-fg" title={project.name}>
              {project.name}
            </p>
          )}
          <p className="truncate text-xs text-fg-subtle">{meta || " "}</p>
        </div>
        {items.length > 1 ? (
          <DropdownMenu
            align="end"
            items={items}
            trigger={
              <button
                type="button"
                aria-label={`More actions for ${project.name}`}
                className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-0 outline-none transition-opacity hover:bg-white/[0.07] hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal size={16} />
              </button>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
