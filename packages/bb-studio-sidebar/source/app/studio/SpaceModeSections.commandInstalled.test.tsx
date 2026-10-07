// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  let studio = false;
  const listeners: ((event: { changes: string[] }) => void)[] = [];
  return {
    setStudio: (value: boolean) => { studio = value; },
    emit: (event: { changes: string[] }) => listeners.forEach((listener) => listener(event)),
    value: {
      plugins: { list: vi.fn(async () => ({ plugins: studio ? [{ id: "studio", enabled: true, status: "running" }] : [] })) },
      subscribe: ({ callback }: { callback: (event: { changes: string[] }) => void }) => {
        listeners.push(callback);
        return () => listeners.splice(listeners.indexOf(callback), 1);
      },
    },
  };
});
vi.mock("@get-bb/plugin-sdk/app", async (actual) => ({
  ...(await actual<object>()),
  useSdk: () => sdk.value,
}));

const { resetCommandInstalledForTest, useCommandInstalled } = await import("./SpaceModeSections.js");

afterEach(() => {
  cleanup();
  resetCommandInstalledForTest();
});

describe("useCommandInstalled", () => {
  it("notices Studio installed after the first check when BB's plugins change", async () => {
    sdk.setStudio(false);
    const { result } = renderHook(() => useCommandInstalled());
    await waitFor(() => expect(sdk.value.plugins.list).toHaveBeenCalled());
    expect(result.current).toBe(false);
    sdk.setStudio(true);
    act(() => sdk.emit({ changes: ["config-changed"] }));
    expect(result.current).toBe(false);
    act(() => sdk.emit({ changes: ["plugins-changed"] }));
    await waitFor(() => expect(result.current).toBe(true));
  });
});
