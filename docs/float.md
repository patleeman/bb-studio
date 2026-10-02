# Float

Float puts threads, channels, Studio items and views in one panel of tabs,
docked at the bottom right or dragged anywhere on screen. Plugin id `float`, display name "Float",
in `packages/bb-studio-float`. It started as Studio Chat's single floating
card, which was split out so anything you can open from the sidebar can
float, several things at once.

## Pieces

| Piece | Where |
|---|---|
| The panel, its tabs and thread tabs | `packages/bb-studio-float` (`experimental_appOverlay` "dock"); state in `src/stack.ts`, UI in `src/Panel.tsx` |
| The registry between Float and other plugins | `packages/bb-studio-kit/src/app/float-registry.ts`, on `window.__bbStudioFloat_v1` |
| `openFloat`, `useFloatAvailable`, `useCanFloat`, `FloatPanels`, `FloatThreadLeading`, `FloatDockPortal`, `useInFloat` | `packages/bb-studio-kit/src/app/float.tsx` |
| The right-click menu on Studio items | `packages/bb-studio-float/src/ItemMenu.tsx`; items are marked with `studioItemProps` from `packages/bb-studio-kit/src/app/studio-item.ts` |

A tab's target is a thread (`{ kind: "thread", threadId }`) or an in-app
path (`{ kind: "path", path }`, e.g. an item's href). A channel is a BB
thread, so it floats as one.

## Showing another plugin's view

BB renders a plugin's components only in its own slots, and each plugin
bundles its own copy of the kit. So the registry lives on `window` under a
versioned key, and:

1. Each plugin that can show paths renders
   `<FloatPanels path="pages" render={(subPath) => <PagesPanel subPath={subPath} />} />`
   from an app overlay. This registers `/plugins/<plugin id>/<path>`.
2. Float publishes an empty element for the path tab showing. The kit calls
   a tab a "window" (`windowKey`, `floatBodies`), from before tabs.
3. The plugin whose registered path is the longest prefix of the tab's
   path portals its panel into that element, with the rest of the path as
   `subPath`, just as BB passes it to a nav panel. The portal carries
   `data-bb-plugin-root` and `data-bb-plugin` so the plugin's CSS applies.

Inside the portal, `useInFloat()` is true, so a view can skip what only fits
its own screen. Pages, for example, doesn't move the panel or float its
chat from inside the panel.

## Other plugins

- `FloatDockPortal` renders in Float's bottom-right corner; Studio Chat's
  New in Float and Open in Float buttons, composer and thread picker sit
  there, and a docked panel sits to their left.
- `FloatThreadLeading` renders above a thread tab's messages; Studio Chat's
  "Viewing" chip uses it.
- `openFloat(target, { minimized, tag })`: `minimized` opens the tab behind
  the one showing (folded, in an empty panel). A tag swaps an unopened tab
  under the same tag, so Studio Chat bringing
  back each item's chat doesn't add a tab per item.
  Pinned and previously opened tabs keep their target when that tag follows
  another item, preserving any draft or editor they may hold.
  After the last tab or all tabs close, minimized opens are ignored until
  an explicit Float action opens the panel again.
- `--studio-float-right` on the root element moves the corner and a docked
  panel left; Pages sets it while its comments card is open.
- The older `bb-studio:chat:float` window event still floats a thread.

## Moving items

Float listens on the document, so any marked element and any link into a
plugin view or a thread moves in one gesture (`src/ItemMenu.tsx`):

- **Right-click:** Open, Float, Open in split, Copy link, New thread with this.
- **Shift-click** floats it, and **Mod-click** opens it in a split. The
  listener runs in the capture phase, so the element's own click handler
  doesn't open it as well.
- **Drag:** a drop zone covers the panel, or the corner when there's none.

A plugin marks the element that opens an item with
`<button {...studioItemProps({ href, title, icon })}>`, or a thread with
`studioThreadProps(threadId, title)`. Marks make the element draggable;
pass `{ drag: false }` inside an editor or a grid that drags its own
content, or where the text should stay selectable. While Mod- and
Shift-clicks mean something of the element's own, such as extending a
selection, set `STUDIO_ITEM_CLICKS_OFF` on it. A menu of the element's own
(anything that cancels `contextmenu`) wins, as on collection rows and
Studio's sidebar tabs.

`useOpenTarget()` opens a target in the main view, Float or a split, with
fallbacks. The collection's row menu, the item header's ⧉ menu, Quick Open
and Float's tab menu all use it.

Inside an unpinned tab, links follow in the tab. Float catches plain link clicks in the
tab body, and the kit's `openAppPath` checks whether the click came from
inside a tab (`navigateFromFloat`) and sends the tab there. Each tab keeps a
back stack for its ← button; validated history survives a reload. A pinned
tab keeps its target and opens links in another tab, focusing an existing
destination when one is already open.

## Layout

- **Tabs.** New tabs join at the end and show. A tab mounts when first shown
  and stays mounted until closed. Switching tabs, folding, and hiding the
  panel preserve local editor and composer state. Tabs reorder by dragging
  (pointer events, committed on drop). While every tab fits at 96px, all
  are labeled; past that, the tab showing keeps its label and the others
  are 32px icons, as many as fit around it. The ⋯ menu lists every tab. At
  the soft limit of 12, only unopened background tabs can be discarded.
  Opened and pinned companions stay until explicitly closed, even when
  that exceeds the limit.
- **Place.** Docked, the panel is 400px wide at the bottom right, left of
  the corner content. Dragging the header (anywhere that isn't a tab or a
  button) pulls it free. A free panel is stored by its left edge and its gap
  above the screen's bottom, so it grows upward when it opens, as it does
  docked, and it's clamped onto the screen when the screen shrinks. Dropped
  less than 48px above the bottom, it docks; an outline shows where.
- **Size.** 400 by 560 until resized. Drag an edge or corner: docked, the top
  and left edges, since the bottom and right stay put; free, any edge. At
  least 300 by 200, and kept on screen. Double-click an edge for the default.
- **State.** Per browser window in session storage: the tabs, pins, history, and tags,
  the tab showing, folded, hidden (Mod+Shift+J), dismissed, the place and the size.

## Limits

- **Navigation.** A floated panel's `useBbNavigate()` drives the main route,
  since BB gives the portal no router of its own. Links, and buttons that go
  through `openAppPath`, stay in the tab.
- **One item twice.** An item open both in the panel and in the main view runs
  two editors, each saving on its own.
- **Float actions.** BB has no slot in its own thread menu or next to the
  sidebar toggle, so Float is offered in Studio Sidebar's, Studio Teams' and
  Studio's own row menus, the item menu, and the palette.
- **Item gestures.** Only marked elements and links get them; an item a
  plugin draws without a mark keeps the browser's behavior.
- **Splits.** BB has no API to open a path in a split, but it opens a
  Mod-clicked link in one when the link is inside the clicking plugin's own
  tree. `openPathInSplit(anchor, path)` clicks such an anchor and falls back
  to the main view when BB doesn't take it (splits off, a small screen).
