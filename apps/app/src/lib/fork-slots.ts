import type {
  ExperimentalAppBackdropRegistration,
  ExperimentalCommandPaletteRegistration,
  ExperimentalContextCardRowRegistration,
  ExperimentalItemDropRegistration,
  ExperimentalLauncherItemRegistration,
  ExperimentalLinkHandlerRegistration,
  ExperimentalMessageActionRegistration,
  ExperimentalModelLoadNoticeRegistration,
  ExperimentalFirstRunRegistration,
  ExperimentalNewConversationRegistration,
  ExperimentalModelPickerGateRegistration,
  ExperimentalHideHostEntriesRegistration,
  ExperimentalNewTabItemsRegistration,
  ExperimentalThreadBannerRegistration,
  ExperimentalThreadHeaderRegistration,
  ExperimentalPaletteSearchRegistration,
  ExperimentalReplyClassifierRegistration,
  ExperimentalSidebarSectionRegistration,
  ExperimentalWindowRegistration,
} from "@get-bb/plugin-sdk";

interface ForkSlotBase {
  pluginId: string;
  generation: number;
}

export interface PluginSidebarSectionSlot
  extends ExperimentalSidebarSectionRegistration, ForkSlotBase {}
export interface PluginPaletteSearchSlot
  extends ExperimentalPaletteSearchRegistration, ForkSlotBase {}

export interface PluginReplyClassifierSlot
  extends ExperimentalReplyClassifierRegistration, ForkSlotBase {}

export interface PluginLinkHandlerSlot
  extends ExperimentalLinkHandlerRegistration, ForkSlotBase {}

export interface PluginWindowSlot
  extends ExperimentalWindowRegistration, ForkSlotBase {}

export interface PluginContextCardRowSlot
  extends ExperimentalContextCardRowRegistration, ForkSlotBase {}

export interface PluginThreadBannerSlot
  extends ExperimentalThreadBannerRegistration, ForkSlotBase {}

export interface PluginModelLoadNoticeSlot
  extends ExperimentalModelLoadNoticeRegistration, ForkSlotBase {}

export interface PluginFirstRunSlot
  extends ExperimentalFirstRunRegistration, ForkSlotBase {}

export interface PluginNewConversationSlot
  extends ExperimentalNewConversationRegistration, ForkSlotBase {}

export interface PluginModelPickerGateSlot
  extends ExperimentalModelPickerGateRegistration, ForkSlotBase {}

export interface PluginHiddenHostEntriesSlot
  extends ExperimentalHideHostEntriesRegistration, ForkSlotBase {}

export interface PluginThreadHeaderSlot
  extends ExperimentalThreadHeaderRegistration, ForkSlotBase {}

export interface PluginMessageActionMenuSlot
  extends ExperimentalMessageActionRegistration, ForkSlotBase {}

export interface PluginLauncherItemSlot
  extends ExperimentalLauncherItemRegistration, ForkSlotBase {}

export interface PluginItemDropSlot
  extends ExperimentalItemDropRegistration, ForkSlotBase {}

export interface PluginNewTabItemsSlot
  extends ExperimentalNewTabItemsRegistration, ForkSlotBase {}

export interface PluginCommandPaletteSlot
  extends ExperimentalCommandPaletteRegistration, ForkSlotBase {}

export interface PluginAppBackdropSlot
  extends ExperimentalAppBackdropRegistration, ForkSlotBase {}

export interface ForkRegistrationSet {
  itemDrops?: readonly ExperimentalItemDropRegistration[];
  newTabItems?: readonly ExperimentalNewTabItemsRegistration[];
  commandPalettes?: readonly ExperimentalCommandPaletteRegistration[];
  appBackdrops?: readonly ExperimentalAppBackdropRegistration[];
  launcherItems?: readonly ExperimentalLauncherItemRegistration[];
  threadBanners?: readonly ExperimentalThreadBannerRegistration[];
  modelLoadNotices?: readonly ExperimentalModelLoadNoticeRegistration[];
  firstRuns?: readonly ExperimentalFirstRunRegistration[];
  newConversations?: readonly ExperimentalNewConversationRegistration[];
  modelPickerGates?: readonly ExperimentalModelPickerGateRegistration[];
  hiddenHostEntries?: readonly ExperimentalHideHostEntriesRegistration[];
  threadHeaders?: readonly ExperimentalThreadHeaderRegistration[];
  forkMessageActions?: readonly ExperimentalMessageActionRegistration[];
  contextCardRows?: readonly ExperimentalContextCardRowRegistration[];
  windows?: readonly ExperimentalWindowRegistration[];
  linkHandlers?: readonly ExperimentalLinkHandlerRegistration[];
  replyClassifiers?: readonly ExperimentalReplyClassifierRegistration[];
  paletteSearches?: readonly ExperimentalPaletteSearchRegistration[];
  sidebarSections?: readonly ExperimentalSidebarSectionRegistration[];
}

