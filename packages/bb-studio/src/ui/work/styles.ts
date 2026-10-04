// Classes for the work UI. Sidebar rows copy BB's own (row height variable,
// hover and selected surfaces), so they sit in BB's sidebar without a seam.

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const ROW =
  "group/row relative flex h-[var(--bb-sidebar-row-height,28px)] w-full min-w-0 items-center gap-2 rounded-md pl-2 pr-1.5 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse,36px)]";

export const ROW_ACTIVE = "bg-sidebar-accent text-sidebar-foreground";

export const ROW_GLYPH = "inline-flex size-4 shrink-0 items-center justify-center text-subtle-foreground [&_svg]:size-4";

export const ROW_LABEL = "min-w-0 flex-1 truncate";

export const SECTION = "group/section flex h-7 items-center gap-1 px-2 text-xs font-medium text-muted-foreground";

export const SECTION_ACTION =
  "ml-auto inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground opacity-0 hover:bg-state-hover hover:text-muted-foreground focus-visible:opacity-100 group-hover/section:opacity-100 max-md:pointer-coarse:size-10 max-md:pointer-coarse:opacity-100 [&_svg]:size-3.5";

export const MENU =
  "z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";

export const MENU_ITEM =
  "flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 text-[13px] outline-none select-none data-[highlighted]:bg-state-hover data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground";

export const MENU_SEPARATOR = "-mx-1 my-1 h-px bg-border";

/** Spread on anything portaled, so Studio's scoped CSS still applies. */
export const PORTAL_SCOPE = {
  "data-bb-portaled-overlay": "",
  "data-bb-plugin-root": "",
  "data-bb-plugin": "studio",
} as const;
