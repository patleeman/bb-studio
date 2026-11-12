import type {
  ExperimentalAppBackdropRegistration,
  ExperimentalCloseFallbackRegistration,
  ExperimentalCommandPaletteRegistration,
  ExperimentalContextCardRowRegistration,
  ExperimentalItemDropRegistration,
  ExperimentalLauncherItemRegistration,
  ExperimentalLinkHandlerRegistration,
  ExperimentalMainHeaderRegistration,
  ExperimentalMessageActionRegistration,
  ExperimentalModelLoadNoticeRegistration,
  ExperimentalFirstRunRegistration,
  ExperimentalModelPickerGateRegistration,
  ExperimentalNewTabItemsRegistration,
  ExperimentalThreadBannerRegistration,
  ExperimentalThreadHeaderRegistration,
  ExperimentalPaletteSearchRegistration,
  ExperimentalPanelTabActionRegistration,
  ExperimentalReplyClassifierRegistration,
  ExperimentalSidebarNewItemRegistration,
  ExperimentalSidebarSectionRegistration,
  ExperimentalSkillSourceRegistration,
  ExperimentalWindowRegistration,
} from "@get-bb/plugin-sdk";

interface ForkSlotBase {
  pluginId: string;
  generation: number;
}

export interface PluginSidebarNewItemSlot
  extends ExperimentalSidebarNewItemRegistration, ForkSlotBase {}
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

export interface PluginMainHeaderSlot
  extends ExperimentalMainHeaderRegistration, ForkSlotBase {}

export interface PluginThreadBannerSlot
  extends ExperimentalThreadBannerRegistration, ForkSlotBase {}

export interface PluginModelLoadNoticeSlot
  extends ExperimentalModelLoadNoticeRegistration, ForkSlotBase {}

export interface PluginFirstRunSlot
  extends ExperimentalFirstRunRegistration, ForkSlotBase {}

export interface PluginModelPickerGateSlot
  extends ExperimentalModelPickerGateRegistration, ForkSlotBase {}

export interface PluginThreadHeaderSlot
  extends ExperimentalThreadHeaderRegistration, ForkSlotBase {}

export interface PluginMessageActionMenuSlot
  extends ExperimentalMessageActionRegistration, ForkSlotBase {}

export interface PluginLauncherItemSlot
  extends ExperimentalLauncherItemRegistration, ForkSlotBase {}

export interface PluginPanelTabActionSlot
  extends ExperimentalPanelTabActionRegistration, ForkSlotBase {}

export interface PluginItemDropSlot
  extends ExperimentalItemDropRegistration, ForkSlotBase {}

export interface PluginCloseFallbackSlot
  extends ExperimentalCloseFallbackRegistration, ForkSlotBase {}

export interface PluginSkillSourceSlot
  extends ExperimentalSkillSourceRegistration, ForkSlotBase {}

export interface PluginNewTabItemsSlot
  extends ExperimentalNewTabItemsRegistration, ForkSlotBase {}

export interface PluginCommandPaletteSlot
  extends ExperimentalCommandPaletteRegistration, ForkSlotBase {}

export interface PluginAppBackdropSlot
  extends ExperimentalAppBackdropRegistration, ForkSlotBase {}

export interface ForkRegistrationSet {
  itemDrops?: readonly ExperimentalItemDropRegistration[];
  closeFallbacks?: readonly ExperimentalCloseFallbackRegistration[];
  skillSources?: readonly ExperimentalSkillSourceRegistration[];
  newTabItems?: readonly ExperimentalNewTabItemsRegistration[];
  commandPalettes?: readonly ExperimentalCommandPaletteRegistration[];
  appBackdrops?: readonly ExperimentalAppBackdropRegistration[];
  panelTabActions?: readonly ExperimentalPanelTabActionRegistration[];
  launcherItems?: readonly ExperimentalLauncherItemRegistration[];
  mainHeaders?: readonly ExperimentalMainHeaderRegistration[];
  threadBanners?: readonly ExperimentalThreadBannerRegistration[];
  modelLoadNotices?: readonly ExperimentalModelLoadNoticeRegistration[];
  firstRuns?: readonly ExperimentalFirstRunRegistration[];
  modelPickerGates?: readonly ExperimentalModelPickerGateRegistration[];
  threadHeaders?: readonly ExperimentalThreadHeaderRegistration[];
  forkMessageActions?: readonly ExperimentalMessageActionRegistration[];
  contextCardRows?: readonly ExperimentalContextCardRowRegistration[];
  windows?: readonly ExperimentalWindowRegistration[];
  linkHandlers?: readonly ExperimentalLinkHandlerRegistration[];
  replyClassifiers?: readonly ExperimentalReplyClassifierRegistration[];
  paletteSearches?: readonly ExperimentalPaletteSearchRegistration[];
  sidebarSections?: readonly ExperimentalSidebarSectionRegistration[];
  sidebarNewItems?: readonly ExperimentalSidebarNewItemRegistration[];
}

