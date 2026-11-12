// The parts of BB's plugin SDK that stable BB doesn't have yet. Studio
// builds against stable BB's SDK, so they are read off the SDK module by
// name and are undefined on a BB (or an SDK) without them. Each caller keeps
// its own fallback. Delete this file once stable BB ships them and import
// the hooks directly.
import type { ComponentType, ReactNode } from "react";
import * as sdkApp from "@get-bb/plugin-sdk/app";

export interface AppRoute {
  pathname: string;
  search: string;
  hash: string;
}

export interface AppPane {
  id: string;
  path: string;
  focused: boolean;
}

export interface AppPanes {
  panes: readonly AppPane[];
  focus(paneId: string): boolean;
  close(paneId: string): boolean;
}

export interface AppTheme {
  mode: "light" | "dark";
  /** Changes whenever BB's theme variables may have new values. */
  epoch: number;
}

export interface AppPathOptions {
  replace?: boolean;
  /**
   * Open beside the current view in a BB split pane. Only a BB with
   * `experimental_toAppPath` can; elsewhere the path opens in the main view.
   */
  split?: boolean;
}

export type ToAppPath = (path: string, options?: AppPathOptions) => boolean;

/** A member by name: undefined where this BB, or the SDK Studio was built with, lacks it. */
export function member(source: object, name: string): unknown {
  return Object.entries(source).find(([key]) => key === name)?.[1];
}

function isHook<Result>(value: unknown): value is () => Result {
  return typeof value === "function";
}

function isToAppPath(value: unknown): value is ToAppPath {
  return typeof value === "function";
}

const appRoute = member(sdkApp, "experimental_useAppRoute");
const appPanes = member(sdkApp, "experimental_useAppPanes");

export const useHostAppRoute = isHook<AppRoute>(appRoute) ? appRoute : null;
/** Whether this BB's workbench has a Global section (`experimental_useGlobalTabs`). */
export const hasGlobalWorkbench = typeof member(sdkApp, "experimental_useGlobalTabs") === "function";

export const FORK_HOOKS = ["experimental_useAppRoute", "experimental_useWindows", "experimental_useLauncherItems"] as const;

export function isForkSdk(sdk: object): boolean {
  return FORK_HOOKS.some((name) => typeof member(sdk, name) === "function");
}

export const onForkHost = isForkSdk(sdkApp);

export function forkOnly(fields: object, fork = onForkHost): object {
  return fork ? fields : {};
}

/** `options` for a panel's openTab, asking for the workbench's Global section. */
export function inGlobalWorkbench<Options extends object>(options: Options): Options {
  const global: object = { experimental_global: true };
  return { ...options, ...global };
}

const appTheme = member(sdkApp, "experimental_useAppTheme");
export const useHostAppTheme = isHook<AppTheme>(appTheme) ? appTheme : null;
export const useHostAppPanes = isHook<AppPanes>(appPanes) ? appPanes : null;

/** `useBbNavigate().experimental_toAppPath`, or null on a BB without it. */
const projectMenu = member(sdkApp, "experimental_ProjectActionsMenu");
const projectContextMenu = member(sdkApp, "experimental_ProjectActionsContextMenu");
/** BB's own project menu behind a "more" button, or null on a BB without it. */
export const HostProjectActionsMenu = (projectMenu ?? null) as ComponentType<{ projectId: string; className?: string }> | null;
/** BB's own project menu as a context menu around one child, or null on a BB without it. */
export const HostProjectActionsContextMenu = (projectContextMenu ?? null) as ComponentType<{ projectId: string; children: ReactNode }> | null;

export type RenameTab = (options: { tab: { id: string }; params?: unknown; title: string }) => boolean;

/** BB's "rename an open tab" (`experimental_renameTab`), or null on a BB without it. */
export function renameTabOf(navigate: object): RenameTab | null {
  const method = member(navigate, "experimental_renameTab");
  return typeof method === "function" ? (options) => (method as RenameTab).call(navigate, options) : null;
}

export function toAppPathOf(navigate: object): ToAppPath | null {
  const method = member(navigate, "experimental_toAppPath");
  return isToAppPath(method) ? (path, options) => method(path, options) : null;
}

