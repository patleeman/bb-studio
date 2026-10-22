// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useOverview } from "./use-overview";

const state = vi.hoisted(() => ({ changed: () => {} }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRealtime: (_channel: string, handler: () => void) => { state.changed = handler; } }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const overview = (title: string) => ({ providers: [], tags: [], views: [], items: [{ pluginId: "pages", id: "a", title }] });

it("serializes full and delta loads so a slow full response cannot replace a newer change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const full = deferred<unknown>();
  let cursor = 1;
  const call = vi.fn(async (method: string) => {
    if (method === "overview") return full.promise;
    if (method === "changes") return { cursor, reset: false, changes: cursor === 2 ? [{ pluginId: "pages", id: "a", removed: false }] : [] };
    if (method === "items") return { items: overview("Newest").items };
    throw new Error(method);
  });
  const rpc = { call };
  let api!: ReturnType<typeof useOverview>;
  function Probe() { api = useOverview(rpc as never); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe />));
    cursor = 2;
    await act(async () => { state.changed(); await vi.advanceTimersByTimeAsync(300); });
    // The delta waits for the full read, rather than publishing concurrently.
    expect(call).not.toHaveBeenCalledWith("items", expect.anything());
    await act(async () => full.resolve(overview("Old")));
    expect(api.data?.items[0]?.title).toBe("Newest");
    expect(call).toHaveBeenCalledWith("changes", { since: 1 });
    expect(call).toHaveBeenCalledWith("items", { pluginId: "pages", ids: ["a"] });
  } finally { act(() => root.unmount()); vi.useRealTimers(); }
});
