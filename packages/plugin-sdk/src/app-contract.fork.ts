import type { ComponentType, ReactNode } from "react";
import type {
  ExperimentalFileLocation,
  ExperimentalLiveFileTarget,
  ExperimentalPanelTabs,
  PluginFileOpenerSource,
} from "./app-contract.js";
import type { JsonValue } from "./json-value.js";

/**
 * Props passed to an `experimental_sidebarSection` component. Experimental:
 * see docs/api_to_audit.md.
 */
export interface ExperimentalSidebarSectionProps {
  /** The thread the route currently shows; null on non-thread routes. */
  activeThreadId: string | null;
  /** The project the route currently shows; null when none is selected. */
  activeProjectId: string | null;
  /** True on phone-width viewports and coarse pointers. */
  isCompactViewport: boolean;
  /** Call after the user opens something. It closes the mobile sidebar drawer. */
  onNavigate: () => void;
  placement: ExperimentalSidebarSectionPlacement;
}

export type ExperimentalSidebarSectionPlacement = "list" | "footer";

/**
 * Registration for `slots.experimental_sidebarSection`: a section of the
 * plugin's own rows in the sidebar, below the thread list and scrolling with
 * it, or with `placement: "footer"` above the sidebar footer, outside the
 * scroll. The component draws its own heading and rows. Experimental: see
 * docs/api_to_audit.md.
 */
export interface ExperimentalSidebarSectionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Names the section for assistive technology and crash messages. */
  title: string;
  placement?: ExperimentalSidebarSectionPlacement;
  component: ComponentType<ExperimentalSidebarSectionProps>;
}

/**
 * One row a plugin contributes to bb's search palette. Experimental: see
 * docs/api_to_audit.md.
 */
export interface ExperimentalPaletteSearchResult {
  /** Unique among this provider's results for the query. */
  id: string;
  title: string;
  /** A second, quieter line: a snippet, a kind, a date. */
  subtitle?: string;
  /**
   * The bb route the row opens, such as one of the plugin's panel paths.
   * Opened like an in-app link; a row whose path is not a bb route is
   * dropped.
   */
  path: string;
  /**
   * What Mod+Enter (or a Mod-click) does for the row instead of opening
   * `path`: open it beside what is on screen, for example. Runs after the
   * palette closes.
   */
  experimental_onModSelect?(): void;
  /** Names the Mod action on the highlighted row, such as "Open in workbench". */
  experimental_modSelectLabel?: string;
  /** A bb icon name, or an emoji, drawn before the title. */
  icon?: string;
}

/**
 * Registration for `slots.experimental_paletteSearch`: results the search
 * palette lists under `title`, after threads. Experimental: see
 * docs/api_to_audit.md.
 */
export interface ExperimentalPaletteSearchRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** The group's heading, such as "Pages". */
  title: string;
  /**
   * Called as the person types, debounced, with the trimmed query; an empty
   * query asks for recent items. `signal` aborts when the query changes or
   * the palette closes. bb shows the first few rows. A rejection is logged
   * and the group is left out; it never breaks the palette.
   */
  search(
    query: string,
    options: { signal: AbortSignal },
  ): Promise<readonly ExperimentalPaletteSearchResult[]>;
}

/**
 * Fields the fork adds to `PluginThreadListRegistration`.
 */
export interface ForkThreadListFields {
  /**
   * While this thread list is the sidebar's, bb draws no sidebar header: no
   * New button or menu from the navigation provider, and no back and forward
   * buttons. Back and forward move to the start of the main view's header
   * row, keeping their shortcuts (in the desktop app's title bar layout they
   * already sit there). Draw your own create control in the list.
   * Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_hideSidebarHeader?: boolean;
}

/**
 * The chat message a `slots.experimental_messageAction` item is for.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalMessageActionMessage {
  threadId: string;
  messageId: string;
  /** The containing turn, or null for a message outside a turn. */
  turnId: string | null;
  role: "user" | "assistant";
  /**
   * The last source event sequence the message covers. Pass it as
   * `sourceSeqEnd` to `threads.fork` to fork the thread after this message.
   */
  sourceSeqEnd: number;
}

/**
 * Registration for `slots.experimental_messageAction`: an item in the ···
 * menu of chat messages, in the main thread view and in `ThreadChat`.
 * `icon` is a bb icon name. `isAvailable` runs while the message renders,
 * so it must be synchronous, pure and fast; leave it out to show the item on
 * every message. A throw from `isAvailable` hides the item; a throw or
 * rejection from `run` is logged. `experimental_replaces: "thread.fork"`
 * hides bb's own "Fork into new thread" item on the messages this item is
 * available for. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalMessageActionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  icon?: string;
  isAvailable?(message: ExperimentalMessageActionMessage): boolean;
  run(message: ExperimentalMessageActionMessage): void | Promise<void>;
  experimental_replaces?: "thread.fork";
}

/**
 * Fields the fork adds to an action tab registration.
 */
export interface ForkTabFields {
  /**
   * The icon for one open instance of this action tab, from its params: a
   * page's glyph for a page, a board's for a board. Return null to keep the
   * registration's `icon`. Must be pure and cheap; it runs while the tab
   * strip renders. Ignored on fixed tabs. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_instanceIcon?(params: JsonValue | null): string | null;
  /**
   * Set to false to leave this action tab out of the New Tab page's Actions
   * list and its action search. The tab stays registered: `openTab`, links
   * and the rest of bb still open it. Leave it out to list the tab. Applies
   * to every action registration of the tab's id in the plugin. Ignored on
   * fixed-availability tabs. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_showInNewTab?: false;
  /**
   * A section heading for this action tab on the New Tab page, such as
   * "New" or "Open". Sections follow the order in which registrations first
   * name them, after bb's own Actions section, which keeps the tabs without
   * one. The action search still lists every match under Actions. Ignored on
   * fixed-availability tabs. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_newTabGroup?: string;
  /**
   * Set to true to let other plugins open this thread action tab with
   * `experimental_workbench(...).open({ kind: "tab", tab: { pluginId, id } })`.
   * Left out, only this plugin opens it there. The opener's params reach the
   * tab as they do with `openTab`, so treat them as untrusted input. Ignored
   * on fixed-availability tabs. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_openableByPlugins?: true;
}

/**
 * One fixed tab, as `experimental_useGlobalTabs()` reports it: an action
 * tab opened with `experimental_global: true`, which bb draws first in
 * every side panel where its plugin registers the tab. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalGlobalTab {
  /** The plugin that registered the tab. */
  pluginId: string;
  /** The registered tab's id. */
  tabId: string;
  title: string;
  /** The instance's params; null when it was opened without any. */
  params: JsonValue | null;
}

/**
 * What a reply classifier says about one assistant reply. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalReplyClassification {
  /** Draw the reply as a small "Quiet check" marker, not as a message. */
  quiet?: boolean;
}

