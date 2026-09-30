import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "./cn";

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <RadixTabs.List className={cn("flex items-center gap-0.5", className)}>{children}</RadixTabs.List>;
}

export function TabsTrigger({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className={cn(
        "inline-flex h-7 select-none items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-fg-subtle outline-none",
        "transition-colors duration-100 hover:text-fg-muted",
        "data-[state=active]:bg-white/[0.08] data-[state=active]:text-fg",
        "focus-visible:ring-2 focus-visible:ring-accent/70",
        className,
      )}
    >
      {children}
    </RadixTabs.Trigger>
  );
}
