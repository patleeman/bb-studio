// BB's tooltip for Studio controls: a styled popup that opens after a short
// delay, where a `title` waits about a second and draws in the system style.
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { usePortalScopeProps } from "./portal-scope";
import { cn } from "./utils";

/** Shows `label` over `children`, which must take a ref (a button or link). */
export function Tooltip({ label, side = "bottom", align = "center", className, children }: {
  label: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  children: React.ReactElement;
}) {
  const scope = usePortalScopeProps();
  if (label === null || label === undefined || label === "") return children;
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={400}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            {...scope}
            side={side}
            align={align}
            sideOffset={4}
            collisionPadding={8}
            className={cn(
              "z-50 max-w-[min(20rem,var(--radix-tooltip-content-available-width))] overflow-hidden break-words rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
              className,
            )}
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
