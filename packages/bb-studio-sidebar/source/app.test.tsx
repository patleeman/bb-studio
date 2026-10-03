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
    sdk: { plugins: { callRpc: ({ method }: { method: string }) => sdkResult(method === "teams_threadBots" ? [] : { automations: [] })() } },
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
  resetPreferencesSyncForTest();
  setPreferencesMirrorStorageForTest(undefined);
});

describe("thread-list plugin", () => {
  it.each(["project", "chronological", "machine"] as const)("collapses bot and automation threads in %s mode", async (organizationMode) => {
    renderList({ organizationMode }, {
      sidebarThreads: { projects: PROJECTS, sections: SECTIONS, threads: [
        ...THREADS,
        makeSidebarThread({ id: "thr_bot", projectId: "proj_app", title: "Atlas scheduled work", originPluginId: "bot-teams" }),
        makeSidebarThread({ id: "thr_run", projectId: "proj_web", title: "Daily digest", originPluginId: "automations" }),
      ] },
    });
    await screen.findByRole("button", { name: "Expand Background section" });
    expect(threadIds()).not.toContain("thr_bot");
    expect(threadIds()).not.toContain("thr_run");
    fireEvent.click(screen.getByRole("button", { name: "Expand Background section" }));
    await screen.findByText("Atlas scheduled work");
    expect(threadIds().filter((id) => id === "thr_bot")).toHaveLength(1);
    expect(threadIds().filter((id) => id === "thr_run")).toHaveLength(1);
    expect(threadIds()).toContain("thr_pinned");
  });

  it("identifies existing bot and automation targets through their public RPCs", async () => {
    renderList({ organizationMode: "project" }, {
      sdk: { plugins: { callRpc: ({ method }: { method: string }) => sdkResult(method === "teams_threadBots"
        ? [{ threadId: "thr_parent" }]
        : { automations: [{ automation: { execution: { targetThreadId: "thr_later" } } }] })() } },
    });
    await screen.findByRole("button", { name: "Expand Background section" });
    expect(threadIds()).not.toContain("thr_parent");
    expect(threadIds()).not.toContain("thr_child");
    expect(threadIds()).not.toContain("thr_later");
    fireEvent.click(screen.getByRole("button", { name: "Expand Background section" }));
    await screen.findByText("Parent thread");
    expect(threadIds()).toContain("thr_child");
    expect(threadIds()).toContain("thr_later");
  });

  it.each(["updates", "hidden", "all"] as const)("applies background visibility: %s", async (backgroundThreads) => {
    renderList({ organizationMode: "project", backgroundThreads, backgroundCollapsed: false }, {
      sidebarThreads: { projects: PROJECTS, sections: [], threads: [
        makeSidebarThread({ id: "thr_read", projectId: "proj_app", title: "Read digest", originPluginId: "automations", isUnread: false }),
        makeSidebarThread({ id: "thr_unread", projectId: "proj_app", title: "New digest", originPluginId: "automations" }),
        makeSidebarThread({ id: "thr_normal", projectId: "proj_web", title: "My work", isUnread: false }),
      ] },
    });
    await screen.findByText("My work");
    if (backgroundThreads === "hidden") {
      expect(threadIds()).toEqual(["thr_normal"]);
      expect(sectionHeaders()).not.toContain("Background");
    } else if (backgroundThreads === "updates") {
      await screen.findByText("New digest");
      expect(threadIds()).not.toContain("thr_read");
      expect(sectionHeaders()).toContain("Background");
    } else {
      await screen.findByText("Read digest");
      expect(threadIds()).toContain("thr_unread");
      expect(sectionHeaders()).not.toContain("Background");
    }
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
