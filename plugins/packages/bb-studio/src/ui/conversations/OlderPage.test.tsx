// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-10T15:00:00").getTime();
const DAY = 86_400_000;
const state = vi.hoisted(() => ({ older: null as unknown, call: vi.fn(async (_method: string, _input: unknown) => ({})), toThread: vi.fn(), openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })) }));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: state.toThread }) }));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (method: string) => ({ data: method === "bot_threads_older" ? state.older : method === "bot_spaces" ? { bots: [{ id: "bot_main", name: "Chief of Staff" }] } : null, error: null, refresh: () => {} }),
}));
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} />, openAppPath: vi.fn(), StudioBar: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));

const { default: OlderPage } = await import("./OlderPage");
const conversation = (threadId: string, title: string, updatedAt: number) => ({ threadId, title, isMain: false, forkedFrom: null, projectId: null, updatedAt, latest: "The last reply", running: false, needsYou: null });
const worker = (threadId: string, title: string, status: string, updatedAt: number, tag: string | null = null) => ({ threadId, title, status, ownerConversationId: null, ownerTitle: "Main", projectId: null, updatedAt, tag, branch: null });

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear(); state.toThread.mockClear(); state.openLink.mockClear();
  state.older = {
    botId: "bot_main",
    conversations: [conversation("thr_trip", "Great Wolf trip", NOW - 20 * DAY)],
    finished: [{ threadId: "thr_prep", title: "Launch prep", finishedAt: NOW - 3 * DAY, summary: "" }],
    workers: [worker("thr_sweep", "Staff sweep", "failed", NOW - 10 * DAY, "homelab"), worker("thr_fix", "Fix the CI flake", "failed", NOW - DAY), worker("thr_docs", "Docs pass", "done", NOW - 4 * DAY)],
  };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const render = () => act(() => root.render(<OlderPage botId="bot_main" />));
const titles = (scope: ParentNode = container) => [...scope.querySelectorAll("[data-testid=bot-page-row-title]")].map((each) => each.textContent);
const pill = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=bot-page-pill]")].find((each) => each.textContent?.startsWith(label))!;

it("is the Archive: its header names it and the Bot, and each thread is one line with its status and age", () => {
  render();
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toBe("Archive·Chief of Staff");
  expect([...container.querySelectorAll("[data-testid=bot-page-pill]")].map((each) => each.textContent)).toEqual(["All", "Conversations2", "Workers3", "Failed2"]);
  expect([...container.querySelectorAll("section")].map((each) => each.getAttribute("aria-label"))).toEqual(["Conversations", "Workers"]);
  // Newest first; a finished conversation says so, with Reopen.
  expect(titles(container.querySelector("section[aria-label=Conversations]")!)).toEqual(["Launch prep", "Great Wolf trip"]);
  const finished = container.querySelector<HTMLElement>("[data-testid=older-finished]")!;
  expect(finished.querySelector("[data-testid=bot-page-row-status]")?.textContent).toBe("Archived");
  expect(finished.querySelector("[data-testid=bot-page-row-meta]")?.textContent).toBe("Nov 7");
  const sweep = [...container.querySelectorAll<HTMLElement>("[data-testid=older-worker]")].find((each) => each.textContent?.includes("Staff sweep"))!;
  expect(sweep.querySelector("[data-testid=bot-page-row-meta]")?.textContent).toBe("homelab · 1w");
  // A failure older than 7 days is grey; a recent one is red.
  expect(sweep.querySelector("[data-testid=bot-page-row-status]")?.className).toContain("text-muted-foreground");
  const fix = [...container.querySelectorAll<HTMLElement>("[data-testid=older-worker]")].find((each) => each.textContent?.includes("Fix the CI flake"))!;
  expect(fix.querySelector("[data-testid=bot-page-row-status]")?.className).toContain("text-destructive");
  // No subtitles: the latest reply and the owner stay off the line.
  expect(container.textContent).not.toContain("The last reply");
  expect(container.textContent).not.toContain("for Main");
});

it("narrows to Conversations, Workers or Failed, and by search", async () => {
  render();
  act(() => pill("Conversations").click());
  expect(titles()).toEqual(["Launch prep", "Great Wolf trip"]);
  act(() => pill("Workers").click());
  expect(titles()).toEqual(["Staff sweep", "Fix the CI flake", "Docs pass"]);
  act(() => pill("Failed").click());
  expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Failed workers");
  expect(titles()).toEqual(["Staff sweep", "Fix the CI flake"]);
  act(() => pill("All").click());
  const search = container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "homelab"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(titles()).toEqual(["Staff sweep"]);
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "nothing"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(container.querySelector("[data-testid=older-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("No archived items match “nothing”");
  act(() => container.querySelector<HTMLButtonElement>("[data-testid=older-empty] [data-testid=bot-page-empty-action]")!.click());
  expect(search.value).toBe("");
  expect(titles().length).toBeGreaterThan(1);
});

it("opens a row's thread through the link router as a conversation tab, and reopens a finished conversation", async () => {
  render();
  const trip = container.querySelector<HTMLElement>("[data-testid=older-conversation]")!;
  act(() => trip.querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_trip", { source: "botPage", title: "Great Wolf trip", modifiers: { meta: false, ctrl: false, shift: false } });
  expect(trip.dataset.selected).toBe("true");
  act(() => { trip.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_trip", expect.objectContaining({ modifiers: { meta: true, ctrl: false, shift: false } }));
  act(() => { container.querySelector("[data-testid=older-worker] button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith(expect.stringMatching(/^bb:\/\/conversation\/thr_/), expect.objectContaining({ source: "botPage", modifiers: { meta: false, ctrl: false, shift: true } }));
  act(() => container.querySelector<HTMLButtonElement>("[data-testid=older-finished] [data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_prep", expect.objectContaining({ title: "Launch prep" }));
  await act(async () => container.querySelector<HTMLButtonElement>("[data-testid=older-reopen]")!.click());
  expect(state.call).toHaveBeenCalledWith("bot_reopen", { threadId: "thr_prep" });
  expect(state.openLink).toHaveBeenCalledTimes(4);
  expect(state.toThread).not.toHaveBeenCalled();
});

it("says Nothing archived yet when there is nothing, with where archiving is", () => {
  state.older = { botId: "bot_main", conversations: [], finished: [], workers: [] };
  render();
  expect(container.querySelector("[data-testid=older-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("Nothing archived yet");
  expect(container.querySelector("[data-testid=older-empty] [data-testid=bot-page-empty-hint]")?.textContent).toBe("Archive a conversation from its ⋯ menu.");
});
