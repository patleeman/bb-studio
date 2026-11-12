import type {
  ExperimentalAppBackdropRegistration,
  ExperimentalCommandPaletteRegistration,
  ExperimentalContextCardRowRegistration,
  ExperimentalItemDropRegistration,
  ForkPluginAppSlots,
  ExperimentalLauncherItemRegistration,
  ExperimentalLinkHandlerRegistration,
  ExperimentalNewTabItemsRegistration,
  ExperimentalMessageActionRegistration,
  ExperimentalModelLoadNoticeRegistration,
  ExperimentalFirstRunRegistration,
  ExperimentalModelPickerGateRegistration,
  ExperimentalHideHostEntriesRegistration,
  ExperimentalThreadBannerRegistration,
  ExperimentalThreadHeaderRegistration,
  ExperimentalPaletteSearchRegistration,
  ExperimentalReplyClassifierRegistration,
  ExperimentalSidebarSectionRegistration,
  ExperimentalWindowRegistration,
  ExperimentalTabRegistration,
  ForkFileOpenerFields,
  ForkThreadListFields,
} from "@get-bb/plugin-sdk";
import {
  requireComponent,
  requireNonEmptyString,
  requireSlotId,
  requireUniqueId,
} from "./composer-customization-validation.js";

export interface ForkSlotRegistrations {
  paletteSearches: ExperimentalPaletteSearchRegistration[];
  sidebarSections: ExperimentalSidebarSectionRegistration[];
  replyClassifiers: ExperimentalReplyClassifierRegistration[];
  linkHandlers: ExperimentalLinkHandlerRegistration[];
  windows: ExperimentalWindowRegistration[];
  contextCardRows: ExperimentalContextCardRowRegistration[];
  threadBanners: ExperimentalThreadBannerRegistration[];
  modelLoadNotices: ExperimentalModelLoadNoticeRegistration[];
  firstRuns: ExperimentalFirstRunRegistration[];
  modelPickerGates: ExperimentalModelPickerGateRegistration[];
  hiddenHostEntries: ExperimentalHideHostEntriesRegistration[];
  threadHeaders: ExperimentalThreadHeaderRegistration[];
  forkMessageActions: ExperimentalMessageActionRegistration[];
  launcherItems: ExperimentalLauncherItemRegistration[];
  itemDrops: ExperimentalItemDropRegistration[];
  newTabItems: ExperimentalNewTabItemsRegistration[];
  commandPalettes: ExperimentalCommandPaletteRegistration[];
  appBackdrops: ExperimentalAppBackdropRegistration[];
}

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
  "modelPickerGates",
  "hiddenHostEntries",
  "threadHeaders",
  "forkMessageActions",
  "launcherItems",
  "itemDrops",
  "newTabItems",
  "commandPalettes",
  "appBackdrops",
] as const satisfies readonly (keyof ForkSlotRegistrations)[];

export function emptyForkSlots(): ForkSlotRegistrations {
  return {
    paletteSearches: [],
    sidebarSections: [],
    replyClassifiers: [],
    linkHandlers: [],
    windows: [],
    contextCardRows: [],
    threadBanners: [],
    modelLoadNotices: [],
    firstRuns: [],
    modelPickerGates: [],
    hiddenHostEntries: [],
    threadHeaders: [],
    forkMessageActions: [],
    launcherItems: [],
    itemDrops: [],
    newTabItems: [],
    commandPalettes: [],
    appBackdrops: [],
  };
}

