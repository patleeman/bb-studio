// The panel of floated tabs, docked at the bottom right or wherever it was
// dragged, and a corner at the bottom right for other plugins (Studio Chat's
// "Work with this…" bar).
import { publishFloatDock, setFloatHost } from "@bb-studio/kit/app";
import { FLOAT_RIGHT_VAR, STUDIO_CHAT_FLOAT_EVENT } from "@bb-studio/kit/contract";
import { useEffect, useState } from "react";
import { update, useFloatState } from "./store";
import { openTab } from "./stack";
import { Stack, useWidth } from "./Panel";

/** Lets every plugin open tabs, and answers Studio Chat's older event. */
function useHost() {
  useEffect(() => {
    setFloatHost({ open: (target, options) => update((state) => openTab(state, target, options)) });
    const onLegacyFloat = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId;
      if (typeof threadId === "string" && threadId) update((state) => openTab(state, { kind: "thread", threadId }));
    };
    window.addEventListener(STUDIO_CHAT_FLOAT_EVENT, onLegacyFloat);
    return () => {
      setFloatHost(null);
      window.removeEventListener(STUDIO_CHAT_FLOAT_EVENT, onLegacyFloat);
    };
  }, []);
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
        className="float-corner pointer-events-none fixed bottom-0 z-40 flex items-end empty:hidden"
        style={{ right: `var(${FLOAT_RIGHT_VAR}, 1.5rem)` }}
      />
      {state.hidden ? null : <Stack state={state} dockOffset={cornerWidth ? cornerWidth + 8 : 0} />}
    </>
  );
}
