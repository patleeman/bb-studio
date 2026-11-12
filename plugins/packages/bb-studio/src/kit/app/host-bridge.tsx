// Connects Studio's route, navigation and pane helpers to BB's own hooks
// where the running BB has them (host-sdk.ts). On a BB without them this
// renders nothing, and route.ts and nav.ts keep their fallbacks.
import { useEffect, useLayoutEffect } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { setHostPanes } from "./host-panes";
import { toAppPathOf, useHostAppPanes, useHostAppRoute, useHostAppTheme } from "./host-sdk";
import { setHostTheme } from "./host-theme";
import { setHostNavigator } from "./nav";
import { setHostPathname } from "./route";

export function HostRouteBridge() {
  return <>
    {useHostAppRoute ? <RouteBridge useAppRoute={useHostAppRoute} /> : null}
    {useHostAppPanes ? <PanesBridge useAppPanes={useHostAppPanes} /> : null}
    {useHostAppTheme ? <ThemeBridge useAppTheme={useHostAppTheme} /> : null}
  </>;
}

function ThemeBridge({ useAppTheme }: { useAppTheme: NonNullable<typeof useHostAppTheme> }) {
  const { mode, epoch } = useAppTheme();
  useLayoutEffect(() => { setHostTheme({ mode, epoch }); }, [mode, epoch]);
  useLayoutEffect(() => () => setHostTheme(null), []);
  return null;
}

function RouteBridge({ useAppRoute }: { useAppRoute: NonNullable<typeof useHostAppRoute> }) {
  const { pathname } = useAppRoute();
  const navigate = useBbNavigate();
  useLayoutEffect(() => { setHostPathname(pathname); }, [pathname]);
  // A layout cleanup, so a remount's new path isn't cleared after it is set.
  useLayoutEffect(() => () => setHostPathname(null), []);
  useEffect(() => {
    setHostNavigator(toAppPathOf(navigate));
    return () => setHostNavigator(null);
  }, [navigate]);
  return null;
}

function PanesBridge({ useAppPanes }: { useAppPanes: NonNullable<typeof useHostAppPanes> }) {
  const panes = useAppPanes();
  useLayoutEffect(() => { setHostPanes(panes); }, [panes]);
  useLayoutEffect(() => () => setHostPanes(null), []);
  return null;
}
