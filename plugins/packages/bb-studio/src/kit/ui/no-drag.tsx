// BB's desktop window is dragged by its top strip (`-webkit-app-region: drag`),
// and a click on a drag region never reaches the page. Anything Studio draws
// up there (the Bot sidebar's header, the Search panel, the Library's header) has to
// take its controls back out: `controls` leaves the empty space draggable,
// `all` makes the whole element clickable.
export const NO_DRAG_CSS = `
[data-studio-no-drag="controls"] :is(button, a, input, select, textarea, [role="tab"], [role="button"], [role="menuitem"], [role="treeitem"], [draggable="true"], [contenteditable="true"]) { app-region: no-drag; -webkit-app-region: no-drag; }
[data-studio-no-drag="all"] { app-region: no-drag; -webkit-app-region: no-drag; }
`;

/** The rule itself; render it once beside an element marked `data-studio-no-drag`. */
export function NoDragStyle() {
  return <style>{NO_DRAG_CSS}</style>;
}
