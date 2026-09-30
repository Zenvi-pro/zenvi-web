import { Bot, SlidersHorizontal } from "lucide-react";
import { lazy, Suspense } from "react";
import { Spinner } from "@/ui/Spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { PropertiesPanel } from "../properties/PropertiesPanel";
import { useSession, useUi } from "../session/context";
import type { RightTab } from "../session/uiStore";

const AssistantPanel = lazy(() => import("../assistant/AssistantPanel"));

export function RightPanel({ width }: { width: number }) {
  const session = useSession();
  const tab = useUi((s) => s.rightTab);
  if (width === 0) return null;
  return (
    <aside className="flex shrink-0 flex-col border-l border-line bg-base" style={{ width }} aria-label="Inspector">
      <Tabs value={tab} onValueChange={(v) => session.ui.setState({ rightTab: v as RightTab })} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center border-b border-line px-1.5">
          <TabsList>
            <TabsTrigger value="properties">
              <SlidersHorizontal size={13} /> Properties
            </TabsTrigger>
            <TabsTrigger value="assistant">
              <Bot size={13} /> Assistant
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="properties" className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden">
          <PropertiesPanel />
        </TabsContent>
        <TabsContent value="assistant" forceMount className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden">
          <Suspense
            fallback={
              <div className="grid flex-1 place-items-center text-fg-subtle">
                <Spinner />
              </div>
            }
          >
            <AssistantPanel />
          </Suspense>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
