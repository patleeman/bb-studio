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
  the one showing (folded, in an empty panel). A tag swaps the tab opened
  under the same tag unless you're looking at it, so Studio Chat bringing
  back each item's chat doesn't add a tab per item.
- `--studio-float-right` on the root element moves the corner and a docked
  panel left; Pages sets it while its comments card is open.
- The older `bb-studio:chat:float` window event still floats a thread.

## The item menu

Right-clicking a Studio item anywhere opens **Open**, **Float** and **Open in
split**. Float listens for `contextmenu` on the document, so a plugin only
marks the element that opens an item:
`<button {...studioItemProps({ href, title, icon })}>`. A link to
`/plugins/<id>/<panel>/<more>` needs no mark. The menu stays out of the way
when the element has its own menu (anything that cancels the event, such as
Studio's sidebar tabs) and on Shift+right-click.

BB has no API to open a path in a split, but it opens a Mod-clicked link in
one when the link is inside the clicking plugin's own tree.
`openPathInSplit(anchor, path)` clicks such an anchor pointed at the path,
and falls back to opening it in full when BB doesn't take the click (splits
off, a small screen). Float's ⋯ menu and Studio's sidebar tabs use it too.

## Layout

- **Tabs.** New tabs join at the end and show. One tab shows at a time, and
  only it is mounted, so switching reloads the tab. Tabs reorder by dragging
  (pointer events, committed on drop). While every tab fits at 96px, all
  are labeled; past that, the tab showing keeps its label and the others
  are 32px icons, as many as fit around it. The ⋯ menu lists every tab. At
  most 12; past that the oldest closes, never the one showing.
- **Place.** Docked, the panel is 400px wide at the bottom right, left of
  the corner content. Dragging the header (anywhere that isn't a tab or a
  button) pulls it free. A free panel is stored by its left edge and its gap
  above the screen's bottom, so it grows upward when it opens, as it does
  docked, and it's clamped onto the screen when the screen shrinks. Dropped
  less than 48px above the bottom, it docks; an outline shows where.
- **Size.** 400 by 560 until resized. Drag an edge or corner: docked, the top
  and left edges, since the bottom and right stay put; free, any edge. At
  least 300 by 200, and kept on screen. Double-click an edge for the default.
- **State.** Per browser window in session storage: the tabs and their tags,
  the tab showing, folded, hidden (Mod+Shift+J), the place and the size.

## Limits

- **Navigation.** A floated panel's `useBbNavigate()` and links drive the main
  route, since BB gives the portal no router of its own.
- **One item twice.** An item open both in the panel and in the main view runs
  two editors, each saving on its own.
- **Float actions.** BB has no slot in its own thread menu or next to the
  sidebar toggle, so Float is offered in Studio Sidebar's, Studio Teams' and
  Studio's own row menus, the item menu, and the palette.
- **Item menu.** Only marked elements and plugin links get it; an item a
  plugin draws without a mark keeps the browser's menu.
