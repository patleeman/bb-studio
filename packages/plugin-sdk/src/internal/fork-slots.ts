import type {
  ExperimentalCloseFallbackRegistration,
  ExperimentalContextCardRowRegistration,
  ExperimentalItemDropRegistration,
  ForkPluginAppSlots,
  ExperimentalLauncherItemRegistration,
  ExperimentalLinkHandlerRegistration,
  ExperimentalMainHeaderRegistration,
  ExperimentalMessageActionRegistration,
  ExperimentalThreadBannerRegistration,
  ExperimentalThreadHeaderRegistration,
  ExperimentalPaletteSearchRegistration,
  ExperimentalPanelTabActionRegistration,
  ExperimentalReplyClassifierRegistration,
  ExperimentalSidebarNewItemRegistration,
  ExperimentalSidebarSectionRegistration,
  ExperimentalSkillSourceRegistration,
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
  sidebarNewItems: ExperimentalSidebarNewItemRegistration[];
  replyClassifiers: ExperimentalReplyClassifierRegistration[];
  linkHandlers: ExperimentalLinkHandlerRegistration[];
  windows: ExperimentalWindowRegistration[];
  contextCardRows: ExperimentalContextCardRowRegistration[];
  mainHeaders: ExperimentalMainHeaderRegistration[];
  threadBanners: ExperimentalThreadBannerRegistration[];
  threadHeaders: ExperimentalThreadHeaderRegistration[];
  forkMessageActions: ExperimentalMessageActionRegistration[];
  panelTabActions: ExperimentalPanelTabActionRegistration[];
  launcherItems: ExperimentalLauncherItemRegistration[];
  itemDrops: ExperimentalItemDropRegistration[];
  closeFallbacks: ExperimentalCloseFallbackRegistration[];
  skillSources: ExperimentalSkillSourceRegistration[];
}

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
  "threadHeaders",
  "forkMessageActions",
  "panelTabActions",
  "launcherItems",
  "itemDrops",
  "closeFallbacks",
  "skillSources",
] as const satisfies readonly (keyof ForkSlotRegistrations)[];

export function emptyForkSlots(): ForkSlotRegistrations {
  return {
    paletteSearches: [],
    sidebarSections: [],
    sidebarNewItems: [],
    replyClassifiers: [],
    linkHandlers: [],
    windows: [],
    contextCardRows: [],
    mainHeaders: [],
    threadBanners: [],
    threadHeaders: [],
    forkMessageActions: [],
    panelTabActions: [],
    launcherItems: [],
    itemDrops: [],
    closeFallbacks: [],
    skillSources: [],
  };
}

export function forkSlotMethods(
  collected: ForkSlotRegistrations,
): ForkPluginAppSlots {
  const seenIds = {
    paletteSearch: new Set<string>(),
    sidebarSection: new Set<string>(),
    sidebarNewItem: new Set<string>(),
    replyClassifier: new Set<string>(),
    linkHandler: new Set<string>(),
    window: new Set<string>(),
    contextCardRow: new Set<string>(),
    mainHeader: new Set<string>(),
    threadBanner: new Set<string>(),
    threadHeader: new Set<string>(),
    messageAction: new Set<string>(),
    panelTabAction: new Set<string>(),
    launcherItem: new Set<string>(),
    itemDrop: new Set<string>(),
    closeFallback: new Set<string>(),
    skillSource: new Set<string>(),
  };
  return {
    experimental_sidebarNewItem(registration) {
      const kind = "slots.experimental_sidebarNewItem";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.sidebarNewItem, id);
      if (typeof registration.run !== "function") {
        throw new Error(`${kind}: "run" must be a function`);
      }
      collected.sidebarNewItems.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        icon: requireNonEmptyString(kind, "icon", registration.icon),
        ...(registration.group === undefined
          ? {}
          : {
              group: requireNonEmptyString(kind, "group", registration.group),
            }),
        run: registration.run,
      });
    },
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
    experimental_closeFallback(registration) {
      const kind = "slots.experimental_closeFallback";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.closeFallback, id);
      if (typeof registration.close !== "function") {
        throw new Error(`${kind} "${id}": close must be a function`);
      }
      collected.closeFallbacks.push({ id, close: registration.close });
    },
    experimental_mainHeader(registration) {
      const kind = "slots.experimental_mainHeader";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.mainHeader, id);
      collected.mainHeaders.push({
        id,
        component: requireComponent(kind, registration.component),
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
      });
    },
    experimental_panelTabAction(registration) {
      const kind = "slots.experimental_panelTabAction";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.panelTabAction, id);
      if (typeof registration.run !== "function") {
        throw new Error(`${kind} "${id}": run must be a function`);
      }
      if (
        registration.isAvailable !== undefined &&
        typeof registration.isAvailable !== "function"
      ) {
        throw new Error(`${kind} "${id}": isAvailable must be a function`);
      }
      collected.panelTabActions.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        ...(registration.icon === undefined
          ? {}
          : { icon: requireNonEmptyString(kind, "icon", registration.icon) }),
        ...(registration.isAvailable === undefined
          ? {}
          : { isAvailable: registration.isAvailable }),
        run: registration.run,
      });
    },
    experimental_skillSource(registration) {
      const kind = "slots.experimental_skillSource";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.skillSource, id);
      if (typeof registration.useSkills !== "function") {
        throw new Error(`${kind} "${id}": useSkills must be a function`);
      }
      collected.skillSources.push({
        id,
        label: requireNonEmptyString(kind, "label", registration.label),
        useSkills: registration.useSkills,
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
  "experimental_instanceIcon" | "experimental_compactWhenFixed"
>;

export function forkTabFields(registration: ForkTabFields): ForkTabFields {
  return {
    ...(typeof registration.experimental_instanceIcon === "function"
      ? { experimental_instanceIcon: registration.experimental_instanceIcon }
      : {}),
    ...(registration.experimental_compactWhenFixed === true
      ? { experimental_compactWhenFixed: true }
      : {}),
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
    ...(registration.experimental_useSidebarStyle === undefined
      ? {}
      : {
          experimental_useSidebarStyle: requireFunction(
            "slots.experimental_threadList",
            "experimental_useSidebarStyle",
            registration.experimental_useSidebarStyle,
          ),
        }),
  };
}

function requireFunction<T>(kind: string, field: string, value: unknown): T {
  if (typeof value !== "function") {
    throw new Error(`${kind}: "${field}" must be a function`);
  }
  return value as T;
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
