// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkCard } from "../contract";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const card = (patch: Partial<WorkCard> = {}): WorkCard => ({ id: "wc_1", threadId: "thr_main", title: "Release 1.0.2", kind: "release", state: "running", step: "2/5 Sign", line: "Notarizing the DMG", needs: null, workerThreadId: null, messageId: "m_1", messageSeq: 41, createdAt: NOW - 60_000, updatedAt: NOW - 60_000, finishedAt: null, stale: false, dismissedAt: null, ...patch });
const state = vi.hoisted(() => ({
  list: [] as WorkCard[],
  error: null as string | null,
  toThread: vi.fn(),
  toAppPath: vi.fn((_path: string, _options?: unknown) => true) as ((path: string, options?: unknown) => boolean) | null,
  pathname: "/threads/thr_main",
  composerThread: "thr_main" as string | null,
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({})),
  refresh: vi.fn(),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => (state.toAppPath ? { toThread: state.toThread, experimental_toAppPath: state.toAppPath } : { toThread: state.toThread }),
}));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "work.list" && !state.error ? { cards: state.list } : null, error: state.error, loading: false, refresh: state.refresh }),
  useCall: () => state.call,
}));
vi.mock("../../kit/ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);
vi.mock("../../kit/app/directive-card", () => ({ remember: (_key: string, value: unknown) => value }));
vi.mock("../../kit/app/route", () => ({ usePathname: () => state.pathname }));
vi.mock("../../kit/composer", () => ({ useComposerThread: () => state.composerThread }));

const { InFlightBanner } = await import("./InFlight");
const { WorkCardView } = await import("./WorkCard");
const { FLASH_CLASS } = await import("./reveal");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { list: [], error: null, pathname: "/threads/thr_main", composerThread: "thr_main" });
  state.toAppPath = vi.fn((_path: string, _options?: unknown) => true);
  state.toThread.mockClear();
  state.call.mockReset();
  state.call.mockImplementation(async () => ({}));
  state.refresh.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const renderList = async () => { await act(async () => root.render(<InFlightBanner />)); };
const q = (selector: string) => container.querySelector<HTMLElement>(selector);
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="in-flight-row"]')];

it("lists one row per card with its name, state and a needs-you marker", async () => {
  state.list = [card({ id: "wc_n", title: "Approve deploy", state: "needs-you", needs: "Approve the prod push" }), card(), card({ id: "wc_w", title: "Wait on CI", state: "waiting", step: null, line: "Queued behind main" })];
  await renderList();
  expect(rows().map((row) => row.dataset.state)).toEqual(["needs-you", "running", "waiting"]);
  expect(rows()[0]!.textContent).toContain("Approve deploy");
  expect(rows()[0]!.textContent).toContain("Approve the prod push");
  expect(rows()[0]!.querySelector('[data-testid="in-flight-needs-you"]')!.textContent).toBe("Needs you");
  expect(rows()[1]!.textContent).toContain("2/5 Sign · Notarizing the DMG");
  expect(rows()[1]!.textContent).toContain("Running");
  expect(rows()[1]!.querySelector('[data-testid="in-flight-needs-you"]')).toBeNull();
  expect(q('[data-testid="in-flight-count"]')!.textContent).toBe("3");
  expect(q('[data-testid="in-flight-needs"]')!.textContent).toBe("1 needs you");
});

it("says so when todos and work cards couldn't be moved to tasks, and stays quiet on any other error", async () => {
  state.error = "Todos and work cards could not be moved to tasks, so they can't be shown: disk I/O error. Nothing was lost. Restart BB Studio to try again.";
  await renderList();
  expect(q('[data-testid="in-flight-error"]')!.textContent).toBe(state.error);
  state.error = "Network error";
  await renderList();
  expect(container.innerHTML).toBe("");
});

it("shows nothing with no open work, finished cards included", async () => {
  await renderList();
  expect(container.innerHTML).toBe("");
  state.list = [card({ state: "done", finishedAt: NOW - 1_000 }), card({ id: "wc_f", state: "failed", finishedAt: NOW - 2_000 })];
  await renderList();
  expect(container.innerHTML).toBe("");
  state.list = [card({ id: "wc_open" }), card({ state: "done", finishedAt: NOW - 1_000 })];
  await renderList();
  expect(rows().map((row) => row.dataset.state)).toEqual(["running"]);
  await act(async () => q('[data-testid="in-flight-done"]')!.click());
  expect(rows().map((row) => row.dataset.state)).toEqual(["running", "done"]);
  expect(rows()[1]!.textContent).not.toContain("2/5 Sign");
  expect(q('[data-testid="in-flight-count"]')!.textContent).toBe("1");
  state.composerThread = null;
  await renderList();
  expect(container.innerHTML).toBe("");
});

