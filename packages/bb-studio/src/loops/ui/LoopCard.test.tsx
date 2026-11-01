// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Loop } from "../contract";

const NOW = new Date("2026-11-02T15:00:00").getTime();
const base: Loop = { id: "loop_1", title: "Reply to Yassine about the FDE referral", why: "He offered to refer you; the posting closes Friday.", source: { kind: "email", ref: "Email from Yassine B." }, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "surfaced", due: null, area: "Job", createdAt: NOW - 86_400_000, updatedAt: NOW, closedAt: null, closedBy: null };
const state = vi.hoisted(() => ({
  enabled: true,
  view: null as { loop: Loop; history: { type: string; at: number; data: string }[] } | null,
  error: null as string | null,
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  toThread: vi.fn(),
  open: vi.fn(),
  live: [] as string[],
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSettings: () => ({ values: { loopsEnabled: state.enabled } }),
  useBbNavigate: () => ({ toThread: state.toThread }),
  useSdk: () => ({ projects: { list: async () => [{ id: "proj_k", name: "Kensico" }] } }),
}));
vi.mock("../../ui/live", () => ({
  useCall: () => state.call,
  useLive: (method: string, _input: unknown, options: { enabled?: boolean } = {}) => {
    if (options.enabled === false) return { data: null, loading: false, error: null, refresh: () => {} };
    state.live.push(method);
    const data = method === "loops.get" ? state.view
      : method === "bot_get" ? { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot" } }
        : method === "project_leads" ? { leads: [{ projectId: "proj_k", leadThreadId: "thr_lead", run: null }] }
          : null;
    return { data, loading: false, error: method === "loops.get" ? state.error : null, refresh: () => {} };
  },
}));
vi.mock("../../kit/ui/index", async () => (await import("./test-kit")).kitUi);
vi.mock("../../kit/app/index", () => ({ remember: (_key: string, value: unknown) => value, openAppPath: state.open }));

const { LoopDirective, LoopsMoreDirective } = await import("./LoopCard");
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { enabled: true, view: { loop: base, history: [] }, error: null, live: [] });
  state.call.mockClear(); state.toThread.mockClear(); state.open.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const message = { id: "m1", threadId: "thr_bot", turnId: null, projectId: null };
const render = async (attributes: Record<string, string> = { id: "loop_1" }, loop?: Partial<Loop>, history: { type: string; at: number; data: string }[] = []) => {
  if (loop) state.view = { loop: { ...base, ...loop }, history };
  await act(async () => root.render(<LoopDirective attributes={attributes} source="" message={message} openWorkspaceFile={null} />));
};
const button = (text: string) => {
  const found = [...container.querySelectorAll("button")].find((each) => each.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}" in: ${[...container.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};
const click = (text: string) => act(async () => button(text).click());

it("is a quiet placeholder while the Attention Router is off, without fetching the loop", async () => {
  state.enabled = false;
  await render();
  expect(container.textContent).toBe("Attention Router is off");
  expect(state.live).not.toContain("loops.get");
});

it("draws nothing for a malformed id", async () => {
  await render({ id: "page_1" });
  expect(container.innerHTML).toBe("");
});

it("draws a do card with its release label, source, due and the four actions", async () => {
  await render(undefined, { due: NOW + 3 * 86_400_000 });
  expect(container.textContent).toContain("Reply to Yassine about the FDE referral");
  expect(container.textContent).toContain("He offered to refer you");
  expect(container.textContent).toContain("Email from Yassine B.");
  expect(container.textContent).toContain("Due Thu");
  for (const label of ["Done", "Snooze", "Hand off", "Drop"]) expect(button(label)).toBeTruthy();
  await click("Done");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "done" });
});

it("snoozes with a preset and with Pick a time", async () => {
  await render();
  const tonight = [...container.querySelectorAll("[role=menuitem]")].find((each) => each.textContent?.startsWith("Tonight")) as HTMLButtonElement;
  await act(async () => tonight.click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "snooze", snooze: "tonight" });
  expect(container.textContent).toContain("When I’m home");
  expect(container.textContent).not.toContain("at my Mac");
  await click("Pick a time…");
  await click("Snooze until then");
  expect(state.call).toHaveBeenLastCalledWith("loops.update", { id: "loop_1", changes: { status: "snoozed", trigger: { type: "time", at: expect.any(Number) } } });
});