/**
 * Registration for `slots.experimental_replyClassifier`. `classify` runs
 * while the thread view renders, so it must be synchronous, pure and fast.
 * Pair it with a backend `experimental_classifyTurns` hook that uses the
 * same rule. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalReplyClassifierRegistration {
  id: string;
  classify(text: string): ExperimentalReplyClassification | null | undefined;
  /**
   * Optional. Say how bb should draw a message that came into the thread
   * (a user-role row). Called with the row's whole text (`part: "message"`)
   * and, for a row bb draws as a system row, with the body after bb's own
   * header (`part: "body"`). Return null to leave the row alone. Must be
   * synchronous, pure and fast. Experimental: see docs/api_to_audit.fork.md.
   */
  classifyMessage?(
    text: string,
    context: ExperimentalMessageClassificationContext,
  ): ExperimentalMessageClassification | null | undefined;
}

/**
 * What bb knows about a message it asks a classifier about. `initiator` is
 * null for `part: "body"`. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalMessageClassificationContext {
  part: "message" | "body";
  initiator: "user" | "agent" | "system" | null;
}

/**
 * A message that was not typed by the user. For a row bb would draw as the
 * user's own message, any result draws it as a system row instead. `sender`
 * names where it came from ("Message from <sender>"); `previewStart` is the
 * offset into the text where the row's one-line preview starts. When the
 * thread's reply to it is quiet, the row and the reply fold into this one
 * row. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalMessageClassification {
  sender?: string;
  previewStart?: number;
}

/**
 * The click a link handler is asked for, when there is one: its modifier
 * keys. Left out when bb opens a URL without a click (a command, a tool).
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalLinkClick {
  modifiers: { meta: boolean; ctrl: boolean; shift: boolean; alt: boolean };
}

/**
 * Registration for `slots.experimental_linkHandler`. `handle` is called when
 * someone clicks a link that bb would open itself (in a chat reply, a file
 * preview, a terminal), before bb opens it, and for a click with a modifier
 * key on any link in the app, with the modifiers in `click`. Return true when
 * the plugin opened it; return false to let the next handler or bb have it.
 * It must be synchronous and must not throw for links it does not know.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalLinkHandlerRegistration {
  id: string;
  handle(url: string, click?: ExperimentalLinkClick): boolean;
}

/**
 * Registration for `slots.experimental_window`: a component bb can show in
 * a window of its own, with no bb chrome around it. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalWindowRegistration {
  id: string;
  title: string;
  component: ComponentType;
}

/**
 * Registration for `slots.experimental_launcherItem`: an app or action a
 * plugin offers to a launcher (a search-and-run window some plugin draws).
 * `section` groups it; `keywords` are extra words to match. `run` is called
 * in the launcher's own window, so it must work from any window: open
 * another window, call the plugin's backend, navigate. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalLauncherItemRegistration {
  id: string;
  title: string;
  icon: string;
  section: "apps" | "actions";
  keywords?: readonly string[];
  order?: number;
  run(): void | Promise<void>;
}

/**
 * One launcher item as `experimental_useLauncherItems()` reports it.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalLauncherItem extends ExperimentalLauncherItemRegistration {
  /** `<pluginId>/<id>`. */
  key: string;
  pluginId: string;
}

/**
 * Props for a `slots.experimental_threadBanner` component: the thread whose
 * view it is drawn in. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalThreadBannerProps {
  threadId: string;
}

/**
 * Registration for `slots.experimental_threadBanner`: a component bb draws
 * in each thread view, under the thread's header row and above its
 * transcript, at the view's width. It receives the thread it is drawn for,
 * which in a split or side panel is not the route's thread, draws its own
 * height, and returns null to take no room. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalThreadBannerRegistration {
  id: string;
  component: ComponentType<ExperimentalThreadBannerProps>;
}

/**
 * What `slots.experimental_threadHeader`'s `useDecoration` is called with:
 * the thread whose header it decorates, which in a split pane is not the
 * route's thread. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalThreadHeaderArgs {
  threadId: string;
}

/**
 * A decoration for a thread's header row. `title` replaces the title text
 * bb shows (an empty string keeps bb's); renaming still edits the thread's
 * real title. `after` is a small node drawn right after the title, in the
 * same row. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalThreadHeaderDecoration {
  title?: string;
  after?: ReactNode;
}

/**
 * Registration for `slots.experimental_threadHeader`. `useDecoration` is a
 * hook bb calls in every thread header (the main thread view and each split
 * pane). Return null to leave the header as it is. When several plugins
 * return a decoration, the first by plugin id, then registration id, wins.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalThreadHeaderRegistration {
  id: string;
  useDecoration(
    args: ExperimentalThreadHeaderArgs,
  ): ExperimentalThreadHeaderDecoration | null;
}

/**
 * One draggable thing in the shared drag payload: a thread, a plugin
 * document, a side panel tab or a file. A drag carries it as JSON under the
 * MIME type `application/x-bb-item`; write it with
 * `experimental_writeDragItem` and read it with `experimental_readDragItem`.
 * Every side panel tab is a native drag source of one: a plugin action tab
 * carries `tab`; a tab another workbench can show (plugin action tabs,
 * workspace, host and thread storage files) carries `open`; a tab that
 * cannot leave its window (terminal, browser, Info, Diff, New Tab, fixed
 * tabs) carries neither and is also marked with the MIME type
 * `application/x-bb-item-local`. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalDragItem {
  kind: "thread" | "doc" | "tab" | "file";
  /** A thread id, a plugin document id, a tab key or a file path. */
  id: string;
  title: string;
  /** The bb route that opens it in the main view, when it has one. */
  path?: string;
  /** Which plugin's thing it is (documents and plugin tabs). */
  pluginId?: string;
  /** For kind "tab": the side panel action tab being dragged. */
  tab?: {
    pluginId: string;
    tabId: string;
    params: Record<string, unknown> | undefined;
    threadId: string | null;
  };
  /**
   * For kind "tab": what `ExperimentalWorkbench.open` takes to show the
   * same tab in another workbench or window. bb itself moves a tab dropped
   * on a side panel's tab row with it; absent for a tab that cannot leave
   * its window.
   */
  open?: ExperimentalWorkbenchOpenSpec;
}

