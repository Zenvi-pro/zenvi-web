import { AlertTriangle, Check, Cloud, CloudAlert, CloudOff, Download, Redo2, Share2, Undo2, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authEnabled } from "@/lib/env";
import { AccountMenu } from "@/features/common/AccountMenu";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/Controls";
import { ZenviMark } from "@/ui/Logo";
import { DropdownMenu, type MenuSpec } from "@/ui/Menu";
import { Spinner } from "@/ui/Spinner";
import { Tooltip } from "@/ui/Tooltip";
import { shortcutFor } from "../commands";
import { useHistory, useSession } from "../session/context";
import { useCommands } from "./commandsContext";

function useCommandItem() {
  const commands = useCommands();
  return (id: string, label?: string): MenuSpec => {
    const command = commands.get(id);
    if (!command) return { type: "item", label: label ?? id, disabled: true, onSelect: () => undefined };
    const common = { label: label ?? command.label, shortcut: shortcutFor(id), disabled: command.enabled ? !command.enabled() : false };
    if (command.checked) return { type: "check", ...common, checked: command.checked(), onSelect: () => command.run() };
    return { type: "item", ...common, onSelect: () => command.run() };
  };
}

function MenuButton({ label, items }: { label: string; items: () => MenuSpec[] }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      items={open ? items() : []}
      trigger={
        <button
          type="button"
          className={cn(
            "h-7 rounded-md px-2 text-sm text-fg-muted outline-none transition-colors hover:bg-white/[0.07] hover:text-fg",
            "focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-white/[0.08] data-[state=open]:text-fg",
          )}
        >
          {label}
        </button>
      }
    />
  );
}

function ProjectName() {
  const session = useSession();
  const name = useStore(session.meta, (m) => m.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    session.rename(draft);
  };
  if (editing) {
    return (
      <input
        ref={input}
        value={draft}
        aria-label="Project name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
        className="h-7 w-[220px] rounded-md bg-white/[0.06] px-2 text-sm font-medium text-fg outline-none ring-1 ring-accent"
      />
    );
  }
  return (
    <Tooltip label="Rename project">
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        className="h-7 max-w-[260px] truncate rounded-md px-2 text-sm font-medium text-fg outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent"
      >
        {name}
      </button>
    </Tooltip>
  );
}

