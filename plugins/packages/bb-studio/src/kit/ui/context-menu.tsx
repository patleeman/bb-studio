// Vendored subset of BB's shared-ui context menu, using the same Radix
// primitives, menu sizing, colors, and stacking layer.
import * as React from "react";
import * as Primitive from "@radix-ui/react-context-menu";
import { usePortalScopeProps } from "./portal-scope";
import { cn } from "./utils";
import { MENU_MUTED } from "./menu-muted";
import { LIST_HOVER_TRANSITION } from "./motion";

export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuSub = Primitive.Sub;

export function ContextMenuSubTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.SubTrigger>) {
  return <Primitive.SubTrigger
    className={cn("relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-xs outline-none focus:bg-state-hover focus:text-foreground data-[state=open]:bg-state-hover [&_[data-icon-root]]:size-4", className)}
    {...props} />;
}

export function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.SubContent>) {
  return <Primitive.Portal><Primitive.SubContent
    {...usePortalScopeProps()}
    className={cn(`z-[70] min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md ${MENU_MUTED}`, className)}
    {...props} /></Primitive.Portal>;
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function ContextMenuContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        {...usePortalScopeProps()}
        className={cn(
          `z-[70] min-w-28 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md ${MENU_MUTED}`,
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-xs outline-none focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0",
        LIST_HOVER_TRANSITION,
        className,
      )}
      {...props}
    />
  );
}

/** A heading or a read-only line inside a context menu: not focusable, not an action. */
export function ContextMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Label>) {
  return <Primitive.Label className={cn("px-2 py-1 text-xs", className)} {...props} />;
}

export function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-[0.3125rem] pl-2 pr-8 text-xs outline-none focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        LIST_HOVER_TRANSITION,
        className,
      )}
      {...props}
    >
      {children}
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <Primitive.ItemIndicator>✓</Primitive.ItemIndicator>
      </span>
    </Primitive.CheckboxItem>
  );
}