/**
 * A mention pill a drop handler puts into a composer: one of the calling
 * plugin's own mentions, the pill `useComposer().insert({ provider, id,
 * label })` makes. `provider` is a mention provider id the plugin
 * registered with `bb.ui.registerMentionProvider`; at send time bb asks
 * that provider to resolve `id`. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalDropMention {
  provider: string;
  id: string;
  label: string;
}

/**
 * Where on bb's own surfaces a dragged item is: the side panel of a thread,
 * of a plugin page (`threadId` null) or of a popped-out tab window, a
 * thread's composer or the new-thread composer (`threadId` null), or the
 * rest of the main view.
 * In a side panel, `pane` and `index` say where: over a pane's tab row,
 * `pane` is 1 or 2 (left to right) and `index` the insertion point among
 * that row's tabs, counted as `ExperimentalWorkbenchPane.tabs` lists them;
 * over the right edge of a side panel with one pane, `pane` is "new"; both
 * are absent elsewhere in the panel. `open(spec, options)` opens an item in
 * that very panel, as `ExperimentalWorkbench.open` does for the calling
 * plugin; it is the one way into a popped-out window's panel, where
 * `experimental_workbench` needs a component mounted in that window. Pass
 * `pane` and `index` to it to open the item where the drop landed.
 * The composer's three functions insert at its caret, or append when it
 * has no caret, and return false when that composer is not on screen or
 * the value is not valid. `insertText` inserts plain text.
 * `insertMention` inserts one of the calling plugin's mention pills.
 * `insertThreadMention` inserts bb's own thread mention, the pill typing @
 * and picking a thread makes; no mention provider is involved.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export type ExperimentalItemDropTarget =
  | {
      zone: "workbench";
      threadId: string | null;
      pane?: 1 | 2 | "new";
      index?: number;
      open(
        spec: ExperimentalWorkbenchOpenSpec,
        options?: ExperimentalWorkbenchOpenOptions,
      ): Promise<string | null>;
    }
  | {
      zone: "composer";
      threadId: string | null;
      insertText(text: string): boolean;
      insertMention(mention: ExperimentalDropMention): boolean;
      insertThreadMention(thread: { id: string; title: string }): boolean;
    }
  | { zone: "main" };

/**
 * Registration for `slots.experimental_itemDrop`: what happens when an item
 * is dropped on one of bb's own surfaces. `canDrop` runs on every pointer
 * move of a drag, so it must be synchronous, pure and fast; a throw counts
 * as false. `drop` goes to the first handler, in plugin-id order, whose
 * `canDrop` is true; a throw or rejection is logged. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalItemDropRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  canDrop(
    item: ExperimentalDragItem,
    target: ExperimentalItemDropTarget,
  ): boolean;
  drop(
    item: ExperimentalDragItem,
    target: ExperimentalItemDropTarget,
  ): void | Promise<void>;
}

/**
 * Props of a replacement quick palette (`slots.experimental_commandPalette`).
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalCommandPaletteProps {
  /**
   * What opened the palette: `"search"` for Search (Mod+K, the rail's Search
   * button, the `thread.search` command), `"commands"` for the quick palette
   * command (Shift+Mod+P). Pressing either again while the palette is open
   * mounts the component again with the new mode.
   */
  initialMode: "commands" | "search";
  /**
   * Close the palette. `then` runs after it has closed and focus is back where
   * it was before the palette opened, as bb runs a chosen command; run app
   * commands that act on the focused view this way.
   */
  close(then?: () => void): void;
  /**
   * Ask `handler` first when Escape is pressed in the palette. When it
   * returns true bb keeps the palette open and the key is handled (its
   * `defaultPrevented` is set); false, a throw or no handler closes the
   * palette. bb calls it before the key reaches the focused element. A new
   * registration replaces the previous one; the returned function removes
   * it. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_onEscape(handler: () => boolean): () => void;
}

/**
 * Registration for `slots.experimental_commandPalette`: a component that
 * replaces bb's quick palette (its command list and its thread search) on
 * every entry point. bb draws it in its own palette dialog, so focus
 * trapping, the overlay and Escape (which closes it unless the component's
 * `experimental_onEscape` handler claims it) are bb's. The first
 * registration by plugin id wins; with none, bb's palette shows. A crash in
 * the component shows bb's palette instead. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalCommandPaletteRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  component: ComponentType<ExperimentalCommandPaletteProps>;
}

/**
 * A surface of bb's main window that `experimental_appBackdrop` can paint:
 * the sidebar, the main view, the composer box, the side panel and the main
 * view's header row, plus two kinds of surface inside the main view and the
 * side panel. `panel` is every card, settings section, page root and field
 * there (`--card`, `bg-background`); left out, it is `--canvas` at 32%.
 * `code` is code blocks, sticky headers and floating bars there, which stay
 * denser so text reads over what scrolls under them; left out, it is
 * `--canvas` at 58%, and its `backdropFilter` (default `blur(8px)`) applies
 * to the sticky and floating ones only. `popover` is every overlay bb
 * portals to `<body>` under `layout.cards` (menus, popovers, select lists,
 * hover cards, tooltips, dialogs, drawers, toasts, the command palette, and
 * a plugin's own that use `bg-popover` or `role="dialog"`): left out, it is
 * `--canvas` at 76% with `blur(12px)`; they take the card radius and
 * shadow, no border, and their hover and selection fills are `--primary` at
 * 24% and 34%. Without `layout.cards` overlays stay opaque. None of the
 * three draws an `edge`.
 */
export type ExperimentalAppSurface =
  | "sidebar"
  | "main"
  | "composer"
  | "secondaryPanel"
  | "header"
  | "panel"
  | "code"
  | "popover";

/**
 * How bb paints one surface over an app backdrop. Each value is a CSS value
 * for that property; one the browser cannot parse is dropped. Experimental:
 * see docs/api_to_audit.fork.md.
 */
export interface ExperimentalAppSurfaceStyle {
  /** A CSS `background`, such as a translucent color or a gradient. Default: none, so the backdrop shows through. */
  background?: string;
  /** A CSS `backdrop-filter`, such as `blur(24px) saturate(1.4)`. */
  backdropFilter?: string;
  /** A CSS color for the surface's border lines where bb draws them. */
  edge?: string;
}

/**
 * What an app backdrop asks of bb's main window while it is shown (see
 * `ExperimentalAppBackdropRegistration.useAppearance`). Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalAppAppearance {
  /**
   * Overrides the window's resolved light or dark mode, so bb's `.dark`
   * class, its `dark:` styles and `experimental_useAppTheme().mode` follow it.
   */
  mode?: "light" | "dark";
  /**
   * CSS custom properties set on `<html>`, such as `--canvas` or `--ink`.
   * A name that is not `--` and letters, digits, `-` or `_`, or a value the
   * browser cannot parse, is dropped.
   */
  tokens?: Record<`--${string}`, string>;
  /** How bb paints each surface; a surface left out is fully see-through. */
  surfaces?: Partial<
    Record<ExperimentalAppSurface, ExperimentalAppSurfaceStyle>
  >;
  /**
   * How bb lays its surfaces out over the backdrop. With `cards`, the
   * sidebar (its content and footer, as one card), the header's groups, the
   * main view and the side panel become rounded cards with `gap` pixels
   * (0 to 24) between them and the window's edges and corner radius
   * `radius` (0 to 28), each painted from its surface in `surfaces`; the
   * composer is a card inside the main view's card, the rail sits bare on
   * the scene, and the scene shows in the gaps. Cards have no border: a
   * surface's `edge` is not drawn, only a faint inner highlight and a soft
   * shadow (`--fork-cards-shadow`). Outside a thread, a page's content
   * column is the main card (as tall as the page area, centered, the scene
   * clear beside it), and a table wider than a thread's column gets the same
   * glass under the part outside it. bb sets `data-fork-cards` and the custom
   * properties `--fork-cards-gap` and `--fork-cards-radius` on `<html>`. Any
   * element outside the sidebar with `data-fork-card="sidebar" | "main" |
   * "header" | "composer" | "secondary-panel"` is painted as a card from
   * that surface. Leave it out for bb's own layout.
   *
   * With `titleRow: true` a page's title is the first row of its card, not
   * a pill in the bar: bb moves the header's title group (title,
   * breadcrumbs, a thread's rename field and menu) into the element marked
   * `data-fork-title-host` under the header's parent and sets
   * `data-fork-title-rows` on `<html>`. bb's Settings, Skills and Plugins
   * pages carry a host; a plugin marks one in its own content (an empty
   * element it styles itself), and a page with no host keeps its title in
   * the bar. Page, transcript and list scrollers reserve no scrollbar
   * gutter under `cards` and show a thin overlay thumb on hover and scroll;
   * mark a plugin's own scroller `data-fork-overlay-scroll` for the same.
   */
  layout?: { cards: { gap: number; radius: number; titleRow?: boolean } };
}

