// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkCard } from "../contract";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const card = (patch: Partial<WorkCard> = {}): WorkCard => ({ id: "wc_1", threadId: "thr_main", title: "Release 1.0.2", kind: "release", state: "running", step: "2/5 Sign", line: "Notarizing the DMG", needs: null, workerThreadId: null, messageId: "m_1", messageSeq: 41, createdAt: NOW - 60_000, updatedAt: NOW - 60_000, finishedAt: null, ...patch });
const state = vi.hoisted(() => ({
  list: [] as WorkCard[],
  toThread: vi.fn(),
  toAppPath: vi.fn((_path: string, _options?: unknown) => true) as ((path: string, options?: unknown) => boolean) | null,
  pathname: "/threads/thr_main",
  composerThread: "thr_main" as string | null,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => (state.toAppPath ? { toThread: state.toThread, experimental_toAppPath: state.toAppPath } : { toThread: state.toThread }),
}));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "work.list" ? { cards: state.list } : null, error: null, loading: false, refresh: () => {} }),
}));
vi.mock("../../kit/ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);
vi.mock("../../kit/app/directive-card", () => ({ remember: (_key: string, value: unknown) => value }));
vi.mock("../../kit/app/route", () => ({ usePathname: () => state.pathname }));
vi.mock("../../kit/composer", () => ({ useComposerThread: () => state.composerThread }));

const { InFlightBanner } = await import("./InFlight");
const { FLASH_CLASS } = await import("./reveal");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { list: [], pathname: "/threads/thr_main", composerThread: "thr_main" });
  state.toAppPath = vi.fn((_path: string, _options?: unknown) => true);
  state.toThread.mockClear();
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

it("shows nothing with no open work, finished cards included", async () => {
  await renderList();
  expect(container.innerHTML).toBe("");
  state.list = [card({ state: "done", finishedAt: NOW - 1_000 }), card({ id: "wc_f", state: "failed", finishedAt: NOW - 2_000 })];
  await renderList();
  expect(container.innerHTML).toBe("");
  state.list = [card({ id: "wc_open" }), card({ state: "done", finishedAt: NOW - 1_000 })];
  await renderList();
  expect(rows().map((row) => row.dataset.state)).toEqual(["running", "done"]);
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
