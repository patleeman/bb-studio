import { QueryClientContext } from "@tanstack/react-query";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import type { PluginFirstRunSlot } from "@/lib/fork-slots";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import { usePluginSlots } from "@/lib/plugin-slots";

interface PluginListEntry {
  enabled: boolean;
  app: { bundle: unknown };
}

export type ForkFirstRunState = "wait" | PluginFirstRunSlot | null;

export function firstRunOwner(
  slots: readonly PluginFirstRunSlot[],
): PluginFirstRunSlot | null {
  return (
    [...slots].sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

export function useForkFirstRun(active: boolean): ForkFirstRunState {
  const settled = usePluginFrontendsSettled();
  const owner = firstRunOwner(usePluginSlots().firstRuns ?? []);
  const client = useContext(QueryClientContext);
  const subscribe = useCallback(
    (onChange: () => void) =>
      client?.getQueryCache().subscribe(onChange) ?? (() => {}),
    [client],
  );
  const plugins = useSyncExternalStore(subscribe, () =>
    client?.getQueryState<PluginListEntry[]>(pluginListQueryKey(true)),
  );
  if (!active) return null;
  if (owner !== null) return owner;
  if (plugins?.status === "pending") return "wait";
  const hasApps =
    plugins?.data?.some(
      (plugin) => plugin.enabled && plugin.app.bundle !== null,
    ) ?? false;
  return hasApps && !settled ? "wait" : null;
}

export function ForkFirstRun({
  state,
}: {
  state: Exclude<ForkFirstRunState, null>;
}) {
  const updateSettings = useUpdateGeneralSettings();
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    updateSettings.mutate(
      { onboardingCompletedAt: new Date().toISOString() },
      {
        onError: () => {
          finished.current = false;
        },
      },
    );
  }, [updateSettings]);
  const slot = state === "wait" ? null : state;
  const Component = slot?.component;
  useEffect(() => {
    if (slot !== null && Component === undefined) finish();
  }, [slot, Component, finish]);
  if (slot === null || Component === undefined) return null;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind="firstRun"
      slotId={slot.id}
      crashFallback={null}
      onCrash={finish}
    >
      <div
        data-fork-first-run={`${slot.pluginId}/${slot.id}`}
        className="flex h-dvh w-full flex-col bg-background"
      >
        <Component finish={finish} />
      </div>
    </PluginSlotMount>
  );
}
