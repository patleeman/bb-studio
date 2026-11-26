import { useMemo } from "react";
import { useLocation, type NavigateFunction } from "react-router-dom";
import type { useStore } from "jotai";
import type { ExperimentalAppRoute, ForkBbNavigate } from "@get-bb/plugin-sdk";
import { resolveRouteHref } from "@/lib/route-paths";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import { paneContentForPathname } from "@/views/thread-detail/splitThreadNavigation";
import { renamePluginTabs } from "./fork-tab-titles";
import { closePluginFixedTab } from "./fork-plugin-global-tabs";
import { popOutAppPath } from "./fork-bare-window";
import { workbenchFor } from "./fork-workbench";

interface ForkNavigateDeps {
  navigate: NavigateFunction;
  onNavigate: (() => void) | null;
  store: ReturnType<typeof useStore>;
  isCompact: boolean;
}

export function useAppRoute(): ExperimentalAppRoute {
  const { pathname, search, hash } = useLocation();
  return useMemo(() => ({ pathname, search, hash }), [pathname, search, hash]);
}

export function createForkNavigate(
  pluginId: string,
  latest: () => ForkNavigateDeps,
): ForkBbNavigate {
  return {
    experimental_toAppPath(path, options) {
      if (!path.startsWith("/")) return false;
      const route = resolveRouteHref({
        currentOrigin: window.location.origin,
        href: path,
      });
      if (route === null) return false;
      const { isCompact, navigate, onNavigate, store } = latest();
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
  };
}
