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
}

/**
 * Registration for `slots.experimental_sidebarNewItem`: one thing the
 * sidebar's New menu can create, listed after New thread. Experimental: see
 * docs/api_to_audit.md.
 */
export interface ExperimentalSidebarNewItemRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** The menu row, such as "Page". */
  title: string;
  icon: string;
  /** Rows with the same group sit together under one divider. */
  group?: string;
  /** Creates the thing and shows it. */
  run(): void | Promise<void>;
}

/**
 * One registered New menu row, as `experimental_useSidebarNewItems()`
 * reports it. Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalSidebarNewItem {
  /** Unique across plugins. */
  key: string;
  pluginId: string;
  id: string;
  title: string;
  icon: string;
  group: string | null;
  run(): void | Promise<void>;
}

/**
 * Registration for `slots.experimental_sidebarSection`: a section of the
 * plugin's own rows in the sidebar, below the thread list and scrolling with
 * it. The component draws its own heading and rows. Experimental: see
 * docs/api_to_audit.md.
 */
export interface ExperimentalSidebarSectionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** Names the section for assistive technology and crash messages. */
  title: string;
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
  /**
   * React hook bb runs in your plugin's scope, inside its sidebar, while this
   * thread list is the sidebar's. `background` (any CSS background: a color
   * or a gradient) is painted on the sidebar's body, the thread list area
   * and the footer under it; the rail keeps bb's. `accent` becomes the
   * sidebar body's `--fork-sidebar-accent` and bb's `--sidebar-accent` there,
   * so bb's selected and hovered rows use it; read the variable in your own
   * rows. bb changes nothing else, text colors included: choose colors that
   * keep text readable in light and dark (see `experimental_useAppTheme`).
   * Return null, or leave a field out, for bb's own. A throw is treated as
   * null. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_useSidebarStyle?: () => ExperimentalSidebarStyle | null;
}

/**
 * Colors a thread list asks bb to paint on its sidebar (see
 * `PluginThreadListRegistration.experimental_useSidebarStyle`).
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalSidebarStyle {
  /** A CSS `background` value, such as a color or a gradient. */
  background?: string;
  /** A CSS color for selected and hovered rows. */
  accent?: string;
}

/**
 * One skill a `slots.experimental_skillSource` lists on bb's Skills page.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalSourceSkill {
  /** Unique within the source. */
  id: string;
  name: string;
  description?: string;
  /** The skill's file on the host, opened in the preferred editor when there is no `onOpen`. */
  path?: string;
  /** Called when the person opens the row. */
  onOpen?(): void;
}

/**
 * Registration for `slots.experimental_skillSource`: a group of skills on
 * bb's Skills page, such as one Bot's own. bb lists them under its own
 * skills and adds one option per source, named `label`, to the page's
 * filter menu. Choosing sources lists only their skills, plus bb's own
 * that match when bb's Type or Provider filter is also set; with bb's
 * filters alone, no source is listed. `useSkills` is a
 * React hook bb runs in your plugin's scope while the page is open; return
 * the current list (keep the array stable between renders when nothing
 * changed). A throw hides the source's rows. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalSkillSourceRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  /** The filter option and the heading over the source's rows. */
  label: string;
  useSkills(): readonly ExperimentalSourceSkill[];
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
   * Draw this action tab as its icon alone while it is a fixed tab (opened
   * with `experimental_global: true`): no title text, the title as tooltip
   * and accessible name. Has no effect on an ordinary instance of the tab.
   * Ignored on fixed-availability tabs. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_compactWhenFixed?: boolean;
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
}

/**
 * Registration for `slots.experimental_linkHandler`. `handle` is called when
 * someone clicks a link that bb would open itself (in a chat reply, a file
 * preview, a terminal), before bb opens it. Return true when the plugin
 * opened it; return false to let the next handler or bb have it. It must be
 * synchronous and must not throw for links it does not know. Experimental:
 * see docs/api_to_audit.fork.md.
 */
