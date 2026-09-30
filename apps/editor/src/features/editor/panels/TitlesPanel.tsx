import { Type } from "lucide-react";
import { titleTemplates } from "../catalog";
import { useSession } from "../session/context";
import { PanelEmpty, PanelHeader } from "./PanelChrome";

export function TitlesPanel() {
  const session = useSession();
  const templates = titleTemplates();
  const open = (templateId: string) => session.ui.setState({ dialog: "title", editingTitleFileId: null, titleTemplate: templateId });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Titles" />
      {templates.length === 0 ? (
        <PanelEmpty icon={<Type size={22} />} title="Title templates are on their way" body="The 50 desktop title templates ship with the next engine update." />
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1 overflow-y-auto px-2 pb-4 pt-2">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => open(t.id)}
              className="group min-w-0 rounded-lg p-1 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="checker relative aspect-video overflow-hidden rounded-md">
                {t.url ? <img src={t.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain" /> : null}
              </div>
              <p className="mt-1 truncate px-0.5 text-xs text-fg-muted">{t.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