it("hands off to the Bot or a project lead", async () => {
  await render();
  await act(async () => { await Promise.resolve(); });
  await click("Kensico lead");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "hand_off", owner: "thread:thr_lead" });
  await click("Chief of Staff");
  expect(state.call).toHaveBeenLastCalledWith("loops.act", { id: "loop_1", action: "hand_off", owner: "cos" });
});

it("shows up to three decide options inline and chooses one", async () => {
  await render(undefined, { kind: "decide", options: ["Bayside Decks · $4,200 · starts Nov 9", "Hudson Carpentry · $3,650 · starts Dec 1"] });
  expect(container.textContent).toContain("$3,650 · starts Dec 1");
  expect(() => button("Choose…")).toThrow();
  await click("Hudson Carpentry$3,650 · starts Dec 1");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "choose", option: "Hudson Carpentry · $3,650 · starts Dec 1" });
});

it("opens Choose… past three options", async () => {
  await render(undefined, { kind: "decide", options: ["A", "B", "C", "D"] });
  expect(button("Choose…")).toBeTruthy();
});

it("reads with Got it, and nudges through a draft, never a send", async () => {
  await render(undefined, { kind: "read" });
  await click("Got it");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "got_it" });
  await render(undefined, { kind: "waiting", title: "Signed lease addendum" });
  expect(container.textContent).toContain("Since Sun");
  await click("Nudge them");
  expect(state.call).toHaveBeenLastCalledWith("loops.act", { id: "loop_1", action: "nudge" });
  expect(container.textContent).toContain("drafting a nudge for you to approve");
});

it("shows who has a handed-off loop, live, with Open thread and Take it back", async () => {
  await render(undefined, { owner: "thread:thr_lead", status: "in_progress" }, [{ type: "handed_off", at: NOW - 12 * 60_000, data: "{}" }]);
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelector("[data-testid=loop-progress]")?.textContent).toContain("Kensico lead is on it· 12 min");
  await click("Open thread");
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
  await click("Take it back");
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_1", changes: { owner: "patrick", status: "surfaced" } });
});

it("collapses a closed loop to one line with how it ended, and Undo reopens it", async () => {
  await render(undefined, { status: "done", closedAt: NOW - 60_000, closedBy: "patrick", kind: "decide", options: ["Hudson Carpentry · $3,650"] }, [{ type: "closed", at: NOW, data: JSON.stringify({ action: "choose", option: "Hudson Carpentry · $3,650" }) }]);
  expect(container.querySelector("[data-testid=loop-closed]")?.textContent).toContain("Hudson Carpentry· Reply to Yassine");
  await act(async () => (container.querySelector("[aria-label^=Undo]") as HTMLButtonElement).click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_1", changes: { status: "surfaced" } });
});

it("says a deleted loop was removed", async () => {
  state.view = null; state.error = "Loop not found";
  await render();
  expect(container.textContent).toContain("This loop was removed.");
});

it("draws a morning row that opens the full card", async () => {
  await render({ id: "loop_1", row: "1" }, { due: NOW });
  const row = container.querySelector("[data-testid=loop-row] button") as HTMLButtonElement;
  expect(row.textContent).toContain("Due today");
  expect(container.querySelector("[data-testid=loop-card]")).toBeNull();
  await act(async () => row.click());
  expect(container.querySelector("[data-testid=loop-card]")).not.toBeNull();
});

it("links +N more to the Loops tab, and draws nothing for 0", async () => {
  await act(async () => root.render(<LoopsMoreDirective attributes={{ more: "3" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.textContent).toBe("3 more in Loops");
  await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_1/loops");
  await act(async () => root.render(<LoopsMoreDirective attributes={{ more: "0" }} source="" message={message} openWorkspaceFile={null} />));
  expect(container.innerHTML).toBe("");
});

it("offers Keep or Drop on a loop with no update in three days (the weekly review)", async () => {
  await render(undefined, { owner: "cos", status: "in_progress", updatedAt: NOW - 4 * 86_400_000 });
  expect(container.querySelector("[data-testid=loop-stale]")?.textContent).toContain("No update in 4 d");
  await click("Keep");
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_1", action: "keep" });
});