export interface ForkSlotSnapshot {
  itemDrops: readonly PluginItemDropSlot[];
  newTabItems: readonly PluginNewTabItemsSlot[];
  commandPalettes: readonly PluginCommandPaletteSlot[];
  appBackdrops: readonly PluginAppBackdropSlot[];
  launcherItems: readonly PluginLauncherItemSlot[];
  threadBanners: readonly PluginThreadBannerSlot[];
  modelLoadNotices: readonly PluginModelLoadNoticeSlot[];
  firstRuns: readonly PluginFirstRunSlot[];
  newConversations: readonly PluginNewConversationSlot[];
  modelPickerGates: readonly PluginModelPickerGateSlot[];
  hiddenHostEntries: readonly PluginHiddenHostEntriesSlot[];
  threadHeaders: readonly PluginThreadHeaderSlot[];
  forkMessageActions: readonly PluginMessageActionMenuSlot[];
  contextCardRows: readonly PluginContextCardRowSlot[];
  windows: readonly PluginWindowSlot[];
  linkHandlers: readonly PluginLinkHandlerSlot[];
  replyClassifiers: readonly PluginReplyClassifierSlot[];
  paletteSearches: readonly PluginPaletteSearchSlot[];
  sidebarSections: readonly PluginSidebarSectionSlot[];
}

export const EMPTY_FORK_SLOTS: ForkSlotSnapshot = {
  itemDrops: [],
  newTabItems: [],
  commandPalettes: [],
  appBackdrops: [],
  launcherItems: [],
  threadBanners: [],
  modelLoadNotices: [],
  firstRuns: [],
  newConversations: [],
  modelPickerGates: [],
  hiddenHostEntries: [],
  threadHeaders: [],
  forkMessageActions: [],
  contextCardRows: [],
  windows: [],
  linkHandlers: [],
  replyClassifiers: [],
  paletteSearches: [],
  sidebarSections: [],
};

export const FORK_SLOT_KINDS = [
  "paletteSearches",
  "sidebarSections",
  "replyClassifiers",
  "linkHandlers",
  "windows",
  "contextCardRows",
  "threadBanners",
  "modelLoadNotices",
  "firstRuns",
  "newConversations",
  "modelPickerGates",
  "hiddenHostEntries",
  "threadHeaders",
  "forkMessageActions",
  "launcherItems",
  "itemDrops",
  "newTabItems",
  "commandPalettes",
  "appBackdrops",
] as const satisfies readonly (keyof ForkSlotSnapshot)[];

export function stampForkSlots(
  set: ForkRegistrationSet,
  stamp: <T extends object>(
    registrations: readonly T[] | undefined,
  ) => readonly (T & ForkSlotBase)[],
): ForkSlotSnapshot {
  return {
    paletteSearches: stamp(set.paletteSearches),
    sidebarSections: stamp(set.sidebarSections),
    replyClassifiers: stamp(set.replyClassifiers),
    linkHandlers: stamp(set.linkHandlers),
    windows: stamp(set.windows),
    contextCardRows: stamp(set.contextCardRows),
    threadBanners: stamp(set.threadBanners),
    modelLoadNotices: stamp(set.modelLoadNotices),
    firstRuns: stamp(set.firstRuns),
    newConversations: stamp(set.newConversations),
    modelPickerGates: stamp(set.modelPickerGates),
    hiddenHostEntries: stamp(set.hiddenHostEntries),
    threadHeaders: stamp(set.threadHeaders),
    forkMessageActions: stamp(set.forkMessageActions),
    launcherItems: stamp(set.launcherItems),
    itemDrops: stamp(set.itemDrops),
    newTabItems: stamp(set.newTabItems),
    commandPalettes: stamp(set.commandPalettes),
    appBackdrops: stamp(set.appBackdrops),
  };
}