export interface PaletteSearchResult {
  id: string;
  title: string;
  subtitle?: string;
  path: string;
  /** What Mod+Enter does for the row, where BB supports it; Enter always opens `path`. */
  experimental_onModSelect?(): void;
  /** Names the Mod action on the highlighted row. */
  experimental_modSelectLabel?: string;
  /** A BB icon name or an emoji, where BB draws one. */
  icon?: string;
}

export interface PaletteSearchRegistration {
  id: string;
  title: string;
  search(query: string, options: { signal: AbortSignal }): Promise<readonly PaletteSearchResult[]>;
}

function isPaletteSearchSlot(value: unknown): value is (registration: PaletteSearchRegistration) => void {
  return typeof value === "function";
}

/**
 * Lists results in BB's own search palette through
 * `slots.experimental_paletteSearch`. False on a BB without that slot, where
 * Studio's quick open is the only place its items are searched.
 */
export function registerPaletteSearch(slots: object, registration: PaletteSearchRegistration): boolean {
  const slot = member(slots, "experimental_paletteSearch");
  if (!isPaletteSearchSlot(slot)) return false;
  slot(registration);
  return true;
}

export interface SidebarSectionProps {
  activeThreadId: string | null;
  activeProjectId: string | null;
  isCompactViewport: boolean;
  onNavigate: () => void;
}

export interface SidebarSectionRegistration {
  id: string;
  title: string;
  component: (props: SidebarSectionProps) => ReactNode;
}

function isSidebarSectionSlot(value: unknown): value is (registration: SidebarSectionRegistration) => void {
  return typeof value === "function";
}

/**
 * Adds a section to BB's own sidebar, below its thread list, through
 * `slots.experimental_sidebarSection`. False on a BB without that slot, where
 * Studio has to replace the whole thread list to show rows of its own.
 */
export function registerSidebarSection(slots: object, registration: SidebarSectionRegistration): boolean {
  const slot = member(slots, "experimental_sidebarSection");
  if (!isSidebarSectionSlot(slot)) return false;
  slot(registration);
  return true;
}

export interface SidebarNewItemRegistration {
  id: string;
  title: string;
  icon: string;
  group?: string;
  run(): void | Promise<void>;
}

/** Adds a row to BB's sidebar New menu (`slots.experimental_sidebarNewItem`); false on a BB without it. */
export function registerSidebarNewItem(slots: object, registration: SidebarNewItemRegistration): boolean {
  const slot = member(slots, "experimental_sidebarNewItem");
  if (typeof slot !== "function") return false;
  (slot as (registration: SidebarNewItemRegistration) => void).call(slots, registration);
  return true;
}

/**
 * `customization` with items for the row under the composer's input
 * (`experimental_footer`). A BB without that row ignores the field.
 */
export function withComposerFooter<Customization extends { id: string }>(customization: Customization, items: readonly { id: string; component: () => ReactNode; placement?: "context" }[]): Customization {
  const footer: object = { experimental_footer: items };
  return { ...customization, ...footer };
}

export interface ContextCardRow {
  label: string;
  value: string;
  /** A quiet second line. */
  note?: string;
  /** Small text buttons under the row. */
  actions?: readonly { id: string; label: string; run(): void | Promise<void> }[];
}

export interface ContextCardRowRegistration {
  id: string;
  /** A hook BB calls while its context popover is shown for the thread in `useBbContext()`; null adds nothing. */
  useRow(): ContextCardRow | null;
}

/** Adds a row to BB's context popover, behind the ring under the composer (`slots.experimental_contextCardRow`); false on a BB without it. */
export function registerContextCardRow(slots: object, registration: ContextCardRowRegistration): boolean {
  const slot = member(slots, "experimental_contextCardRow");
  if (typeof slot !== "function") return false;
  (slot as (registration: ContextCardRowRegistration) => void).call(slots, registration);
  return true;
}

export interface HostContextCard {
  /** False while the thread has no context ring yet; `open` then does nothing. */
  available: boolean;
  open(): void;
}

const contextCard = member(sdkApp, "experimental_useContextCard");
/** Opens BB's context popover from a control of Studio's (`experimental_useContextCard`), or null on a BB without it. */
export const useHostContextCard = isHook<HostContextCard>(contextCard) ? contextCard : null;

