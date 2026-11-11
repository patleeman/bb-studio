import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ExperimentalDragItem,
  ExperimentalNewTabItem,
} from "@get-bb/plugin-sdk";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginItemIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { parseDragItem, writeDragItem } from "@/lib/fork-item-drag";
import type { PluginNewTabItemsSlot } from "@/lib/fork-slots";
import { usePluginSlots } from "@/lib/plugin-slots";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  LAUNCHER_ROW_BASE_CLASS,
  LAUNCHER_ROW_ICON_CLASS,
  LauncherRowTrailing,
  LauncherSectionHeader,
} from "./launcherRow";
import type { NewTabAction } from "./NewTabActions";
import type { ThreadRecentItem } from "./threadRecentItems";

const SEARCH_DEBOUNCE_MS = 150;
export const NEW_TAB_SEARCH_GROUP_LIMIT = 8;

export interface ForkNewTabItem {
  domId: string;
  section: "recent" | "fork";
  pluginId: string;
  group: string;
  title: string;
  kind: string;
  icon: string | null;
  updatedAt: number;
  dragItem: ExperimentalDragItem | null;
  open(): void;
}

export interface ForkNewTabEntry {
  kind: "fork";
  item: ForkNewTabItem;
}

type RecentEntry = { kind: "recent"; item: ThreadRecentItem };

export interface ForkNewTab {
  recents: readonly (RecentEntry | ForkNewTabEntry)[];
  results: readonly ForkNewTabEntry[];
  node: ReactNode;
}

function slotKey(slot: PluginNewTabItemsSlot): string {
  return `${slot.pluginId}/${slot.id}`;
}

function bySlotOrder(a: PluginNewTabItemsSlot, b: PluginNewTabItemsSlot) {
  return a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id);
}

