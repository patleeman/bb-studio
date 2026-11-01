// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Loop } from "../contract";

const NOW = new Date("2026-11-02T15:00:00").getTime();
const loop = (id: string, title: string, extra: Partial<Loop> = {}): Loop => ({ id, title, why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "surfaced", due: null, area: null, createdAt: NOW - 86_400_000, updatedAt: NOW - 600_000, closedAt: null, closedBy: null, ...extra });
const empty = { needsYouNow: [] as Loop[], comingUp: [] as Loop[], agentsOnIt: [] as Loop[], waitingOnOthers: [] as Loop[], done: [] as Loop[] };
const state = vi.hoisted(() => ({
  groups: null as unknown,
  inputs: [] as unknown[],
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  toThread: vi.fn(),
  interactions: [] as unknown[],
  attention: null as unknown,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSettings: () => ({ values: { loopsEnabled: true } }),
  useBbNavigate: () => ({ toThread: state.toThread }),
  useSdk: () => sdk,
}));
const sdk = { projects: { list: async () => [{ id: "proj_k", name: "Kensico" }] }, threads: { interactions: { list: async () => state.interactions } } };
vi.mock("../../ui/live", () => ({
  useCall: () => state.call,
  useLive: (method: string, input: unknown) => {
    if (method === "loops.list") state.inputs.push(input);
    const data = method === "loops.list" ? state.groups
      : method === "bot_get" ? { bot: { id: "bot_1", name: "Chief of Staff", threadId: "thr_bot" } }
        : method === "project_leads" ? { leads: [{ projectId: "proj_k", leadThreadId: "thr_lead", run: null }] }
          : method === "loops.places" ? { names: ["Home", "Office", "Mom’s"] }
            : method === "bot_attention" ? { attention: state.attention } : null;
    return { data, loading: false, error: null, refresh: () => {} };
  },
}));
vi.mock("../../kit/ui/index", async () => (await import("./test-kit")).kitUi);
vi.mock("../../kit/app/index", () => ({ openAppPath: vi.fn() }));

