// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, call: vi.fn(async () => ({})) }));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (method: string) => ({ data: state.data[method] ?? null, error: null, loading: false, refresh: () => {} }),
}));
vi.mock("../ProjectLeads", () => ({ HeartbeatFields: () => null, useHeartbeatForm: () => ({ input: () => ({}) }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ ThreadChat: ({ threadId }: { threadId: string }) => React.createElement("div", { "data-chat": threadId }) }));
vi.mock("@bb-studio/kit/app", () => ({
  Badge: ({ label }: { label: string }) => React.createElement("span", null, label),
  PageColumn: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  openAppPath: vi.fn(), DANGER_BUTTON: "", GHOST_BUTTON: "", OUTLINE_BUTTON: "", PRIMARY_BUTTON: "", SECTION_TITLE: "",
}));
vi.mock("@bb-studio/kit/ui", () => ({
  Icon: () => null,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement("input", props),
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => React.createElement("textarea", props),
  Dialog: ({ children }: { children: React.ReactNode }) => React.createElement("div", { role: "dialog" }, children),
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement("p", null, children),
}));

const { BotHome } = await import("./BotHome");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === label)!;

test("offers to create a Bot when there is none", async () => {
  state.data = { bot_get: { bot: null, run: null } };
  act(() => root.render(<BotHome />));
  expect(container.textContent).toContain("Create your bot");
  await act(async () => button("Start chat").click());
  expect(state.call).toHaveBeenCalledWith("bot_create", { name: "Bot", avatar: "🤖" });
});

test("shows the Bot's chat, Needs you and Activity, and confirms Stop", async () => {
  state.data = {
    bot_get: { bot: { id: "bot_main", name: "Chief of Staff", avatar: "🧭", state: "active", threadId: "thr_bot", createdAt: 1, updatedAt: 1 }, run: { enabled: true, cadence: "daily", time: "09:00" } },
    bot_activity: {
      needsYou: [{ id: "t1", title: "Approve deploy", status: "active", projectId: "p", updatedAt: 1, relation: "started", needsYou: true }],
      inProgress: [{ id: "t2", title: "Research flights", status: "active", projectId: "p", updatedAt: 1, relation: "started", needsYou: false }],
      scheduled: [{ id: "a1", kind: "heartbeat", name: "Check-in (heartbeat)", cron: "0 9 * * *", enabled: true, nextRunAt: null }],
      completed: [], latest: null,
    },
  };
  act(() => root.render(<BotHome />));
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("thr_bot");
  for (const text of ["Chief of Staff", "Active", "Approve deploy", "Research flights", "Check-in (heartbeat)"]) expect(container.textContent).toContain(text);
  act(() => button("Stop").click());
  expect(container.textContent).toContain("the 1 running thread it started stop");
  await act(async () => [...container.querySelectorAll("[role=dialog] button")].find((each) => each.textContent === "Stop")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(state.call).toHaveBeenCalledWith("bot_stop", {});
});

test("links its Memory page, lists its skills with Share and Delete, and shows Waiting to start", async () => {
  vi.stubGlobal("confirm", () => true);
  state.data = {
    bot_get: { bot: { id: "bot_main", name: "Dot", avatar: "🟣", state: "active", threadId: "thr_bot", memoryPageId: "pg_mem", createdAt: 1, updatedAt: 1 }, run: null },
    bot_activity: {
      needsYou: [], inProgress: [], scheduled: [], completed: [], latest: null,
      waiting: [{ id: "t3", title: "Friday digest", status: "idle", projectId: "p", updatedAt: 1, relation: "started", needsYou: false }],
    },
    bot_skills: { skills: [{ name: "weekly-review", description: "Fridays: sum up the week", updatedAt: 1 }] },
  };
  act(() => root.render(<BotHome />));
  for (const text of ["Waiting to start", "Friday digest", "Skills", "weekly-review", "Fridays: sum up the week"]) expect(container.textContent).toContain(text);
  const { openAppPath } = await import("@bb-studio/kit/app");
  await act(async () => button("Memory").click());
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/pages/pg_mem");
  await act(async () => button("Share").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_share", { name: "weekly-review" });
  await act(async () => button("Delete").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_delete", { name: "weekly-review" });
});