/**
 * Registration for `slots.experimental_appBackdrop`: a component bb draws
 * once per main window behind its whole layout (full window, under every
 * surface, no pointer events). While it is shown bb's own surfaces are
 * see-through and painted from `useAppearance`. The first registration by
 * plugin id wins. A crash in the component or in `useAppearance` removes
 * the backdrop and every override. Plugin windows, popped-out routes and
 * popped-out tabs get none. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalAppBackdropRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  component: ComponentType;
  /**
   * A hook bb calls in the plugin's scope in the main window. Return null,
   * or leave a field out, for bb's own.
   */
  useAppearance?: () => ExperimentalAppAppearance | null;
}

/**
 * A side panel tab shown in a popped-out window ("Open in new window",
 * `experimental_workbench(...).popOut`), as `experimental_useTabWindow()`
 * reports it to the tab's components. The window's bar shows the selected
 * tab's `title` and "Return to workbench", so the tab need not draw its own
 * title row. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalTabWindow {
  /** The title the window's bar shows: the selected tab's. */
  title: string;
  /**
   * An element in the window's bar, before "Return to workbench", for the
   * tab's own controls (render into it with `createPortal`). It lays its
   * children out in a row and keeps them out of the window drag region.
   * Null until the bar has mounted, and null for every tab but the selected
   * one.
   */
  toolbar: HTMLElement | null;
}

/**
 * One entry of bb's quick palette command list, as
 * `experimental_useAppCommands()` lists it. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalAppCommand {
  /**
   * Stable across renders: `app:<command id>` for bb's commands (such as
   * `app:thread.new`), `plugin:<plugin id>/<id>` for plugin commands, `settings:<section>` and `settings:plugin:<plugin id>`
   * for settings pages, `plugin-page:<plugin id>/<panel id>` for plugin
   * pages and `server:<id>` for switching servers.
   */
  id: string;
  /** The title bb's palette shows, such as "New conversation". */
  title: string;
  /** The heading bb's palette groups it under, such as "Threads" or "Settings". */
  group: string;
  /** The shortcut as bb shows it, such as "⌘N"; absent when it has none. */
  shortcut?: string;
  /**
   * Run it. Inside a replacement palette this closes the palette first and
   * runs the command after focus is back, as bb's palette does.
   */
  run(): void;
}

/**
 * How a plugin window looks and behaves. Sizes are in points. `hotkey` is a
 * system-wide shortcut in Electron's accelerator form (such as
 * `Alt+Space`) that shows or hides the window. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalWindowOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  /** No background and no frame: the component draws everything. */
  transparent?: boolean;
  frame?: boolean;
  alwaysOnTop?: boolean;
  resizable?: boolean;
  hotkey?: string;
  minWidth?: number;
  minHeight?: number;
  /** `"hiddenInset"`: no title bar; the traffic lights sit inside the content. */
  titleBar?: "hiddenInset";
  /**
   * Reopen where it was last shown or hidden, at that size, on that
   * display; on the main display, moved on-screen, when that display is gone.
   */
  rememberBounds?: boolean;
  /** Open in the middle of the screen. */
  center?: boolean;
  /** Close when the window loses focus (a launcher). */
  hideOnBlur?: boolean;
  /** Passed to the window as its query string. */
  params?: Readonly<Record<string, string>>;
}

/** A macOS permission desktop control needs. Experimental: see docs/api_to_audit.fork.md. */
export type ExperimentalDesktopPermission =
  | "accessibility"
  | "screenRecording"
  | "inputMonitoring";

/** A screen rectangle in points, top-left origin. */
export interface ExperimentalDesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A spot the person pointed at with the HUD: the app, window, element and
 * page under it, a screenshot of the window, and its number on screen.
 */
export interface ExperimentalDesktopPin {
  id: string;
  number: number;
  threadId: string | null;
  createdAt: number;
  x: number;
  y: number;
  app: string | null;
  bundleId: string | null;
  pid: number | null;
  windowId: number | null;
  windowTitle: string | null;
  windowBounds: ExperimentalDesktopRect | null;
  url: string | null;
  role: string | null;
  label: string | null;
  elementFrame: ExperimentalDesktopRect | null;
  secure: boolean;
  /** Absolute path of the PNG on this machine, or null without Screen Recording. */
  imagePath: string | null;
  /** A small data URL of the screenshot. */
  thumbnail: string | null;
  /** False while the talk key is still held. */
  placed: boolean;
  /** A composer has taken it (`pinsTaken`). */
  taken: boolean;
}

/** What an agent is doing on the desktop right now. */
export interface ExperimentalDesktopActivity {
  threadId: string;
  agent: string;
  caption: string;
  app: string | null;
  phase: "acting" | "paused" | "stopped";
  x: number | null;
  y: number | null;
  clickAt: number | null;
  /** The action uses the person's real cursor or keyboard. */
  foreground: boolean;
  updatedAt: number;
}

/** An agent asking for the person's cursor and keyboard. */
export interface ExperimentalDesktopAsk {
  id: string;
  threadId: string;
  agent: string;
  reason: string;
  app: string | null;
}

/** Desktop control's state, the same in every window. */
export interface ExperimentalDesktopControlState {
  supported: boolean;
  driver: {
    status: "unavailable" | "stopped" | "starting" | "ready" | "failed";
    version: string | null;
    error: string | null;
  };
  helper: boolean;
  permissions: Record<ExperimentalDesktopPermission, boolean> & { checked: boolean };
  /** Screen Recording was allowed after launch; macOS may need a relaunch. */
  restartAdvised: boolean;
  hud: { shown: boolean; threadId: string | null };
  pointing: boolean;
  talkKey: string;
  talking: boolean;
  hover: ExperimentalDesktopPin | null;
  pins: readonly ExperimentalDesktopPin[];
  activity: ExperimentalDesktopActivity | null;
  grant: { kind: "none" | "once" | "session"; threadId: string | null };
  ask: ExperimentalDesktopAsk | null;
}

