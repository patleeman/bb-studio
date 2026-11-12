// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BotThreadInfo } from "../../bot-threads-contract";

const state = vi.hoisted(() => ({ page: "main", composer: "main" }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbContext: () => ({ threadId: state.page, projectId: null }),
  useComposer: () => ({ scope: { kind: "thread", threadId: state.composer } }),
  useBbNavigate: () => ({ toThread: () => {} }),
  experimental_DetailRow: () => null,
}));
const info = (threadId: string, isMain: boolean): BotThreadInfo => ({
  threadId, botId: "dot", botName: "Chief of Staff", kind: "conversation", isMain, title: isMain ? "Main" : "Reply in thread", forkedFrom: isMain ? null : { threadId: "main", messageId: null, turnId: null, title: "Main" },
  owner: null, status: null, waitingOn: null, startedAt: 0, tag: null, branch: null, archivedAt: null, finishedSummary: null, finishing: false, needsYou: null, projectId: "proj",
  workers: isMain ? [{ threadId: "w1", title: "Main's worker", status: "running" }] : [],
});
vi.mock("../live", () => ({
  useLive: (_method: string, input: { threadId: string }) => ({ data: { info: input.threadId === "main" ? info("main", true) : input.threadId === "panel" ? info("panel", false) : null }, error: null, loading: false, refresh: () => {} }),
  useCall: () => async () => ({}),
}));
vi.mock("../../kit/app/index", () => ({
  Icon: () => null,
  DropdownMenu: () => null, DropdownMenuTrigger: () => null, DropdownMenuContent: () => null, DropdownMenuItem: () => null,
}));
vi.mock("./ConversationApprovals", () => ({ ConversationApprovals: () => null, ConversationApprovalsBanner: () => null }));

import { ConversationWorkersLine, ReadOnlyFallbackBanner } from "./ReadOnlyComposer";

const mirrors: Record<string, { mirrored: boolean; readOnly?: boolean }> = { main: { mirrored: true, readOnly: true }, panel: { mirrored: false } };

let root: Root;
let host: HTMLDivElement;
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const id = decodeURIComponent(url.split("/").pop() ?? "");
    return new Response(JSON.stringify(mirrors[id] ?? { mirrored: false }), { status: 200 });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.page = "main";
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render(composer: string) {
  state.composer = composer;
  await act(async () => { root.render(<><ReadOnlyFallbackBanner /><ConversationWorkersLine /></>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

it("draws no read-only box over a writable panel thread beside a mirrored Main, and keeps it on Main", async () => {
  await render("panel");
  expect($('[data-testid="mirror-banner"]')).toBeNull();
  expect($("[data-studio-readonly-fallback]")).toBeNull();
  expect($('[data-testid="conversation-workers"]')).toBeNull();
  await act(async () => { root.unmount(); });
  root = createRoot(host);
  await render("main");
  expect($('[data-studio-readonly="mirror"] [data-testid="mirror-banner"]')?.textContent).toContain("Read-only");
  expect($('[data-testid="conversation-workers"]')?.textContent).toContain("Main's worker");
});