export function forkSlotMethods(
  collected: ForkSlotRegistrations,
): ForkPluginAppSlots {
  const seenIds = {
    paletteSearch: new Set<string>(),
    sidebarSection: new Set<string>(),
    replyClassifier: new Set<string>(),
    linkHandler: new Set<string>(),
    window: new Set<string>(),
    contextCardRow: new Set<string>(),
    threadBanner: new Set<string>(),
    modelLoadNotice: new Set<string>(),
    firstRun: new Set<string>(),
    modelPickerGate: new Set<string>(),
    hiddenHostEntries: new Set<string>(),
    threadHeader: new Set<string>(),
    messageAction: new Set<string>(),
    launcherItem: new Set<string>(),
    itemDrop: new Set<string>(),
    newTabItems: new Set<string>(),
    commandPalette: new Set<string>(),
    appBackdrop: new Set<string>(),
  };
  return {
    experimental_sidebarSection(registration) {
      const kind = "slots.experimental_sidebarSection";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.sidebarSection, id);
      collected.sidebarSections.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        component: requireComponent(kind, registration.component),
      });
    },
    experimental_replyClassifier(registration) {
      const kind = "slots.experimental_replyClassifier";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.replyClassifier, id);
      if (typeof registration.classify !== "function") {
        throw new Error(`${kind} "${id}": classify must be a function`);
      }
      collected.replyClassifiers.push({ id, classify: registration.classify });
    },
    experimental_linkHandler(registration) {
      const kind = "slots.experimental_linkHandler";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.linkHandler, id);
      if (typeof registration.handle !== "function") {
        throw new Error(`${kind} "${id}": handle must be a function`);
      }
      collected.linkHandlers.push({ id, handle: registration.handle });
    },
    experimental_window(registration) {
      const kind = "slots.experimental_window";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.window, id);
      collected.windows.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        component: requireComponent(kind, registration.component),
      });
    },
    experimental_contextCardRow(registration) {
      const kind = "slots.experimental_contextCardRow";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.contextCardRow, id);
      if (typeof registration.useRow !== "function") {
        throw new Error(`${kind} "${id}": useRow must be a function`);
      }
      collected.contextCardRows.push({ id, useRow: registration.useRow });
    },
    experimental_launcherItem(registration) {
      const kind = "slots.experimental_launcherItem";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.launcherItem, id);
      if (typeof registration.run !== "function") {
        throw new Error(`${kind} "${id}": run must be a function`);
      }
      if (
        registration.section !== "apps" &&
        registration.section !== "actions"
      ) {
        throw new Error(`${kind} "${id}": section must be "apps" or "actions"`);
      }
      collected.launcherItems.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        icon: requireNonEmptyString(kind, "icon", registration.icon),
        section: registration.section,
        keywords: Array.isArray(registration.keywords)
          ? registration.keywords.filter(
              (word): word is string => typeof word === "string",
            )
          : [],
        ...(typeof registration.order === "number" &&
        Number.isFinite(registration.order)
          ? { order: registration.order }
          : {}),
        run: registration.run,
      });
    },
    experimental_itemDrop(registration) {
      const kind = "slots.experimental_itemDrop";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.itemDrop, id);
      if (typeof registration.canDrop !== "function") {
        throw new Error(`${kind} "${id}": canDrop must be a function`);
      }
      if (typeof registration.drop !== "function") {
        throw new Error(`${kind} "${id}": drop must be a function`);
      }
      collected.itemDrops.push({
        id,
        canDrop: registration.canDrop,
        drop: registration.drop,
      });
    },
    experimental_commandPalette(registration) {
      const kind = "slots.experimental_commandPalette";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.commandPalette, id);
      collected.commandPalettes.push({
        id,
        component: requireComponent(kind, registration.component),
      });
    },
    experimental_appBackdrop(registration) {
      const kind = "slots.experimental_appBackdrop";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.appBackdrop, id);
      const component = requireComponent<
        ExperimentalAppBackdropRegistration["component"]
      >(kind, registration.component);
      if (registration.useAppearance === undefined) {
        collected.appBackdrops.push({ id, component });
        return;
      }
      if (typeof registration.useAppearance !== "function") {
        throw new Error(`${kind} "${id}": useAppearance must be a function`);
      }
      collected.appBackdrops.push({
        id,
        component,
        useAppearance: registration.useAppearance,
      });
    },
    experimental_threadBanner(registration) {
      const kind = "slots.experimental_threadBanner";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.threadBanner, id);
      collected.threadBanners.push({
        id,
        component: requireComponent(kind, registration.component),
      });
    },
    experimental_modelLoadNotice(registration) {
      const kind = "slots.experimental_modelLoadNotice";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.modelLoadNotice, id);
      collected.modelLoadNotices.push({
        id,
        component: requireComponent(kind, registration.component),
      });
    },
    experimental_firstRun(registration) {
      const kind = "slots.experimental_firstRun";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.firstRun, id);
      collected.firstRuns.push(
        registration.component === undefined
          ? { id }
          : { id, component: requireComponent(kind, registration.component) },
      );
    },
    experimental_modelPickerGate(registration) {
      const kind = "slots.experimental_modelPickerGate";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.modelPickerGate, id);
      collected.modelPickerGates.push({
        id,
        component: requireComponent(kind, registration.component),
      });
    },
    experimental_hideHostEntries(registration) {
      const kind = "slots.experimental_hideHostEntries";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.hiddenHostEntries, id);
      const list = <T extends string>(field: string, value: unknown): T[] => {
        if (value === undefined) return [];
        if (
          !Array.isArray(value) ||
          value.some((entry) => typeof entry !== "string" || entry === "")
        ) {
          throw new Error(
            `${kind} "${id}": ${field} must be an array of non-empty strings`,
          );
        }
        return [...value] as T[];
      };
      collected.hiddenHostEntries.push({
        id,
        navigation: list("navigation", registration.navigation),
        pages: list("pages", registration.pages),
        settings: list("settings", registration.settings),
      });
    },
    experimental_threadHeader(registration) {
      const kind = "slots.experimental_threadHeader";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.threadHeader, id);
      if (typeof registration.useDecoration !== "function") {
        throw new Error(`${kind} "${id}": useDecoration must be a function`);
      }
      collected.threadHeaders.push({
        id,
        useDecoration: registration.useDecoration,
      });
    },
    experimental_messageAction(registration) {
      const kind = "slots.experimental_messageAction";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.messageAction, id);
      if (typeof registration.run !== "function") {
        throw new Error(`${kind} "${id}": run must be a function`);
      }
      if (
        registration.isAvailable !== undefined &&
        typeof registration.isAvailable !== "function"
      ) {
        throw new Error(`${kind} "${id}": isAvailable must be a function`);
      }
      collected.forkMessageActions.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        ...(registration.icon === undefined
          ? {}
          : { icon: requireNonEmptyString(kind, "icon", registration.icon) }),
        ...(registration.isAvailable === undefined
          ? {}
          : { isAvailable: registration.isAvailable }),
        run: registration.run,
        ...(registration.experimental_replaces === "thread.fork"
          ? { experimental_replaces: "thread.fork" as const }
          : {}),
      });
    },
    experimental_newTabItems(registration) {
      const kind = "slots.experimental_newTabItems";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.newTabItems, id);
      const { useRecents, search } = registration;
      if (useRecents === undefined && search === undefined) {
        throw new Error(`${kind} "${id}": give useRecents, search or both`);
      }
      for (const [name, value] of [
        ["useRecents", useRecents],
        ["search", search],
      ] as const) {
        if (value !== undefined && typeof value !== "function") {
          throw new Error(`${kind} "${id}": ${name} must be a function`);
        }
      }
      collected.newTabItems.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        ...(useRecents === undefined ? {} : { useRecents }),
        ...(search === undefined ? {} : { search }),
      });
    },
    experimental_paletteSearch(registration) {
      const kind = "slots.experimental_paletteSearch";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.paletteSearch, id);
      if (typeof registration.search !== "function") {
        throw new Error(`${kind} "${id}": search must be a function`);
      }
      collected.paletteSearches.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        search: registration.search,
      });
    },
  };
}

