import type { ForkSlotRegistrations } from "./fork-slots.js";
import type { PluginAppComponentPath } from "./plugin-app-component-fields.js";

export const FORK_COMPONENT_FIELDS: {
  readonly [K in keyof ForkSlotRegistrations]: readonly PluginAppComponentPath<
    ForkSlotRegistrations[K][number]
  >[];
} = {
  paletteSearches: [],
  sidebarSections: ["component"],
  replyClassifiers: [],
  linkHandlers: [],
  windows: ["component"],
  contextCardRows: [],
  threadBanners: ["component"],
  modelLoadNotices: ["component"],
  firstRuns: ["component"],
  newConversations: [],
  modelPickerGates: ["component"],
  hiddenHostEntries: [],
  threadHeaders: [],
  forkMessageActions: [],
  launcherItems: [],
  itemDrops: [],
  newTabItems: [],
  commandPalettes: ["component"],
  appBackdrops: ["component"],
  timelineFilters: [],
};
