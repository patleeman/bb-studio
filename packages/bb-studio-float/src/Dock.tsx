// The panel of floated tabs, docked at the bottom right or wherever it was
// dragged, and a corner at the bottom right for other plugins (Studio Chat's
// "Work with this…" bar), and the gestures that move Studio items around.
import { floatWindowKey, publishFloatDock, setFloatHost } from "@bb-studio/kit/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { FLOAT_RIGHT_VAR } from "@bb-studio/kit/contract";
import { useEffect, useState } from "react";
import { getFloat, update, useFloatState } from "./store";
import { navigateTab, openTab } from "./stack";
import { ItemGestures } from "./ItemMenu";
import { Stack, useWidth } from "./Panel";

/** Lets every plugin open tabs. */
function useHost() {
  const navigate = useBbNavigate();
  useEffect(() => {
    setFloatHost({
      open: (target, options) => {
        update((state) => openTab(state, target, options));
        // BB shows one live view of a thread: floating the thread open in the
        // main view moves it, and the main view goes back to its project.
        const shown = /^\/projects\/([^/]+)\/threads\/([^/?#]+)/u.exec(window.location.pathname);
        if (target.kind === "thread" && !options?.minimized && shown && decodeURIComponent(shown[2]!) === target.threadId) {
          navigate.toProject(decodeURIComponent(shown[1]!));
        }
        const key = floatWindowKey(target);
        if (!options?.minimized && getFloat().tabs.some((tab) => tab.key === key && tab.placement === "main")) {
          navigate.toPluginPanel("companions", { subPath: key });
        }
      },
      navigate: (windowKey, target) => update((state) => navigateTab(state, windowKey, target)),
    });
    return () => setFloatHost(null);
  }, [navigate]);
}

export function Dock() {
  useHost();
  const state = useFloatState();
  const [corner, setCorner] = useState<HTMLDivElement | null>(null);
  const cornerWidth = useWidth(corner);

  useEffect(() => {
    publishFloatDock(corner);
    return () => publishFloatDock(null);
  }, [corner]);

  return (
    <>
      <div
        ref={setCorner}
        data-float-occupied={!state.hidden && state.tabs.length > 0}
        className="float-corner pointer-events-none fixed bottom-0 z-40 flex items-end empty:hidden"
        style={{ right: `var(${FLOAT_RIGHT_VAR}, 1.5rem)` }}
      />
      <ItemGestures />
      <Stack state={state} dockOffset={cornerWidth ? cornerWidth + 8 : 0} />
    </>
  );
}