it("collapses to its header and remembers it", async () => {
  state.list = [card()];
  await renderList();
  const header = q('[aria-expanded]')!;
  await act(async () => header.click());
  expect(rows()).toHaveLength(0);
  expect(window.localStorage.getItem("bb.studio.in-flight.collapsed")).toBe("true");
  await act(async () => header.click());
  expect(rows()).toHaveLength(1);
});

it("a click goes to the card's message through bb's message link, then highlights the card", async () => {
  state.list = [card()];
  await renderList();
  const target = document.createElement("div");
  target.dataset.workCardId = "wc_1";
  document.body.append(target);
  await act(async () => rows()[0]!.click());
  expect(state.toAppPath).toHaveBeenCalledWith("/threads/thr_main#msg=41", { replace: true });
  expect(target.classList.contains(FLASH_CLASS)).toBe(false);
  act(() => { vi.advanceTimersByTime(300); });
  expect(target.classList.contains(FLASH_CLASS)).toBe(true);
  act(() => { vi.advanceTimersByTime(2_000); });
  expect(target.classList.contains(FLASH_CLASS)).toBe(false);
  target.remove();
});

it("waits for a card bb loads from older messages before highlighting it", async () => {
  state.list = [card()];
  await renderList();
  await act(async () => rows()[0]!.click());
  act(() => { vi.advanceTimersByTime(1_000); });
  const late = document.createElement("div");
  late.dataset.workCardId = "wc_1";
  document.body.append(late);
  act(() => { vi.advanceTimersByTime(150); });
  expect(late.classList.contains(FLASH_CLASS)).toBe(true);
  late.remove();
});

it("scrolls to the card on the page when bb can't take a message link", async () => {
  const target = document.createElement("div");
  target.dataset.workCardId = "wc_1";
  document.body.append(target);
  state.list = [card({ messageSeq: null })];
  await renderList();
  await act(async () => rows()[0]!.click());
  expect(state.toAppPath).not.toHaveBeenCalled();
  expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  expect(target.classList.contains(FLASH_CLASS)).toBe(true);
  state.list = [card()];
  state.toAppPath = null;
  (target.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
  await renderList();
  await act(async () => rows()[0]!.click());
  expect(target.scrollIntoView).toHaveBeenCalled();
  state.toAppPath = vi.fn((_path: string, _options?: unknown) => true);
  state.pathname = "/plugins/studio/studio";
  (target.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
  await renderList();
  await act(async () => rows()[0]!.click());
  expect(state.toAppPath).not.toHaveBeenCalled();
  expect(target.scrollIntoView).toHaveBeenCalled();
  target.remove();
});

it("builds bb's message link only for the thread on screen", async () => {
  const { messageLinkPath } = await import("./in-flight-model");
  expect(messageLinkPath("/threads/thr_main", "thr_main", 7)).toBe("/threads/thr_main#msg=7");
  expect(messageLinkPath("/projects/proj_1/threads/thr_main/", "thr_main", 0)).toBe("/projects/proj_1/threads/thr_main#msg=0");
  expect(messageLinkPath("/threads/thr_other", "thr_main", 7)).toBeNull();
  expect(messageLinkPath("/plugins/studio/studio", "thr_main", 7)).toBeNull();
});

it("leaves out a card that is on screen, and lists it again once it scrolls away", async () => {
  const observers: { callback: (entries: Partial<IntersectionObserverEntry>[]) => void; disconnect: () => void }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    callback: (entries: Partial<IntersectionObserverEntry>[]) => void;
    constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  });
  state.list = [card({ id: "wc_a", title: "Research" }), card({ id: "wc_b", title: "Release" })];
  await act(async () => root.render(<><WorkCardView card={state.list[0]!} now={NOW} /><InFlightBanner /></>));
  expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining("Research"), expect.stringContaining("Release")]);
  await act(async () => observers[0]!.callback([{ isIntersecting: true, intersectionRatio: 1 }]));
  expect(rows().map((row) => row.title)).toEqual(["Release"]);
  state.list = [state.list[0]!];
  await act(async () => root.render(<><WorkCardView card={state.list[0]!} now={NOW} /><InFlightBanner /></>));
  expect(q('[data-testid="in-flight"]')).toBeNull();
  await act(async () => observers.at(-1)!.callback([{ isIntersecting: false, intersectionRatio: 0 }]));
  expect(rows().map((row) => row.title)).toEqual(["Research"]);
  vi.unstubAllGlobals();
});

const many = () => [
  card({ id: "wc_d1", title: "Done one", state: "done", finishedAt: NOW - 1_000 }),
  card({ id: "wc_live1", title: "Live one" }),
  card({ id: "wc_d2", title: "Done two", state: "done", finishedAt: NOW - 2_000 }),
  card({ id: "wc_f1", title: "Failed one", state: "failed", finishedAt: NOW - 3_000 }),
  card({ id: "wc_live2", title: "Live two", state: "needs-you", needs: "Approve" }),
];

