# Float

Float puts threads, channels, Studio items and views in windows along the
bottom of the screen, side by side. Plugin id `float`, display name "Float",
in `packages/bb-studio-float`. It started as Studio Chat's single floating
card, which was split out so anything you can open from the sidebar can
float, and several things at once.

## Pieces

| Piece | Where |
|---|---|
| The windows, the row and thread windows | `packages/bb-studio-float` (`experimental_appOverlay` "dock") |
| The registry between Float and other plugins | `packages/bb-studio-kit/src/app/float-registry.ts`, on `window.__bbStudioFloat_v1` |
| `openFloat`, `useFloatAvailable`, `useCanFloat`, `FloatPanels`, `FloatThreadLeading`, `FloatDockPortal`, `useInFloat` | `packages/bb-studio-kit/src/app/float.tsx` |

A window's target is a thread (`{ kind: "thread", threadId }`) or an in-app
path (`{ kind: "path", path }`, e.g. an item's href). A channel is a BB
thread, so it floats as one.

## Showing another plugin's view

BB renders a plugin's components only in its own slots, and each plugin
bundles its own copy of the kit. So the registry lives on `window` under a
versioned key, and:

1. Each plugin that can show paths renders
   `<FloatPanels path="pages" render={(subPath) => <PagesPanel subPath={subPath} />} />`
   from an app overlay. This registers `/plugins/<plugin id>/<path>`.
2. Float publishes an empty element for each open path window.
3. The plugin whose registered path is the longest prefix of the window's
   path portals its panel into that element, with the rest of the path as
   `subPath`, just as BB passes it to a nav panel. The portal carries
   `data-bb-plugin-root` and `data-bb-plugin` so the plugin's CSS applies.

Inside the portal, `useInFloat()` is true, so a view can skip what only fits
its own screen. Pages, for example, doesn't move the windows or float its
chat from inside a window.

## Other plugins in the row

- `FloatDockPortal` renders at the right end of the row; Studio Chat's
  "Work with this…" bar and composer sit there, and the windows fit around
  them.
- `FloatThreadLeading` renders above each thread window's messages; Studio
  Chat's "Viewing" chip uses it.
- `openFloat(target, { minimized, tag })`: a tag swaps a still-minimized
  window opened under the same tag, so Studio Chat bringing back each item's
  chat doesn't stack a window per item.
- `--studio-float-right` on the root element moves the row left; Pages sets
  it while its comments card is open.
- The older `bb-studio:chat:float` window event still floats a thread.

## Layout

New windows join at the right. An open window is 400px wide, a minimized
one 240px. Counting from the newest, windows show while they fit beside the
corner content; the rest go in a menu at the left end. The newest always
shows, so phones get one full-width window. State is per browser window in
session storage: the list, each window's minimized flag and tag, and whether
the windows are hidden (Mod+Shift+J).

## Limits

- **Navigation.** A floated panel's `useBbNavigate()` and links drive the main
  route, since BB gives the portal no router of its own.
- **One item twice.** An item open both in a window and in the main view runs
  two editors, each saving on its own.
- **Window actions.** BB has no slot in its own thread menu or next to the
  sidebar toggle, so Float is offered in Studio Sidebar's, Studio Teams' and
  Studio's own row menus and in the palette.
