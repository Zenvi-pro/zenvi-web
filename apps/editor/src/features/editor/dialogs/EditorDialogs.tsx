import { useSession, useUi } from "../session/context";
import { ExportDialog } from "./ExportDialog";
import { ShareDialog } from "./ShareDialog";
import { CloudConflictDialog, CommandPalette, ProjectFormatDialog, RelinkDialog, ShortcutsDialog } from "./SimpleDialogs";
import { TitleDialog } from "./TitleDialog";
import { ToolRunnerDialog } from "./ToolRunner";
import { UploadDialog } from "./UploadDialog";

/** Every editor dialog, driven by `ui.dialog`. */
export function EditorDialogs() {
  const session = useSession();
  const dialog = useUi((s) => s.dialog);
  const toolName = useUi((s) => s.toolName);
  const close = () => session.ui.setState({ dialog: null });
  return (
    <>
      <ExportDialog open={dialog === "export"} onClose={close} />
      <ShareDialog open={dialog === "share"} onClose={close} />
      <ShortcutsDialog open={dialog === "shortcuts"} onClose={close} />
      <CommandPalette open={dialog === "palette"} onClose={close} />
      <ProjectFormatDialog open={dialog === "profile"} onClose={close} />
      <RelinkDialog open={dialog === "relink"} onClose={close} />
      <TitleDialog open={dialog === "title"} onClose={close} />
      <CloudConflictDialog open={dialog === "cloudConflict"} onClose={close} />
      <UploadDialog open={dialog === "upload"} onClose={close} />
      <ToolRunnerDialog name={dialog === "tool" ? toolName : null} onClose={close} />
    </>
  );
}
