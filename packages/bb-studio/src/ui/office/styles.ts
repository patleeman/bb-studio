// Sidebar classes for the office UI. They copy BB's own sidebar rows
// (row height variable, hover and selected surfaces) so office rows sit next
// to BB's without a seam.

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const ROW =
  "group/row relative flex h-[var(--bb-sidebar-row-height,28px)] w-full min-w-0 items-center gap-2 rounded-md pl-2 pr-1.5 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse,36px)]";

export const ROW_ACTIVE = "bg-sidebar-accent text-sidebar-foreground";

export const ROW_GLYPH = "inline-flex size-4 shrink-0 items-center justify-center text-subtle-foreground [&_svg]:size-4";

export const ROW_LABEL = "min-w-0 flex-1 truncate";

export const SECTION_HEADER =
  "group/section flex h-7 items-center gap-1 px-2 text-xs font-medium text-muted-foreground";

export const SECTION_ACTION =
  "ml-auto inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-muted-foreground focus-visible:opacity-100 group-hover/section:opacity-100 max-md:pointer-coarse:opacity-100";

export const COUNT = "shrink-0 text-xs tabular-nums text-muted-foreground";

/** A count that asks for action: requests waiting on you. */
export const COUNT_HOT =
  "shrink-0 rounded-full bg-foreground px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-background";

export const SHORTCUT = "shrink-0 text-xs text-subtle-foreground";

export const MENU =
  "z-50 min-w-60 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none";

export const MENU_ITEM =
  "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[highlighted]:bg-state-hover data-[disabled]:opacity-50 [&_svg]:size-4";

export const MENU_SEPARATOR = "-mx-1 my-1 h-px bg-border";