type ForkTabFields = Pick<
  ExperimentalTabRegistration,
  | "experimental_instanceIcon"
  | "experimental_showInNewTab"
  | "experimental_newTabGroup"
  | "experimental_openableByPlugins"
>;

export function forkTabFields(registration: ForkTabFields): ForkTabFields {
  const showInNewTab = registration.experimental_showInNewTab;
  if (showInNewTab !== undefined && showInNewTab !== false) {
    throw new Error(
      `slots.experimental_tab: "experimental_showInNewTab" must be false when set`,
    );
  }
  const newTabGroup = registration.experimental_newTabGroup;
  const openableByPlugins = registration.experimental_openableByPlugins;
  if (openableByPlugins !== undefined && openableByPlugins !== true) {
    throw new Error(
      `slots.experimental_tab: "experimental_openableByPlugins" must be true when set`,
    );
  }
  return {
    ...(newTabGroup === undefined
      ? {}
      : {
          experimental_newTabGroup: requireNonEmptyString(
            "slots.experimental_tab",
            "experimental_newTabGroup",
            newTabGroup,
          ),
        }),
    ...(openableByPlugins === true
      ? { experimental_openableByPlugins: true }
      : {}),
    ...(typeof registration.experimental_instanceIcon === "function"
      ? { experimental_instanceIcon: registration.experimental_instanceIcon }
      : {}),
    ...(showInNewTab === false ? { experimental_showInNewTab: false } : {}),
  };
}

export function withForkThreadListFields<T>(
  registration: ForkThreadListFields,
  collected: T,
): T & ForkThreadListFields {
  return {
    ...collected,
    ...(registration.experimental_hideSidebarHeader === true
      ? { experimental_hideSidebarHeader: true }
      : {}),
  };
}

export function forkFileOpenerFields(
  kind: string,
  registration: ForkFileOpenerFields,
): ForkFileOpenerFields {
  return registration.experimental_handleOpen === undefined
    ? {}
    : {
        experimental_handleOpen: requireFunction(
          kind,
          "experimental_handleOpen",
          registration.experimental_handleOpen,
        ),
      };
}

function requireFunction<T>(kind: string, field: string, value: unknown): T {
  if (typeof value !== "function") {
    throw new Error(`${kind}: "${field}" must be a function`);
  }
  return value as T;
}