/** A request to desktop control. */
export type ExperimentalDesktopControlRequest =
  | { op: "state" }
  | { op: "refreshPermissions" }
  | { op: "requestPermission"; permission: ExperimentalDesktopPermission }
  | { op: "openSettings"; permission: ExperimentalDesktopPermission }
  | { op: "relaunch" }
  | { op: "hud"; shown: boolean; threadId?: string | null }
  | { op: "pointing"; on: boolean }
  | { op: "talkKey"; key: "fn" | "AltRight" | "MetaRight" | "ControlRight" }
  | { op: "talk"; down: boolean }
  | { op: "pinsTaken"; ids: readonly string[] }
  | { op: "clearPins" }
  | { op: "answer"; id: string; answer: "session" | "once" | "no" }
  | { op: "stop" }
  | { op: "resume" };

/**
 * `experimental_useDesktopControl()`: the desktop app's control of other
 * apps (permissions, the HUD, pointing and pins, an agent's activity and
 * the cursor grant). `native` is false outside the desktop app on macOS,
 * where `state` stays null and `request` resolves null. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalDesktopControl {
  native: boolean;
  state: ExperimentalDesktopControlState | null;
  request(
    request: ExperimentalDesktopControlRequest,
  ): Promise<ExperimentalDesktopControlState | null>;
}

/**
 * `experimental_useWindows()`. `native` is true in the desktop app, where
 * every option applies. In a browser `open` opens a plain popup and the
 * styling and hotkey options are ignored. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalWindows {
  native: boolean;
  /** Set up a window's hotkey without showing it. */
  register(
    windowId: string,
    options?: ExperimentalWindowOptions,
  ): Promise<boolean>;
  open(windowId: string, options?: ExperimentalWindowOptions): Promise<boolean>;
  toggle(
    windowId: string,
    options?: ExperimentalWindowOptions,
  ): Promise<boolean>;
  close(windowId: string): Promise<boolean>;
  /**
   * Whether the window's `hotkey` is registered with the system. False when
   * none was asked for, when another app holds it, or outside the desktop
   * app; ask after `register` or `open`.
   */
  hotkeyRegistered(windowId: string): Promise<boolean>;
}

/** Arguments passed to a file opener's `experimental_handleOpen`. */
export interface PluginFileOpenerOpenArgs {
  path: string;
  source: PluginFileOpenerSource;
  /** One-based, inclusive lines requested by this open, or null when untargeted. */
  lineRange: {
    startLineNumber: number;
    endLineNumber: number;
  } | null;
}

