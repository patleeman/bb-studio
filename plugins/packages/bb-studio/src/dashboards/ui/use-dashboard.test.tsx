// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DASHBOARD_UPDATE_TYPE, DATA_UPDATE_TYPE, EMPTY_LAYOUTS, type DashboardView } from "../shared";

const mocks = vi.hoisted(() => ({ call: vi.fn(), event: (_payload: unknown) => {}, error: vi.fn() }));
const rpc = { call: mocks.call };
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc, useRealtime: (_channel: string, callback: typeof mocks.event) => { mocks.event = callback; } }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, info: vi.fn() } }));
const { useDashboard } = await import("./use-dashboard");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const view = (updatedAt: number, name = "Ops", id = "dsh_one"): DashboardView => ({
  id, name, updatedAt, createdAt: 1, projectId: null, archived: false, widgetCount: 0,
  widgets: [], layouts: EMPTY_LAYOUTS, data: [], widgetTypes: [],
});
let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useDashboard>;
function Probe({ id }: { id: string }) { state = useDashboard(id); return null; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.call.mockReset(); mocks.error.mockReset();
  mocks.call.mockResolvedValue({ ok: true });
  container = document.createElement("div"); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function mount(next = view(10)) {
  mocks.call.mockImplementation(async (method: string) => method === "dashboards.get" ? { dashboard: next } : { ok: true });
  await act(async () => root.render(<Probe id={next.id} />));
}

it("does not let an old load overwrite an edit or restore snapshot", async () => {
  await mount();
  const old = deferred<{ dashboard: DashboardView }>();
  mocks.call.mockReturnValueOnce(old.promise);
  let load!: Promise<void>;
  act(() => { load = state.load(); });
  act(() => state.apply(view(20, "Restored")));
  await act(async () => { old.resolve({ dashboard: view(10) }); await load; });
  expect(state.dashboard?.name).toBe("Restored");
});

it("rejects out-of-order edit responses", async () => {
  await mount();
  const older = deferred<{ dashboard: DashboardView }>();
  const newer = deferred<{ dashboard: DashboardView }>();
  mocks.call.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  let a!: Promise<unknown>, b!: Promise<unknown>;
  act(() => { a = state.edit([]); b = state.edit([]); });
  await act(async () => { newer.resolve({ dashboard: view(30, "New") }); await b; });
  await act(async () => { older.resolve({ dashboard: view(20, "Old") }); await a; });
  expect(state.dashboard?.name).toBe("New");
});

it("supersedes a pending load when layout saves and rejects older layout responses", async () => {
  await mount();
  const old = deferred<{ dashboard: DashboardView }>();
  const layout = { ...EMPTY_LAYOUTS, lg: [{ i: "w1", x: 1, y: 0, w: 3, h: 3 }] };
  mocks.call.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ updatedAt: 20 });
  let load!: Promise<void>;
  act(() => { load = state.load(); });
  await act(async () => state.saveLayout(layout));
  await act(async () => { old.resolve({ dashboard: view(10) }); await load; });
  expect(state.dashboard?.layouts).toEqual(layout);
  act(() => state.apply(view(30)));
  mocks.call.mockResolvedValueOnce({ updatedAt: 25 });
  await act(async () => state.saveLayout(layout));
  expect(state.dashboard?.updatedAt).toBe(30);
  expect(state.dashboard?.layouts).toEqual(EMPTY_LAYOUTS);
});

it.each([DASHBOARD_UPDATE_TYPE, DATA_UPDATE_TYPE])("reloads %s at the same document revision", async (type) => {
  await mount();
  const next = { ...view(10), name: "Approval or type changed", data: [{ widgetId: "w1", value: 42, fetchedAt: 5, error: null, errorAt: null, status: "ok" as const }] };
  mocks.call.mockResolvedValueOnce({ dashboard: next });
  await act(async () => mocks.event({ type, dashboardId: "dsh_one", updatedAt: 10 }));
  expect(state.dashboard).toEqual(next);
});

it("keeps the last view on an unavailable read and accepts a confirmed absence", async () => {
  await mount();
  mocks.call.mockRejectedValueOnce(new Error("offline"));
  await act(async () => state.load());
  expect(state.dashboard?.updatedAt).toBe(10);
  expect(mocks.error).toHaveBeenCalledWith("offline");
  mocks.call.mockRejectedValueOnce({ code: "NOT_FOUND" });
  await act(async () => state.load());
  expect(state.dashboard).toBeNull();
});

it("does not apply responses from the previous dashboard", async () => {
  await mount();
  const old = deferred<{ dashboard: DashboardView }>();
  mocks.call.mockReturnValueOnce(old.promise);
  let edit!: Promise<unknown>;
  act(() => { edit = state.edit([]); });
  await mount(view(2, "Other", "dsh_two"));
  await act(async () => { old.resolve({ dashboard: view(40) }); await edit; });
  expect(state.dashboard?.id).toBe("dsh_two");
  expect(state.dashboard?.updatedAt).toBe(2);
});
