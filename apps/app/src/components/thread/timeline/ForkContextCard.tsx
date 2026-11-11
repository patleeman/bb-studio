import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ExperimentalContextCard } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import type { PluginContextCardRowSlot } from "@/lib/fork-slots";
import { getPluginSlotSnapshot, usePluginSlots } from "@/lib/plugin-slots";

let requestedOpen = false;
let mountedIndicators = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasForkContextCardRows(): boolean {
  return getPluginSlotSnapshot().contextCardRows.length > 0;
}

export function useForkContextCardOpen(): {
  open: boolean;
  wrap(handler: (open: boolean) => void): (open: boolean) => void;
} {
  const open = useSyncExternalStore(
    subscribe,
    () => requestedOpen,
    () => false,
  );
  useEffect(() => {
    mountedIndicators += 1;
    emit();
    return () => {
      mountedIndicators -= 1;
      requestedOpen = false;
      emit();
    };
  }, []);
  return useMemo(
    () => ({
      open,
      wrap: (handler) => (next) => {
        if (!next && requestedOpen) {
          requestedOpen = false;
          emit();
        }
        handler(next);
      },
    }),
    [open],
  );
}

export function usePluginContextCard(): ExperimentalContextCard {
  const available = useSyncExternalStore(
    subscribe,
    () => mountedIndicators > 0,
    () => false,
  );
  return useMemo(
    () => ({
      available,
      open: () => {
        if (mountedIndicators === 0) return;
        requestedOpen = true;
        emit();
      },
    }),
    [available],
  );
}

function ForkContextCardRow({ slot }: { slot: PluginContextCardRowSlot }) {
  const row = slot.useRow();
  const [busy, setBusy] = useState<string | null>(null);
  if (row === null) return null;
  return (
    <div
      className="order-4 flex flex-col gap-1 border-t border-border-hairline pt-2"
      data-fork-context-row={`${slot.pluginId}/${slot.id}`}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs max-md:pointer-coarse:text-sm">
        <span className="text-muted-foreground">{row.label}</span>
        <span className="font-medium tabular-nums text-muted-foreground">
          {row.value}
        </span>
      </div>
      {row.note ? (
        <p className="text-xs text-muted-foreground max-md:pointer-coarse:text-sm">
          {row.note}
        </p>
      ) : null}
      {row.actions && row.actions.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
          {row.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={busy !== null}
              className="cursor-pointer rounded-xs text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 max-md:pointer-coarse:text-sm"
              onClick={() => {
                setBusy(action.id);
                void Promise.resolve()
                  .then(() => action.run())
                  .catch((error: unknown) => {
                    console.warn(
                      `[plugin:${slot.pluginId}] context card action "${action.id}" failed`,
                      error,
                    );
                  })
                  .finally(() => setBusy(null));
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ForkContextCardRows() {
  const { contextCardRows } = usePluginSlots();
  if (contextCardRows.length === 0) return null;
  return (
    <>
      {contextCardRows.map((slot) => (
        <PluginSlotMount
          key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
          pluginId={slot.pluginId}
          slotKind="contextCardRow"
          slotId={slot.id}
          crashFallback={null}
        >
          <ForkContextCardRow slot={slot} />
        </PluginSlotMount>
      ))}
    </>
  );
}
