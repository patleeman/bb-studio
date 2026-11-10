import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAtomValue, useStore } from "jotai";
import type { ExperimentalAppPanes } from "@get-bb/plugin-sdk";
import { listPanes } from "@/lib/split-layout";
import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  closeSplitPane,
  focusSplitPane,
} from "@/views/thread-detail/splitPaneActions.fork";
import { paneContentRoute } from "@/views/thread-detail/splitThreadNavigation";

export function useAppPanes(): ExperimentalAppPanes {
  const layout = useAtomValue(splitLayoutAtom);
  const store = useStore();
  const navigate = useNavigate();
  const panes = useMemo(
    () =>
      layout === null
        ? []
        : listPanes(layout.root).map((pane) => ({
            id: pane.paneId,
            path: paneContentRoute(pane.content),
            focused: pane.paneId === layout.focusedPaneId,
          })),
    [layout],
  );
  const run = useCallback(
    (action: typeof focusSplitPane, paneId: string) =>
      action({
        store,
        navigate: (route, options) => {
          void navigate(route, options);
        },
        setMaximizedPaneId: (next) => store.set(maximizedPaneIdAtom, next),
        paneId,
      }),
    [navigate, store],
  );
  return useMemo(
    () => ({
      panes,
      focus: (paneId) => run(focusSplitPane, paneId),
      close: (paneId) => run(closeSplitPane, paneId),
    }),
    [panes, run],
  );
}
