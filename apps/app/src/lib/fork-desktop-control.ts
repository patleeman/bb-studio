import { useCallback, useEffect, useState } from "react";
import type {
  ExperimentalDesktopControl,
  ExperimentalDesktopControlRequest,
  ExperimentalDesktopControlState,
} from "@get-bb/plugin-sdk";
import type { BbDesktopApi } from "@bb/desktop-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

type DesktopControlBridge = NonNullable<
  BbDesktopApi["experimental_desktopControl"]
>;
export type ForkDesktopControlState = Awaited<
  ReturnType<DesktopControlBridge["request"]>
>;
export type ForkDesktopControlRequest = Parameters<
  DesktopControlBridge["request"]
>[0];

let shared: ForkDesktopControlState | null = null;
const listeners = new Set<(state: ForkDesktopControlState) => void>();
let unsubscribe: (() => void) | null = null;

function bridge() {
  return getBbDesktopInfo()?.experimental_desktopControl ?? null;
}

function publish(state: ForkDesktopControlState): void {
  shared = state;
  for (const listener of listeners) listener(state);
}

function listen(
  listener: (state: ForkDesktopControlState) => void,
): () => void {
  const desktop = bridge();
  listeners.add(listener);
  if (desktop !== null && unsubscribe === null) {
    unsubscribe = desktop.subscribe(publish);
    void desktop.request({ op: "state" }).then(publish, () => {});
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

export async function requestDesktopControl(
  request: ForkDesktopControlRequest,
): Promise<ForkDesktopControlState | null> {
  const desktop = bridge();
  if (desktop === null) return null;
  const state = await desktop.request(request);
  publish(state);
  return state;
}

export function useDesktopControlState(): ForkDesktopControlState | null {
  const [state, setState] = useState<ForkDesktopControlState | null>(shared);
  useEffect(() => listen(setState), []);
  return state;
}

export function usePluginDesktopControl(): ExperimentalDesktopControl {
  const state = useDesktopControlState();
  const request = useCallback(
    (next: ExperimentalDesktopControlRequest) =>
      requestDesktopControl(
        next as ForkDesktopControlRequest,
      ) as Promise<ExperimentalDesktopControlState | null>,
    [],
  );
  return {
    native: bridge() !== null,
    state: state as ExperimentalDesktopControlState | null,
    request,
  };
}
