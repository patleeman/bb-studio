import type { ExperimentalMessageActionMessage } from "@get-bb/plugin-sdk";
import type { PluginMessageActionMenuSlot } from "@/lib/fork-slots";
import { useSyncExternalStore } from "react";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
} from "@/lib/plugin-slots";
import type { ThreadTimelinePluginMessageAction } from "./types.js";

const MENU_KEY_PREFIX = "fork-menu/";
const REPLACES_FORK_KEY_PREFIX = `${MENU_KEY_PREFIX}replaces=thread.fork/`;

interface MessageRow {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  turnId: string | null;
  sourceSeqEnd: number;
}

function menuSlots(): readonly PluginMessageActionMenuSlot[] {
  return getPluginSlotSnapshot().forkMessageActions;
}

export function useForkMessageActions(): readonly PluginMessageActionMenuSlot[] {
  return useSyncExternalStore(subscribePluginSlots, menuSlots, menuSlots);
}

function isAvailable(
  slot: PluginMessageActionMenuSlot,
  message: ExperimentalMessageActionMessage,
): boolean {
  if (slot.isAvailable === undefined) return true;
  try {
    return slot.isAvailable(message) === true;
  } catch {
    return false;
  }
}

function run(
  slot: PluginMessageActionMenuSlot,
  message: ExperimentalMessageActionMessage,
): void {
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${slot.pluginId}] message action "${slot.id}" failed`,
      error,
    );
  };
  try {
    const result = slot.run(message);
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

export function forkMessageMenuActions(
  slots: readonly PluginMessageActionMenuSlot[],
  row: MessageRow,
): ThreadTimelinePluginMessageAction[] {
  if (slots.length === 0) return [];
  const message: ExperimentalMessageActionMessage = {
    threadId: row.threadId,
    messageId: row.id,
    turnId: row.turnId,
    role: row.role,
    sourceSeqEnd: row.sourceSeqEnd,
  };
  return [...slots]
    .sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
    )
    .filter((slot) => isAvailable(slot, message))
    .map((slot) => ({
      key: `${slot.experimental_replaces === "thread.fork" ? REPLACES_FORK_KEY_PREFIX : MENU_KEY_PREFIX}${slot.pluginId}/${slot.id}/${slot.generation}`,
      pluginId: slot.pluginId,
      icon: slot.icon ?? null,
      label: slot.title,
      onSelect: () => run(slot, message),
    }));
}

export function withForkMessageMenu(
  slots: readonly PluginMessageActionMenuSlot[],
  row: MessageRow,
  actions: readonly ThreadTimelinePluginMessageAction[] | undefined,
): readonly ThreadTimelinePluginMessageAction[] | undefined {
  const menu = forkMessageMenuActions(slots, row);
  return menu.length === 0 ? actions : [...(actions ?? []), ...menu];
}

function isMenuAction(action: ThreadTimelinePluginMessageAction): boolean {
  return action.key.startsWith(MENU_KEY_PREFIX);
}

export function forkInlineMessageActions(
  actions: readonly ThreadTimelinePluginMessageAction[],
): readonly ThreadTimelinePluginMessageAction[] {
  return actions.filter((action) => !isMenuAction(action));
}

export function forkMenuMessageActions(
  actions: readonly ThreadTimelinePluginMessageAction[],
): {
  icon: "Copy";
  plugin: { pluginId: string | null; icon: string | null };
  key: string;
  label: string;
  onSelect: () => void;
}[] {
  return actions.filter(isMenuAction).map((action) => ({
    icon: "Copy",
    plugin: { pluginId: action.pluginId, icon: action.icon },
    key: action.key,
    label: action.label,
    onSelect: action.onSelect,
  }));
}

export function forkKeepsThreadFork(
  actions: readonly ThreadTimelinePluginMessageAction[],
): boolean {
  return !actions.some((action) =>
    action.key.startsWith(REPLACES_FORK_KEY_PREFIX),
  );
}
