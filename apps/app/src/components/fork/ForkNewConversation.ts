import { useCallback } from "react";
import type { PluginNewConversationSlot } from "@/lib/fork-slots";
import { usePluginSlots } from "@/lib/plugin-slots";

export function runForkNewConversation(
  slots: readonly PluginNewConversationSlot[] | undefined,
): boolean {
  const ordered = [...(slots ?? [])].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
  );
  for (const slot of ordered) {
    try {
      if (slot.run() === true) return true;
    } catch (error) {
      console.error(
        `[plugin:${slot.pluginId}] slots.experimental_newConversation "${slot.id}" failed`,
        error,
      );
    }
  }
  return false;
}

export function useForkNewConversation(): () => boolean {
  const slots = usePluginSlots().newConversations;
  return useCallback(() => runForkNewConversation(slots), [slots]);
}
