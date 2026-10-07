// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import { sidebarHiddenThreadsAtom } from "../preferences/atoms.js";
import { resetPreferencesSyncForTest } from "../preferences/preferences-sync.js";
import type { SidebarProject } from "../model/use-sidebar-data.js";

const get = vi.hoisted(() => vi.fn());
vi.mock("@get-bb/plugin-sdk/app", async (actual) => ({
  ...(await actual<object>()),
  useSdk: () => ({ threads: { get } }),
}));

const { useHiddenThreads } = await import("./useHiddenThreads.js");

afterEach(() => {
  cleanup();
  resetPreferencesSyncForTest();
});

describe("useHiddenThreads", () => {
  it("prunes hidden ids of deleted threads, keeping archived ones and failed lookups", async () => {
    get.mockImplementation(async ({ threadId }: { threadId: string }) => {
      if (threadId === "thr_deleted") throw Object.assign(new Error("Thread not found"), { status: 404 });
      if (threadId === "thr_flaky") throw Object.assign(new Error("Server error"), { status: 500 });
      return { id: threadId, archivedAt: 1 };
    });
    const store = getDefaultStore();
    store.set(sidebarHiddenThreadsAtom, ["thr_active", "thr_deleted", "thr_archived", "thr_flaky"]);
    const projects = [{ id: "proj_a", threads: [makeSidebarThread({ id: "thr_active", projectId: "proj_a" })] }] as unknown as SidebarProject[];
    const sectionKeyOf = () => () => "threads";
    const keepIds = new Set<string>();
    renderHook(() => useHiddenThreads({ projects, sectionKeyOf, keepIds }));
    await waitFor(() => expect(store.get(sidebarHiddenThreadsAtom)).toEqual(["thr_active", "thr_archived", "thr_flaky"]));
    // Listed threads are never looked up.
    expect(get.mock.calls.map(([args]) => (args as { threadId: string }).threadId).sort()).toEqual(["thr_archived", "thr_deleted", "thr_flaky"]);
  });
});