export interface ExperimentalLinkHandlerRegistration {
  id: string;
  handle(url: string): boolean;
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
 * Registration for `slots.experimental_mainHeader`: a component bb draws in
 * a row above the main view, spanning the view and its side panel (a tab
 * strip, a breadcrumb). It draws its own height and returns null to take no
 * room. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalMainHeaderRegistration {
  id: string;
  component: ComponentType;
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
 * The side panel tab a `slots.experimental_panelTabAction` item was opened
 * on. Only plugin action tabs get these items, never bb's own file, diff or
 * terminal tabs. Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalPanelTabActionTab {
  /** The plugin that registered the tab. */
  pluginId: string;
  /** The registered tab's id. */
  tabId: string;
  /** The instance's params when they are an object; undefined otherwise. */
  params: Record<string, unknown> | undefined;
  title: string;
  /** The thread whose side panel holds the tab; null on a plugin page. */
  threadId: string | null;
}

/**
 * Registration for `slots.experimental_panelTabAction`: an item in the
 * right-click menu of a plugin action tab in the side panel's tab strip,
 * any plugin's tab. `icon` is a bb icon name. `isAvailable` runs while the
 * menu renders, so it must be synchronous, pure and fast; leave it out to
 * show the item on every plugin action tab. A throw from `isAvailable`
 * hides the item; a throw or rejection from `run` is logged. Experimental:
 * see docs/api_to_audit.fork.md.
 */
export interface ExperimentalPanelTabActionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  icon?: string;
  isAvailable?(tab: ExperimentalPanelTabActionTab): boolean;
  run(tab: ExperimentalPanelTabActionTab): void | Promise<void>;
}

/**
 * One draggable thing in the shared drag payload: a thread, a plugin
 * document, a side panel tab or a file. A drag carries it as JSON under the
 * MIME type `application/x-bb-item`; write it with
 * `experimental_writeDragItem` and read it with `experimental_readDragItem`.
 * Experimental: see docs/api_to_audit.fork.md.
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
 * Where on bb's own surfaces a dragged item is: the side panel of a thread
 * or of a plugin page (`threadId` null), a thread's composer or the
 * new-thread composer (`threadId` null), or the rest of the main view.
 * In a side panel, `pane` and `index` say where: over a pane's tab row,
 * `pane` is 1 or 2 (left to right) and `index` the insertion point among
 * that row's tabs, counted as `ExperimentalWorkbenchPane.tabs` lists them;
 * over the right edge of a side panel with one pane, `pane` is "new"; both
 * are absent elsewhere in the panel. Pass them to
 * `ExperimentalWorkbench.open` to open the item there.
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
 * Registration for `slots.experimental_closeFallback`: what the close
 * command (Mod+W) closes when it is not closing a side panel tab. `close`
 * returns true when it closed something, and bb then does nothing else.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalCloseFallbackRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  close(): boolean;
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
 * A side panel tab shown alone in its own window ("Open in new window",
 * `experimental_workbench(...).popOut`), as `experimental_useTabWindow()`
 * reports it to the tab's components. The window's bar shows `title` and
 * "Return to workbench", so the tab need not draw its own title row.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalTabWindow {
  /** The title the window's bar shows. */
  title: string;
  /**
   * An element in the window's bar, before "Return to workbench", for the
   * tab's own controls (render into it with `createPortal`). It lays its
   * children out in a row and keeps them out of the window drag region.
   * Null until the bar has mounted.
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
 * `Alt+Space`) that shows or hides the window; `menuBarTitle` adds a menu
 * bar entry that does the same. Experimental: see
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
  /** Clicks pass through to whatever is behind the window. */
  clickThrough?: boolean;
  resizable?: boolean;
  hotkey?: string;
  menuBarTitle?: string;
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
  /**
   * macOS only, with `transparent`: the system's blurred material behind the
   * component, kept active when the window is not focused. `"hud"` is the
   * dark heads-up material, `"under-window"` the window background one.
   * Ignored elsewhere and without `transparent`.
   */
  vibrancy?: "hud" | "under-window";
  /** Passed to the window as its query string. */
  params?: Readonly<Record<string, string>>;
}

