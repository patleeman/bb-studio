import type { ExperimentalHostPromptStackEntry } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { useForkHiddenHostEntries } from "./ForkHiddenHostEntries";

/** Whether a plugin hid this part of the stack above the composer (slots.experimental_hideHostEntries, promptStack). */
export function useForkPromptStackHidden(entry: ExperimentalHostPromptStackEntry): boolean {
  return useForkHiddenHostEntries().promptStack.has(entry);
}

/**
 * The Active child threads card's section as the host should draw it. With
 * "active-child-threads" hidden, only the children waiting on the user stay
 * (their questions with them); with none waiting, nothing is drawn.
 */
export function useForkChildThreads<Section extends { items: readonly { hasPendingInteraction: boolean }[] }>(
  section: Section | null,
): Section | null {
  const hidden = useForkPromptStackHidden("active-child-threads");
  return useMemo(() => {
    if (!hidden || section === null) return section;
    const items = section.items.filter((item) => item.hasPendingInteraction);
    return items.length === section.items.length ? section : { ...section, items };
  }, [hidden, section]);
}
