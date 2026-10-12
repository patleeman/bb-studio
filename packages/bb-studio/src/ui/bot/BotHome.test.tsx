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
vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: ({ threadId }: { threadId: string }) => React.createElement("div", { "data-chat": threadId }),
}));
vi.mock("./Onboarding", () => ({
  Greeting: ({ lines, onStarter }: { lines: string[]; onStarter(starter: unknown): void }) => React.createElement("div", null, lines.join(" "),
    React.createElement("button", { onClick: () => onStarter({ kind: "customize" }) }, "Customize me")),
  Composer: ({ onSend }: { onSend(text: string): void }) => React.createElement("button", { "aria-label": "Send", onClick: () => onSend("") }),
}));
vi.mock("@bb-studio/kit/app", () => ({
  PageColumn: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  openAppPath: vi.fn(), DANGER_BUTTON: "", GHOST_BUTTON: "", ICON_BUTTON: "", OUTLINE_BUTTON: "", PRIMARY_BUTTON: "",
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
  DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect(): void }) => React.createElement("button", { onClick: onSelect }, children),
}));

const { ActivityPanel, BOT_PATH, BotHome, BotRedirect } = await import("./BotHome");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
/** Renders and lets the lazily loaded chat arrive. */
const show = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === label)!;

const click = (el: Element | null | undefined) => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
const thread = (id: string, title: string) => ({ id, title, status: "idle", projectId: "p", updatedAt: 1, relation: "started" as const, needsYou: false });
const empty = { needsYou: [], inProgress: [], waiting: [], scheduled: [], completed: [], latest: null };
const dot = { id: "bot_main", name: "Dot", avatar: "🟣", shape: "blob", color: "#5b8def", state: "active", threadId: "thr_bot", createdAt: 1, updatedAt: 1 };

test("with no Bot, greets as one; Customize edits the draft and the first message makes it", async () => {
  state.data = { bot_get: { bot: null, run: null } };
  await show(<BotHome />);
  expect(container.textContent).toContain("Hey! I'm your bot.");
  act(() => button("Customize me").click());
  const name = container.querySelector('input[aria-label="Bot name"]') as HTMLInputElement;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Penny"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => click(container.querySelector('[aria-label="Shape hexagon"]')));
  act(() => button("Save").click());
  expect(container.querySelector("h1")?.textContent).toBe("Penny");
  await act(async () => click(container.querySelector('[aria-label="Send"]')));
  expect(state.call).toHaveBeenCalledWith("bot_create", { name: "Penny", avatar: "🤖", shape: "hexagon", color: "#5b8def" });
});

test("Studio's old Bot address redirects to the Bot's own panel", async () => {
  const { openAppPath } = await import("@bb-studio/kit/app");
  act(() => root.render(<BotRedirect />));
  expect(BOT_PATH).toBe("/plugins/studio/bot");
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot", { replace: true });
});

test("Activity: one quiet line when all is empty, sections only when non-empty, the recent few completed", () => {
  act(() => root.render(<ActivityPanel loading={false} data={empty} />));
  expect(container.textContent).toBe("Nothing going on right now.");
  expect(container.querySelector("section")).toBeNull();
  const completed = ["a", "b", "c", "d", "e"].map((id) => thread(id, `Done ${id}`));
  act(() => root.render(<ActivityPanel loading={false} data={{ ...empty, waiting: [thread("w", "Friday digest")], completed }} />));
  expect(container.textContent).toContain("Friday digest");
  expect([...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"))).toEqual(["Waiting to start", "Recent"]);
  expect(container.textContent).not.toContain("Done d");
  act(() => button("Show all 5").click());
  expect(container.textContent).toContain("Done e");
});

test("Activity is a side panel, closed until opened, then remembered", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty };
  await show(<BotHome />);
  expect(container.querySelector('aside[aria-label="Activity"]')).toBeNull();
  act(() => click(container.querySelector('[aria-label="Show activity"]')));
  expect(container.querySelector('aside[aria-label="Activity"]')).not.toBeNull();
  expect(localStorage.getItem("studio.bot.activity")).toBe("open");
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, needsYou: [{ ...thread("t1", "Approve deploy"), needsYou: true }] } };
  await show(<BotHome key="again" />);
  expect(container.querySelector('aside[aria-label="Activity"] section[aria-label="Needs you"]')?.textContent).toContain("Approve deploy");
});

