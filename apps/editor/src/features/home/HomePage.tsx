import type { Profile } from "@zenvi/engine";
import { Cloud, FolderOpen, HardDrive, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { cloudClient, cloudRouteId, type CloudProjectSummary } from "@/lib/cloud";
import { cloudEnabled } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import {
  createLocalProject,
  downloadBlob,
  duplicateLocalProject,
  importProjectFile,
  projectFileBlob,
  queueImports,
  resolveProfile,
  safeFileName,
} from "@/lib/projectFactory";
import { requestPersistentStorage, storageEstimate } from "@/lib/storage/media";
import { projectRepository, type LocalProjectMeta } from "@/lib/storage/projects";
import { AccountMenu } from "@/features/common/AccountMenu";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { ZenviMark } from "@/ui/Logo";
import { Spinner } from "@/ui/Spinner";
import { toast } from "@/ui/Toast";
import { COMMON_PRESETS, FormatCard, MoreFormatsCard } from "./FormatPicker";
import { ProjectCard } from "./ProjectCard";

const PROJECT_FILE_TYPES = ".zvn,.osp,.flow,application/json";
const MEDIA_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|wav|m4a|aac|ogg|opus|flac|png|jpe?g|gif|webp|svg|bmp)$/i;

function isProjectFile(file: File): boolean {
  return /\.(zvn|osp|flow)$/i.test(file.name);
}

function isMediaFile(file: File): boolean {
  return /^(video|audio|image)\//.test(file.type) || MEDIA_EXTENSIONS.test(file.name);
}

function useLocalProjects() {
  const [projects, setProjects] = useState<LocalProjectMeta[] | null>(null);
  const refresh = useCallback(() => {
    projectRepository()
      .list()
      .then(setProjects)
      .catch((e: unknown) => {
        setProjects([]);
        toast.error("Could not read your projects", { description: e instanceof Error ? e.message : String(e) });
      });
  }, []);
  useEffect(refresh, [refresh]);
  return { projects, refresh };
}

