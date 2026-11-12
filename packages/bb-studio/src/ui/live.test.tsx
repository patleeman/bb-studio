// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, expectTypeOf, it, vi } from "vitest";
import { useCall, useLive } from "./live";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
const realtime = vi.hoisted(() => ({ listeners: new Set<() => void>(), connection: "connected" }));
vi.mock("@get-bb/plugin-sdk/app", async () => {
  const { useEffect } = await import("react");
  return { useRealtimeConnectionState: () => realtime.connection, useRpc: () => rpc, useRealtime: (_channel: string, handler: () => void) => {
    useEffect(() => { realtime.listeners.add(handler); return () => { realtime.listeners.delete(handler); }; }, [handler]);
  } };
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

it("shares the initial load, one polling timer, and releases everything with the last reader", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const pending = deferred<unknown>();
  rpc.call.mockReset().mockReturnValueOnce(pending.promise).mockResolvedValue({ botId: "fresh" });
  let api!: ReturnType<typeof useLive<"bot_thread_owner">>;
  function Reader() { api = useLive("bot_thread_owner", { threadId: "shared" }, { pollMs: 1000 }); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<><Reader /><Reader /></>));
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => pending.resolve({ botId: "first" }));
    // Joining the pending request must not queue a second fetch.
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(api.data?.botId).toBe("first");
    await act(async () => vi.advanceTimersByTimeAsync(1250));
    expect(rpc.call).toHaveBeenCalledTimes(2);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    expect(realtime.listeners.size).toBe(0);
    await act(async () => root.render(<Reader />));
    // No idle cache or callback survives the last reader.
    expect(rpc.call).toHaveBeenCalledTimes(3);
  } finally { act(() => root.unmount()); vi.useRealTimers(); }
});

it("disabled readers do not subscribe or load, and abandoned responses cannot populate a new entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const pending = deferred<unknown>();
  rpc.call.mockReset().mockReturnValueOnce(pending.promise).mockResolvedValue({ botId: "new" });
  let api!: ReturnType<typeof useLive<"bot_thread_owner">>;
  function Reader({ enabled }: { enabled: boolean }) { api = useLive("bot_thread_owner", { threadId: "abandoned" }, { enabled }); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Reader enabled={false} />));
    expect(rpc.call).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => root.render(<Reader enabled />));
    await act(async () => root.render(null));
    await act(async () => root.render(<Reader enabled />));
    expect(api.data?.botId).toBe("new");
    await act(async () => pending.resolve({ botId: "old" }));
    expect(api.data?.botId).toBe("new");
  } finally { act(() => root.unmount()); vi.useRealTimers(); }
});

// Checked by tsc; this function is never rendered or invoked.
function contractTypes() {
  const live = useLive("bot_thread_owner", { threadId: "thread" });
  expectTypeOf(live.data).toEqualTypeOf<{ botId: string | null } | null>();
  // @ts-expect-error unknown method
  useLive("missing_method", {});
  // @ts-expect-error wrong input for method
  useLive("bot_thread_owner", { projectId: "project" });
  // @ts-expect-error callers cannot choose a response shape
  useLive<{ invented: boolean }>("bot_get", {});
  const call = useCall();
  // @ts-expect-error missing thread id
  void call("bot_thread_owner", {});
}
void contractTypes;


it("refreshes runner create, update and delete signals, and reconciles missed signals on reconnect", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let runners: { id: string; name: string }[] = [];
  rpc.call.mockReset().mockImplementation(async () => ({ runners, adoptable: [] }));
  let api!: ReturnType<typeof useLive<"bot_runners">>;
  function Reader() { api = useLive("bot_runners", { botId: "runner-refresh" }, { pollMs: 0 }); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Reader />));
    expect(api.data?.runners).toEqual([]);
    for (const next of [[{ id: "security", name: "Security" }], [{ id: "security", name: "Security audit" }], []]) {
      runners = next;
      await act(async () => { for (const listener of realtime.listeners) listener(); await vi.advanceTimersByTimeAsync(250); });
      expect(api.data?.runners).toEqual(next);
    }
    realtime.connection = "reconnecting";
    await act(async () => root.render(<Reader />));
    runners = [{ id: "missed", name: "Created while disconnected" }];
    realtime.connection = "connected";
    await act(async () => { root.render(<Reader />); });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(api.data?.runners).toEqual(runners);
  } finally { act(() => root.unmount()); realtime.connection = "connected"; vi.useRealTimers(); }
});