/** Fields the fork adds to `PluginFileOpenerRegistration`. */
export interface ForkFileOpenerFields {
  /**
   * Called before bb opens a file tab that resolves to this opener. Resolve
   * `true` when the plugin showed the file elsewhere (for example in its own
   * panel tab); bb then opens no file tab. Resolve `false`, throw, or take
   * longer than 3 seconds to get the normal tab with `component`. Not called
   * when the user chose this opener for one open from "Open with", when a
   * New Tab's file search opens the file in place, or when bb restores an
   * existing tab. A bb without it ignores the field, so keep `component` as
   * the fallback. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_handleOpen?: (
    args: PluginFileOpenerOpenArgs,
  ) => boolean | Promise<boolean>;
}

/**
 * One row a plugin adds to bb's context popover (the card behind the
 * context ring under the composer). bb draws it in the card's own style:
 * `label` on the left, `value` on the right, `note` as a quiet second line,
 * and `actions` as small text buttons. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalContextCardRow {
  label: string;
  value: string;
  note?: string;
  actions?: readonly {
    id: string;
    label: string;
    run(): void | Promise<void>;
  }[];
}

/**
 * Registration for `slots.experimental_contextCardRow`. `useRow` is a hook:
 * bb calls it while the card is shown for the thread in `useBbContext()`.
 * Return null to add nothing. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalContextCardRowRegistration {
  id: string;
  useRow(): ExperimentalContextCardRow | null;
}

/**
 * `experimental_useContextCard()`: lets a plugin control open bb's context
 * popover. `available` is false while the thread has no context ring (no
 * usage yet); `open` then does nothing. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalContextCard {
  available: boolean;
  open(): void;
}

/**
 * Props for a `slots.experimental_modelLoadNotice` component: the model list
 * that failed to load, as bb's model picker shows it. `code` is the
 * failure's code (`failed`, `auth_required`, `timeout`,
 * `missing_executable`, `provider_unavailable`); `detail` is the server's
 * message, or null. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalModelLoadNoticeProps {
  providerLabel: string;
  code: string;
  detail: string | null;
}

/**
 * Registration for `slots.experimental_modelLoadNotice`: a component bb
 * draws under "Could not load models for …" wherever it shows a model list
 * failure. It draws its own content and returns null to add nothing.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalModelLoadNoticeRegistration {
  id: string;
  component: ComponentType<ExperimentalModelLoadNoticeProps>;
}

/**
 * Registration for `slots.experimental_newConversation`: bb's "New thread"
 * command (Mod+N) and the sidebar's New thread row call `run` first. When it
 * returns true the plugin started the new conversation itself and bb does
 * nothing more; false (or a throw) falls back to bb's new-thread page. The
 * first registration in plugin-id order is asked first. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalNewConversationRegistration {
  id: string;
  run(): boolean;
}

/**
 * Props for a `slots.experimental_firstRun` component. `finish()` marks bb's
 * first run done (the same setting bb's own setup screens set) and shows the
 * app. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalFirstRunProps {
  finish(): void;
}

/**
 * Registration for `slots.experimental_firstRun`: the plugin takes over bb's
 * first run. On a data dir whose first run is not done, bb waits for plugin
 * frontends to settle; when a plugin registered this slot, bb draws its
 * `component` full-window instead of bb's setup screens, or, with no
 * component, marks the first run done at once and shows the app. The first
 * registration in plugin-id order wins. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalFirstRunRegistration {
  id: string;
  component?: ComponentType<ExperimentalFirstRunProps>;
}

/**
 * Props for a `slots.experimental_modelPickerGate` component: `children` is
 * bb's model picker, and `hasSelectedModel` says whether it shows a model.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalModelPickerGateProps {
  hasSelectedModel: boolean;
  children: ReactNode;
}

/**
 * Registration for `slots.experimental_modelPickerGate`: a component bb draws
 * in place of every model picker in the composer and elsewhere. It returns
 * `children` to keep bb's picker, or its own node instead (a "Sign in"
 * button while no provider can run a turn). The first registration in
 * plugin-id order wins; one that throws falls back to bb's picker.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalModelPickerGateRegistration {
  id: string;
  component: ComponentType<ExperimentalModelPickerGateProps>;
}

export type ExperimentalHostPage = "skills";

export type ExperimentalHostSetting = "cli-skills";

export type ExperimentalHostSettingsSection = "mobile";

export interface ExperimentalHideHostEntriesRegistration {
  id: string;
  navigation?: readonly string[];
  pages?: readonly ExperimentalHostPage[];
  settings?: readonly ExperimentalHostSetting[];
  settingsSections?: readonly ExperimentalHostSettingsSection[];
  footer?: readonly string[];
}

/**
 * Slots the fork adds beside `PluginAppSlots`.
 */
export interface ForkPluginAppSlots {
  /**
   * Add a row to bb's context popover (see
   * {@link ExperimentalContextCardRowRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_contextCardRow(
    registration: ExperimentalContextCardRowRegistration,
  ): void;
  /**
   * Offer a component bb can show in a window of its own (see
   * {@link ExperimentalWindowRegistration}); open it with
   * `experimental_useWindows()`. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_window(registration: ExperimentalWindowRegistration): void;
  /**
   * Draw a row under each thread's header (see
   * {@link ExperimentalThreadBannerRegistration}). Rows are stacked in
   * plugin-id order. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_threadBanner(
    registration: ExperimentalThreadBannerRegistration,
  ): void;
  /**
   * Draw a notice under a model list failure (see
   * {@link ExperimentalModelLoadNoticeRegistration}). Notices are stacked in
   * plugin-id order. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_modelLoadNotice(
    registration: ExperimentalModelLoadNoticeRegistration,
  ): void;
  /**
   * Take over bb's first run (see
   * {@link ExperimentalFirstRunRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_firstRun(registration: ExperimentalFirstRunRegistration): void;
  /**
   * Start new conversations the plugin's way (see
   * {@link ExperimentalNewConversationRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_newConversation(
    registration: ExperimentalNewConversationRegistration,
  ): void;
  /**
   * Stand in for bb's model picker (see
   * {@link ExperimentalModelPickerGateRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_modelPickerGate(
    registration: ExperimentalModelPickerGateRegistration,
  ): void;
  experimental_hideHostEntries(
    registration: ExperimentalHideHostEntriesRegistration,
  ): void;
  /**
   * Change the title text and add a node after it in each thread's header
   * (see {@link ExperimentalThreadHeaderRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_threadHeader(
    registration: ExperimentalThreadHeaderRegistration,
  ): void;
  /**
   * Add an item to the ··· menu of chat messages (see
   * {@link ExperimentalMessageActionRegistration}). Items are listed in
   * plugin-id order, before bb's own Fork item. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_messageAction(
    registration: ExperimentalMessageActionRegistration,
  ): void;
  /**
   * Take items dropped on bb's own surfaces (see
   * {@link ExperimentalItemDropRegistration}). Handlers are asked in
   * plugin-id order. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_itemDrop(registration: ExperimentalItemDropRegistration): void;
  /**
   * Replace bb's quick palette with the plugin's own component (see
   * {@link ExperimentalCommandPaletteRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_commandPalette(
    registration: ExperimentalCommandPaletteRegistration,
  ): void;
  /**
   * Draw a component behind bb's main window and paint bb's surfaces over
   * it (see {@link ExperimentalAppBackdropRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_appBackdrop(
    registration: ExperimentalAppBackdropRegistration,
  ): void;
  /**
   * Offer an app or action to a launcher (see
   * {@link ExperimentalLauncherItemRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_launcherItem(
    registration: ExperimentalLauncherItemRegistration,
  ): void;
  /**
   * Open some links yourself (see
   * {@link ExperimentalLinkHandlerRegistration}). Handlers are asked in
   * plugin-id order; the first that returns true wins. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_linkHandler(
    registration: ExperimentalLinkHandlerRegistration,
  ): void;
  /**
   * Say how bb's thread view should draw a finished assistant reply (see
   * {@link ExperimentalReplyClassifierRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_replyClassifier(
    registration: ExperimentalReplyClassifierRegistration,
  ): void;
  /**
   * Add a section of the plugin's own rows to the sidebar, below the thread
   * list (see {@link ExperimentalSidebarSectionRegistration}). Experimental:
   * see docs/api_to_audit.md.
   */
  experimental_sidebarSection(
    registration: ExperimentalSidebarSectionRegistration,
  ): void;
  /**
   * List the plugin's own items in bb's search palette (see
   * {@link ExperimentalPaletteSearchRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_paletteSearch(
    registration: ExperimentalPaletteSearchRegistration,
  ): void;
  /**
   * Add the plugin's items to the side panel's New Tab page: recent items
   * merged into its Recent list, and results for its search box (see
   * {@link ExperimentalNewTabItemsRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_newTabItems(
    registration: ExperimentalNewTabItemsRegistration,
  ): void;
}

/**
 * One plugin item on the side panel's New Tab page. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalNewTabItem {
  /** Unique within the registration. */
  id: string;
  title: string;
  /** What the item is, such as "Page" or "Whiteboard"; shown after the title. */
  kind: string;
  /** A bb icon name or an emoji; the plugin's icon when left out. */
  icon?: string;
  /** Epoch milliseconds; orders Recent and is shown as a relative time. */
  updatedAt: number;
  /** Shows the item, usually with `openTab`. */
  open(): void;
  /**
   * Makes the item's row draggable. bb writes this as the drag payload, as
   * `experimental_writeDragItem` does, so the row drops on bb's item drop
   * targets (a side panel pane, a composer) and reaches
   * `slots.experimental_itemDrop` handlers like any other dragged item. A
   * value that is not a valid drag item leaves the row undraggable.
   */
  experimental_dragItem?: ExperimentalDragItem;
}

/**
 * Registration for `slots.experimental_newTabItems`. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalNewTabItemsRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Heading of the search results group, such as "Pages". */
  title: string;
  /**
   * A React hook bb calls while a New Tab page shows, with the conversation
   * the side panel belongs to (null on a plugin page or the New thread
   * screen). Its items join bb's Recent list, newest first.
   */
  useRecents?(context: {
    threadId: string | null;
  }): readonly ExperimentalNewTabItem[];
  /**
   * Results for the search box, called debounced with the trimmed, non-empty
   * query; `signal` aborts when the query changes. bb lists the first eight
   * under `title`.
   */
  search?(
    query: string,
    context: { signal: AbortSignal; threadId: string | null },
  ): Promise<readonly ExperimentalNewTabItem[]>;
}

/**
 * Regions the fork adds to `ComposerCustomization`.
 */
export interface ForkComposerCustomization {
  /**
   * Small status items in the row under an existing thread's input, beside
   * the session, permission and context-window controls. Each component
   * draws one compact chip, at most one line tall, and returns null to take
   * no space. The row is hidden while the composer is collapsed, and only
   * the `thread` scope has one. `placement: "context"` draws the item right
   * before the context-window ring, as one control with it (a click should
   * open the context popover); otherwise it goes before the session and
   * permission controls. Experimental: see docs/api_to_audit.md.
   */
  experimental_footer?: readonly {
    id: string;
    component: ComponentType;
    placement?: "context";
  }[];
  /**
   * Draw something else where an existing thread's composer box goes, for
   * threads nobody should type into directly (a read-only worker, a mirrored
   * thread). bb calls `useActive` as a hook for every thread composer it
   * shows, in the main thread view and in `ThreadChat`; while it returns
   * true, bb renders `component` in the composer's place, at its width, and
   * no composer box. Both receive the thread the composer belongs to, which
   * in a `ThreadChat` is not the route's thread. When several plugins are
   * active, the first by plugin id wins. A throw counts as false. Only the
   * `thread` scope has it. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_replace?: ExperimentalComposerReplace;
}

/**
 * Props for `experimental_replace`: the thread whose composer is replaced.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalComposerReplaceProps {
  threadId: string;
}

/**
 * A composer replacement (see `ComposerCustomization.experimental_replace`).
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalComposerReplace {
  /** A React hook; true while this thread's composer should be replaced. */
  useActive(props: ExperimentalComposerReplaceProps): boolean;
  component: ComponentType<ExperimentalComposerReplaceProps>;
}