function toDragItem(value: unknown): ExperimentalDragItem | null {
  if (typeof value !== "object" || value === null) return null;
  try {
    return parseDragItem(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function toForkNewTabItems(
  slot: PluginNewTabItemsSlot,
  items: unknown,
  section: ForkNewTabItem["section"],
  limit = Number.POSITIVE_INFINITY,
): ForkNewTabItem[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const valid: ForkNewTabItem[] = [];
  for (const raw of items as readonly unknown[]) {
    if (valid.length >= limit) break;
    if (typeof raw !== "object" || raw === null) continue;
    const { id, title, kind, icon, updatedAt, open, experimental_dragItem } =
      raw as Partial<ExperimentalNewTabItem>;
    if (
      typeof id !== "string" ||
      id === "" ||
      seen.has(id) ||
      typeof title !== "string" ||
      typeof kind !== "string" ||
      typeof updatedAt !== "number" ||
      !Number.isFinite(updatedAt) ||
      typeof open !== "function"
    ) {
      continue;
    }
    seen.add(id);
    valid.push({
      section,
      domId: `new-tab-${section}-${encodeURIComponent(`${slotKey(slot)}/${id}`)}`,
      pluginId: slot.pluginId,
      group: slot.title,
      title,
      kind,
      icon: typeof icon === "string" && icon !== "" ? icon : null,
      updatedAt,
      dragItem: toDragItem(experimental_dragItem),
      open: () => {
        try {
          open.call(raw);
        } catch (error) {
          console.error(
            `[plugin:${slot.pluginId}] new tab item "${id}" failed to open`,
            error,
          );
        }
      },
    });
  }
  return valid;
}

export function mergeNewTabRecents(
  recentItems: readonly ThreadRecentItem[],
  pluginItems: readonly ForkNewTabItem[],
): (RecentEntry | ForkNewTabEntry)[] {
  return [
    ...recentItems.map((item): RecentEntry => ({ kind: "recent", item })),
    ...pluginItems.map((item): ForkNewTabEntry => ({ kind: "fork", item })),
  ].sort(
    (a, b) =>
      (b.kind === "recent" ? b.item.openedAt : b.item.updatedAt) -
      (a.kind === "recent" ? a.item.openedAt : a.item.updatedAt),
  );
}

type ReportRecents = (
  key: string,
  items: readonly ForkNewTabItem[] | null,
) => void;

const NO_RECENTS: readonly ExperimentalNewTabItem[] = [];

function useNoRecents(): readonly ExperimentalNewTabItem[] {
  return NO_RECENTS;
}

const RecentsCollector = memo(function RecentsCollector({
  slot,
  threadId,
  report,
}: {
  slot: PluginNewTabItemsSlot;
  threadId: string | null;
  report: ReportRecents;
}) {
  const useRecents = slot.useRecents ?? useNoRecents;
  const items = useRecents({ threadId });
  const key = slotKey(slot);
  const valid = useMemo(
    () => toForkNewTabItems(slot, items, "recent"),
    [slot, items],
  );
  useLayoutEffect(() => {
    report(key, valid);
  }, [key, report, valid]);
  useLayoutEffect(() => () => report(key, null), [key, report]);
  return null;
});

function usePluginSearch(
  slots: readonly PluginNewTabItemsSlot[],
  query: string,
  threadId: string | null,
): readonly ForkNewTabItem[] {
  const [settled, setSettled] = useState<{
    query: string;
    slots: readonly PluginNewTabItemsSlot[];
    items: readonly ForkNewTabItem[];
  } | null>(null);
  useEffect(() => {
    const searchable = slots.filter((slot) => slot.search !== undefined);
    if (query === "" || searchable.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all(
        searchable.map(async (slot) => {
          try {
            const results = await slot.search?.(query, {
              signal: controller.signal,
              threadId,
            });
            return toForkNewTabItems(
              slot,
              results,
              "fork",
              NEW_TAB_SEARCH_GROUP_LIMIT,
            );
          } catch (error) {
            if (!controller.signal.aborted) {
              console.warn(
                `[plugin:${slot.pluginId}] new tab search "${slot.id}" failed`,
                error,
              );
            }
            return [];
          }
        }),
      ).then((groups) => {
        if (controller.signal.aborted) return;
        setSettled({ query, slots, items: groups.flat() });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, slots, threadId]);
  return useMemo(
    () =>
      settled !== null && settled.query === query && settled.slots === slots
        ? settled.items
        : [],
    [query, settled, slots],
  );
}

export function useForkNewTabActions<Action extends { id: string }>(
  actions: readonly Action[],
): readonly Action[] {
  const tabs = usePluginSlots().tabs;
  const hidden = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of tabs) {
      if (
        tab.availability === "action" &&
        tab.experimental_showInNewTab === false
      ) {
        ids.add(`plugin-action:${tab.pluginId}:${tab.id}`);
      }
    }
    return ids;
  }, [tabs]);
  return useMemo(
    () =>
      hidden.size === 0
        ? actions
        : actions.filter((action) => !hidden.has(action.id)),
    [actions, hidden],
  );
}

export interface ForkNewTabActionGroup {
  label: string | undefined;
  actions: NewTabAction[];
}

export function groupNewTabActions(
  actions: readonly NewTabAction[],
  groupOf: ReadonlyMap<string, string>,
  groupOrder: readonly string[],
): ForkNewTabActionGroup[] {
  const ungrouped: NewTabAction[] = [];
  const grouped = new Map<string, NewTabAction[]>();
  for (const action of actions) {
    const label = groupOf.get(action.id);
    if (label === undefined) {
      ungrouped.push(action);
      continue;
    }
    const members = grouped.get(label);
    if (members === undefined) grouped.set(label, [action]);
    else members.push(action);
  }
  const groups: ForkNewTabActionGroup[] = [
    { label: undefined, actions: ungrouped },
  ];
  for (const label of groupOrder) {
    const members = grouped.get(label);
    if (members !== undefined) groups.push({ label, actions: members });
  }
  return groups;
}

export function useForkNewTabActionGroups(
  actions: readonly NewTabAction[],
): ForkNewTabActionGroup[] {
  const tabs = usePluginSlots().tabs;
  const { groupOf, groupOrder } = useMemo(() => {
    const byId = new Map<string, string>();
    const order: string[] = [];
    for (const tab of tabs) {
      const label =
        tab.availability === "action"
          ? tab.experimental_newTabGroup
          : undefined;
      if (label === undefined) continue;
      byId.set(`plugin-action:${tab.pluginId}:${tab.id}`, label);
      if (!order.includes(label)) order.push(label);
    }
    return { groupOf: byId, groupOrder: order };
  }, [tabs]);
  return useMemo(
    () => groupNewTabActions(actions, groupOf, groupOrder),
    [actions, groupOf, groupOrder],
  );
}

export function useForkNewTab({
  recentItems,
  query,
  threadId,
}: {
  recentItems: readonly ThreadRecentItem[];
  query: string;
  threadId: string | null;
}): ForkNewTab {
  const registered = usePluginSlots().newTabItems;
  const slots = useMemo(() => [...registered].sort(bySlotOrder), [registered]);
  const [reported, setReported] = useState<
    ReadonlyMap<string, readonly ForkNewTabItem[]>
  >(() => new Map());
  const report = useCallback<ReportRecents>((key, items) => {
    setReported((current) => {
      if (items === null ? !current.has(key) : current.get(key) === items) {
        return current;
      }
      const next = new Map(current);
      if (items === null) next.delete(key);
      else next.set(key, items);
      return next;
    });
  }, []);
  const searchItems = usePluginSearch(slots, query, threadId);
  const recents = useMemo(
    () => mergeNewTabRecents(recentItems, [...reported.values()].flat()),
    [recentItems, reported],
  );
  const results = useMemo(
    () => searchItems.map((item): ForkNewTabEntry => ({ kind: "fork", item })),
    [searchItems],
  );
  const node = slots.map((slot) =>
    slot.useRecents === undefined ? null : (
      <PluginSlotMount
        key={`${slotKey(slot)}/${slot.generation}`}
        pluginId={slot.pluginId}
        slotKind="newTabItems"
        slotId={slot.id}
        instanceId={threadId ?? "none"}
        crashFallback={null}
      >
        <RecentsCollector slot={slot} threadId={threadId} report={report} />
      </PluginSlotMount>
    ),
  );
  return { recents, results, node };
}

export function ForkNewTabRow({
  item,
  isActive,
  nowMs,
  onActivate,
}: {
  item: ForkNewTabItem;
  isActive: boolean;
  nowMs: number;
  onActivate: () => void;
}) {
  const { dragItem } = item;
  return (
    <button
      type="button"
      id={item.domId}
      data-panel-new-tab-item=""
      role="option"
      aria-selected={isActive}
      onClick={item.open}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      draggable={dragItem !== null}
      onDragStart={
        dragItem === null
          ? undefined
          : (event) => writeDragItem(event.dataTransfer, dragItem)
      }
      title={item.title}
      className={cn(
        LAUNCHER_ROW_BASE_CLASS,
        "relative scroll-mt-7",
        isActive ? "bg-state-active" : "hover:bg-state-hover",
      )}
    >
      <span className={LAUNCHER_ROW_ICON_CLASS}>
        <PluginItemIcon
          pluginId={item.pluginId}
          icon={item.icon}
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
        />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-foreground">{item.title}</span>
        <span className="shrink-0 text-muted-foreground">{item.kind}</span>
      </span>
      <LauncherRowTrailing
        idle={formatRelativeTime({ timestamp: item.updatedAt, now: nowMs })}
        isActive={isActive}
      />
    </button>
  );
}

function isForkEntry(entry: { kind: string }): entry is ForkNewTabEntry {
  return entry.kind === "fork";
}

export function ForkNewTabResults({
  items,
  activeIndex,
  nowMs,
  onActivateIndex,
  spaced,
}: {
  items: readonly { entry: { kind: string }; index: number }[];
  activeIndex: number;
  nowMs: number;
  onActivateIndex: (index: number) => void;
  spaced: boolean;
}) {
  const groups: {
    title: string;
    rows: { item: ForkNewTabItem; index: number }[];
  }[] = [];
  for (const { entry, index } of items) {
    if (!isForkEntry(entry)) continue;
    const { item } = entry;
    const last = groups.at(-1);
    if (last?.title === item.group) last.rows.push({ item, index });
    else groups.push({ title: item.group, rows: [{ item, index }] });
  }
  return groups.map((group, groupIndex) => (
    <section
      key={`${group.title}/${String(groupIndex)}`}
      role="group"
      aria-label={group.title}
      className={cn((spaced || groupIndex > 0) && "mt-3")}
    >
      <LauncherSectionHeader
        label={group.title}
        sticky
        className={spaced || groupIndex > 0 ? "pt-2" : undefined}
      />
      <div className="flex flex-col gap-px">
        {group.rows.map(({ item, index }) => (
          <ForkNewTabRow
            key={item.domId}
            item={item}
            isActive={index >= 0 && index === activeIndex}
            nowMs={nowMs}
            onActivate={() => onActivateIndex(index)}
          />
        ))}
      </div>
    </section>
  ));
}
