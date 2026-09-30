import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { menuContentClass } from "./Menu";

export interface SelectOption<V extends string | number> {
  value: V;
  label: string;
  hint?: string;
}

export interface SelectProps<V extends string | number> {
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function Select<V extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  className,
  size = "sm",
}: SelectProps<V>) {
  const current = options.find((o) => o.value === value);
  return (
    <RadixDropdown.Root modal={false}>
      <RadixDropdown.Trigger
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-md border border-line-strong bg-white/[0.03] pl-2.5 pr-1.5 text-sm text-fg outline-none",
          "hover:border-line-bright focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=open]:border-accent disabled:opacity-40",
          size === "sm" ? "h-7" : "h-8",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? String(value)}</span>
        <ChevronDown size={13} className="shrink-0 text-fg-subtle" />
      </RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          loop
          className={cn(menuContentClass, "min-w-[var(--radix-dropdown-menu-trigger-width)]")}
        >
          <RadixDropdown.RadioGroup value={String(value)} onValueChange={(v) => {
            const option = options.find((o) => String(o.value) === v);
            if (option) onChange(option.value);
          }}>
            {options.map((option) => (
              <RadixDropdown.RadioItem
                key={String(option.value)}
                value={String(option.value)}
                className="group relative flex h-7 cursor-default select-none items-center gap-2 rounded-md pl-7 pr-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white"
              >
                <RadixDropdown.ItemIndicator className="absolute left-2 inline-flex">
                  <Check size={13} strokeWidth={2.5} />
                </RadixDropdown.ItemIndicator>
                <span className="truncate">{option.label}</span>
                {option.hint ? (
                  <span className="ml-auto pl-4 text-xs text-fg-subtle group-data-[highlighted]:text-white/80">{option.hint}</span>
                ) : null}
              </RadixDropdown.RadioItem>
            ))}
          </RadixDropdown.RadioGroup>
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
