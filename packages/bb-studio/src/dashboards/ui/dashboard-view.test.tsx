// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardView } from "../shared";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRpc: () => ({ call: async () => ({}) }),
  useRealtime: () => {},
  useSdk: () => ({}),
  ThreadTitle: () => null,
  experimental_Icon: ({ name }: { name: string }) => React.createElement("i", { "data-icon": name }),
}));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }

const { DashboardBoard } = await import("./dashboard-view");

const view = (overrides: Partial<DashboardView> = {}): DashboardView => ({
  id: "dsh_0123456789abcdef", name: "Ops", projectId: null, createdAt: 1, updatedAt: 2, widgetCount: 2, archived: false,
  widgets: [
    { id: "w1", type: "stat", title: "Revenue", options: {}, source: { kind: "url", url: "https://api.example/r", intervalSec: 60 }, customType: null, html: null, script: null },
    { id: "w2", type: "stat", title: "Jobs", options: {}, source: { kind: "script", command: "echo 3", intervalSec: 300 }, customType: null, html: null, script: { sha256: "a".repeat(64), approved: false } },
  ],
  layouts: { lg: [{ i: "w1", x: 0, y: 0, w: 3, h: 3 }, { i: "w2", x: 3, y: 0, w: 3, h: 3 }], md: [], sm: [] },
  data: [
    { widgetId: "w1", value: 1200, fetchedAt: Date.now() - 120_000, error: null, errorAt: null, status: "ok" },
    { widgetId: "w2", value: null, fetchedAt: null, error: null, errorAt: null, status: "approval" },
  ],
  widgetTypes: [],
  ...overrides,
});

function fakeState(current: DashboardView) {
  return {
    dashboard: current,
    edit: vi.fn(async () => current),
    saveLayout: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
    apply: vi.fn(),
    load: vi.fn(async () => {}),
    rename: vi.fn(),
    rpc: { call: vi.fn(async (method: string) => (method === "dashboards.widgetTypes" ? { types: [] } : { versions: [] })) },
  };
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.getAttribute("aria-label") === label || each.textContent?.trim() === label);
const click = async (element: Element | undefined) => {
  if (!element) throw new Error("No such element");
  await act(async () => (element as HTMLElement).click());
};

async function render(state: ReturnType<typeof fakeState>) {
  await act(async () => root.render(<DashboardBoard dashboard={state.dashboard} state={state as never} />));
}

