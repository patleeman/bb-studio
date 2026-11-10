import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { usePluginSlots } from "@/lib/plugin-slots";

export const FORK_WINDOW_ROUTE_PATH = "/fork-window/:pluginId/:windowId";

export function ForkWindowView() {
  const { pluginId, windowId } = useParams();
  const [search] = useSearchParams();
  const transparent = search.get("bbTransparent") === "1";
  const slot = usePluginSlots().windows.find(
    (candidate) => candidate.pluginId === pluginId && candidate.id === windowId,
  );

  useEffect(() => {
    if (slot !== undefined) document.title = slot.title;
  }, [slot]);

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