test("shows the Bot's chat and status, and confirms Stop", async () => {
  state.data = {
    bot_get: { bot: { ...dot, name: "Chief of Staff" }, run: { enabled: true, cadence: "daily", time: "09:00" } },
    bot_activity: { ...empty, inProgress: [thread("t2", "Research flights")] },
  };
  await show(<BotHome />);
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("thr_bot");
  expect(container.querySelector("[data-testid=bot-status]")?.textContent).toBe("Working on 1 thread");
  act(() => button("Stop…").click());
  expect(container.textContent).toContain("the 1 running thread it started stop");
  await act(async () => click([...container.querySelectorAll("[role=dialog] button")].find((each) => each.textContent === "Stop")));
  expect(state.call).toHaveBeenCalledWith("bot_stop", {});
});

test("Edit profile saves shape, color and role; Skills (Share/Delete) live under Advanced; Memory opens its page", async () => {
  vi.stubGlobal("confirm", () => true);
  state.data = {
    bot_get: { bot: { ...dot, memoryPageId: "pg_mem" }, run: null },
    bot_activity: empty,
    bot_skills: { skills: [{ name: "weekly-review", description: "Fridays: sum up the week", updatedAt: 1 }] },
  };
  act(() => root.render(<BotHome />));
  const { openAppPath } = await import("@bb-studio/kit/app");
  await act(async () => button("Memory").click());
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/pages/pg_mem");
  act(() => button("Skills…").click());
  expect(container.textContent).toContain("weekly-review");
  await act(async () => button("Share").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_share", { name: "weekly-review" });
  await act(async () => button("Delete").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_delete", { name: "weekly-review" });
  act(() => click(container.querySelector('[aria-label="Shape star"]')));
  act(() => click(container.querySelector('[aria-label="Color #e5484d"]')));
  const role = container.querySelector('textarea[aria-label="Role"]') as HTMLTextAreaElement;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(role, "You are my chief of staff."); role.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Save").click());
  expect(state.call).toHaveBeenCalledWith("bot_set", { shape: "star", color: "#e5484d", role: "You are my chief of staff." });
});

test("BB's thread view shows the current thread; Earlier conversation opens the one it handed off from", async () => {
  const { openAppPath } = await import("@bb-studio/kit/app");
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty, bot_chain: { threadIds: ["thr_old", "thr_bot"] } };
  await show(<BotHome />);
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("thr_bot");
  act(() => button("Earlier conversation").click());
  expect(openAppPath).toHaveBeenCalledWith("/threads/thr_old");
});

test("Needs you banner: only for threads the Bot started, not its own (ThreadChat shows that inline)", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, needsYou: [{ ...thread("thr_bot", "Its chat"), relation: "self", needsYou: true }] } };
  await show(<BotHome />);
  expect(container.querySelector('[role=status][aria-label="Needs you"]')).toBeNull();
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, needsYou: [{ ...thread("t1", "Approve deploy"), needsYou: true }] } };
  await show(<BotHome key="again" />);
  expect(container.querySelector('[role=status][aria-label="Needs you"]')?.textContent).toContain("Approve deploy");
});

test("Check-ins offers presets, marks the current one, and applies one in a click", async () => {
  state.data = { bot_get: { bot: dot, run: { enabled: true, cadence: "weekdays", time: "08:00" } }, bot_activity: empty };
  await show(<BotHome />);
  act(() => button("Check-ins…").click());
  const presets = [...container.querySelectorAll('[role=radiogroup][aria-label="Check-in preset"] [role=radio]')];
  expect(presets.map((each) => each.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
  await act(async () => click(presets[1]));
  expect(state.call).toHaveBeenCalledWith("bot_checkin_preset", { preset: "evening" });
});
