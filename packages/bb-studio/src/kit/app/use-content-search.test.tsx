// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useContentSearch } from "./use-content-search";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
afterEach(() => { vi.useRealTimers(); });
it("clears old query matches, exposes failure and retries without accepting late responses", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const old = deferred<ReadonlyMap<string, string | null>>();
  const next = deferred<ReadonlyMap<string, string | null>>();
  const search = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise).mockResolvedValue(new Map([["new", "retry result"]]));
  let state!: ReturnType<typeof useContentSearch>;
  function Probe({ query }: { query: string }) { state = useContentSearch(query, search); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe query="first" />));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => old.resolve(new Map([["old", "first result"]])));
  expect(state.matches.has("old")).toBe(true);
  await act(async () => root.render(<Probe query="second" />));
  expect(state.matches.size).toBe(0);
  expect(state.loading).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => next.reject(new Error("offline")));
  expect(state.error).toBe("offline");
  expect(state.matches.size).toBe(0);
  await act(async () => state.retry());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(state.matches.get("new")).toBe("retry result");
  expect(state.error).toBeNull();
  act(() => root.unmount());
});

it("ignores successes and errors from a superseded search or an unmounted view", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const old = deferred<ReadonlyMap<string, string | null>>();
  const next = deferred<ReadonlyMap<string, string | null>>();
  const search = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  let state!: ReturnType<typeof useContentSearch>;
  function Probe({ query }: { query: string }) { state = useContentSearch(query, search); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe query="first" />));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => root.render(<Probe query="second" />));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => next.resolve(new Map([["new", "second result"]])));
  await act(async () => old.reject(new Error("old failure")));
  expect(state.matches.get("new")).toBe("second result");
  expect(state.error).toBeNull();
  act(() => root.unmount());
});