/**
 * Methods the fork adds to `BbNavigate`.
 */
export interface ForkBbNavigate {
  /**
   * Close a fixed tab this plugin opened with `experimental_global: true`,
   * in every side panel at once. Nothing else closes a fixed tab: it has no
   * close button and bb's close commands leave it alone. The tab is found
   * by its registration and `params`, as `openTab` finds it. Returns false
   * when this plugin has no such fixed tab. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_closeFixedTab(options: {
    tab: { id: string };
    params?: JsonValue;
  }): boolean;
  /**
   * Give an open action tab a new title, wherever it is open: as a fixed
   * tab and in every thread's side panel opened in this window. The tab is
   * found by its registration and `params`, as `openTab` finds it. Returns
   * false when no open tab matched or the title is empty. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_renameTab(options: {
    tab: { id: string };
    params?: JsonValue;
    title: string;
  }): boolean;
  /**
   * Navigate the main view to any bb route by path, the way a click on an
   * in-app link does: another plugin's panel, a thread, settings. `path`
   * starts with `/` and may carry a query and hash. `replace` swaps the
   * current history entry instead of pushing. `split: true` opens the path
   * in a split pane with the placement a modifier-click on an in-app link
   * gets: focus the pane already showing it, else split to the right of the
   * focused pane, else replace the focused pane at the pane cap. It falls
   * back to plain navigation on compact viewports and for routes that cannot
   * be a pane, such as settings. Returns false, and does nothing, when the
   * path is not a bb route. Experimental: see docs/api_to_audit.md.
   */
  experimental_toAppPath(
    path: string,
    options?: { replace?: boolean; split?: boolean },
  ): boolean;
  /**
   * Open any bb route in a window of its own, with no sidebar, no rail, no
   * plugin main header and no bb page header, inside bb's normal layout (so
   * every provider and plugin keeps working): a thread (`/threads/<id>`), a
   * plugin panel, settings, or the `path` of a dragged item. `path` starts
   * with `/` and may carry a query and hash. In the desktop app it is a
   * native window that remembers its size and place per path; in a browser
   * it is a popup. Popping out a path that is already open focuses that
   * window. `width` and `height` default to 960 by 720. Resolves false, and
   * opens nothing, when the path is not a bb route of this origin or the
   * popup was blocked. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_popOut(options: {
    path: string;
    title?: string;
    width?: number;
    height?: number;
  }): Promise<boolean>;
  /**
   * The side panel ("workbench") of a conversation on screen, for code that
   * is not inside that thread's view, such as an agent tool's handler. Leave
   * `threadId` out for the conversation in the main view. Null when that
   * thread's view is not on screen in this window. Pass
   * `"page:<pluginId>/<panelId>"` for the side panel of your own nav-panel
   * page; the result's `threadId` is that key. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_workbench(threadId?: string): ExperimentalWorkbench | null;
}

/**
 * What `ExperimentalWorkbench.open` shows. `tab` is a thread action tab (a
 * page, a whiteboard, a thread), opened as `openTab` opens it: the calling
 * plugin's own, or, with `tab.pluginId`, another plugin's tab registered
 * with `experimental_openableByPlugins: true` (any other resolves null);
 * `diff` is bb's diff tab for one changed file. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export type ExperimentalWorkbenchOpenSpec =
  | {
      kind: "tab";
      tab: { id: string; pluginId?: string };
      params?: JsonValue;
      title?: string;
    }
  | {
      kind: "file";
      target: ExperimentalLiveFileTarget;
      location?: ExperimentalFileLocation | null;
    }
  | { kind: "diff"; path: string }
  | { kind: "url"; url: string }
  | { kind: "terminal"; terminalId: string };

/**
 * One pane of the side panel, with its own tab row. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalWorkbenchPane {
  /** The keys of the pane's tabs, in the order its tab row shows them. */
  tabs: string[];
  /** The pane's share of the side panel's width, 0 to 100. */
  widthPercent: number;
}

/**
 * The side panel's layout, as `layout()` reports it. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalWorkbenchLayout {
  /** Whether the side panel shows. */
  panel: "open" | "closed";
  /** The side panel's share of the thread view's width, 20 to 80. */
  widthPercent: number;
  /** Collapsed: the side panel fills the view and the conversation is hidden. */
  conversation: "shown" | "collapsed";
  /**
   * The panes, left to right: one, or two side by side. A narrow window's
   * side panel drawer always has one.
   */
  panes: ExperimentalWorkbenchPane[];
}

/**
 * What `ExperimentalWorkbench.arrange` changes; leave out what stays.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalWorkbenchArrangement {
  panel?: "open" | "closed";
  /** Clamped to 20 to 80. */
  widthPercent?: number;
  conversation?: "shown" | "collapsed";
  /**
   * One pane, or two side by side. Going to two moves the selected tab of
   * the one pane into a new pane on the right, so that pane needs two tabs;
   * going to one moves pane 2's tabs into pane 1.
   */
  panes?: 1 | 2;
  /**
   * The two panes' widths as a ratio, such as `[2, 1]`; both positive. Each
   * pane keeps at least 15 percent of the panel. Needs two panes.
   */
  paneWidths?: [number, number];
}

/**
 * Where `ExperimentalWorkbench.open` puts a tab. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalWorkbenchOpenOptions {
  /**
   * False opens the tab behind the selected tab and leaves a closed side
   * panel closed. Default true.
   */
  focus?: boolean;
  /**
   * Pane 1 or 2 (left to right), or "new": a second pane on the right,
   * made for this tab. A tab already open moves there. Pane 2 needs two
   * panes and "new" needs one; otherwise `open` resolves null and opens
   * nothing. Left out, a new tab opens in the focused pane and an open one
   * stays where it is.
   */
  pane?: 1 | 2 | "new";
  /**
   * The tab's place in its pane's tab row, counted as
   * `ExperimentalWorkbenchPane.tabs` lists them without it; past the end
   * means last. Left out, a new tab goes where bb puts it and an open one
   * keeps its place. Not applied in a narrow window's drawer.
   */
  index?: number;
}

