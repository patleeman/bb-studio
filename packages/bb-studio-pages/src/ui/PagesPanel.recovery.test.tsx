// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PagesPanel } from "./PagesPanel";

const state = vi.hoisted(() => ({
  call: vi.fn(), navigate: vi.fn(), handler: (_event: unknown) => {},
}));
const rpc = { call: state.call };
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpc,
  useBbNavigate: () => ({ toPluginPanel: state.navigate }),
  useRealtime: (_channel: string, handler: typeof state.handler) => { state.handler = handler; },
}));
vi.mock("@bb-studio/kit/app", () => ({
  AddOnCollection: () => null,
  navigateFromFloat: vi.fn(), openAppPath: vi.fn(), studioPath: vi.fn(), useStudioPresent: () => false,
}));
vi.mock("./shared", () => ({ useProjects: () => [] }));
vi.mock("./PageView", () => ({ PageView: () => <div>Live editor</div> }));
vi.mock("./PageChat", () => ({ PageConversation: () => null }));
vi.mock("./MissingPageRecovery", () => ({ MissingPageRecovery: ({ pageId, onRetryPage }: { pageId: string; onRetryPage(): void }) => <div>Recovery for {pageId}<button onClick={onRetryPage}>Retry loading page</button></div> }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.call.mockImplementation((method: string) => Promise.resolve(method === "tree" ? { pages: [] } : method === "bots" ? { available: false, reason: null, bots: [] } : { page: null }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("opens recovery when revisiting a page with missing metadata", async () => {
  await act(async () => root.render(<PagesPanel subPath="pg_deleted" />));
  expect(container.textContent).toContain("Recovery for pg_deleted");
  expect(state.navigate).not.toHaveBeenCalled();
});

it("keeps recovery reachable after deletion even if an earlier get resolves late", async () => {
  let resolveGet!: (result: unknown) => void;
  const get = new Promise(resolve => { resolveGet = resolve; });
  const previousCall = state.call.getMockImplementation()!;
  state.call.mockImplementation((method: string, input: unknown) => method === "get" ? get : previousCall(method, input));
  await act(async () => root.render(<PagesPanel subPath="pg_deleted" />));
  await act(async () => state.handler({ type: "deleted", pageIds: ["pg_deleted"] }));
  expect(container.textContent).toContain("Recovery for pg_deleted");
  await act(async () => resolveGet({ page: { id: "pg_deleted", title: "Stale metadata" } }));
  expect(container.textContent).toContain("Recovery for pg_deleted");
  expect(container.textContent).not.toContain("Live editor");
  expect(state.navigate).not.toHaveBeenCalled();
});

it("retries metadata without hiding recovery, then returns to an existing page", async () => {
  await act(async () => root.render(<PagesPanel subPath="pg_temporary" />));
  let resolveGet!: (result: unknown) => void;
  state.call.mockImplementationOnce(() => new Promise(resolve => { resolveGet = resolve; }));
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toContain("Recovery for pg_temporary");
  await act(async () => resolveGet({ page: { id: "pg_temporary", title: "Existing page" } }));
  expect(container.textContent).toBe("Live editor");
  expect(state.call).not.toHaveBeenCalledWith("create", expect.anything());
});

it("keeps a missing-page retry read-only when metadata is still null", async () => {
  await act(async () => root.render(<PagesPanel subPath="pg_deleted" />));
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toContain("Recovery for pg_deleted");
  expect(state.call.mock.calls.filter(([method]) => method === "get")).toHaveLength(2);
  expect(state.call).not.toHaveBeenCalledWith("create", expect.anything());
});

it("ignores an old route's response after changing pages", async () => {
  let resolveOld!: (result: unknown) => void;
  const previousCall = state.call.getMockImplementation()!;
  state.call.mockImplementation((method: string, input: { id?: string }) => method === "get" && input.id === "pg_old" ? new Promise(resolve => { resolveOld = resolve; }) : previousCall(method, input));
  await act(async () => root.render(<PagesPanel subPath="pg_old" />));
  await act(async () => root.render(<PagesPanel subPath="pg_new" />));
  expect(container.textContent).toContain("Recovery for pg_new");
  await act(async () => resolveOld({ page: { id: "pg_old", title: "Old page" } }));
  expect(container.textContent).toContain("Recovery for pg_new");
  expect(container.textContent).not.toContain("Live editor");
});