export interface ForkSlotSnapshot {
  itemDrops: readonly PluginItemDropSlot[];
  closeFallbacks: readonly PluginCloseFallbackSlot[];
  skillSources: readonly PluginSkillSourceSlot[];
  newTabItems: readonly PluginNewTabItemsSlot[];
  commandPalettes: readonly PluginCommandPaletteSlot[];
  appBackdrops: readonly PluginAppBackdropSlot[];
  panelTabActions: readonly PluginPanelTabActionSlot[];
  launcherItems: readonly PluginLauncherItemSlot[];
  mainHeaders: readonly PluginMainHeaderSlot[];
  threadBanners: readonly PluginThreadBannerSlot[];
  modelLoadNotices: readonly PluginModelLoadNoticeSlot[];
  firstRuns: readonly PluginFirstRunSlot[];
  modelPickerGates: readonly PluginModelPickerGateSlot[];
  threadHeaders: readonly PluginThreadHeaderSlot[];
  forkMessageActions: readonly PluginMessageActionMenuSlot[];
  contextCardRows: readonly PluginContextCardRowSlot[];
  windows: readonly PluginWindowSlot[];
  linkHandlers: readonly PluginLinkHandlerSlot[];
  replyClassifiers: readonly PluginReplyClassifierSlot[];
  paletteSearches: readonly PluginPaletteSearchSlot[];
  sidebarSections: readonly PluginSidebarSectionSlot[];
  sidebarNewItems: readonly PluginSidebarNewItemSlot[];
}

export const EMPTY_FORK_SLOTS: ForkSlotSnapshot = {
  itemDrops: [],
  closeFallbacks: [],
  skillSources: [],
  newTabItems: [],
  commandPalettes: [],
  appBackdrops: [],
  launcherItems: [],
  mainHeaders: [],
  threadBanners: [],
  modelLoadNotices: [],
  firstRuns: [],
  modelPickerGates: [],
  threadHeaders: [],
  forkMessageActions: [],
  panelTabActions: [],
  contextCardRows: [],
  windows: [],
  linkHandlers: [],
  replyClassifiers: [],
  paletteSearches: [],
  sidebarSections: [],
  sidebarNewItems: [],
};

export const FORK_SLOT_KINDS = [
  "paletteSearches",
  "sidebarSections",
  "sidebarNewItems",
  "replyClassifiers",
  "linkHandlers",
  "windows",
  "contextCardRows",
  "mainHeaders",
  "threadBanners",
  "modelLoadNotices",
  "firstRuns",
  "modelPickerGates",
  "threadHeaders",
  "forkMessageActions",
  "panelTabActions",
  "launcherItems",
  "itemDrops",
  "closeFallbacks",
  "skillSources",
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
    sidebarNewItems: stamp(set.sidebarNewItems),
    replyClassifiers: stamp(set.replyClassifiers),
    linkHandlers: stamp(set.linkHandlers),
    windows: stamp(set.windows),
    contextCardRows: stamp(set.contextCardRows),
    mainHeaders: stamp(set.mainHeaders),
    threadBanners: stamp(set.threadBanners),
    modelLoadNotices: stamp(set.modelLoadNotices),
    firstRuns: stamp(set.firstRuns),
    modelPickerGates: stamp(set.modelPickerGates),
    threadHeaders: stamp(set.threadHeaders),
    forkMessageActions: stamp(set.forkMessageActions),
    panelTabActions: stamp(set.panelTabActions),
    launcherItems: stamp(set.launcherItems),
    itemDrops: stamp(set.itemDrops),
    closeFallbacks: stamp(set.closeFallbacks),
    skillSources: stamp(set.skillSources),
    newTabItems: stamp(set.newTabItems),
    commandPalettes: stamp(set.commandPalettes),
    appBackdrops: stamp(set.appBackdrops),
  };
}
