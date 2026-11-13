// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BotThreadInfo } from "../../bot-threads-contract";

const state = vi.hoisted(() => ({
  threadId: "w1" as string | null,
  infos: {} as Record<string, unknown>,
  mirror: null as { mirrored: boolean; readOnly?: boolean } | null,
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ conversationId: "conv", projectId: null })),
  toThread: vi.fn(),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbContext: () => ({ threadId: state.threadId, projectId: null }),
  useComposer: () => ({ scope: { kind: "thread", threadId: state.threadId } }),
  useBbNavigate: () => ({ toThread: state.toThread }),
  experimental_DetailRow: ({ label, children }: { label: string; children: React.ReactNode }) => <div data-testid="detail-row" data-label={label}>{children}</div>,
}));
vi.mock("../live", () => ({
  useLive: (_method: string, input: { threadId: string }, options: { enabled?: boolean }) => ({ data: options.enabled === false ? null : { info: state.infos[input.threadId] ?? null }, error: null, loading: false, refresh: () => {} }),
  useCall: () => state.call,
}));
vi.mock("../mirror-banner", () => ({
  useMirrorStatus: () => state.mirror,
  isReadOnlyMirror: (status: { mirrored: boolean; readOnly?: boolean } | null) => !!status?.mirrored && status.readOnly === true,
  MirrorBox: () => <div data-testid="mirror-banner">Read-only</div>,
}));
vi.mock("../../kit/app/host-sdk", () => ({
  registerThreadBanner: (slots: { experimental_threadBanner?: (registration: unknown) => void }, registration: unknown) => { if (!slots.experimental_threadBanner) return false; slots.experimental_threadBanner(registration); return true; },
  registerThreadHeader: (slots: { experimental_threadHeader?: (registration: unknown) => void }, registration: unknown) => { if (!slots.experimental_threadHeader) return false; slots.experimental_threadHeader(registration); return true; },
}));
vi.mock("../../kit/app/index", () => ({
  Icon: () => null,
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...rest }: { children: React.ReactNode; onSelect?: () => void }) => <div role="menuitem" {...rest} onClick={() => onSelect?.()}>{children}</div>,
}));
vi.mock("./ConversationApprovals", () => ({ ConversationApprovals: () => null, ConversationApprovalsBanner: () => null }));

import { ConversationWorkersLine, ReadOnlyComposer, ReadOnlyFallbackBanner, readOnlyKind, registerReadOnlyComposer, setWorkerStatusInHeader, setWorkerStatusOnTop, useReadOnly, useStudioThreadHeader, WorkerFromRow, WorkerStatusBanner } from "./ReadOnlyComposer";

const worker: BotThreadInfo = {
  threadId: "w1", botId: "dot", botName: "Chief of Staff", kind: "worker", isMain: false, title: "Fable lead: sidebar rewrite", forkedFrom: null,
  owner: { threadId: "conv", title: "Fork redesign" }, status: "running", waitingOn: null, startedAt: Date.now() - 14 * 60_000, tag: "bb-studio-native", branch: "exp/studio-native", archivedAt: null,
  finishedSummary: null, finishing: false, needsYou: null, projectId: "proj", workers: [],
};
const conversation: BotThreadInfo = {
  ...worker, threadId: "conv", kind: "conversation", title: "Fork redesign", owner: null, status: null, tag: null, branch: null,
  workers: [{ threadId: "w1", title: "Fable lead", status: "running" }, { threadId: "w2", title: "UX review", status: "done" }, { threadId: "w3", title: "Codex", status: "needs-you" }],
};

