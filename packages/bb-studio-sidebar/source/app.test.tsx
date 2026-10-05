// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSection, setSectionHidden } from "../../bb-studio-kit/src/app/sidebar-registry.js";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import {
  loadPluginApp,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import { makePluginProject, makeSidebarThread, sdkResult } from "./app/testing/fixtures.js";
import {
  resetPreferencesSyncForTest,
  setPreferencesMirrorStorageForTest,
} from "./app/preferences/preferences-sync.js";
import { getDefaultStore } from "jotai";
import { studioSpacesAtom } from "./app/studio/studioSpaces.js";
import { resetCommandInstalledForTest } from "./app/studio/SpaceModeSections.js";
import {
  defaultPreferences,
  type PreferenceValues,
} from "./shared/preferences.js";

const app = await loadPluginApp(() => import("./app"));
const registration = app.threadLists[0];
if (!registration) throw new Error("thread-list slot not registered");

const PERSONAL_PROJECT_ID = "proj_personal";

const PROJECTS = [
  makePluginProject({
    id: PERSONAL_PROJECT_ID,
    name: "Personal",
    isPersonal: true,
  }),
  makePluginProject({ id: "proj_app", name: "App" }),
  makePluginProject({ id: "proj_web", name: "Web" }),
];

const SECTIONS = [
  { id: "sec_later", name: "Later", createdAt: 1, updatedAt: 1 },
  { id: "sec_review", name: "Review", createdAt: 2, updatedAt: 2 },
];

const THREADS = [
  makeSidebarThread({
    id: "thr_pinned",
    projectId: "proj_app",
    title: "Pinned thread",
    isPinned: true,
    pinnedAt: 10,
    pinSortKey: "a",
    createdAt: 10,
    updatedAt: 10,
    latestAttentionAt: 10,
  }),
  makeSidebarThread({
    id: "thr_parent",
    projectId: "proj_app",
    title: "Parent thread",
    createdAt: 8,
    updatedAt: 8,
    latestAttentionAt: 8,
  }),
  makeSidebarThread({
    id: "thr_child",
    projectId: "proj_app",
    title: "Child thread",
    parentThreadId: "thr_parent",
    createdAt: 7,
    updatedAt: 7,
    latestAttentionAt: 7,
  }),
  makeSidebarThread({
    id: "thr_later",
    projectId: "proj_web",
    title: "Later thread",
    sectionId: "sec_later",
    createdAt: 6,
    updatedAt: 6,
    latestAttentionAt: 6,
    host: { id: "host_laptop", name: "Laptop" },
    environment: {
      id: "env_web",
      name: null,
      branchName: "main",
      path: null,
      providerId: null,
      isWorktree: false,
      workspaceDisplayKind: "other",
    },
  }),
  makeSidebarThread({
    id: "thr_personal",
    projectId: PERSONAL_PROJECT_ID,
    title: "Personal thread",
    createdAt: 5,
    updatedAt: 5,
    latestAttentionAt: 5,
  }),
];

function props(): PluginThreadListProps {
  return {
    activeThreadId: null,
    activeProjectId: null,
    isCompactViewport: false,
    onNavigate: vi.fn(),
    searchQuery: "",
  };
}

function renderList(
  preferences: Partial<PreferenceValues>,
  options: RenderSlotOptions = {},
) {
  return renderSlot(registration, props(), {
    sidebarThreads: {
      projects: PROJECTS,
      sections: SECTIONS,
      threads: THREADS,
    },
    rpc: {
      listPreferences: () => ({
        preferences: { ...defaultPreferences(), ...preferences },
      }),
      setPreference: (input: unknown) => input,
    },
    sdk: { plugins: { callRpc: () => sdkResult({})() } },
    ...options,
  });
}

function sectionHeaders(): string[] {
  return Array.from(
    document.querySelectorAll('[data-sidebar-sticky-tier="label"] [title]'),
    (element) => element.getAttribute("title") ?? "",
  );
}

function threadIds(): string[] {
  return Array.from(
    document.querySelectorAll("[data-sidebar-thread-id]"),
    (element) => element.getAttribute("data-sidebar-thread-id") ?? "",
  );
}