/**
 * One conversation's side panel. Tabs are named by
 * `ExperimentalPanelTab.key`; keys change when a tab is reopened.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalWorkbench {
  readonly threadId: string;
  /** The open tabs of every kind, in tab strip order, and the selected one. */
  list(): ExperimentalPanelTabs;
  /**
   * Open a tab, or select it when it is already open, and resolve its key;
   * null when the side panel declined (an unknown tab, no in-app browser for
   * a URL, a terminal that is not this thread's, a pane that is not there)
   * or the tab did not appear within three seconds.
   */
  open(
    spec: ExperimentalWorkbenchOpenSpec,
    options?: ExperimentalWorkbenchOpenOptions,
  ): Promise<string | null>;
  /** Close a tab as its close button does; false for fixed tabs and unknown keys. */
  close(key: string): boolean;
  /** Select a tab and show the side panel; false for an unknown key. */
  focus(key: string): boolean;
  /** The side panel's current layout. */
  layout(): ExperimentalWorkbenchLayout;
  /**
   * Change any part of the layout. False, and nothing changed, for a value
   * out of range, two panes the panel cannot make, or pane widths without
   * two panes.
   */
  arrange(layout: ExperimentalWorkbenchArrangement): boolean;
  /**
   * True while the user is typing in this side panel: keyboard focus is in a
   * text field, an editable element or a frame inside it. Check it before
   * `open` or `focus` to avoid taking a tab from under the user.
   */
  isTyping(): boolean;
  /**
   * Open a tab in a window of its own and close it in the side panel. The
   * window is a workbench panel of this thread: more tabs reach it by drag
   * and drop, its last tab dragged out closes it, and its Return to
   * workbench button opens every tab again in the panel that popped it out.
   * In the main window `list()` does not include tabs living in windows.
   * Resolves false, with nothing changed, for a key that is not open, a tab
   * that cannot be shown alone (see the Fork API reference) or a blocked
   * popup.
   */
  popOut(key: string): Promise<boolean>;
}

/**
 * bb's current appearance, as `experimental_useAppTheme()` reports it.
 * Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalAppTheme {
  /** The mode in effect, after resolving a "system" preference. */
  mode: "light" | "dark";
  /**
   * Changes whenever the theme's CSS variables may have new values: another
   * theme, an edited theme, a plugin theme loading. Use it as an effect or
   * memo dependency to read the variables again.
   */
  epoch: number;
}

/**
 * One pane of bb's split workspace, as `experimental_useAppPanes()` reports
 * it. Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalAppPane {
  /** Stable while the pane stays open; not stable across reloads. */
  id: string;
  /** The route the pane shows: a thread, the New thread screen, or a plugin page. */
  path: string;
  /** Whether this is the focused pane, the one the address bar follows. */
  focused: boolean;
}

/**
 * bb's split workspace, as `experimental_useAppPanes()` returns it.
 * Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalAppPanes {
  /**
   * The workspace's panes in layout order. One pane when nothing is split.
   * The workspace keeps its panes while the main view shows a route outside
   * it, such as settings; compare `experimental_useAppRoute()` with the
   * focused pane's path to tell.
   */
  panes: readonly ExperimentalAppPane[];
  /** Focus a pane and navigate to its route. False for an unknown pane. */
  focus(paneId: string): boolean;
  /**
   * Close a pane, as its close button does. Closing the last pane shows the
   * New thread screen in it. False for an unknown pane or when there is
   * nothing to close.
   */
  close(paneId: string): boolean;
}

/**
 * The main view's current location, as `experimental_useAppRoute()` reports
 * it. Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalAppRoute {
  /** The path, percent-encoded as in the address bar, such as `/plugins/docs/docs/a%20b`. */
  pathname: string;
  /** The query string with its leading `?`, or an empty string. */
  search: string;
  /** The fragment with its leading `#`, or an empty string. */
  hash: string;
}

/**
 * Hooks the fork adds to the app runtime surface.
 */
export interface ForkPluginSdkApp {
  /**
   * Every plugin's launcher items, apps before actions, then by `order`,
   * plugin id and item id, for a plugin that draws a launcher.
   * Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_useLauncherItems(): readonly ExperimentalLauncherItem[];
  /**
   * Open bb's context popover from the plugin's own control. Experimental:
   * see docs/api_to_audit.fork.md.
   */
  experimental_useContextCard(): ExperimentalContextCard;
  /**
   * Open, close and style the plugin's own windows. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_useWindows(): ExperimentalWindows;
  /**
   * The desktop app's control of other apps. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_useDesktopControl(): ExperimentalDesktopControl;
  /**
   * Put an item on a drag as the shared payload, under the MIME type
   * `application/x-bb-item`. Call it in `dragstart`; it leaves the drag's
   * other data alone. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_writeDragItem(
    dataTransfer: DataTransfer,
    item: ExperimentalDragItem,
  ): void;
  /**
   * The item a drag carries, or null when it carries none. Browsers hide
   * drag data until the drop, so during `dragover` this returns the item of
   * a drag that started in this window and null for one from another
   * window; `dataTransfer.types` still lists `application/x-bb-item`.
   * Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_readDragItem(
    dataTransfer: DataTransfer,
  ): ExperimentalDragItem | null;
  /**
   * The main view's current location. The calling component renders again
   * whenever bb navigates, including navigation the plugin did not start, so
   * an always-mounted `experimental_appOverlay` can follow the route.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_useAppRoute(): ExperimentalAppRoute;
  /**
   * The fixed tabs, every plugin's: action tabs bb draws first in every
   * side panel, before the panel's own tabs, with no close button. The
   * calling component renders again when the list changes. Open one with
   * `openTab({ ..., experimental_global: true })`; close it with
   * `useBbNavigate().experimental_closeFixedTab`. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_useGlobalTabs(): readonly ExperimentalGlobalTab[];
  /**
   * bb's light or dark mode and a counter that changes with the theme. The
   * calling component renders again when either changes, so a plugin that
   * copies colors out of bb's CSS variables (into a canvas, an iframe, an
   * embedded editor) knows when to read them again without observing the
   * document. Experimental: see docs/api_to_audit.md.
   */
  experimental_useAppTheme(): ExperimentalAppTheme;
  /**
   * The panes of bb's split workspace, with controls to focus and close
   * them. The calling component renders again when panes open, close, move,
   * change content, or change focus. Open a pane with
   * `useBbNavigate().experimental_toAppPath(path, { split: true })`.
   * Experimental: see docs/api_to_audit.md.
   */
  experimental_useAppPanes(): ExperimentalAppPanes;
  /**
   * Everything bb's quick palette lists as commands: bb's app commands that
   * are available now, plugin palette commands, settings pages, plugin pages
   * and server switches, in bb's order. Inside a replacement palette the
   * list is the one taken when the palette opened, as bb's palette takes it;
   * elsewhere (a plugin window) it is read again after mount and whenever
   * the window gains focus, and commands act on that window. Open a
   * settings section without it with
   * `useBbNavigate().experimental_toAppPath("/settings/<section>")`.
   * Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_useAppCommands(): readonly ExperimentalAppCommand[];
  /**
   * The window a side panel tab was popped out to (see
   * {@link ExperimentalTabWindow}), or null anywhere else. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_useTabWindow(): ExperimentalTabWindow | null;
}
