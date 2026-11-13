import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { usePluginSlots } from "@/lib/plugin-slots";
import { TAB_WINDOW_ID, TAB_WINDOW_OWNER } from "@/lib/fork-tab-popout";
import { ForkTabWindow } from "./ForkTabWindow";
import { DESKTOP_OVERLAY_WINDOW_ID, ForkDesktopOverlay } from "./ForkDesktopOverlay";

export const FORK_WINDOW_ROUTE_PATH = "/fork-window/:pluginId/:windowId";

export function ForkWindowView() {
  const { pluginId, windowId } = useParams();
  if (pluginId === TAB_WINDOW_OWNER && windowId === DESKTOP_OVERLAY_WINDOW_ID) {
    return <DesktopOverlayWindow />;
  }
  return pluginId === TAB_WINDOW_OWNER && windowId === TAB_WINDOW_ID ? (
    <ForkTabWindow />
  ) : (
    <PluginWindowView pluginId={pluginId} windowId={windowId} />
  );
}

function useTransparentPage(transparent: boolean) {
  useEffect(() => {
    if (!transparent) return;
    const targets = [document.documentElement, document.body];
    const previous = targets.map((target) => target.style.background);
    for (const target of targets) target.style.background = "transparent";
    return () => {
      targets.forEach((target, index) => {
        target.style.background = previous[index] ?? "";
      });
    };
  }, [transparent]);
}

function DesktopOverlayWindow() {
  useTransparentPage(true);
  return <ForkDesktopOverlay />;
}

function PluginWindowView({
  pluginId,
  windowId,
}: {
  pluginId: string | undefined;
  windowId: string | undefined;
}) {
  const [search] = useSearchParams();
  const transparent = search.get("bbTransparent") === "1";
  const slot = usePluginSlots().windows.find(
    (candidate) => candidate.pluginId === pluginId && candidate.id === windowId,
  );

  useEffect(() => {
    if (slot !== undefined) document.title = slot.title;
  }, [slot]);

  useTransparentPage(transparent);

  if (slot === undefined) return null;
  const Component = slot.component;
  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <div
        data-fork-window={`${slot.pluginId}/${slot.id}`}
        className="h-dvh w-dvw overflow-hidden"
      >
        <PluginSlotMount
          pluginId={slot.pluginId}
          slotKind="window"
          slotId={slot.id}
          crashFallback={null}
        >
          <Component />
        </PluginSlotMount>
      </div>
    </TooltipProvider>
  );
}
