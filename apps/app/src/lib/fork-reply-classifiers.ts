import { useMemo, useSyncExternalStore } from "react";
import type { ExperimentalMessageClassificationContext } from "@get-bb/plugin-sdk";
import { getPluginSlotSnapshot, subscribePluginSlots } from "./plugin-slots";

export interface PluginMessageClassification {
  sender: string | null;
  previewStart: number;
}

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

export function classifyPluginMessage(
  text: string,
  context: ExperimentalMessageClassificationContext,
): PluginMessageClassification | null {
  for (const classifier of getPluginSlotSnapshot().replyClassifiers) {
    if (typeof classifier.classifyMessage !== "function") continue;
    try {
      const result = classifier.classifyMessage(text, context);
      if (result === null || result === undefined) continue;
      const sender =
        typeof result.sender === "string" && result.sender.trim().length > 0
          ? result.sender.trim()
          : null;
      const start = result.previewStart;
      const previewStart =
        typeof start === "number" && Number.isInteger(start)
          ? Math.min(Math.max(start, 0), text.length)
          : 0;
      return { sender, previewStart };
    } catch {
      continue;
    }
  }
  return null;
}

export function usePluginMessageClassification(
  text: string,
  context: ExperimentalMessageClassificationContext,
): PluginMessageClassification | null {
  const { part, initiator } = context;
  const read = () => {
    const result = classifyPluginMessage(text, { part, initiator });
    return result === null ? null : JSON.stringify(result);
  };
  const key = useSyncExternalStore(subscribePluginSlots, read, read);
  return useMemo(
    () =>
      key === null ? null : (JSON.parse(key) as PluginMessageClassification),
    [key],
  );
}
