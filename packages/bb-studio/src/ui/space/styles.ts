// Classes for the space UI's menus.

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

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