describe("the dashboard grid", () => {
  it("shows widgets in view mode with their freshness, and no edit controls", async () => {
    const state = fakeState(view());
    await render(state);
    expect(container.querySelectorAll("[data-widget-id]")).toHaveLength(2);
    expect(container.textContent).toContain("1,200");
    expect(container.textContent).toContain("Updated 2m ago");
    expect(button("Settings for Revenue")).toBeUndefined();
    expect(container.querySelector(".dashboard-drag")).toBeNull();
    expect(container.querySelector(".react-grid-item:not(.react-resizable-hide) > .react-resizable-handle")).toBeNull();
  });

  it("asks before running a script in a dialog with Deny focused, and approves with its nonce", async () => {
    const state = fakeState(view());
    const prompt = {
      nonce: "n".repeat(43), notBefore: Date.now() - 1, expiresAt: Date.now() + 300_000, sha256: "a".repeat(64),
      command: "echo 3", cwd: "/Users/me", cwdIsHome: true, host: "studio-mac", intervalSec: 300, backgroundSec: 1800,
      timeoutSec: 30, maxOutputBytes: 1024 * 1024, proposedBy: { actor: "agent", threadId: "thr_1", threadTitle: "Ops review", at: Date.now() - 60_000 },
    };
    state.rpc.call.mockImplementation(async (method: string) => (method === "dashboards.requestApproval" ? { prompt } : method === "dashboards.widgetTypes" ? { types: [] } : { ok: true }) as never);
    await render(state);
    const card = container.querySelector("[aria-label='Script approval']")!;
    expect(card.textContent).toContain("echo 3");
    expect(state.rpc.call).not.toHaveBeenCalledWith("dashboards.approveScript", expect.anything());
    await click([...card.querySelectorAll("button")].find((each) => each.textContent === "Review command…"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    const dialog = document.querySelector("[data-dashboard-approval]")!;
    expect(dialog.querySelector("[data-approval-command]")!.textContent).toBe("echo 3");
    for (const text of ["/Users/me", "(home)", "studio-mac", "Every 5 minutes while the dashboard is open; every 30 minutes otherwise", "Stopped after 30 s; output up to 1 MB", "An agent in “Ops review”, 1m ago"]) expect(dialog.textContent).toContain(text);
    expect(document.activeElement).toBe(dialog.querySelector("[data-approval-deny]"));
    await click(dialog.querySelector("[data-approval-approve]")!);
    expect(state.rpc.call).toHaveBeenCalledWith("dashboards.approveScript", { id: "dsh_0123456789abcdef", widgetId: "w2", sha256: "a".repeat(64), nonce: prompt.nonce });
    expect(state.load).toHaveBeenCalled();
    expect(document.querySelector("[data-dashboard-approval]")).toBeNull();
  });

  it("Deny closes the dialog and gives up its nonce", async () => {
    const state = fakeState(view());
    const prompt = { nonce: "m".repeat(43), notBefore: Date.now() - 1, expiresAt: Date.now() + 300_000, sha256: "a".repeat(64), command: "echo 3", cwd: "/tmp", cwdIsHome: false, host: "h", intervalSec: 300, backgroundSec: 1800, timeoutSec: 30, maxOutputBytes: 1048576, proposedBy: null };
    state.rpc.call.mockImplementation(async (method: string) => (method === "dashboards.requestApproval" ? { prompt } : { ok: true }) as never);
    await render(state);
    await click(button("Review command…"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    await click(document.querySelector("[data-approval-deny]")!);
    expect(document.querySelector("[data-dashboard-approval]")).toBeNull();
    expect(state.rpc.call).toHaveBeenCalledWith("dashboards.cancelApproval", { nonce: prompt.nonce });
    expect(state.rpc.call).not.toHaveBeenCalledWith("dashboards.approveScript", expect.anything());
  });

  it("turns on dragging, resizing, settings and removal in edit mode", async () => {
    const state = fakeState(view());
    await render(state);
    await click(button("Edit"));
    expect(button("Done")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".dashboard-drag")).toHaveLength(2);
    expect(container.querySelectorAll(".react-grid-item:not(.react-resizable-hide) > .react-resizable-handle")).toHaveLength(2);
    await click(button("Remove Revenue"));
    expect(state.edit).toHaveBeenCalledWith([{ op: "remove", widgetId: "w1" }]);
  });

  it("adds a widget from the picker, then opens its settings and saves them", async () => {
    const added = view({ widgets: [...view().widgets, { id: "w3", type: "note", title: "Note", options: { markdown: "hi" }, source: { kind: "none" }, customType: null, html: null, script: null }] });
    const state = fakeState(view());
    state.edit.mockResolvedValueOnce(added);
    await render(state);
    await click(button("Edit"));
    await click(button("Add widget"));
    expect(container.querySelector("[role=dialog][aria-label='Add a widget']")).not.toBeNull();
    await click([...container.querySelectorAll("button")].find((each) => each.textContent?.startsWith("Note")));
    expect(state.edit).toHaveBeenCalledWith([expect.objectContaining({ op: "add", type: "note" })]);
    // The new widget isn't in this render's dashboard; open the first one's settings instead.
    await click(button("Settings for Revenue"));
    const sheet = container.querySelector("[role=dialog][aria-label='Settings for Revenue']")!;
    expect(sheet).not.toBeNull();
    const title = sheet.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(title, "Sales");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    state.edit.mockResolvedValueOnce(view());
    await click([...sheet.querySelectorAll("button")].find((each) => each.textContent === "Save"));
    expect(state.edit).toHaveBeenLastCalledWith([expect.objectContaining({ op: "update", widgetId: "w1", title: "Sales", source: expect.objectContaining({ kind: "url", url: "https://api.example/r" }) })]);
  });

  it("offers to add the first widget on an empty dashboard", async () => {
    const state = fakeState(view({ widgets: [], data: [], layouts: { lg: [], md: [], sm: [] } }));
    await render(state);
    expect(container.textContent).toContain("No widgets yet");
    await click(button("Add widget"));
    expect(container.querySelector("[aria-label='Add a widget']")).not.toBeNull();
  });
});
