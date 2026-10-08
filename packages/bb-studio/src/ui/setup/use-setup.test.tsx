// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { SetupSummary } from "../../setup-contract";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc, useRealtime: () => {} }));

const { useSetup } = await import("./use-setup");

const summary = (checkedAt: number) => ({ checkedAt } as SetupSummary);

test("a summary that was requested before an install finished doesn't replace the install's result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const resolvers: Record<string, (value: unknown) => void> = {};
  let loads = 0;
  rpc.call.mockImplementation((method: string) => {
    if (method === "setup.summary") return loads++ === 0 ? Promise.resolve(summary(1)) : new Promise((resolve) => { resolvers.late = resolve; });
    return Promise.resolve({ summary: summary(3), failures: [] });
  });
  let api!: ReturnType<typeof useSetup>;
  function Probe() { api = useSetup(); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  expect(api.summary?.checkedAt).toBe(1);
  // A refresh starts, then the install completes, then the old refresh answers.
  await act(async () => { void api.checkAgain(); });
  await act(async () => { await api.install(["pages"]); });
  expect(api.summary?.checkedAt).toBe(3);
  await act(async () => resolvers.late!(summary(2)));
  expect(api.summary?.checkedAt).toBe(3);
  act(() => root.unmount());
});