/**
 * `experimental_useWindows()`. `native` is true in the desktop app, where
 * every option applies. In a browser `open` opens a plain popup and the
 * styling, hotkey and menu bar options are ignored. Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalWindows {
  native: boolean;
  /** Set up a window's hotkey and menu bar entry without showing it. */
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
  /**
   * Turn click-through on or off for an open window. While it is on, the
   * window's hotkey and menu bar entry turn it off instead of hiding the
   * window, so there is always a way back. The window's page gets a
   * `bb-fork-window-click-through` event with `detail.on` on every change.
   * It still receives mouse-move events while clicks pass through.
   * `hold: true` only pauses (`on: false`) or resumes (`on: true`) passing
   * clicks through while click-through stays on: no event is sent, and the
   * hotkey and menu bar entry still turn click-through off, not hide.
   */
  setClickThrough(
    windowId: string,
    on: boolean,
    how?: { hold?: boolean },
  ): Promise<boolean>;
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
   * Draw a row above the main view (see
   * {@link ExperimentalMainHeaderRegistration}). Rows are stacked in
   * plugin-id order. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_mainHeader(
    registration: ExperimentalMainHeaderRegistration,
  ): void;
  /**
   * Draw a row under each thread's header (see
   * {@link ExperimentalThreadBannerRegistration}). Rows are stacked in
   * plugin-id order. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_threadBanner(
    registration: ExperimentalThreadBannerRegistration,
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
   * Add an item to the menu of plugin action tabs in the side panel's tab
   * strip (see {@link ExperimentalPanelTabActionRegistration}). Items are
   * listed in plugin-id order, before bb's own Close items. Experimental:
   * see docs/api_to_audit.fork.md.
   */
  experimental_panelTabAction(
    registration: ExperimentalPanelTabActionRegistration,
  ): void;
  /**
   * Take items dropped on bb's own surfaces (see
   * {@link ExperimentalItemDropRegistration}). Handlers are asked in
   * plugin-id order. Experimental: see docs/api_to_audit.fork.md.
   */
  experimental_itemDrop(registration: ExperimentalItemDropRegistration): void;
  /**
   * Take the close command when it is not closing a side panel tab (see
   * {@link ExperimentalCloseFallbackRegistration}). Handlers are asked in
   * plugin-id order; the first to return true wins. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_closeFallback(
    registration: ExperimentalCloseFallbackRegistration,
  ): void;
  /**
   * Replace bb's quick palette with the plugin's own component (see
   * {@link ExperimentalCommandPaletteRegistration}). Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_commandPalette(
    registration: ExperimentalCommandPaletteRegistration,
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
   * Add a row to the sidebar's New menu (see
   * {@link ExperimentalSidebarNewItemRegistration}). Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_sidebarNewItem(
    registration: ExperimentalSidebarNewItemRegistration,
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
   * List a group of the plugin's skills on bb's Skills page, with a filter
   * option of its own (see {@link ExperimentalSkillSourceRegistration}).
   * Sources are listed in plugin-id order. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_skillSource(
    registration: ExperimentalSkillSourceRegistration,
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
   * the `thread` scope has one. Experimental: see docs/api_to_audit.md.
   */
  experimental_footer?: readonly { id: string; component: ComponentType }[];
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
   * thread's view is not on screen in this window. Experimental: see
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
   * Open a tab in a window of its own and close it in the side panel; the
   * window has a Return to workbench button that opens it again in the pane
   * it came from. Resolves false, with nothing changed, for a key that is not
   * open, a tab that cannot be shown alone (see the Fork API reference) or a
   * blocked popup.
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
/**
 * Props of `experimental_ProjectActionsMenu`: bb's own project menu (rename,
 * add a local path, settings, delete) behind its "more" button.
 * Experimental: see docs/api_to_audit.fork.md.
 */
export interface ExperimentalProjectActionsMenuProps {
  projectId: string;
  /** Classes for the trigger button. */
  className?: string;
}

/**
 * Props of `experimental_ProjectActionsContextMenu`: the same menu on a
 * right-click of `children` (one element). Experimental: see
 * docs/api_to_audit.fork.md.
 */
export interface ExperimentalProjectActionsContextMenuProps {
  projectId: string;
  children: ReactNode;
}

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
   * bb's own project menu behind a "more" button, for a plugin that draws
   * project rows. Renders nothing for an unknown project. Experimental: see
   * docs/api_to_audit.fork.md.
   */
  experimental_ProjectActionsMenu: ComponentType<ExperimentalProjectActionsMenuProps>;
  /**
   * bb's own project menu as the context menu of its child. Experimental:
   * see docs/api_to_audit.fork.md.
   */
  experimental_ProjectActionsContextMenu: ComponentType<ExperimentalProjectActionsContextMenuProps>;
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
   * The rows plugins added to the sidebar's New menu, for a plugin that
   * draws that menu. Experimental: see docs/api_to_audit.md.
   */
  experimental_useSidebarNewItems(): readonly ExperimentalSidebarNewItem[];
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