export interface ThreadBannerRegistration {
  id: string;
  /** Drawn under the thread's header, above its transcript, for the thread it is in; null takes no room. */
  component: (props: { threadId: string }) => ReactNode;
}

export interface FirstRunRegistration {
  id: string;
  component?: ComponentType<{ finish(): void }>;
}

export function registerFirstRun(slots: object, registration: FirstRunRegistration): boolean {
  const slot = member(slots, "experimental_firstRun");
  if (typeof slot !== "function") return false;
  (slot as (registration: FirstRunRegistration) => void).call(slots, registration);
  return true;
}

export interface ModelPickerGateRegistration {
  id: string;
  component: ComponentType<{ hasSelectedModel: boolean; children: ReactNode }>;
}

export function registerModelPickerGate(slots: object, registration: ModelPickerGateRegistration): boolean {
  const slot = member(slots, "experimental_modelPickerGate");
  if (typeof slot !== "function") return false;
  (slot as (registration: ModelPickerGateRegistration) => void).call(slots, registration);
  return true;
}

/** Adds a row under every thread's header (`slots.experimental_threadBanner`); false on a BB without it. */
export function registerThreadBanner(slots: object, registration: ThreadBannerRegistration): boolean {
  const slot = member(slots, "experimental_threadBanner");
  if (typeof slot !== "function") return false;
  (slot as (registration: ThreadBannerRegistration) => void).call(slots, registration);
  return true;
}

export interface ThreadHeaderDecoration {
  /** Shown in place of the thread's title in BB's header; renaming still edits the real title. */
  title?: string;
  /** A small node right after the title, in the same row. */
  after?: ReactNode;
}

export interface ThreadHeaderRegistration {
  id: string;
  /** A hook BB calls in every thread header (main view and split panes); null leaves the header alone. */
  useDecoration(args: { threadId: string }): ThreadHeaderDecoration | null;
}

/** Changes a thread header's title text and adds a node after it (`slots.experimental_threadHeader`); false on a BB without it. */
export function registerThreadHeader(slots: object, registration: ThreadHeaderRegistration): boolean {
  const slot = member(slots, "experimental_threadHeader");
  if (typeof slot !== "function") return false;
  (slot as (registration: ThreadHeaderRegistration) => void).call(slots, registration);
  return true;
}

/** The chat message a message action is for (the fork's `slots.experimental_messageAction`). */
export interface MessageActionMessage {
  threadId: string;
  messageId: string;
  turnId: string | null;
  role: "user" | "assistant";
  /** The last source event the message covers: `threads.fork` after it. */
  sourceSeqEnd: number;
}

export interface MessageActionRegistration {
  id: string;
  title: string;
  icon?: string;
  /** Synchronous and fast: it runs while the message renders. */
  isAvailable?(message: MessageActionMessage): boolean;
  run(message: MessageActionMessage): void | Promise<void>;
  /** Hides BB's own "Fork into new thread" on the messages this item shows for. */
  experimental_replaces?: "thread.fork";
}

/** Adds an item to the ··· menu of chat messages (`slots.experimental_messageAction`). False on a BB without it. */
export function registerMessageAction(slots: object, registration: MessageActionRegistration): boolean {
  const slot = member(slots, "experimental_messageAction");
  if (typeof slot !== "function") return false;
  (slot as (registration: MessageActionRegistration) => void).call(slots, registration);
  return true;
}

export interface LauncherItemRegistration {
  id: string;
  title: string;
  icon: string;
  section: "apps" | "actions";
  /** Extra words to match. */
  keywords?: readonly string[];
  order?: number;
  /** Called in the launcher's own window, so it must work from any window. */
  run(): void | Promise<void>;
}

export interface LauncherItem extends LauncherItemRegistration {
  /** `<pluginId>/<id>`. */
  key: string;
  pluginId: string;
}

/** Offers an app or action to a launcher (`slots.experimental_launcherItem`); false on a BB without it. */
export function registerLauncherItem(slots: object, registration: LauncherItemRegistration): boolean {
  const slot = member(slots, "experimental_launcherItem");
  if (typeof slot !== "function") return false;
  (slot as (registration: LauncherItemRegistration) => void).call(slots, registration);
  return true;
}