const { LoopsTab } = await import("./LoopsTab");
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear(); state.toThread.mockClear(); state.inputs = []; state.interactions = []; state.attention = null;
  state.groups = {
    ...empty,
    needsYouNow: [loop("loop_n", "Reply to Yassine about the FDE referral", { why: "He offered to refer you", area: "Job", due: NOW + 4 * 86_400_000 }), loop("loop_d", "Choose the deck contractor", { kind: "decide", options: ["Bayside", "Hudson"], area: "Home" })],
    comingUp: [loop("loop_c", "Call the plumber about the slow drain", { status: "queued", trigger: { type: "place", place: "home", direction: "arrive" }, area: "Home" }), loop("loop_t", "Send the October expense report", { status: "snoozed", trigger: { type: "time", at: NOW + 2 * 86_400_000 } })],
    agentsOnIt: [loop("loop_a", "Draft the Kensico Q4 lead summary", { owner: "thread:thr_lead", status: "in_progress", area: "Kensico" })],
    waitingOnOthers: [loop("loop_w", "Signed lease addendum", { kind: "waiting", status: "queued" })],
    done: [1, 2, 3, 4].map((n) => loop(`loop_x${n}`, `Closed ${n}`, { status: "done", closedAt: NOW - n * 60_000, closedBy: "patrick" })),
  };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = async () => { await act(async () => root.render(<LoopsTab />)); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const section = (name: string) => container.querySelector(`section[aria-label="${name}"]`) as HTMLElement | null;
const buttonIn = (scope: Element, text: string) => {
  const found = [...scope.querySelectorAll("button")].find((each) => each.textContent?.trim() === text);
  if (!found) throw new Error(`No "${text}" in: ${[...scope.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found;
};

it("shows the five sections in order with their counts", async () => {
  await render();
  expect([...container.querySelectorAll("section")].map((each) => each.getAttribute("aria-label"))).toEqual(["Needs you now", "Coming up", "Agents on it", "Waiting on others", "Done · last 7 days"]);
  expect(section("Needs you now")!.textContent).toContain("Needs you now2");
  expect(section("Coming up")!.textContent).toContain("Next: Wed 3:00 PM");
  expect(section("Coming up")!.textContent).toContain("When you get home");
  expect(section("Agents on it")!.textContent).toContain("Kensico lead");
  expect(section("Waiting on others")!.textContent).toContain("Since Sun");
  // Done shows three until Show all.
  expect(section("Done · last 7 days")!.querySelectorAll("[data-testid=loop-done]")).toHaveLength(3);
  await act(async () => buttonIn(section("Done · last 7 days")!, "Show all").click());
  expect(section("Done · last 7 days")!.querySelectorAll("[data-testid=loop-done]")).toHaveLength(4);
});

it("filters by area chip and by owner", async () => {
  await render();
  await act(async () => buttonIn(container, "Kensico").click());
  expect(state.inputs.at(-1)).toEqual({ area: "Kensico" });
  await act(async () => buttonIn(container, "Kensico lead").click());
  expect(state.inputs.at(-1)).toEqual({ area: "Kensico", owner: "thread:thr_lead" });
  await act(async () => buttonIn(container, "All").click());
  await act(async () => buttonIn(container, "Me").click());
  expect(state.inputs.at(-1)).toEqual({ owner: "patrick" });
});

it("acts from rows: Done, choose, Surface now, Take it back, Nudge them and Undo", async () => {
  await render();
  const needs = section("Needs you now")!;
  await act(async () => buttonIn(needs, "Done").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_n", action: "done" });
  await act(async () => buttonIn(needs, "Hudson").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_d", action: "choose", option: "Hudson" });
  await act(async () => buttonIn(section("Coming up")!, "Surface now").click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_c", surfaceNow: true });
  await act(async () => buttonIn(section("Agents on it")!, "Take it back").click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_a", changes: { owner: "patrick", status: "surfaced" } });
  await act(async () => buttonIn(section("Agents on it")!, "Open thread").click());
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
  await act(async () => buttonIn(section("Waiting on others")!, "Nudge them").click());
  expect(state.call).toHaveBeenCalledWith("loops.act", { id: "loop_w", action: "nudge" });
  expect(container.textContent).toContain("drafting a nudge for you to approve");
  await act(async () => (section("Done · last 7 days")!.querySelector("[aria-label='Undo: Closed 1']") as HTMLButtonElement).click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_x1", changes: { status: "surfaced" } });
});

it("changes a trigger to a phone place with Send to iPhone", async () => {
  await render();
  const row = section("Coming up")!.querySelector("[data-testid=loop-coming]")!;
  await act(async () => buttonIn(row, "Change trigger").click());
  const form = container.querySelector("form[aria-label='Change trigger']")!;
  expect([...form.querySelectorAll("[role=radiogroup][aria-label=Place] label")].map((each) => each.textContent)).toEqual(["Home", "Office", "Mom’s"]);
  // The stored key is lower-case; the phone's name in any case still matches.
  expect((form.querySelector("input[type=radio]") as HTMLInputElement).checked).toBe(true);
  await act(async () => ([...form.querySelectorAll("input[type=radio]")][1] as HTMLInputElement).click());
  await act(async () => buttonIn(form, "Leave").click());
  await act(async () => (form.querySelector("input[type=checkbox]") as HTMLInputElement).click());
  await act(async () => buttonIn(form, "Save").click());
  expect(state.call).toHaveBeenCalledWith("loops.update", { id: "loop_c", changes: { trigger: { type: "place", place: "Office", direction: "leave" }, push: true } });
});

it("adds a typed loop through the Bot", async () => {
  await render();
  const input = container.querySelector("input[aria-label='Add a loop']") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "call the plumber when I'm home");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => buttonIn(container, "").click());
  expect(state.call).toHaveBeenCalledWith("loops.add", { text: "call the plumber when I'm home" });
  expect(container.textContent).toContain("Added. Chief of Staff is filling it in.");
});

it("lists the Bot chat's pending questions in Needs you now, read-only and once", async () => {
  state.interactions = [{ id: "int_1", status: "pending", createdAt: NOW, payload: { kind: "approval" } }, { id: "int_2", status: "pending", createdAt: NOW, payload: { kind: "user_question" } }, { id: "int_3", status: "resolved" }];
  (state.groups as typeof empty).needsYouNow.push(loop("loop_q", "Approve the invoice", { source: { kind: "interaction", ref: "int_1" } }));
  await render();
  const pending = [...container.querySelectorAll("[data-testid=loop-pending]")];
  expect(pending.map((each) => each.textContent)).toEqual([expect.stringContaining("Asked you a question")]);
  expect(section("Needs you now")!.textContent).toContain("Needs you now4");
  await act(async () => buttonIn(pending[0]!, "Open chat").click());
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
});

it("shows the empty state with Done still listed", async () => {
  state.groups = { ...empty, done: [loop("loop_v", "Cancel the Vercel Pro trial", { status: "done", closedAt: NOW, closedBy: "patrick" })] };
  await render();
  expect(container.querySelector("[data-testid=loops-empty]")?.textContent).toContain("No open loops");
  expect(section("Done · last 7 days")!.textContent).toContain("Cancel the Vercel Pro trial");
  expect(section("Done · last 7 days")!.textContent).toContain("You · Today 3:00 PM");
});

it("puts the CoS's queued loops in Coming up with their trigger, and names a thread owner by its title", async () => {
  state.groups = {
    ...empty,
    comingUp: [
      loop("loop_g", "Check whether GitHub resumed security advisories (GHSA)", { owner: "cos", status: "queued", trigger: { type: "time", at: new Date("2026-11-04T10:00:00").getTime() }, area: "Kensico" }),
      loop("loop_p", "Remove red4's PHP upload-progress mitigation once Unraid ships a fix", { owner: "cos", status: "queued", priority: "low", trigger: { type: "event", event: "unraid:php-cve-2026-115560-fixed", label: "when Unraid fixes the PHP CVE" } }),
      loop("loop_r", "Review the OpenAI FDE resume, then send it to Yassine", { status: "queued" }),
      loop("loop_s", "Silent-speech Long read on other form factors?", { status: "queued", priority: "low" }),
    ],
    agentsOnIt: [loop("loop_u", "Add the remaining utilities to the AI power Long read", { owner: "thread:thr_egv6yq7mbp", status: "in_progress" }), loop("loop_c2", "Fill in the draft", { owner: "cos", status: "in_progress" })],
    held: [{ id: "loop_r", reason: "budget" }, { id: "loop_s", reason: "morning" }],
    owners: [{ owner: "thread:thr_egv6yq7mbp", name: "AI power Long read", threadId: "thr_egv6yq7mbp" }],
  };
  await render();
  const coming = section("Coming up")!;
  const rows = [...coming.querySelectorAll("[data-testid=loop-coming]")].map((row) => row.textContent);
  expect(rows[0]).toContain("Chief of Staff will do it");
  expect(rows[0]).toContain("Wed 10:00 AM");
  expect(rows[1]).toContain("When Unraid fixes the PHP CVE");
  expect(rows[2]).toContain("Next free slot");
  expect(rows[3]).toContain("Tomorrow morning card");
  expect(rows.join(" ")).not.toContain("Anytime");
  expect(coming.textContent).toContain("Next: Wed 10:00 AM");
  const agents = section("Agents on it")!;
  expect(agents.textContent).not.toContain("Waiting to start");
  expect(agents.textContent).toContain("AI power Long read");
  expect(agents.textContent).not.toContain("An agent");
  await act(async () => buttonIn(agents, "Open thread").click());
  expect(state.toThread).toHaveBeenLastCalledWith("thr_egv6yq7mbp");
  await act(async () => buttonIn(agents, "Open chat").click());
  expect(state.toThread).toHaveBeenLastCalledWith("thr_bot");
});

it("drops Open thread when the owner's thread is gone", async () => {
  state.groups = { ...empty, agentsOnIt: [loop("loop_u", "Utilities", { owner: "thread:thr_gone", status: "in_progress" })], owners: [{ owner: "thread:thr_gone", name: "A thread that was removed", threadId: null }] };
  await render();
  expect(section("Agents on it")!.textContent).toContain("A thread that was removed");
  expect([...section("Agents on it")!.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Open thread");
});

it("shows the same items as the Bot row's badge: an unread reply counts in Needs you now", async () => {
  state.groups = { ...empty, comingUp: [loop("loop_r", "Review the resume", { status: "queued" })] };
  state.attention = { reason: "1 thing for you", count: 1, since: NOW, unread: 1 };
  await render();
  const needs = section("Needs you now")!;
  expect(needs.textContent).toContain("Needs you now1");
  expect(needs.querySelector("[data-testid=loop-unread]")?.textContent).toContain("A reply from Chief of Staff");
  await act(async () => buttonIn(needs, "Open chat").click());
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
});