afterEach(() => {
  cleanup();
  getDefaultStore().set(studioSpacesAtom, { status: "loading" });
  resetCommandInstalledForTest();
  resetPreferencesSyncForTest();
  setPreferencesMirrorStorageForTest(undefined);
});

describe("thread-list plugin", () => {
  it("hides a thread from its row's menu, with Show and Unhide", async () => {
    const { rpcCalls } = renderList({ organizationMode: "project" });
    await screen.findByText("Later thread");
    const web = () => screen.getByTitle("Web").closest("[data-sidebar-sticky-group]") as HTMLElement;
    fireEvent.contextMenu(document.querySelector('[data-sidebar-thread-id="thr_later"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hide" }));
    await waitFor(() => expect(rpcCalls).toContainEqual({ method: "setPreference", input: { key: "hiddenThreads", value: ["thr_later"] } }));
    await waitFor(() => expect(threadIds()).not.toContain("thr_later"));
    expect(web().querySelector('[data-sidebar-hidden-threads="project:proj_web"]')?.textContent).toContain("1 hidden");
    fireEvent.click(within(web()).getByRole("button", { name: "Show 1 hidden" }));
    await screen.findByText("Later thread");
    expect(web().querySelector("[data-sidebar-hidden-threads]")?.textContent).toContain("Showing 1 hidden");
    fireEvent.contextMenu(document.querySelector('[data-sidebar-thread-id="thr_later"]')!);
    expect(await screen.findByRole("menuitem", { name: "Unhide" })).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(within(web()).getByRole("button", { name: "Hide 1 hidden" }));
    await waitFor(() => expect(threadIds()).not.toContain("thr_later"));
  });

  it("hides stored hidden threads and their children, but never pinned ones", async () => {
    renderList({ organizationMode: "project", hiddenThreads: ["thr_parent", "thr_pinned", "thr_gone"] });
    await screen.findByText("Pinned thread");
    expect(threadIds()).not.toContain("thr_parent");
    expect(threadIds()).not.toContain("thr_child");
    const app = screen.getByTitle("App").closest("[data-sidebar-sticky-group]") as HTMLElement;
    expect(app.querySelector('[data-sidebar-hidden-threads="project:proj_app"]')?.textContent).toContain("2 hidden");
    expect(document.querySelector("[data-sidebar-hidden-threads=pinned]")).toBeNull();
  });

  it.each(["project", "chronological"] as const)("keeps Archive off a Space lead outside By space (%s)", async (organizationMode) => {
    const studioCalls: string[] = [];
    renderList({ organizationMode, rowActions: ["archive"] }, {
      sdk: { plugins: {
        callRpc: async ({ pluginId, method, input }: { pluginId: string; method: string; input?: unknown }) => {
          if (pluginId !== "studio") return {} as never;
          studioCalls.push(method);
          if (method === "spaces") return { spaces: [{ id: "sp_alpha", name: "Alpha", color: "#f00", icon: null, isDefault: true, defaultProjectId: null, projectIds: [] }] } as never;
          if (method === "space_lead") return { leadThreadId: (input as { spaceId: string }).spaceId === "sp_alpha" ? "thr_parent" : null, run: null } as never;
          return {} as never;
        },
      } },
    });
    await screen.findByText("Parent thread");
    const row = (id: string) => document.querySelector(`[data-sidebar-thread-id="${id}"]`)!.closest("[data-sidebar-rename-row]") as HTMLElement;
    await waitFor(() => expect(within(row("thr_parent")).queryByRole("button", { name: "Archive thread" })).toBeNull());
    expect(studioCalls).not.toContain("space_of_threads");
    expect(within(row("thr_later")).getByRole("button", { name: "Archive thread" })).not.toBeNull();
    fireEvent.contextMenu(document.querySelector('[data-sidebar-thread-id="thr_parent"]')!);
    expect(await screen.findByRole("menuitem", { name: "Hide" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.contextMenu(document.querySelector('[data-sidebar-thread-id="thr_later"]')!);
    expect(await screen.findByRole("menuitem", { name: "Archive" })).not.toBeNull();
  });

  it("shows one Space at a time, with its lead on top and dots to switch", async () => {
    localStorage.removeItem("bb-studio:sidebar-organization");
    const threads = [
      ...THREADS,
      makeSidebarThread({ id: "thr_lead", projectId: "proj_web", title: "Alpha lead", createdAt: 1, updatedAt: 1, latestAttentionAt: 1, isUnread: false }),
      makeSidebarThread({ id: "thr_ask", projectId: "proj_web", title: "Asks you", createdAt: 0, updatedAt: 0, latestAttentionAt: 0, isUnread: false, hasPendingInteraction: true }),
      makeSidebarThread({ id: "thr_busy", projectId: "proj_web", title: "Busy", createdAt: 0, updatedAt: 0, latestAttentionAt: 0, isUnread: false, status: "active" }),
    ];
    const studioCalls: { method: string; input: unknown }[] = [];
    const studio: Record<string, (input: unknown) => unknown> = {
      spaces: () => ({ spaces: [
        { id: "sp_alpha", name: "Alpha", color: "#f00", icon: "🚀", isDefault: true, defaultProjectId: "proj_web", projectIds: [], threadIds: [], itemKeys: [], pageId: null, description: "" },
        { id: "sp_beta", name: "Beta", color: "#00f", icon: null, isDefault: false, defaultProjectId: null, projectIds: [], threadIds: [], itemKeys: [], pageId: null, description: "" },
      ] }),
      space_of_threads: () => ({ threads: { thr_parent: "sp_alpha", thr_lead: "sp_alpha", thr_busy: "sp_alpha", thr_ask: "sp_beta", thr_later: "sp_beta", thr_personal: "sp_gone" } }),
      thread_lines: () => ({ lines: {
        thr_lead: { text: "Screenshot capture · 31 of 44", kind: "progress", at: 1 },
        thr_busy: { text: "Typecheck failed", kind: "failure", at: 1 },
        thr_ask: { text: "Fix the layout, or loosen the check?", kind: "blocked", at: 1 },
      } }),
      space_lead: (input) => ({ leadThreadId: (input as { spaceId: string }).spaceId === "sp_alpha" ? "thr_lead" : null, run: { enabled: true, cadence: "hourly", time: "09:00" } }),
      space_set_lead: () => ({ leadThreadId: null, run: null }),
      spaceTree: () => ({ spaces: [
        { id: "sp_alpha", itemCount: 1, open: [{ pluginId: "pages", id: "pg_1", title: "Launch plan", icon: null, kindIcon: "FileText", href: "/plugins/pages/pages/pg_1" }] },
        { id: "sp_beta", itemCount: 0, open: [] },
      ] }),
    };
    const { inspection, rpcCalls } = renderList({ organizationMode: "space" }, {
      sidebarThreads: { projects: PROJECTS, sections: SECTIONS, threads },
      sdk: { plugins: {
        list: async () => ({ plugins: [{ id: "studio", enabled: true, status: "running" }] }) as never,
        callRpc: async ({ pluginId, method, input }: { pluginId: string; method: string; input?: unknown }) => {
          if (pluginId !== "studio" || !studio[method]) return {} as never;
          studioCalls.push({ method, input });
          return studio[method]!(input) as never;
        },
      } },
    });
    // The default Space shows first; threads in no Space are its.
    await screen.findByTitle("Alpha");
    expect(sectionHeaders()).toEqual(["Pinned", "Alpha"]);
    expect(localStorage.getItem("bb-studio:sidebar-organization")).toBe("space");
    const alpha = () => screen.getByTitle("Alpha").closest("[data-sidebar-sticky-group]") as HTMLElement;
    expect(alpha().querySelector("[data-sidebar-space-mark]")?.textContent).toBe("🚀");
    const lead = alpha().querySelector("[data-space-lead=thr_lead]") as HTMLElement;
    expect(lead.textContent).toContain("heartbeat hourly");
    expect(Array.from(alpha().querySelectorAll("[data-sidebar-thread-id]"), (el) => el.getAttribute("data-sidebar-thread-id"))[0]).toBe("thr_lead");
    expect(within(alpha()).getByText("Personal thread")).not.toBeNull();
    expect(threadIds()).not.toContain("thr_later");
    // Two-line rows: a status dot, the title and its age, then the latest line, leads first.
    await waitFor(() => expect(lead.querySelector("[data-space-thread-line]")?.textContent).toBe("Screenshot capture · 31 of 44"));
    expect(studioCalls.find((call) => call.method === "thread_lines")?.input).toEqual({ threadIds: ["thr_lead", "thr_pinned", "thr_parent", "thr_child", "thr_personal", "thr_busy"] });
    const row = (id: string) => document.querySelector(`[data-sidebar-thread-id="${id}"]`)!.closest("[data-sidebar-rename-row]") as HTMLElement;
    expect(row("thr_busy").querySelector("[data-space-thread-line]")?.getAttribute("data-space-thread-line")).toBe("failure");
    expect(row("thr_busy").querySelector("[data-space-thread-line]")?.className).toContain("text-destructive");
    expect(row("thr_busy").querySelector("[data-space-thread-dot]")?.getAttribute("data-space-thread-dot")).toBe("working");
    expect(row("thr_parent").querySelector("[data-space-thread-dot]")?.getAttribute("data-space-thread-dot")).toBe("unread");
    expect(row("thr_parent").querySelector("[data-space-thread-line]")).toBeNull();
    expect(row("thr_parent").querySelector("[data-space-thread-time]")?.textContent).toMatch(/^(now|\d+(m|h|d|w|mo|y))$/);
    expect(row("thr_parent").querySelector("[data-sidebar-thread-trailing-indicator]")).toBeNull();
    // The heading is plain: ⋯ has the Space's actions.
    expect(screen.queryByRole("button", { name: "Open Alpha" })).toBeNull();
    const dialogs: unknown[] = [];
    const onDialog = (event: Event) => dialogs.push((event as CustomEvent).detail);
    window.addEventListener("studio:space-dialog", onDialog);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Alpha actions" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Space" }));
    window.removeEventListener("studio:space-dialog", onDialog);
    expect(dialogs).toEqual([{ spaceId: "sp_alpha", dialog: "edit" }]);
    // With Studio installed, ⋯ opens the Space's Command view.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Alpha actions" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Command view" }));
    expect(window.location.pathname).toBe("/plugins/studio/studio/command/sp_alpha");
    // So does the button beside ⋯ on the heading.
    window.history.pushState(null, "", "/");
    fireEvent.click(screen.getByRole("button", { name: "Command view for Alpha" }));
    expect(window.location.pathname).toBe("/plugins/studio/studio/command/sp_alpha");
    fireEvent.click(screen.getByRole("button", { name: "New thread in Alpha" }));
    expect(inspection.sidebarActionCalls).toContainEqual({ method: "openNewThread", options: { projectId: "proj_web", focusPrompt: true } });
    // An item opens in the main area (in place here, where BB can't split).
    fireEvent.click(within(alpha()).getByRole("link", { name: "Launch plan" }));
    expect(window.location.pathname).toBe("/plugins/pages/pages/pg_1");
    // Any thread can become the lead.
    fireEvent.contextMenu(document.querySelector('[data-sidebar-thread-id="thr_parent"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Make Space lead" }));
    expect(studioCalls).toContainEqual({ method: "space_set_lead", input: { spaceId: "sp_alpha", threadId: "thr_parent" } });
    await waitFor(() => expect(document.querySelector("[data-space-lead=thr_parent]")).not.toBeNull());
    // The dots switch Spaces; Beta's needs you, and that thread comes first.
    const switcher = screen.getByRole("navigation", { name: "Spaces" });
    fireEvent.click(within(switcher).getByRole("button", { name: "Beta, needs you" }));
    await screen.findByTitle("Beta");
    expect(sectionHeaders()).toEqual(["Pinned", "Beta"]);
    await waitFor(() => expect(rpcCalls).toContainEqual({ method: "setPreference", input: { key: "currentSpace", value: "sp_beta" } }));
    expect(threadIds().filter((id) => id !== "thr_pinned")).toEqual(["thr_ask", "thr_later"]);
    expect(document.querySelector('[data-sidebar-thread-id="thr_ask"]')?.parentElement?.querySelector("[data-sidebar-needs-you]")).not.toBeNull();
    expect(document.querySelectorAll("[data-sidebar-needs-you]")).toHaveLength(1);
    expect(screen.getByText("No items")).not.toBeNull();
    const created: Event[] = [];
    const onNew = (event: Event) => created.push(event);
    window.addEventListener("studio:new-space", onNew);
    fireEvent.click(within(switcher).getByRole("button", { name: "New Space" }));
    window.removeEventListener("studio:new-space", onNew);
    expect(created).toHaveLength(1);
    await waitFor(() => expect(document.querySelector('[data-sidebar-thread-id="thr_ask"]')!.closest("[data-sidebar-rename-row]")!.querySelector("[data-space-thread-line]")?.className).toContain("text-warning"));
    // ⌃⌥← / ⌃⌥→ step through All and the Spaces; All stacks every Space.
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true, altKey: true });
    await waitFor(() => expect(sectionHeaders()).toEqual(["Pinned", "Alpha", "Beta"]));
    await waitFor(() => expect(rpcCalls).toContainEqual({ method: "setPreference", input: { key: "currentSpace", value: "all" } }));
    expect(within(switcher).getByRole("button", { name: "All Spaces" }).getAttribute("aria-current")).toBe("true");
    const beta = () => screen.getByTitle("Beta").closest("[data-sidebar-sticky-group]") as HTMLElement;
    expect(beta().querySelector("[data-space-needs-you]")).not.toBeNull();
    expect(alpha().querySelector("[data-space-needs-you]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Beta section" }));
    await waitFor(() => expect(within(beta()).queryByText("Asks you")).toBeNull());
    await waitFor(() => expect(rpcCalls).toContainEqual({ method: "setPreference", input: { key: "collapsedSpaces", value: ["sp_beta"] } }));
    fireEvent.click(screen.getByRole("button", { name: "Expand Beta section" }));
    await within(beta()).findByText("Asks you");
    // Each Space's Studio and Threads fold away on their own.
    fireEvent.click(within(beta()).getByRole("button", { name: "Collapse Threads" }));
    await waitFor(() => expect(within(beta()).queryByText("Asks you")).toBeNull());
    await waitFor(() => expect(rpcCalls).toContainEqual({ method: "setPreference", input: { key: "collapsedSpaceSections", value: ["sp_beta:threads"] } }));
    fireEvent.click(within(beta()).getByRole("button", { name: "Collapse Studio" }));
    await waitFor(() => expect(within(beta()).queryByText("No items")).toBeNull());
    fireEvent.click(within(beta()).getByRole("button", { name: "Expand Threads" }));
    fireEvent.click(within(beta()).getByRole("button", { name: "Expand Studio" }));
    await within(beta()).findByText("Asks you");
    expect(within(beta()).getByText("No items")).not.toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true, altKey: true });
    await waitFor(() => expect(sectionHeaders()).toEqual(["Pinned", "Alpha"]));
  });

  it("keeps BB's one-line rows outside By space", async () => {
    renderList({ organizationMode: "chronological" });
    await screen.findByText("Parent thread");
    expect(document.querySelector("[data-space-thread-dot]")).toBeNull();
    expect(document.querySelector("[data-space-thread-time]")).toBeNull();
  });

  it("falls back to By project while Studio has no Spaces", async () => {
    renderList({ organizationMode: "space" });
    await screen.findByText("Pinned thread");
    expect(sectionHeaders()).toEqual(["Pinned", "App", "Web", "Threads"]);
    expect(localStorage.getItem("bb-studio:sidebar-organization")).toBe("project");
  });

  it("offers By space only with Studio's Spaces", async () => {
    renderList({ organizationMode: "project" });
    await screen.findByText("Pinned thread");
    fireEvent.keyDown(screen.getByRole("button", { name: /^Threads actions/ }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Organize" }), { key: "ArrowRight" });
    const bySpace = await screen.findByRole("menuitemradio", { name: /By space/ });
    expect(bySpace.getAttribute("aria-disabled")).toBe("true");
    expect(bySpace.textContent).toContain("Needs Studio with Spaces");
  });

  it("places Studio sections above threads and hides them when requested", async () => {
    const unregister = registerSection({ pluginId: "pages", id: "tabs", title: "Studio", order: 0 });
    try {
      renderList({ organizationMode: "project" });
      const anchor = await waitFor(() => document.querySelector('[data-studio-sidebar-anchor="pages:tabs"]'));
      expect(anchor).not.toBeNull();
      const sections = anchor?.closest('[data-studio-sidebar-sections]');
      const threads = document.querySelector('[data-sidebar-thread-id]');
      expect(sections!.compareDocumentPosition(threads!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      setSectionHidden("pages:tabs", true);
      await waitFor(() => expect(document.querySelector('[data-studio-sidebar-anchor="pages:tabs"]')).toBeNull());
    } finally {
      setSectionHidden("pages:tabs", false);
      unregister();
    }
  });
  it("shows the navigation skeleton until preferences load", () => {
    setPreferencesMirrorStorageForTest(null);
    renderSlot(registration, props(), {
      sidebarThreads: {
        projects: PROJECTS,
        sections: SECTIONS,
        threads: THREADS,
      },
      rpc: { listPreferences: () => new Promise(() => undefined) },
    });
    expect(screen.getByLabelText("Loading sidebar navigation")).not.toBeNull();
    expect(threadIds()).toEqual([]);
  });

  it("renders pinned, custom sections, and loose threads in chronological mode", async () => {
    setPreferencesMirrorStorageForTest(null);
    const { rpcCalls } = renderList({ organizationMode: "chronological" });

    await screen.findByText("Pinned thread");
    expect(rpcCalls.map((call) => call.method)).toEqual(["listPreferences"]);
    expect(sectionHeaders()).toEqual(["Pinned", "Later", "Review", "Threads"]);
    expect(threadIds()).toEqual([
      "thr_pinned",
      "thr_later",
      "thr_parent",
      "thr_child",
      "thr_personal",
    ]);
    expect(
      screen.getByRole("button", { name: "Collapse Parent thread threads" }),
    ).not.toBeNull();
  });

  it("groups pinned worktree roots when environment grouping is enabled", async () => {
    setPreferencesMirrorStorageForTest(null);
    const environment = {
      id: "env_review",
      name: "Reviewer worktree group",
      branchName: "review",
      path: null,
      providerId: null,
      isWorktree: true,
      workspaceDisplayKind: "managed-worktree" as const,
    };
    const pinnedWorktreeThreads = [
      makeSidebarThread({
        id: "thr_worktree_a",
        projectId: "proj_app",
        title: "Worktree root A",
        pinnedAt: 20,
        pinSortKey: "a",
        environment,
      }),
      makeSidebarThread({
        id: "thr_worktree_b",
        projectId: "proj_app",
        title: "Worktree root B",
        pinnedAt: 19,
        pinSortKey: "b",
        environment,
      }),
    ];
    renderList(
      {
        organizationMode: "chronological",
        environmentGrouping: true,
      },
      {
        sidebarThreads: {
          projects: PROJECTS,
          sections: SECTIONS,
          threads: [...THREADS, ...pinnedWorktreeThreads],
        },
      },
    );

    const environmentGroup = (
      await screen.findByText("Reviewer worktree group")
    ).closest("[data-sidebar-sticky-group]");
    expect(environmentGroup).not.toBeNull();
    expect(
      within(environmentGroup as HTMLElement).getByText("Worktree root A"),
    ).not.toBeNull();
    expect(
      within(environmentGroup as HTMLElement).getByText("Worktree root B"),
    ).not.toBeNull();
  });

  it("groups threads by machine in machine mode", async () => {
    setPreferencesMirrorStorageForTest(null);
    renderList({ organizationMode: "machine" });

    await screen.findByText("Pinned thread");
    expect(sectionHeaders()).toEqual(["Pinned", "Laptop", "No machine"]);
    const laptop = screen
      .getByTitle("Laptop")
      .closest("[data-sidebar-sticky-group]");
    expect(laptop).not.toBeNull();
    expect(
      within(laptop as HTMLElement).getByText("Later thread"),
    ).not.toBeNull();
    const noMachine = screen
      .getByTitle("No machine")
      .closest("[data-sidebar-sticky-group]");
    expect(
      within(noMachine as HTMLElement).getByText("Personal thread"),
    ).not.toBeNull();
  });

  it("opens the composer on the machine named by its section", async () => {
    setPreferencesMirrorStorageForTest(null);
    const { inspection } = renderList({ organizationMode: "machine" });

    fireEvent.click(
      await screen.findByRole("button", { name: "New thread in Laptop" }),
    );

    expect(inspection.sidebarActionCalls).toContainEqual({
      method: "openNewThread",
      options: {
        projectId: PERSONAL_PROJECT_ID,
        hostId: "host_laptop",
        focusPrompt: true,
      },
    });
  });

  it("shows a machine section before it has any threads", async () => {
    setPreferencesMirrorStorageForTest(null);
    renderList(
      { organizationMode: "machine" },
      {
        sidebarThreads: {
          projects: PROJECTS,
          sections: SECTIONS,
          threads: THREADS,
          experimental_hosts: [
            { id: "host_laptop", name: "Laptop" },
            { id: "host_empty", name: "Studio Mac" },
          ],
        },
      },
    );

    await screen.findByText("Pinned thread");
    expect(sectionHeaders()).toEqual([
      "Pinned",
      "Laptop",
      "Studio Mac",
      "No machine",
    ]);
  });

  it("opens the New project dialog from Threads", async () => {
    setPreferencesMirrorStorageForTest(null);
    renderList({ organizationMode: "project" }, {
      sdk: {
        hosts: { list: async () => ([{ id: "host_laptop", name: "Laptop", status: "connected" }] as never) },
        system: { config: async () => ({ primaryHostId: "host_laptop" } as never) },
      },
    });
    await screen.findByText("Pinned thread");
    fireEvent.keyDown(screen.getByRole("button", { name: /^Threads actions/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "New project" }));
    expect(await screen.findByRole("dialog", { name: "New project" })).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Folder path" })).not.toBeNull();
  });

  it("groups threads by project in project mode", async () => {
    setPreferencesMirrorStorageForTest(null);
    renderList({ organizationMode: "project" });

    await screen.findByText("Pinned thread");
    expect(sectionHeaders()).toEqual(["Pinned", "App", "Web", "Threads"]);
    const appGroup = screen
      .getByTitle("App")
      .closest("[data-sidebar-sticky-group]") as HTMLElement;
    expect(within(appGroup).getByText("Parent thread")).not.toBeNull();
    expect(within(appGroup).getByText("Child thread")).not.toBeNull();
    const webGroup = screen
      .getByTitle("Web")
      .closest("[data-sidebar-sticky-group]") as HTMLElement;
    expect(within(webGroup).getByText("Later thread")).not.toBeNull();
    const threadsGroup = screen
      .getByTitle("Threads")
      .closest("[data-sidebar-sticky-group]") as HTMLElement;
    expect(within(threadsGroup).getByText("Personal thread")).not.toBeNull();
  });

  it("keys its slot and preferences mirror by its own plugin id", async () => {
    window.localStorage.clear();
    expect(registration.id).toBe("thread-list");
    renderList({ organizationMode: "machine" }, { pluginId: "thread-list" });

    await screen.findByText("Pinned thread");
    expect(
      JSON.parse(
        window.localStorage.getItem("bb.thread-list.preferences.v1") ?? "{}",
      ).organizationMode,
    ).toBe("machine");
    window.localStorage.clear();
  });

  it.each([true, false])(
    "renders personal rows once with standard projects: %s",
    async (includeStandardProjects) => {
      setPreferencesMirrorStorageForTest(null);
      renderList(
        { organizationMode: "project" },
        {
          sidebarThreads: {
            projects: includeStandardProjects
              ? PROJECTS
              : PROJECTS.filter((project) => project.isPersonal),
            sections: [],
            threads: THREADS.filter(
              (thread) => thread.projectId === PERSONAL_PROJECT_ID,
            ),
          },
        },
      );

      await screen.findByTitle("Threads");
      expect(threadIds()).toEqual(["thr_personal"]);
      expect(sectionHeaders()).toEqual(
        includeStandardProjects ? ["App", "Web", "Threads"] : ["Threads"],
      );
    },
  );

  it("calls onNavigate when a thread row is opened", async () => {
    setPreferencesMirrorStorageForTest(null);
    const listProps = props();
    renderSlot(registration, listProps, {
      sidebarThreads: {
        projects: PROJECTS,
        sections: SECTIONS,
        threads: THREADS,
      },
      rpc: {
        listPreferences: () => ({
          preferences: {
            ...defaultPreferences(),
            organizationMode: "chronological",
          },
        }),
      },
    });
    const link = await screen.findByRole("link", {
      name: "Open Personal thread",
    });
    link.click();
    await waitFor(() => expect(listProps.onNavigate).toHaveBeenCalledOnce());
  });
});
