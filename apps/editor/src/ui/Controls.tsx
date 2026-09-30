import * as RadixSlider from "@radix-ui/react-slider";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  tooltipSide?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}

const iconSizes = { xs: "h-6 w-6", sm: "h-7 w-7", md: "h-8 w-8", lg: "h-10 w-10" } as const;

/** Square icon button with an accessible label and a tooltip (label + shortcut). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = "sm", tooltipSide, className, children, type, ...rest },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md outline-none transition-colors duration-100",
          "focus-visible:ring-2 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-35",
          active ? "bg-accent/[0.16] text-accent-hover hover:bg-accent/[0.22]" : "text-fg-muted hover:bg-white/[0.07] hover:text-fg active:bg-white/[0.1]",
          iconSizes[size],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full outline-none transition-colors duration-150",
        "focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-40",
        checked ? "bg-accent" : "bg-white/[0.14]",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150",
          checked ? "translate-x-[16px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  onValueCommit?: (value: number) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}

export function Slider({ value, min, max, step = 1, onValueChange, onValueCommit, label, className, disabled }: SliderProps) {
  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onValueChange(v[0] ?? value)}
      onValueCommit={(v) => onValueCommit?.(v[0] ?? value)}
      className={cn("relative flex h-5 touch-none select-none items-center", className)}
    >
      <RadixSlider.Track className="relative h-[3px] grow overflow-hidden rounded-full bg-white/[0.12]">
        <RadixSlider.Range className="absolute h-full bg-white/60" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={label}
        className="block h-3 w-3 rounded-full bg-white shadow-[0_0_0_3px_rgba(0,0,0,0.4)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent"
      />
    </RadixSlider.Root>
  );
}

export function Divider({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <div aria-hidden className={cn(vertical ? "mx-1 h-4 w-px" : "my-1 h-px w-full", "shrink-0 bg-line-strong", className)} />;
}