function useCloudProjects() {
  const status = useAuth((s) => s.status);
  const [state, setState] = useState<{ projects: CloudProjectSummary[] | null; error: string | null }>({ projects: null, error: null });
  useEffect(() => {
    if (status !== "signed-in" || !cloudEnabled()) return;
    const controller = new AbortController();
    cloudClient()
      .listProjects(controller.signal)
      .then((projects) => setState({ projects, error: null }))
      .catch((e: unknown) => {
        if ((e as { name?: string }).name === "AbortError") return;
        setState({ projects: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => controller.abort();
  }, [status]);
  return status === "signed-in" && cloudEnabled() ? state : null;
}

export function HomePage() {
  const navigate = useNavigate();
  const { projects, refresh } = useLocalProjects();
  const cloud = useCloudProjects();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LocalProjectMeta | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    document.title = "Projects · Zenvi";
    void requestPersistentStorage();
    storageEstimate().then((e) => e && e.usage > 0 && setUsage(formatBytes(e.usage)));
  }, []);

  const create = async (profile: Profile, files: File[] = []) => {
    setBusy(true);
    try {
      const name = files[0] ? files[0].name.replace(/\.[^.]+$/, "") : "Untitled project";
      const id = await createLocalProject(profile, name);
      if (files.length) queueImports(id, files);
      navigate(`/p/${id}`);
    } catch (e) {
      toast.error("Could not create the project", { description: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const openProjectFile = async (file: File) => {
    setBusy(true);
    try {
      const id = await importProjectFile(file);
      navigate(`/p/${id}`);
    } catch (e) {
      toast.error("Could not open that file", { description: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const handleFiles = (list: FileList | File[]) => {
    const files = [...list];
    const project = files.find(isProjectFile);
    if (project) {
      void openProjectFile(project);
      return;
    }
    const media = files.filter(isMediaFile);
    if (media.length === 0) {
      toast.warning("Nothing to open", { description: "Drop video, audio, images, or a .zvn project file." });
      return;
    }
    // Start in the most common format; the editor offers to match the first video.
    void create(resolveProfile("HD 1080p 30 fps"), media);
  };

  const onDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const remove = async (meta: LocalProjectMeta) => {
    setConfirmDelete(null);
    await projectRepository().remove(meta.id);
    toast.success(`Deleted “${meta.name}”`);
    refresh();
  };

  return (
    <div
      className="relative min-h-full bg-canvas"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_50%_-20%,rgba(50,117,248,0.13),transparent_65%)]" />

      <header className="relative z-10 mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-8">
        <a href="https://zenvi.pro" className="flex items-center gap-2.5 text-fg" aria-label="zenvi.pro">
          <ZenviMark size={22} />
          <span className="text-md font-semibold tracking-tight">Zenvi</span>
        </a>
        <span className="rounded-full border border-line-strong px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-fg-subtle">
          Web editor
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="md" icon={<FolderOpen size={15} />} onClick={() => fileInput.current?.click()} disabled={busy}>
          <span className="hidden sm:inline">Open project file</span>
        </Button>
        <AccountMenu />
      </header>

      <main className="relative z-10 mx-auto max-w-[1200px] px-4 pb-20 sm:px-8">
        <section className="pb-10 pt-10 sm:pt-16">
          <h1 className="font-serif text-[44px] leading-[1.02] tracking-[-0.01em] text-fg sm:text-4xl">Make something.</h1>
          <p className="mt-3 max-w-xl text-md text-fg-subtle">
            Pick a format for a new project, open a <span className="font-mono text-fg-muted">.zvn</span> from the desktop app, or drop a video anywhere on this page.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {COMMON_PRESETS.map((preset) => (
              <FormatCard key={preset.id} preset={preset} onPick={(p) => void create(p)} busy={busy} />
            ))}
            <MoreFormatsCard onPick={(p) => void create(p)} busy={busy} />
          </div>
        </section>

        <section aria-labelledby="recent-heading" className="pt-4">
          <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
            <HardDrive size={14} className="text-fg-subtle" />
            <h2 id="recent-heading" className="text-sm font-medium text-fg-muted">
              In this browser
            </h2>
            <span className="flex-1" />
            {usage ? <span className="text-xs text-fg-faint">{usage} used</span> : null}
          </div>
          {projects === null ? (
            <div className="flex h-40 items-center justify-center text-fg-subtle">
              <Spinner />
            </div>
          ) : projects.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-fg-subtle outline-none transition-colors hover:border-line-bright hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Upload size={20} />
              <span className="text-md">No projects yet</span>
              <span className="text-xs text-fg-faint">Choose a format above, or drop media here to start.</span>
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={{
                    id: p.id,
                    name: p.name,
                    updatedAt: p.updatedAt,
                    width: p.width,
                    height: p.height,
                    duration: p.duration,
                    thumbnail: p.thumbnail,
                    cloud: Boolean(p.cloud),
                  }}
                  onOpen={() => navigate(`/p/${p.id}`)}
                  onRename={(name) => {
                    void projectRepository().updateMeta(p.id, { name }).then(refresh);
                  }}
                  onDuplicate={() => {
                    void duplicateLocalProject(p.id).then(refresh);
                  }}
                  onDownload={() => {
                    void projectRepository()
                      .load(p.id)
                      .then(async (stored) => stored && downloadBlob(await projectFileBlob(stored.project), safeFileName(p.name, "zvn")));
                  }}
                  onDelete={() => setConfirmDelete(p)}
                />
              ))}
            </div>
          )}
        </section>

        {cloud ? (
          <section aria-labelledby="cloud-heading" className="pt-12">
            <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
              <Cloud size={14} className="text-fg-subtle" />
              <h2 id="cloud-heading" className="text-sm font-medium text-fg-muted">
                Zenvi Cloud
              </h2>
            </div>
            {cloud.projects === null ? (
              <div className="flex h-24 items-center justify-center text-fg-subtle">
                <Spinner />
              </div>
            ) : cloud.error ? (
              <p className="rounded-lg border border-line bg-base px-4 py-3 text-sm text-fg-subtle">{cloud.error}</p>
            ) : cloud.projects.length === 0 ? (
              <p className="rounded-lg border border-line bg-base px-4 py-3 text-sm text-fg-subtle">
                No cloud projects yet. Open a project and choose <span className="text-fg-muted">Share</span> to push it here, or push from the desktop app.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {cloud.projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={{
                      id: p.id,
                      name: p.name,
                      updatedAt: p.updatedAt ? Date.parse(p.updatedAt) : null,
                      width: p.width,
                      height: p.height,
                      duration: p.duration,
                      thumbnail: p.thumbnailUrl,
                      cloud: true,
                    }}
                    onOpen={() => navigate(`/p/${cloudRouteId(p.id)}`)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>

      <input
        ref={fileInput}
        type="file"
        hidden
        accept={`${PROJECT_FILE_TYPES},video/*,audio/*,image/*`}
        multiple
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 grid animate-fade-in place-items-center bg-black/70 p-6 backdrop-blur-[2px]">
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-accent/70 bg-accent/[0.06]">
            <Upload size={28} className="text-accent-hover" />
            <p className="text-lg font-medium text-fg">Drop to start a new project</p>
            <p className="text-sm text-fg-subtle">Video, audio and images stay in this browser.</p>
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50">
          <Spinner size={20} className="text-fg" />
        </div>
      ) : null}

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Delete this project?"
        description={confirmDelete ? `“${confirmDelete.name}” will be removed from this browser. Media shared with other projects is kept.` : undefined}
        width={420}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => confirmDelete && void remove(confirmDelete)}>
              Delete
            </Button>
          </>
        }
      >
        {confirmDelete?.cloud ? <p className="text-sm text-fg-subtle">The Zenvi Cloud copy is not deleted.</p> : null}
      </Dialog>
    </div>
  );
}
