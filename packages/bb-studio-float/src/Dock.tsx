// The panel of floated tabs, docked at the bottom right or wherever it was
// dragged, and a corner at the bottom right for other plugins (Studio Chat's
// "Work with this…" bar), and the gestures that move Studio items around.
import { floatWindowKey, publishFloatDock, setFloatHost } from "@bb-studio/kit/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { FLOAT_RIGHT_VAR, STUDIO_CHAT_FLOAT_EVENT } from "@bb-studio/kit/contract";
import { useEffect, useState } from "react";
import { getFloat, update, useFloatState } from "./store";
import { navigateTab, openTab } from "./stack";
import { ItemGestures } from "./ItemMenu";
import { Stack, useWidth } from "./Panel";

/** Lets every plugin open tabs, and answers Studio Chat's older event. */
function useHost() {
  const navigate = useBbNavigate();
  useEffect(() => {
    setFloatHost({
      open: (target, options) => {
        update((state) => openTab(state, target, options));
        const key = floatWindowKey(target);
        if (!options?.minimized && getFloat().tabs.some((tab) => tab.key === key && tab.placement === "main")) {
          navigate.toPluginPanel("companions", { subPath: key });
        }
      },
      navigate: (windowKey, target) => update((state) => navigateTab(state, windowKey, target)),
    });
    const onLegacyFloat = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId;
      if (typeof threadId === "string" && threadId) update((state) => openTab(state, { kind: "thread", threadId }));
    };
    window.addEventListener(STUDIO_CHAT_FLOAT_EVENT, onLegacyFloat);
    return () => {
      setFloatHost(null);
      window.removeEventListener(STUDIO_CHAT_FLOAT_EVENT, onLegacyFloat);
    };
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