let root: Root;
let host: HTMLDivElement;
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.threadId = "w1";
  state.infos = { w1: worker, conv: conversation };
  state.mirror = null;
  state.call.mockClear();
  state.toThread.mockClear();
  setWorkerStatusOnTop(false);
  setWorkerStatusInHeader(false);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function type(text: string) {
  const area = $('[data-testid="worker-ask"]') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("replaces a worker's composer and a mirrored thread's, and no other; a mirrored worker keeps its Ask box", () => {
  expect(readOnlyKind(worker, false)).toBe("worker");
  expect(readOnlyKind(worker, true)).toBe("worker");
  expect(readOnlyKind(conversation, false)).toBeNull();
  expect(readOnlyKind(conversation, true)).toBe("mirror");
  expect(readOnlyKind(null, false)).toBeNull();
});

it("shows the worker's status line and sends a question to the Bot in its conversation, then goes there", async () => {
  await act(async () => { root.render(<ReadOnlyComposer threadId="w1" />); });
  expect($('[data-studio-readonly="worker"]')).not.toBeNull();
  // One muted row: the state, then the conversation it works for. No pill, no age, no repo.
  expect($('[data-testid="worker-status"]')?.textContent).toBe("Running·for Fork redesign");
  // An active composer: the helper sits on the right, beside a send button that reads as one.
  expect($('[data-testid="worker-ask-box"]')?.className).toContain("shadow-sm");
  expect($('[data-testid="worker-ask-where"]')?.textContent).toBe("Sends to Chief of Staff in Fork redesign");
  expect(($('[data-testid="worker-ask-send"]') as HTMLButtonElement).disabled).toBe(true);
  await type("Is it done?");
  await act(async () => { $('[data-testid="worker-ask"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(state.call).toHaveBeenCalledWith("bot_worker_ask", { threadId: "w1", text: "Is it done?" });
  expect(state.toThread).toHaveBeenCalledWith("conv");
  // The owner's name opens it too.
  await act(async () => { $('[data-testid="worker-owner"]')!.click(); });
  expect(state.toThread).toHaveBeenLastCalledWith("conv");
});

it("says why when the question doesn't send, and keeps the text", async () => {
  state.call.mockRejectedValueOnce(new Error("Dot is paused."));
  await act(async () => { root.render(<ReadOnlyComposer threadId="w1" />); });
  await type("Still there?");
  await act(async () => { $('[data-testid="worker-ask-send"]')!.click(); });
  expect($('[role="alert"]')?.textContent).toBe("Dot is paused.");
  expect(($('[data-testid="worker-ask"]') as HTMLTextAreaElement).value).toBe("Still there?");
  expect(state.toThread).not.toHaveBeenCalled();
});

it("leaves a conversation's composer alone and shows a mirrored thread's take-over box", async () => {
  await act(async () => { root.render(<ReadOnlyComposer threadId="conv" />); });
  expect(host.innerHTML).toBe("");
  state.mirror = { mirrored: true, readOnly: true };
  await act(async () => { root.render(<ReadOnlyComposer threadId="conv" />); });
  expect($('[data-studio-readonly="mirror"] [data-testid="mirror-banner"]')).not.toBeNull();
});

it("on a BB that can't replace the composer, draws the box as a banner that hides the composer's own controls", async () => {
  await act(async () => { root.render(<ReadOnlyFallbackBanner />); });
  expect($("[data-studio-readonly-fallback] style")?.textContent).toContain("[data-composer-box]:has([data-studio-readonly-fallback])");
  expect($('[data-testid="worker-ask"]')).not.toBeNull();
  state.threadId = "conv";
  await act(async () => { root.render(<ReadOnlyFallbackBanner />); });
  expect(host.innerHTML).toBe("");
});

it("shows a conversation's active workers as chips, the one that needs Patrick first, and folds the done ones into one chip", async () => {
  state.threadId = "conv";
  await act(async () => { root.render(<ConversationWorkersLine />); });
  expect($('[data-testid="conversation-workers"]')?.textContent).not.toContain("from here");
  const chips = [...host.querySelectorAll<HTMLElement>('[data-testid="conversation-worker"]')];
  expect(chips.map((chip) => [chip.textContent, chip.dataset.status])).toEqual([["Codex", "needs-you"], ["Fable lead", "running"]]);
  expect(chips[0]!.className).toContain("max-w-[240px]");
  await act(async () => { chips[1]!.click(); });
  expect(state.toThread).toHaveBeenCalledWith("w1");
  expect($('[data-testid="conversation-workers-done"]')?.textContent).toBe("1 done");
  const listed = [...host.querySelectorAll<HTMLElement>('[data-testid="conversation-worker-done"]')];
  expect(listed.map((item) => item.textContent)).toEqual(["UX review"]);
  await act(async () => { listed[0]!.click(); });
  expect(state.toThread).toHaveBeenLastCalledWith("w2");
  // A worker has no such line.
  state.threadId = "w1";
  await act(async () => { root.render(<ConversationWorkersLine />); });
  expect(host.innerHTML).toBe("");
});

it("shows only the done chip when nothing is active, and nothing without workers", async () => {
  state.threadId = "conv";
  state.infos = { ...state.infos, conv: { ...conversation, workers: [{ threadId: "w2", title: "UX review", status: "done" }, { threadId: "w4", title: "Lint", status: "failed" }] } };
  await act(async () => { root.render(<ConversationWorkersLine />); });
  expect(host.querySelectorAll('[data-testid="conversation-worker"]')).toHaveLength(0);
  expect($('[data-testid="conversation-workers-done"]')?.textContent).toBe("2 done");
  state.infos = { ...state.infos, conv: { ...conversation, workers: [] } };
  await act(async () => { root.render(<ConversationWorkersLine />); });
  expect(host.innerHTML).toBe("");
});

it("lets Patrick answer a waiting worker's own question himself: its composer comes back in this window", async () => {
  state.infos = { ...state.infos, w9: { ...worker, threadId: "w9", status: "needs-you", waitingOn: "question" } };
  function Probe() { return <><output>{String(useReadOnly("w9"))}</output><ReadOnlyComposer threadId="w9" /></>; }
  await act(async () => { root.render(<Probe />); });
  expect($("output")?.textContent).toBe("worker");
  await act(async () => { $('[data-testid="worker-answer-here"]')!.click(); });
  expect($("output")?.textContent).toBe("null");
  // A worker that isn't waiting offers no such way.
  await act(async () => { root.render(<ReadOnlyComposer threadId="w1" />); });
  expect($('[data-testid="worker-answer-here"]')).toBeNull();
});

it("registers the replacement with BB's experimental_replace, the banner fallback beside it, and the workers line", () => {
  const customize = vi.fn();
  registerReadOnlyComposer({ composer: { customize }, slots: {} } as never);
  expect(customize.mock.calls[0]![0]).toMatchObject({ id: "readonly", scopes: ["thread"], banners: [{ id: "readonly-fallback", chrome: "bare" }], experimental_replace: { component: ReadOnlyComposer } });
  expect(typeof customize.mock.calls[0]![0].experimental_replace.useActive).toBe("function");
  expect(customize.mock.calls[1]![0]).toMatchObject({ id: "conversation-workers", banners: [{ id: "workers", component: ConversationWorkersLine }] });
  // Without thread banners, the live approval cards sit above the composer.
  expect(customize.mock.calls[2]![0]).toMatchObject({ id: "conversation-approvals", banners: [{ id: "approvals", chrome: "bare" }] });
});

it("opens a finished conversation read-only, with when it was finished and Reopen", async () => {
  const finishedAt = new Date(new Date().getFullYear(), 10, 10).getTime();
  state.infos = { ...state.infos, done: { ...conversation, threadId: "done", workers: [], archivedAt: finishedAt, finishedSummary: "**Decisions**\n- One mock a day" } };
  expect(readOnlyKind(state.infos.done as BotThreadInfo, false)).toBe("finished");
  // Archived without a Finish, or finished then reopened: the normal composer.
  expect(readOnlyKind({ ...conversation, archivedAt: finishedAt, finishedSummary: null }, false)).toBeNull();
  expect(readOnlyKind({ ...conversation, archivedAt: null, finishedSummary: "x" }, false)).toBeNull();
  await act(async () => { root.render(<ReadOnlyComposer threadId="done" />); });
  expect($('[data-testid="readonly-composer"]')?.dataset.studioReadonly).toBe("finished");
  expect($('[data-testid="finished-box"]')?.textContent).toContain("Archived on Nov 10. Read-only.");
  await act(async () => { $('[data-testid="finished-reopen"]')!.click(); });
  expect(state.call).toHaveBeenCalledWith("bot_reopen", { threadId: "done" });
});

it("an approval never brings the worker's composer back: the status line points to its conversation's card", async () => {
  state.infos = { ...state.infos, w8: { ...worker, threadId: "w8", status: "needs-you", waitingOn: "approval" } };
  function Probe() { return <><output>{String(useReadOnly("w8"))}</output><ReadOnlyComposer threadId="w8" /></>; }
  await act(async () => { root.render(<Probe />); });
  expect($('[data-testid="worker-answer-here"]')).toBeNull();
  expect($('[data-testid="worker-status"] [data-status]')?.textContent).toBe("Waiting for your approval");
  expect($('[data-testid="worker-for"]')?.textContent).toBe("Approve it in Fork redesign");
  expect($("output")?.textContent).toBe("worker");
});

it("puts the status line at the top of a worker where BB has no header slot, and only the Ask box at the bottom", async () => {
  const slots: unknown[] = [];
  registerReadOnlyComposer({ composer: { customize: () => {} }, slots: { experimental_threadBanner: (registration: unknown) => slots.push(registration) } } as never);
  expect(slots.map((slot) => (slot as { id: string }).id)).toEqual(["worker-status", "approvals"]);
  expect(slots[0]).toEqual({ id: "worker-status", component: WorkerStatusBanner });
  state.mirror = { mirrored: true, readOnly: true };
  await act(async () => { root.render(<><WorkerStatusBanner threadId="w1" /><ReadOnlyComposer threadId="w1" /></>); });
  expect($('[data-testid="worker-banner"]')?.textContent).toBe("Running·for Fork redesign");
  // The read-only line above the composer says it is mirrored; the row doesn't.
  expect($('[data-testid="worker-banner"] [data-testid="mirror-take-over"]')).toBeNull();
  expect($('[data-studio-readonly="worker"] [data-testid="worker-status"]')).toBeNull();
  expect($('[data-studio-readonly="worker"] [data-testid="worker-ask"]')).not.toBeNull();
  expect($('[data-testid="mirror-banner"]')).toBeNull();
  // A conversation gets no banner.
  await act(async () => { root.render(<WorkerStatusBanner threadId="conv" />); });
  expect(host.innerHTML).toBe("");
});

it("keeps a conversation's workers line where the composer is replaced (Main mirrored from bb): BB draws no banners there", async () => {
  state.mirror = { mirrored: true, readOnly: true };
  await act(async () => { root.render(<ReadOnlyComposer threadId="conv" />); });
  expect($('[data-studio-readonly="mirror"] [data-testid="conversation-workers"]')).not.toBeNull();
  expect($('[data-testid="mirror-banner"]')).not.toBeNull();
  // The banner fallback leaves the line to its own banner, and a worker has none.
  await act(async () => { root.render(<ReadOnlyComposer threadId="conv" replaced={false} />); });
  expect($('[data-testid="conversation-workers"]')).toBeNull();
  state.mirror = null;
  await act(async () => { root.render(<ReadOnlyComposer threadId="w1" />); });
  expect($('[data-testid="conversation-workers"]')).toBeNull();
});

function Header({ threadId }: { threadId: string }) {
  const decoration = useStudioThreadHeader({ threadId });
  return decoration ? <header><h1>{decoration.title ?? "BB title"}</h1>{decoration.after}</header> : null;
}

it("decorates BB's thread header in one row: a worker's state as a dot and muted text, a conversation's Bot as muted text", async () => {
  const slots: { id: string; useDecoration?: unknown }[] = [];
  registerReadOnlyComposer({ composer: { customize: () => {} }, slots: { experimental_threadBanner: () => {}, experimental_threadHeader: (registration: { id: string }) => slots.push(registration) } } as never);
  expect(slots).toEqual([{ id: "thread-header", useDecoration: useStudioThreadHeader }]);
  state.infos = { ...state.infos, main: { ...conversation, threadId: "main", isMain: true, title: "Chief of Staff" }, w9: { ...worker, threadId: "w9", status: "needs-you", waitingOn: "question", tag: null } };
  await act(async () => { root.render(<Header threadId="main" />); });
  expect($("h1")?.textContent).toBe("Main");
  expect($('[data-testid="conversation-bot"]')?.textContent).toBe("with Chief of Staff");
  await act(async () => { root.render(<Header threadId="conv" />); });
  expect($("h1")?.textContent).toBe("BB title");
  expect($('[data-testid="conversation-bot"]')?.className).toContain("text-muted-foreground");
  await act(async () => { root.render(<Header threadId="w1" />); });
  expect($("h1")?.textContent).toBe("BB title");
  expect($("header")?.textContent).toBe("BB titleRunning");
  expect($('[data-testid="worker-state"]')?.className).toContain("text-muted-foreground");
  expect($('[data-testid="worker-state"]')?.className).not.toContain("rounded-full");
  await act(async () => { root.render(<Header threadId="w9" />); });
  expect($('[data-testid="worker-state"]')?.textContent).toBe("Waiting for you");
  // A thread no Bot has keeps BB's header.
  await act(async () => { root.render(<Header threadId="other" />); });
  expect(host.innerHTML).toBe("");
});

it("with the state in the header, draws no row under it; a waiting worker's box says where to answer", async () => {
  setWorkerStatusOnTop(true);
  setWorkerStatusInHeader(true);
  state.mirror = { mirrored: true, readOnly: true };
  await act(async () => { root.render(<><WorkerStatusBanner threadId="w1" /><ReadOnlyComposer threadId="w1" /></>); });
  expect($('[data-testid="worker-banner"]')).toBeNull();
  expect($('[data-testid="worker-status"]')).toBeNull();
  expect($('[data-testid="worker-needs"]')).toBeNull();
  state.infos = { ...state.infos, w1: { ...worker, status: "needs-you", waitingOn: "approval" } };
  await act(async () => { root.render(<ReadOnlyComposer threadId="w1" />); });
  expect($('[data-testid="worker-needs"]')?.textContent).toBe("Approve it in Fork redesign");
  state.infos = { ...state.infos, w1: { ...worker, status: "needs-you", waitingOn: "question" } };
  await act(async () => { root.render(<ReadOnlyComposer threadId="w1" />); });
  expect($('[data-testid="worker-needs"] [data-testid="worker-answer-here"]')).not.toBeNull();
});

it("puts the conversation a worker works for in BB's Info tab as From, which opens it", async () => {
  const rows: { id: string; group: string; component: unknown }[] = [];
  registerReadOnlyComposer({ composer: { customize: () => {} }, slots: { experimental_threadInfoRow: (row: { id: string; group: string; component: unknown }) => rows.push(row) } } as never);
  expect(rows).toEqual([{ id: "worker-from", group: "1_thread", order: 49, component: WorkerFromRow }]);
  await act(async () => { root.render(<WorkerFromRow threadId="w1" />); });
  expect($('[data-testid="detail-row"]')?.dataset.label).toBe("From");
  expect($('[data-testid="worker-from"]')?.textContent).toBe("Fork redesign");
  await act(async () => { $('[data-testid="worker-from"]')!.click(); });
  expect(state.toThread).toHaveBeenCalledWith("conv");
  await act(async () => { root.render(<WorkerFromRow threadId="conv" />); });
  expect(host.innerHTML).toBe("");
});
