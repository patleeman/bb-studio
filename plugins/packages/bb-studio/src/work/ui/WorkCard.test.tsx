// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkCard } from "../contract";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
const card = (patch: Partial<WorkCard> = {}): WorkCard => ({ id: "wc_1", threadId: "thr_main", title: "Release 1.0.2", kind: "release", state: "running", step: "2/5 Sign", line: "Notarizing the DMG", needs: null, workerThreadId: null, messageId: "m_1", messageSeq: 41, createdAt: NOW - 60_000, updatedAt: NOW - 60_000, finishedAt: null, ...patch });
const state = vi.hoisted(() => ({
  get: null as WorkCard | null,
  getError: null as string | null,
  call: vi.fn(async (_method: string, _input: unknown) => ({})),
  toThread: vi.fn(),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toThread: state.toThread }),
}));
vi.mock("../../ui/live", () => ({
  useCall: () => state.call,
  useLive: (method: string) => ({ data: method === "work.get" ? state.get : null, error: method === "work.get" ? state.getError : null, loading: false, refresh: () => {} }),
}));
vi.mock("../../kit/ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);
vi.mock("../../kit/app/directive-card", () => ({ remember: (_key: string, value: unknown) => value }));

const { WorkDirective } = await import("./WorkCard");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { get: card(), getError: null });
  state.call.mockClear(); state.toThread.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

const message = { id: "m_1", threadId: "thr_main", turnId: null, projectId: null };
const renderCard = async (attributes: Record<string, string> = { id: "wc_1" }) => {
  await act(async () => root.render(<WorkDirective attributes={attributes} source="" message={message} openWorkspaceFile={null} />));
};
const text = () => container.textContent ?? "";
const q = (selector: string) => container.querySelector<HTMLElement>(selector);

it("draws a card from live state: kind, step, title, state, one-liner", async () => {
  await renderCard();
  const el = q('[data-testid="work-card"]')!;
  expect(el.dataset.workCardId).toBe("wc_1");
  expect(el.dataset.state).toBe("running");
  expect(text()).toContain("Release");
  expect(q('[data-testid="work-step"]')!.textContent).toBe("2/5 Sign");
  expect(text()).toContain("Release 1.0.2");
  expect(q('[data-testid="work-state"]')!.textContent).toBe("Running");
  expect(q('[data-testid="work-line"]')!.textContent).toBe("Notarizing the DMG");
  expect(q('[data-testid="work-needs"]')).toBeNull();
});

it("redraws in place when the card changes, and shows what the user needs to do", async () => {
  await renderCard();
  state.get = card({ state: "needs-you", step: "3/5 Upload", line: "Waiting on approval", needs: "Approve the release draft", updatedAt: NOW });
  await renderCard();
  expect(container.querySelectorAll('[data-testid="work-card"]')).toHaveLength(1);
  expect(q('[data-testid="work-state"]')!.textContent).toBe("Needs you");
  expect(q('[data-testid="work-step"]')!.textContent).toBe("3/5 Upload");
  expect(q('[data-testid="work-needs"]')!.textContent).toBe("Approve the release draft");
  state.get = card({ state: "done", line: "Published", finishedAt: NOW });
  await renderCard();
  expect(q('[data-testid="work-state"]')!.textContent).toBe("Done");
  expect(q('[data-testid="work-needs"]')).toBeNull();
});

it("says Done once: a finished card drops its last step from the header", async () => {
  state.get = card({ kind: "worker", state: "done", step: "Done", line: "Saved page", finishedAt: NOW });
  await renderCard();
  expect(q('[data-testid="work-step"]')).toBeNull();
  expect(q("[data-studio-card-meta]")!.textContent).toBe("Worker");
  expect(text().match(/Done/g)).toHaveLength(1);
  state.get = card({ state: "failed", step: "4/5 Upload", finishedAt: NOW });
  await renderCard();
  expect(q('[data-testid="work-step"]')).toBeNull();
});

it("opens the worker doing the work from the open icon at the end of its header, with no footer link", async () => {
  state.get = card({ kind: "worker", workerThreadId: "thr_worker" });
  await renderCard();
  const head = q("[data-studio-card-head]")!;
  expect(head.lastElementChild).toBe(q('[data-testid="work-open"]'));
  expect(q('[data-testid="work-open"]')!.getAttribute("aria-label")).toBe("Open worker");
  expect(q("[data-studio-card-foot]")).toBeNull();
  await act(async () => q('[data-testid="work-open"]')!.click());
  expect(state.toThread).toHaveBeenCalledWith("thr_worker");
  state.get = card({ workerThreadId: null });
  await renderCard();
  expect(q('[data-testid="work-open"]')).toBeNull();
});

it("reports the message it sits in once, while its place is unknown", async () => {
  state.get = card({ messageId: null, messageSeq: null });
  await renderCard();
  await renderCard();
  expect(state.call).toHaveBeenCalledTimes(1);
  expect(state.call).toHaveBeenCalledWith("work.anchor", { id: "wc_1", threadId: "thr_main", messageId: "m_1" });
  state.call.mockClear();
  state.get = card();
  act(() => root.unmount()); root = createRoot(container);
  await renderCard();
  expect(state.call).not.toHaveBeenCalled();
});

it("ignores a bad id and says when the card was removed", async () => {
  await renderCard({ id: "nope" });
  expect(container.innerHTML).toBe("");
  state.get = null; state.getError = "Work card wc_1 not found";
  await renderCard();
  expect(text()).toBe("This work card was removed.");
});
