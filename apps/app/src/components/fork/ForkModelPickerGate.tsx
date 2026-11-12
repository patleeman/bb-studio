import type { ReactNode } from "react";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import type { PluginModelPickerGateSlot } from "@/lib/fork-slots";
import { usePluginSlots } from "@/lib/plugin-slots";

export function modelPickerGateOwner(
  slots: readonly PluginModelPickerGateSlot[],
): PluginModelPickerGateSlot | null {
  return (
    [...slots].sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

function ForkModelPickerGate({
  hasSelectedModel,
  children,
}: {
  hasSelectedModel: boolean;
  children: ReactNode;
}) {
  const gate = modelPickerGateOwner(usePluginSlots().modelPickerGates ?? []);
  if (gate === null) return <>{children}</>;
  return (
    <PluginSlotMount
      pluginId={gate.pluginId}
      slotKind="modelPickerGate"
      slotId={gate.id}
      crashFallback={children}
      wrapRoot={false}
    >
      <gate.component hasSelectedModel={hasSelectedModel}>
        {children}
      </gate.component>
    </PluginSlotMount>
  );
}

export function forkModelPickerGate(
  picker: ReactNode,
  args: { hasSelectedModel: boolean },
): ReactNode {
  return (
    <ForkModelPickerGate hasSelectedModel={args.hasSelectedModel}>
      {picker}
    </ForkModelPickerGate>
  );
}