it("folds finished rows into one line under the live ones, and opens them on a click", async () => {
  state.list = many();
  await renderList();
  expect(rows().map((row) => row.title)).toEqual(["Live one", "Live two"]);
  const fold = q('[data-testid="in-flight-done"]')!;
  expect(fold.textContent).toBe("3 done");
  expect(fold.getAttribute("aria-expanded")).toBe("false");
  expect(q('[data-testid="in-flight-count"]')!.textContent).toBe("2");
  await act(async () => fold.click());
  expect(rows().map((row) => row.title)).toEqual(["Live one", "Live two", "Done one", "Done two", "Failed one"]);
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  await act(async () => fold.click());
  expect(rows()).toHaveLength(2);
  state.list = [card()];
  await renderList();
  expect(q('[data-testid="in-flight-done"]')).toBeNull();
  expect(q('[data-testid="in-flight-clear"]')).toBeNull();
});

it("Clear done takes every finished row off the list at once and asks the server to keep it that way", async () => {
  state.list = many();
  await renderList();
  await act(async () => q('[data-testid="in-flight-clear"]')!.click());
  expect(state.call).toHaveBeenCalledWith("work.clear", { threadId: "thr_main" });
  expect(state.refresh).toHaveBeenCalled();
  expect(rows().map((row) => row.title)).toEqual(["Live one", "Live two"]);
  expect(q('[data-testid="in-flight-done"]')).toBeNull();
  expect(q('[data-testid="in-flight-clear"]')).toBeNull();
});

it("shows a cleared card again once it comes back changed: reopened, or handed to the user", async () => {
  state.list = many();
  await renderList();
  await act(async () => q('[data-testid="in-flight-clear"]')!.click());
  state.list = many();
  await renderList();
  expect(rows().map((row) => row.title)).toEqual(["Live one", "Live two"]);
  expect(q('[data-testid="in-flight-needs"]')!.textContent).toBe("1 needs you");
  const live = many().filter((c) => c.state !== "done" && c.state !== "failed");
  const d1 = many().find((c) => c.id === "wc_d1")!, d2 = many().find((c) => c.id === "wc_d2")!;
  state.list = [...live, { ...d1, state: "running", finishedAt: null, updatedAt: NOW + 5_000 }, { ...d2, state: "needs-you", needs: "Look", finishedAt: null, updatedAt: NOW + 6_000 }];
  await renderList();
  expect(rows().map((row) => row.title).sort()).toEqual(["Done one", "Done two", "Live one", "Live two"]);
  expect(q('[data-testid="in-flight-needs"]')!.textContent).toBe("2 need you");
});

it("puts the rows back when clearing fails", async () => {
  state.list = many();
  state.call.mockRejectedValueOnce(new Error("offline"));
  await renderList();
  await act(async () => q('[data-testid="in-flight-clear"]')!.click());
  expect(q('[data-testid="in-flight-done"]')!.textContent).toBe("3 done");
});

it("removes one row with its ×, live or done", async () => {
  state.list = many();
  await renderList();
  await act(async () => q('[data-testid="in-flight-done"]')!.click());
  const dismissOf = (title: string) => rows().find((row) => row.title === title)!.parentElement!.querySelector<HTMLElement>('[data-testid="in-flight-dismiss"]')!;
  expect(dismissOf("Done two").getAttribute("aria-label")).toBe("Remove Done two from In flight");
  await act(async () => dismissOf("Done two").click());
  expect(state.call).toHaveBeenLastCalledWith("work.dismiss", { id: "wc_d2" });
  await act(async () => dismissOf("Live one").click());
  expect(state.call).toHaveBeenLastCalledWith("work.dismiss", { id: "wc_live1" });
  expect(rows().map((row) => row.title)).toEqual(["Live two", "Done one", "Failed one"]);
  expect(q('[data-testid="in-flight-done"]')!.textContent).toBe("2 done");
});

it("shows an ended card as done with a question, never Running", async () => {
  state.list = [card({ id: "wc_live" }), card({ id: "wc_end", title: "Stuck worker", state: "done", stale: true, finishedAt: NOW - 1_000 })];
  await renderList();
  expect(q('[data-testid="in-flight-done"]')!.textContent).toBe("1 done");
  await act(async () => q('[data-testid="in-flight-done"]')!.click());
  const ended = rows()[1]!;
  expect(ended.dataset.stale).toBe("true");
  expect(ended.textContent).toContain("Ended");
  expect(ended.textContent).not.toContain("Running");
  expect(ended.textContent).not.toContain("2/5 Sign");
  expect(ended.querySelector('[data-testid="state-ended"]')!.getAttribute("aria-label")).toBe("Ended without a final update");
});
