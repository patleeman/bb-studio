import { useCallback, useContext, useMemo, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "jotai";
import type {
  BbNavigate,
  ExperimentalAppRoute,
  ForkBbNavigate,
} from "@get-bb/plugin-sdk";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { RouteNavigationCallbackContext } from "@/components/ui/app-route-anchor";
import { resolveRouteHref } from "@/lib/route-paths";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import { paneContentForPathname } from "@/views/thread-detail/splitThreadNavigation";
import { renamePluginTabs } from "./fork-tab-titles";
import { closePluginFixedTab } from "./fork-plugin-global-tabs";
import { popOutAppPath } from "./fork-bare-window";
import { workbenchFor } from "./fork-workbench";

export function useAppRoute(): ExperimentalAppRoute {
  const { pathname, search, hash } = useLocation();
  return useMemo(() => ({ pathname, search, hash }), [pathname, search, hash]);
}

export function useForkNavigate(pluginId: string): ForkBbNavigate {
  const onNavigate = useContext(RouteNavigationCallbackContext);
  const navigate = useNavigate();
  const store = useStore();
  const isCompact = useIsCompactViewport();
  const experimental_toAppPath = useCallback<
    ForkBbNavigate["experimental_toAppPath"]
  >(
    (path, options) => {
      if (!path.startsWith("/")) return false;
      const route = resolveRouteHref({
        currentOrigin: window.location.origin,
        href: path,
      });
      if (route === null) return false;
      onNavigate?.();
      const content = options?.split
        ? paneContentForPathname(route.path.split(/[?#]/)[0] ?? route.path)
        : null;
      if (content !== null) {
        openPaneContentInSplit({
          store,
          navigate: (target, navigateOptions) => {
            void navigate(target, navigateOptions);
          },
          content,
          route: route.path,
          enabled: !isCompact,
        });
        return true;
      }
      void navigate(
        route.path,
        options?.replace ? { replace: true } : undefined,
      );
      return true;
    },
    [isCompact, navigate, onNavigate, store],
  );
  return useMemo<ForkBbNavigate>(
    () => ({
      experimental_toAppPath,
      experimental_popOut: popOutAppPath,
      experimental_workbench: (threadId) => workbenchFor(pluginId, threadId),
      experimental_renameTab: (options) =>
        renamePluginTabs(pluginId, {
          tabId: options.tab.id,
          title: options.title,
          ...(options.params === undefined ? {} : { params: options.params }),
        }),
      experimental_closeFixedTab: (options) =>
        closePluginFixedTab(pluginId, {
          tabId: options.tab.id,
          ...(options.params === undefined ? {} : { params: options.params }),
        }),
    }),
    [experimental_toAppPath, pluginId],
  );
}

export function forkLatestNavigate(
  latest: RefObject<BbNavigate>,
): ForkBbNavigate {
  return {
    experimental_toAppPath: (...args) =>
      latest.current.experimental_toAppPath(...args),
    experimental_renameTab: (...args) =>
      latest.current.experimental_renameTab(...args),
    experimental_popOut: (...args) =>
      latest.current.experimental_popOut(...args),
    experimental_workbench: (...args) =>
      latest.current.experimental_workbench(...args),
    experimental_closeFixedTab: (...args) =>
      latest.current.experimental_closeFixedTab(...args),
  };
}
