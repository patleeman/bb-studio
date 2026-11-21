import type { ExperimentalHostPromptStackEntry } from "@get-bb/plugin-sdk/app";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { useForkHiddenHostEntries } from "./ForkHiddenHostEntries";

export function useForkPromptStackHidden(entry: ExperimentalHostPromptStackEntry, threadId: string | null): boolean {
  const { promptStack, promptStackSources } = useForkHiddenHostEntries();
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = promptStackSources.map((source) => source.subscribe(listener));
      return () => { for (const stop of stops) stop(); };
    },
    [promptStackSources],
  );
  const inThread = useCallback(
    () => threadId !== null && promptStackSources.some((source) => source.get(threadId).includes(entry)),
    [entry, promptStackSources, threadId],
  );
  const hiddenHere = useSyncExternalStore(subscribe, inThread, inThread);
  return promptStack.has(entry) || hiddenHere;
}

export function useForkChildThreads<Section extends { items: readonly { hasPendingInteraction: boolean }[] }>(
  section: Section | null,
  threadId: string | null,
): Section | null {
  const hidden = useForkPromptStackHidden("active-child-threads", threadId);
  return useMemo(() => {
    if (!hidden || section === null) return section;
    const items = section.items.filter((item) => item.hasPendingInteraction);
    return items.length === section.items.length ? section : { ...section, items };
  }, [hidden, section]);
}

export const ForkThreadContextElsewhere = createContext(false);

export function useForkThreadContextRowHidden(threadId: string | null): boolean {
  const hidden = useForkPromptStackHidden("thread-context", threadId);
  const elsewhere = useContext(ForkThreadContextElsewhere);
  return hidden && !elsewhere;
}