const launcherItems = member(sdkApp, "experimental_useLauncherItems");
/** Every plugin's launcher items (`experimental_useLauncherItems`), or null on a BB without them. */
export const useHostLauncherItems = isHook<readonly LauncherItem[]>(launcherItems) ? launcherItems : null;

/** A conversation's workbench, as `useBbNavigate().experimental_workbench(threadId)` returns it (src/workbench-agent/exec.ts). */
export type HostWorkbench = import("../../workbench-agent/exec").HostWorkbenchLike & { readonly threadId: string };

/** The workbench of `threadId` while its view is on screen in this window; null when it isn't, or on a BB without `experimental_workbench`. */
export function workbenchOf(navigate: object, threadId?: string): HostWorkbench | null {
  const method = member(navigate, "experimental_workbench");
  if (typeof method !== "function") return null;
  try {
    return ((method as (threadId?: string) => HostWorkbench | null).call(navigate, threadId)) ?? null;
  } catch {
    return null;
  }
}

/** One item on the side panel's New Tab page (the fork's `ExperimentalNewTabItem`). */
export interface NewTabItem {
  id: string;
  title: string;
  /** What it is, shown after the title: "Page", "Conversation". */
  kind: string;
  icon?: string;
  updatedAt: number;
  open(): void;
}

export interface NewTabItemsRegistration {
  id: string;
  /** The search group's heading. */
  title: string;
  /** A hook: items for the page's Recent list, merged newest first. */
  useRecents?(context: { threadId: string | null }): readonly NewTabItem[];
  search?(query: string, context: { signal: AbortSignal; threadId: string | null }): Promise<readonly NewTabItem[]>;
}

/** Adds items to the New Tab page's Recent list and search (`slots.experimental_newTabItems`); false on a BB without it. */
export function registerNewTabItems(slots: object, registration: NewTabItemsRegistration): boolean {
  const slot = member(slots, "experimental_newTabItems");
  if (typeof slot !== "function") return false;
  (slot as (registration: NewTabItemsRegistration) => void).call(slots, registration);
  return true;
}

export interface CommandPaletteProps {
  initialMode: "commands" | "search";
  close(then?: () => void): void;
  experimental_onEscape?(handler: () => boolean): () => void;
}

export interface CommandPaletteRegistration {
  id: string;
  component: (props: CommandPaletteProps) => ReactNode;
}

export function registerCommandPalette(slots: object, registration: CommandPaletteRegistration): boolean {
  const slot = member(slots, "experimental_commandPalette");
  if (typeof slot !== "function") return false;
  (slot as (registration: CommandPaletteRegistration) => void).call(slots, registration);
  return true;
}

export type HostAppSurface = "sidebar" | "main" | "composer" | "secondaryPanel" | "header" | "popover";

export interface HostAppSurfaceStyle {
  background?: string;
  backdropFilter?: string;
  edge?: string;
}

export interface HostAppAppearance {
  mode?: "light" | "dark";
  tokens?: Record<`--${string}`, string>;
  surfaces?: Partial<Record<HostAppSurface, HostAppSurfaceStyle>>;
  layout?: { cards: { gap: number; radius: number; titleRow?: boolean } };
}

export interface AppBackdropRegistration {
  id: string;
  component: ComponentType;
  useAppearance?: () => HostAppAppearance | null;
}

export function registerAppBackdrop(slots: object, registration: AppBackdropRegistration): boolean {
  const slot = member(slots, "experimental_appBackdrop");
  if (typeof slot !== "function") return false;
  (slot as (registration: AppBackdropRegistration) => void).call(slots, registration);
  return true;
}

export interface HostAppCommand {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  run(): void;
}

export interface TabWindow {
  title: string;
  toolbar: HTMLElement | null;
}

const tabWindow = member(sdkApp, "experimental_useTabWindow");
const noTabWindow = (): TabWindow | null => null;
export const useHostTabWindow = isHook<TabWindow | null>(tabWindow) ? tabWindow : noTabWindow;

const appCommands = member(sdkApp, "experimental_useAppCommands");
export const useHostAppCommands = isHook<readonly HostAppCommand[]>(appCommands) ? appCommands : null;
