import { useMemo, useSyncExternalStore } from "react";
import type { ExperimentalMessageClassificationContext } from "@get-bb/plugin-sdk";
import { getPluginSlotSnapshot, subscribePluginSlots } from "./plugin-slots";
import type { PluginReplyClassifierSlot } from "./fork-slots";

export type ReplyClassifiers = readonly PluginReplyClassifierSlot[];

function currentClassifiers(): ReplyClassifiers {
  return getPluginSlotSnapshot().replyClassifiers;
}

export interface PluginMessageClassification {
  sender: string | null;
  previewStart: number;
}

export function isQuietReply(
  text: string | null | undefined,
  classifiers: ReplyClassifiers = currentClassifiers(),
): boolean {
  if (typeof text !== "string") return false;
  for (const classifier of classifiers) {
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

function wellFormedClassification(
  result: unknown,
): { sender?: string; previewStart?: number } | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return null;
  }
  const { sender, previewStart } = result as Record<string, unknown>;
  const senderOk =
    sender === undefined ||
    (typeof sender === "string" && sender.trim().length > 0);
  const startOk =
    previewStart === undefined ||
    (typeof previewStart === "number" && Number.isInteger(previewStart));
  if (!senderOk || !startOk || (sender === undefined && previewStart === undefined)) {
    return null;
  }
  return {
    ...(typeof sender === "string" ? { sender: sender.trim() } : {}),
    ...(typeof previewStart === "number" ? { previewStart } : {}),
  };
}

export function classifyPluginMessage(
  text: string,
  context: ExperimentalMessageClassificationContext,
  classifiers: ReplyClassifiers = currentClassifiers(),
): PluginMessageClassification | null {
  for (const classifier of classifiers) {
    if (typeof classifier.classifyMessage !== "function") continue;
    try {
      const result: unknown = classifier.classifyMessage(text, context);
      const parsed = wellFormedClassification(result);
      if (parsed === null) continue;
      const sender = parsed.sender ?? null;
      const previewStart = Math.min(Math.max(parsed.previewStart ?? 0, 0), text.length);
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
