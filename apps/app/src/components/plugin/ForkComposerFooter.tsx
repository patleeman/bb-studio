import { useMemo, useSyncExternalStore } from "react";
import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import {
  EMPTY_PLUGIN_SLOT_SNAPSHOT,
  getPluginSlotSnapshot,
  subscribePluginSlots,
  type PluginComposerCustomizationSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

type ComposerFooterItem = NonNullable<
  PluginComposerCustomizationSlot["experimental_footer"]
>[number];

export interface ResolvedComposerFooterItem {
  key: string;
  pluginId: string;
  customizationId: string;
  item: ComposerFooterItem;
}

export function resolveComposerFooter(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly ResolvedComposerFooterItem[] {
  const resolved: ResolvedComposerFooterItem[] = [];
  for (const customization of customizations) {
    if (
      customization.scopes !== undefined &&
      !customization.scopes.includes(scopeKind)
    ) {
      continue;
    }
    for (const item of customization.experimental_footer ?? []) {
      resolved.push({
        key: [
          customization.pluginId,
          customization.generation,
          customization.id,
          item.id,
        ].join("/"),
        pluginId: customization.pluginId,
        customizationId: customization.id,
        item,
      });
    }
  }
  return resolved;
}

function useResolvedComposerFooter(
  scopeKind: PluginComposerScope["kind"] | null,
): readonly ResolvedComposerFooterItem[] {
  const customizations = useSyncExternalStore(
    subscribePluginSlots,
    () => getPluginSlotSnapshot().composerCustomizations,
    () => EMPTY_PLUGIN_SLOT_SNAPSHOT.composerCustomizations,
  );
  return useMemo(
    () =>
      scopeKind === null
        ? []
        : resolveComposerFooter(customizations, scopeKind),
    [customizations, scopeKind],
  );
}

export function PluginComposerFooter({
  scope,
}: {
  scope: PluginComposerScope | null;
}) {
  const items = useResolvedComposerFooter(scope?.kind ?? null);
  return items.map(({ key, pluginId, customizationId, item }) => (
    <div
      key={key}
      data-plugin-composer-footer={`${pluginId}/${customizationId}/${item.id}`}
      className="flex max-h-6 min-w-0 shrink items-center overflow-hidden empty:hidden max-md:pointer-coarse:max-h-11"
    >
      <PluginSlotMount
        pluginId={pluginId}
        slotKind="composerFooter"
        slotId={`${customizationId}/${item.id}`}
        wrapRoot={false}
        crashFallback={<></>}
      >
        <item.component />
      </PluginSlotMount>
    </div>
  ));
}
