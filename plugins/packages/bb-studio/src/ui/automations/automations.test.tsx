// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import type { ScheduledItem } from "../../loops/scheduled";
import { wakeLabel } from "./model";
import { ScheduledView } from "./ThreadAutomations";

const headerForTest = vi.hoisted(() => ({ owner: { data: null as unknown, loading: false }, scheduled: [] as unknown[], calls: [] as unknown[], openThreadPanel: vi.fn(), openLink: vi.fn(async () => ({ via: "workbench" })) }));
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  experimental_useAppPanel: () => ({ openTab: ({ tab, ...rest }: { tab: { id: string } }) => (headerForTest.openThreadPanel)({ actionId: tab.id, ...rest }) }),
}));
vi.mock("../live", () => ({
  useLive: (method: string, input: unknown, options?: { enabled?: boolean }) => {
    if (method === "bot_thread_owner") return headerForTest.owner;
    headerForTest.calls.push({ method, input, enabled: options?.enabled ?? true });
    return { data: options?.enabled === false ? null : { items: headerForTest.scheduled }, loading: false, error: null };
  },
}));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: headerForTest.openLink }));

installTestPluginRuntime();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
function mount(node: ReactNode): Root {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return root;
}
function cleanup() {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
}
const render = mount;
const byText = (text: string) => [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => el.children.length === 0 && el.textContent === text);
const screen = {
  getByText: (text: string) => byText(text)[0] ?? (() => { throw new Error(`No text ${text}`); })(),
  getAllByText: byText,
  getByRole: (role: string, options: { name?: string } = {}) => {
    const found = [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((el) => options.name === undefined || el.getAttribute("aria-label") === options.name);
    if (!found) throw new Error(`No ${role} ${options.name ?? ""}`);
    return found;
  },
  getAllByRole: (role: string, options: { name?: string } = {}) => [...document.querySelectorAll<HTMLElement>(role === "button" ? "button" : `[role="${role}"]`)]
    .filter((el) => options.name === undefined || (el.getAttribute("aria-label") ?? el.textContent) === options.name),
};
const fireEvent = { click: (el: HTMLElement) => act(() => { el.click(); }) };
function renderHook<P, R>(hook: (props: P) => R, options: { wrapper?: typeof StrictMode; initialProps?: P } = {}) {
  const result = { current: undefined as R };
  function Probe({ props }: { props: P }) { result.current = hook(props); return null; }
  const wrap = (props: P) => options.wrapper ? <StrictMode><Probe props={props} /></StrictMode> : <Probe props={props} />;
  const root = mount(wrap(options.initialProps as P));
  return { result, rerender: (props: P) => act(() => root.render(wrap(props))) };
}
async function waitFor(check: () => void, timeout = 1000) {
  for (const started = Date.now(); ; ) {
    try { check(); return; } catch (error) {
      if (Date.now() - started > timeout) throw error;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  }
}

const NOW = Date.UTC(2026, 9, 8, 12, 0);

const item = (over: Partial<ScheduledItem> = {}): ScheduledItem => ({
  key: "automation:bot_main:aut_1", source: "automation", id: "aut_1", botId: "bot_main", botName: "Dot", kind: "checkin", title: "Check inbox",
  nextAt: NOW + 5 * 60_000, state: "active", scheduleText: "Every 30 min", threadId: "thr_1", link: "bb://automation/bot_main%3Aaut_1", ...over,
});

afterEach(cleanup);

describe("ScheduledView", () => {
  it("shows the empty state", () => {
    render(<ScheduledView items={[]} error={null} now={NOW} />);
    expect(screen.getByText("Nothing scheduled")).toBeTruthy();
  });

  it("shows why it couldn't load", () => {
    render(<ScheduledView items={null} error="Studio is offline" now={NOW} />);
    expect(screen.getByRole("status").textContent).toContain("Studio is offline");
  });

  it("lists each item with its kind and next run, and opens its link", () => {
    render(<ScheduledView items={[item(), item({ key: "todo:loop_1", source: "todo", kind: "todo", title: "Pay the bill", link: "bb://todo/loop_1", nextAt: null, state: "paused" })]} error={null} now={NOW} />);
    const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-scheduled]")];
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringMatching(/^Check inboxCheck-in · /), "Pay the billTodo · Paused"]);
    fireEvent.click(rows[1]!);
    expect(headerForTest.openLink).toHaveBeenCalledWith("bb://todo/loop_1", { source: "botPage", title: "Pay the bill" });
  });
});

describe("ThreadAutomationsSummary", () => {
  it("counts a regular thread's scheduled items in its context row, opening the tab, and hides for Bot-owned threads", async () => {
    headerForTest.scheduled = [item(), item({ key: "b", state: "paused" })];
    const { ThreadAutomationsSummary, useThreadAutomationsVisible } = await import("./ThreadAutomations");

    headerForTest.owner = { data: { botId: "bot_1" }, loading: false };
    const bot = renderHook(() => useThreadAutomationsVisible("thr_1", "proj_1"));
    expect(bot.result.current).toBe(false);
    expect(headerForTest.calls.at(-1)).toEqual({ method: "loops.scheduled", input: { threadId: "thr_1" }, enabled: false });
    cleanup();

    headerForTest.owner = { data: { botId: null }, loading: false };
    const regular = renderHook(() => useThreadAutomationsVisible("thr_1", "proj_1"));
    await waitFor(() => expect(regular.result.current).toBe(true));
    cleanup();

    render(<ThreadAutomationsSummary threadId="thr_1" projectId="proj_1" />);
    const label = wakeLabel(headerForTest.scheduled as ScheduledItem[]);
    expect(label).toBe("2 scheduled items for this thread (1 on)");
    const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(button.textContent).toBe("2 scheduled");
    fireEvent.click(button);
    expect(headerForTest.openThreadPanel).toHaveBeenCalledWith({ actionId: "thread-automations", title: "Automations" });
  });
});
