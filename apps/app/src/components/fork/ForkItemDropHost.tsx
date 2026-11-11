import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useRouteState } from "@/hooks/useRouteState";
import { lookupCachedThread } from "@/lib/cached-thread";
import {
  installItemDropHost,
  insertComposerMention,
  insertComposerText,
  insertComposerThreadMention,
  ITEM_DROP_ATTRIBUTE,
  threadIdOfElement,
  type ItemDropPane,
} from "@/lib/fork-item-drag";
import { openTabSpecIn, tabDropOutcome } from "@/lib/fork-tab-move";
import { usePluginSlots } from "@/lib/plugin-slots";
import { listPanes } from "@/lib/split-layout";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";

const ITEM_DROP_STYLE = `[${ITEM_DROP_ATTRIBUTE}="over"] { outline: 2px solid var(--ring); outline-offset: -2px; }`;

export function ForkItemDropHost({ threadId }: { threadId?: string }) {
  const handlers = usePluginSlots().itemDrops;
  const routeState = useRouteState();
  const routeThreadId = threadId ?? routeState.threadId ?? null;
  const layout = useAtomValue(splitLayoutAtom);
  const queryClient = useQueryClient();
  const panes = useMemo<ItemDropPane[]>(
    () =>
      layout === null || threadId !== undefined
        ? []
        : listPanes(layout.root).map((pane) => ({
            id: pane.paneId,
            threadId:
              pane.content.kind === "thread" ? pane.content.threadId : null,
            focused: pane.paneId === layout.focusedPaneId,
          })),
    [layout, threadId],
  );
  const latest = useRef({ handlers, panes, routeThreadId });
  useLayoutEffect(() => {
    latest.current = { handlers, panes, routeThreadId };
  });
  useEffect(() => {
    const threadIdOf = (element: HTMLElement) =>
      threadIdOfElement(
        element,
        latest.current.panes,
        latest.current.routeThreadId,
      );
    return installItemDropHost(document, {
      handlers: () => latest.current.handlers,
      threadIdOf,
      openInPanel: (element, pluginId, spec, options) => {
        const panelThreadId = threadIdOf(element);
        return panelThreadId === null
          ? Promise.resolve(null)
          : openTabSpecIn(pluginId, panelThreadId, spec, options);
      },
      tabDrop: (item, zone, commit) =>
        tabDropOutcome(item, zone, commit, threadIdOf),
      insertText: insertComposerText,
      insertMention: insertComposerMention,
      insertThreadMention: (composerThreadId, pluginId, thread) => {
        const projectId = lookupCachedThread(queryClient, thread.id)?.projectId;
        return insertComposerThreadMention(composerThreadId, pluginId, {
          ...thread,
          ...(projectId === undefined ? {} : { projectId }),
        });
      },
    });
  }, [queryClient]);
  return <style>{ITEM_DROP_STYLE}</style>;
}
