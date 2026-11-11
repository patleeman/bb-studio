import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { isBareWindow } from "@/lib/fork-bare-window";
import { useForkTooltipDismiss } from "@/lib/fork-tooltip-dismiss";
import { usePluginSlots } from "@/lib/plugin-slots";

export function ForkMainHeader() {
  useForkTooltipDismiss();
  const headers = [...(usePluginSlots().mainHeaders ?? [])].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
  );
  if (isBareWindow()) return null;
  return (
    <>
      {headers.map((header) => (
        <PluginSlotMount
          key={`${header.pluginId}/${header.id}/${header.generation}`}
          pluginId={header.pluginId}
          slotKind="mainHeader"
          slotId={header.id}
          crashFallback={null}
        >
          <div
            data-fork-main-header={`${header.pluginId}/${header.id}`}
            className="min-w-0 shrink-0"
          >
            <header.component />
          </div>
        </PluginSlotMount>
      ))}
    </>
  );
}