export function SaveStatus() {
  const session = useSession();
  const [status, setStatus] = useState(session.autosave.current);
  useEffect(() => session.autosave.subscribe(setStatus), [session]);
  const cloud = useStore(session.cloudSync);
  const linked = useStore(session.meta, (m) => Boolean(m.cloud));

  let icon: ReactNode;
  let text: string;
  let tone = "text-fg-faint";
  if (status.state === "error") {
    icon = <AlertTriangle size={12} />;
    text = "Not saved";
    tone = "text-danger";
  } else if (status.state === "saving" || status.state === "dirty") {
    icon = <Spinner size={11} />;
    text = "Saving";
  } else if (linked) {
    if (cloud.state === "syncing" || cloud.state === "pending") {
      icon = <Spinner size={11} />;
      text = "Syncing";
    } else if (cloud.state === "conflict") {
      icon = <AlertTriangle size={12} />;
      text = "Conflict";
      tone = "text-warning";
    } else if (cloud.state === "partial") {
      icon = <CloudAlert size={12} />;
      text = `${cloud.missing.length} not synced`;
      tone = "text-warning";
    } else if (cloud.state === "offline" || cloud.state === "error") {
      icon = <CloudOff size={12} />;
      text = cloud.state === "offline" ? "Offline" : "Sync failed";
      tone = "text-warning";
    } else {
      icon = <Cloud size={12} />;
      text = "Synced";
    }
  } else {
    icon = <Check size={12} />;
    text = "Saved";
  }
  const detail =
    status.state === "error"
      ? `Could not save: ${status.error}`
      : linked
        ? cloud.error ?? "Saved in this browser and Zenvi Cloud"
        : "Saved in this browser";
  if (linked && (cloud.state === "partial" || cloud.state === "conflict")) {
    // Actionable: relink the files the cloud lacks, or resolve the conflict.
    return (
      <Tooltip label={detail}>
        <button
          type="button"
          role="status"
          onClick={() => session.ui.setState({ dialog: cloud.state === "partial" ? "relink" : "cloudConflict" })}
          className={cn("inline-flex items-center gap-1 rounded-sm text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent", tone)}
        >
          {icon}
          <span className="max-sm:sr-only">{text}</span>
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={detail}>
      <span role="status" className={cn("inline-flex items-center gap-1 text-xs", tone)}>
        {icon}
        <span className="max-sm:sr-only">{text}</span>
      </span>
    </Tooltip>
  );
}

export function TopBar() {
  const session = useSession();
  const navigate = useNavigate();
  const commands = useCommands();
  const item = useCommandItem();
  const history = useHistory();
  const run = (id: string) => commands.get(id)?.run();
  const sep: MenuSpec = { type: "separator" };

  const fileMenu = (): MenuSpec[] => [
    item("actionNew", "New project…"),
    item("actionOpen"),
    sep,
    item("actionImportFiles"),
    item("actionTitle"),
    sep,
    item("actionSave"),
    item("actionSaveAs"),
    sep,
    item("actionProfile"),
    sep,
    item("actionSaveFrame"),
    item("actionExportVideo"),
  ];
  const editMenu = (): MenuSpec[] => [
    item("actionUndo", history.undoLabel ? `Undo ${history.undoLabel}` : "Undo"),
    item("actionRedo", history.redoLabel ? `Redo ${history.redoLabel}` : "Redo"),
    sep,
    item("cutAll"),
    item("copyAll"),
    item("pasteAll"),
    item("actionDuplicate"),
    sep,
    item("deleteItem"),
    item("actionRippleDelete"),
    sep,
    item("selectAll"),
    item("selectNone"),
  ];
  const viewMenu = (): MenuSpec[] => {
    const panels = session.ui.getState().panels;
    return [
      item("showFiles"),
      item("showEffects"),
      item("showTransitions"),
      item("showTitles"),
      item("showStock"),
      item("showGenerate"),
      sep,
      item("actionProperties"),
      item("showAssistant"),
      sep,
      item("actionTimelineZoomIn"),
      item("actionTimelineZoomOut"),
      item("actionZoomToTimeline"),
      item("actionCenterOnPlayhead"),
      sep,
      {
        type: "check",
        label: "Left panel",
        checked: !panels.leftCollapsed,
        onSelect: () => session.ui.setState({ panels: { ...panels, leftCollapsed: !panels.leftCollapsed } }),
      },
      {
        type: "check",
        label: "Right panel",
        checked: !panels.rightCollapsed,
        onSelect: () => session.ui.setState({ panels: { ...panels, rightCollapsed: !panels.rightCollapsed } }),
      },
    ];
  };
  const timelineMenu = (): MenuSpec[] => [
    item("actionAddTrack"),
    item("actionAddMarker"),
    item("actionPreviousMarker"),
    item("actionNextMarker"),
    sep,
    {
      type: "sub",
      label: "Slice",
      items: [
        item("sliceSelectedKeepBothSides", "Selected: keep both sides"),
        item("sliceSelectedKeepLeftSide", "Selected: keep left side"),
        item("sliceSelectedKeepRightSide", "Selected: keep right side"),
        sep,
        item("sliceAllKeepBothSides", "All: keep both sides"),
        item("sliceAllKeepLeftSide", "All: keep left side"),
        item("sliceAllKeepRightSide", "All: keep right side"),
      ],
    },
    {
      type: "sub",
      label: "Insert keyframe",
      items: [
        item("actionInsertKeyframe", "All"),
        item("actionInsertKeyframePosition", "Position"),
        item("actionInsertKeyframeScale", "Scale"),
        item("actionInsertKeyframeRotation", "Rotation"),
        item("actionInsertKeyframeAlpha", "Alpha"),
      ],
    },
    sep,
    item("actionSnappingTool"),
    item("actionRazorTool"),
    sep,
    item("actionJumpStart"),
    item("actionJumpEnd"),
  ];
  const helpMenu = (): MenuSpec[] => [
    item("showShortcuts"),
    item("commandPalette"),
    sep,
    { type: "item", label: "Zenvi docs", onSelect: () => window.open("https://zenvi.pro/docs", "_blank", "noopener") },
    { type: "item", label: "zenvi.pro", onSelect: () => window.open("https://zenvi.pro", "_blank", "noopener") },
  ];

  const back = () => {
    void session.autosave.flush().finally(() => navigate("/"));
  };

  return (
    <header className="relative z-30 flex h-11 shrink-0 items-center gap-1 border-b border-line bg-base pl-2 pr-2">
      <Tooltip label="All projects">
        <button
          type="button"
          onClick={back}
          aria-label="All projects"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ZenviMark size={18} />
        </button>
      </Tooltip>
      <nav aria-label="Menu" className="flex items-center">
        <MenuButton label="File" items={fileMenu} />
        <MenuButton label="Edit" items={editMenu} />
        <MenuButton label="View" items={viewMenu} />
        <MenuButton label="Timeline" items={timelineMenu} />
        <MenuButton label="Help" items={helpMenu} />
      </nav>
      <div className="mx-2 h-4 w-px bg-line-strong" />
      <div className="flex min-w-0 items-center gap-2">
        <ProjectName />
        <SaveStatus />
      </div>
      <div className="flex-1" />
      <IconButton label={history.undoLabel ? `Undo ${history.undoLabel}` : "Undo"} shortcut={shortcutFor("actionUndo")} disabled={!history.canUndo} onClick={() => run("actionUndo")}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label={history.redoLabel ? `Redo ${history.redoLabel}` : "Redo"} shortcut={shortcutFor("actionRedo")} disabled={!history.canRedo} onClick={() => run("actionRedo")}>
        <Redo2 size={16} />
      </IconButton>
      <div className="mx-1.5 h-4 w-px bg-line-strong" />
      <Button variant="ghost" size="sm" icon={<WandSparkles size={14} />} onClick={() => run("actionMakeReel")}>
        Make a reel
      </Button>
      {authEnabled() ? (
        <Button variant="ghost" size="sm" icon={<Share2 size={14} />} onClick={() => session.ui.setState({ dialog: "share" })}>
          Share
        </Button>
      ) : null}
      <Button variant="primary" size="sm" icon={<Download size={14} />} onClick={() => run("actionExportVideo")} className="ml-1">
        Export
      </Button>
      <div className="ml-2">
        <AccountMenu compact />
      </div>
    </header>
  );
}

