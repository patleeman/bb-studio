// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerCustomization } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { forkComposerArea } from "./ForkComposerReplace";

const readOnly = new Set<string>();
const listeners = new Set<() => void>();

function setReadOnly(threadId: string, value: boolean) {
  if (value) readOnly.add(threadId);
  else readOnly.delete(threadId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useReadOnly({ threadId }: { threadId: string }): boolean {
  return useSyncExternalStore(subscribe, () => readOnly.has(threadId));
}

function register(pluginId: string, customization: ComposerCustomization) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({ composerCustomizations: [customization] }),
  );
}

function Screen({ threadId }: { threadId: string }) {
  return <>{forkComposerArea(threadId, <textarea aria-label="Composer" />)}</>;
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  readOnly.clear();
  listeners.clear();
  vi.restoreAllMocks();
});

describe("composer replacement", () => {
  it("shows bb's composer while no plugin is active, and the replacement while one is", () => {
    register("studio", {
      id: "worker",
      scopes: ["thread"],
      experimental_replace: {
        useActive: useReadOnly,
        component: ({ threadId }) => <p>Ask the Bot about {threadId}</p>,
      },
    });
    const view = render(<Screen threadId="thr_a" />);
    expect(screen.getByLabelText("Composer")).toBeTruthy();

    act(() => setReadOnly("thr_a", true));
    expect(screen.queryByLabelText("Composer")).toBeNull();
    expect(screen.getByText("Ask the Bot about thr_a")).toBeTruthy();

    view.rerender(<Screen threadId="thr_b" />);
    expect(screen.getByLabelText("Composer")).toBeTruthy();
    expect(screen.queryByText(/Ask the Bot/)).toBeNull();

    act(() => setReadOnly("thr_a", false));
    view.rerender(<Screen threadId="thr_a" />);
    expect(screen.getByLabelText("Composer")).toBeTruthy();
  });

  it("ignores customizations that do not apply to the thread scope", () => {
    register("studio", {
      id: "compose",
      scopes: ["new-thread"],
      experimental_replace: {
        useActive: () => true,
        component: () => <p>Replaced</p>,
      },
    });
    render(<Screen threadId="thr_a" />);
    expect(screen.getByLabelText("Composer")).toBeTruthy();
    expect(screen.queryByText("Replaced")).toBeNull();
  });

  it("picks the first active plugin by id", () => {
    register("zeta", {
      id: "z",
      experimental_replace: {
        useActive: () => true,
        component: () => <p>Zeta</p>,
      },
    });
    register("alpha", {
      id: "a",
      experimental_replace: {
        useActive: () => true,
        component: () => <p>Alpha</p>,
      },
    });
    render(<Screen threadId="thr_a" />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Zeta")).toBeNull();
  });

  it("keeps bb's composer when useActive throws or the replacement crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    register("broken-hook", {
      id: "b",
      experimental_replace: {
        useActive: () => {
          throw new Error("hook failed");
        },
        component: () => <p>Never</p>,
      },
    });
    const view = render(<Screen threadId="thr_a" />);
    expect(screen.getByLabelText("Composer")).toBeTruthy();
    expect(screen.queryByText("Never")).toBeNull();
    view.unmount();

    resetPluginSlotStoreForTest();
    register("broken-view", {
      id: "c",
      experimental_replace: {
        useActive: () => true,
        component: () => {
          throw new Error("view failed");
        },
      },
    });
    render(<Screen threadId="thr_a" />);
    expect(screen.getByLabelText("Composer")).toBeTruthy();
  });

  it("renders nothing when the thread has no composer", () => {
    expect(forkComposerArea("thr_a", null)).toBeNull();
  });
});
