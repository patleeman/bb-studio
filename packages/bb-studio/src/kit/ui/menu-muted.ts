/**
 * Muted text inside Studio's menus (descriptions, hints, ages). BB's dark
 * theme sets --muted-foreground a few percent off the menu's text, so hints
 * read as normal items there. Inside a menu it is the menu's text mixed 82%
 * toward its background: the same step BB's light theme already has (44% on
 * 32%), now in dark too.
 */
export const MENU_MUTED = "[--muted-foreground:color-mix(in_oklab,var(--popover-foreground)_82%,var(--popover))]";
