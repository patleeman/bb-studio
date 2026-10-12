// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const at = new Date(2026, 9, 11, 9).getTime();
const sdk = vi.hoisted(() => ({
  threads: {
    timeline: vi.fn(),
    get: vi.fn(),
    send: vi.fn(async () => ({})),
    stop: vi.fn(async () => ({})),
    interactions: { list: vi.fn(), resolve: vi.fn(async () => ({})), respond: vi.fn(async () => ({})) },
  },
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk, Markdown: ({ content }: { content: string }) => React.createElement("div", { "data-md": "" }, content) }));
vi.mock("@bb-studio/kit/app", () => ({ openAppPath: vi.fn() }));
vi.mock("@bb-studio/kit/ui", () => ({ Icon: () => null }));

const { default: BotChat } = await import("./BotChat");
const bot = { name: "Dot", avatar: "🟣", shape: "blob", color: "#5b8def" };
const page = (rows: unknown[]) => ({ rows, timelinePage: { olderCursor: null, hasOlderRows: false } });

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const fn of [sdk.threads.timeline, sdk.threads.get, sdk.threads.send, sdk.threads.interactions.list, sdk.threads.interactions.resolve]) fn.mockClear();
  sdk.threads.get.mockResolvedValue({ status: "idle" });
  sdk.threads.interactions.list.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const show = async (props: Partial<React.ComponentProps<typeof BotChat>> = {}) => {
  await act(async () => root.render(<BotChat threadIds={["thr_bot"]} bot={bot} childStatus={new Map()} needsYou={[]} onStarter={() => {}} {...props} />));
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === label || each.getAttribute("aria-label") === label)!;

test("draws bubbles, the Bot's replies, one Working line and child-thread cards", async () => {
  sdk.threads.timeline.mockResolvedValue(page([
    { kind: "conversation", role: "user", initiator: "user", id: "u1", text: "Plan my week", createdAt: at },
    { kind: "work", workKind: "tool", id: "t1", toolName: "pages_read", status: "completed", createdAt: at },
    { kind: "work", workKind: "tool", id: "t2", toolName: "thread_spawn", toolArgs: { title: "Book flights" }, output: "thr_child123", status: "completed", createdAt: at },
    { kind: "conversation", role: "assistant", id: "a1", text: 'Here is your week.\n\n::next{reply="👍 Looks good"}', createdAt: at },
  ]));
  await show({ childStatus: new Map([["thr_child123", "finished"]]) });
  expect(sdk.subscribe).toHaveBeenCalledWith(expect.objectContaining({ event: "thread:changed", threadId: "thr_bot" }));
  expect(container.textContent).toContain("Plan my week");
  expect(container.querySelector("[data-md]")?.textContent).toBe("Here is your week.");
  expect(button("Open ‘Book flights’, Finished")).toBeTruthy();
  expect(container.textContent).toContain("1 step");
  await act(async () => button("👍Looks good").click());
  expect(sdk.threads.send).toHaveBeenCalledWith({ threadId: "thr_bot", input: [{ type: "text", text: "👍 Looks good", mentions: [] }], mode: "auto" });
});

test("answers a pending question inline, above the composer", async () => {
  sdk.threads.timeline.mockResolvedValue(page([]));
  sdk.threads.interactions.list.mockResolvedValue([{ id: "int_1", threadId: "thr_bot", status: "pending", payload: { kind: "user_question", questions: [{ id: "q", prompt: "Which day?", multiSelect: false, allowFreeText: false, options: [{ label: "Monday", value: "mon" }] }] } }]);
  await show();
  expect(container.querySelector('section[aria-label="Needs you"]')?.textContent).toContain("Which day?");
  await act(async () => button("Monday").click());
  expect(sdk.threads.interactions.resolve).toHaveBeenCalledWith({ threadId: "thr_bot", interactionId: "int_1", resolution: { kind: "user_answer", answers: { q: { selected: ["mon"] } } } });
});

test("answers Studio's question form inline through respond", async () => {
  sdk.threads.timeline.mockResolvedValue(page([]));
  sdk.threads.interactions.list.mockResolvedValue([{ id: "int_3", threadId: "thr_bot", status: "pending", origin: { kind: "plugin", pluginId: "studio", rendererId: "design-questions" }, payload: { kind: "plugin", title: "A few questions", data: { questions: [{ id: "vault", kind: "choice", question: "Which vault?", options: [{ label: "1Password" }] }] } } }]);
  await show();
  await act(async () => button("1Password").click());
  expect(sdk.threads.interactions.respond).toHaveBeenCalledWith({ threadId: "thr_bot", interactionId: "int_3", value: { vault: "1Password" } });
});

test("approves inline", async () => {
  sdk.threads.timeline.mockResolvedValue(page([]));
  sdk.threads.interactions.list.mockResolvedValue([{ id: "int_2", threadId: "thr_bot", status: "pending", payload: { kind: "approval", availableDecisions: ["allow_once", "deny"], reason: null, subject: { kind: "command", command: "git push" } } }]);
  await show();
  expect(container.textContent).toContain("git push");
  await act(async () => button("Approve").click());
  expect(sdk.threads.interactions.resolve).toHaveBeenCalledWith({ threadId: "thr_bot", interactionId: "int_2", resolution: { decision: "allow_once", grantedPermissions: null } });
});

test("an empty chat greets with starter chips; Enter sends", async () => {
  sdk.threads.timeline.mockResolvedValue(page([]));
  const onStarter = vi.fn();
  await show({ onStarter });
  expect([...container.querySelectorAll('[aria-label="Suggestions"] button')].map((each) => each.textContent)).toEqual(["Plan my week", "What needs me today?", "Set up a morning brief", "Customize me"]);
  act(() => button("Customize me").click());
  expect(onStarter).toHaveBeenCalledWith({ kind: "customize" });
  const field = container.querySelector("textarea")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Hello"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(sdk.threads.send).toHaveBeenCalledWith(expect.objectContaining({ input: [{ type: "text", text: "Hello", mentions: [] }] }));
});

test("while it works: blinking avatar with thinking dots, and Stop in place of Send", async () => {
  sdk.threads.timeline.mockResolvedValue(page([{ kind: "conversation", role: "user", initiator: "user", id: "u1", text: "Go", createdAt: at }]));
  sdk.threads.get.mockResolvedValue({ status: "active" });
  await show();
  expect(button("Stop Dot")).toBeTruthy();
  const thinking = container.querySelector('[role=status][aria-label="Dot is thinking"]');
  expect(thinking?.querySelector("svg")?.getAttribute("data-working")).toBe("true");
  await act(async () => button("Stop Dot").click());
  expect(sdk.threads.stop).toHaveBeenCalledWith({ threadId: "thr_bot" });
});
