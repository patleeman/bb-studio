// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const panelProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const rpcCall = vi.hoisted(() => vi.fn(async (_method: string, _input?: unknown) => ({}) as unknown));

vi.mock("@bb-studio/kit/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ThreadItemsPanel: (props: Record<string, unknown>) => {
    panelProps.current = props;
    return null;
  },
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRpc: () => ({ call: rpcCall }),
  useRealtime: () => {},
  useSdk: () => ({}),
}));

const { default: DashboardsTab, dashboardParam } = await import("./dashboard-tab");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  panelProps.current = null;
  rpcCall.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Dashboards thread tab", () => {
  it("lists the thread's dashboards through Studio's links, opening the one it was given", async () => {
    act(() => root.render(<DashboardsTab threadId="thr_1" params={{ dashboardId: "dsh_e45b713f3e6f18f3" }} />));
    const props = panelProps.current!;
    expect(props).toMatchObject({ threadId: "thr_1", pluginId: "dashboards", kind: "dashboard", channel: "dashboards", initialId: "dsh_e45b713f3e6f18f3" });
    await (props.call as (method: string, input: unknown) => Promise<unknown>)("studio_list", null);
    expect(rpcCall).toHaveBeenCalledWith("provider.call", { pluginId: "dashboards", method: "studio_list", input: null });
  });

  it("ignores params that aren't a dashboard id", () => {
    expect(dashboardParam(null)).toBeNull();
    expect(dashboardParam({ dashboardId: "nope" })).toBeNull();
    expect(dashboardParam({ dashboardId: "dsh_0123456789abcdef" })).toBe("dsh_0123456789abcdef");
  });

  it("heartbeats dashboards.view for the open dashboard, so the panel counts as viewing", async () => {
    act(() => root.render(<DashboardsTab threadId="thr_1" params={null} />));
    const renderItem = panelProps.current!.renderItem as (id: string, options: { backLabel: string; onBack(): void }) => React.ReactNode;
    await act(async () => root.render(<>{renderItem("dsh_0123456789abcdef", { backLabel: "Dashboards", onBack: () => {} })}</>));
    expect(rpcCall).toHaveBeenCalledWith("dashboards.view", expect.objectContaining({ id: "dsh_0123456789abcdef" }));
  });
});
