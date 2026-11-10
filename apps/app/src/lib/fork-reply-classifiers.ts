import { useSyncExternalStore } from "react";
import { getPluginSlotSnapshot, subscribePluginSlots } from "./plugin-slots";

export function isQuietReply(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  for (const classifier of getPluginSlotSnapshot().replyClassifiers) {
    try {
      if (classifier.classify(text)?.quiet === true) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function useQuietReply(text: string | null | undefined): boolean {
  const read = () => isQuietReply(text);
  return useSyncExternalStore(subscribePluginSlots, read, read);
}
