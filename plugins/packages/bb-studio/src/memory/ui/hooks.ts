// The Memory view's data: one RPC result per input, refetched when Studio
// says something changed (STUDIO_REALTIME_CHANNEL, which every memory write
// publishes) and when the window reconnects.
import { useRealtime, useRealtimeConnectionState, useRpc, type PluginRpcCallArgs, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { STUDIO_REALTIME_CHANNEL } from "../../kit/contract";
import { errorMessage } from "../../kit/format";
import type { MemoryRpcContract } from "../contract";

export type MemoryMethod = keyof MemoryRpcContract;
export type MemoryInput<M extends MemoryMethod> = PluginRpcCallArgs<MemoryRpcContract[M]>[0];
export type MemoryResult<M extends MemoryMethod> = PluginRpcResult<MemoryRpcContract[M]>;

export function useMemoryCall(): <M extends MemoryMethod>(method: M, input: MemoryInput<M>) => Promise<MemoryResult<M>> {
  // Stable across renders, so a fetch keyed on it runs once per input.
  const client = useRpc<MemoryRpcContract>();
  const rpc = useRef(client);
  rpc.current = client;
  return useCallback((method, input) => rpc.current.call(method, ...([input] as PluginRpcCallArgs<MemoryRpcContract[typeof method]>)), []);
}

/** A method's result for `input`: the last good data stays while a refetch runs or fails. */
export function useMemory<M extends MemoryMethod>(method: M, input: MemoryInput<M>, enabled = true): { data: MemoryResult<M> | null; error: string | null; refresh(): void } {
  const call = useMemoryCall();
  const key = JSON.stringify(input ?? null);
  const [state, setState] = useState<{ key: string; data: MemoryResult<M> | null; error: string | null }>({ key, data: null, error: null });
  const generation = useRef(0);
  const refresh = useCallback(() => {
    if (!enabled) return;
    const mine = ++generation.current;
    call(method, JSON.parse(key) as MemoryInput<M>).then(
      (data) => { if (mine === generation.current) setState({ key, data, error: null }); },
      (cause: unknown) => { if (mine === generation.current) setState((prev) => ({ key, data: prev.key === key ? prev.data : null, error: errorMessage(cause) })); },
    );
  }, [call, method, key, enabled]);
  useEffect(() => { refresh(); }, [refresh]);
  useRealtime(STUDIO_REALTIME_CHANNEL, refresh);
  const connection = useRealtimeConnectionState();
  const was = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && was.current !== "connected") refresh();
    was.current = connection;
  }, [connection, refresh]);
  // A new input shows the previous list until its own answer comes, so typing doesn't flash empty.
  return { data: state.data, error: state.error, refresh };
}
