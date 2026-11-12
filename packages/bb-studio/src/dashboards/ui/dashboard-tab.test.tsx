// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcCall = vi.hoisted(() => vi.fn(async (_method: string, _input?: unknown) => ({}) as unknown));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRpc: () => ({ call: rpcCall }),
  useRealtime: () => {},
  useSdk: () => ({}),
}));

const { TabDashboard } = await import("./dashboard-tab");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rpcCall.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("A dashboard in the Studio tab", () => {
  it("heartbeats dashboards.view for the open dashboard, so the panel counts as viewing", async () => {
    await act(async () => root.render(<TabDashboard dashboardId="dsh_0123456789abcdef" backLabel="Studio" onBack={() => {}} />));
    expect(rpcCall).toHaveBeenCalledWith("dashboards.view", expect.objectContaining({ id: "dsh_0123456789abcdef" }));
  });
});
