// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  values: { autoTitle: false } as Record<string, unknown>,
  calls: [] as string[],
  realtime: null as null | (() => void),
  client: null as unknown,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => (sdk.client ??= {
    call: async (method: string, input: { values?: Record<string, unknown> } | null) => {
      sdk.calls.push(method);
      if (method === "settings.set") sdk.values = { ...sdk.values, ...input!.values };
      return { values: sdk.values, changed: Object.keys(sdk.values), timeZone: "Europe/Paris" };
    },
  }),
  useRealtime: (channel: string, listener: () => void) => { if (channel === "studio-settings") sdk.realtime = listener; },
}));

import { useStudioSettings, type StudioSettingsState } from "./use-settings";

it("loads Studio's settings once per window, saves changes, and refetches when the server says they changed", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let seen: StudioSettingsState | null = null;
  const Probe = () => { seen = useStudioSettings(); return null; };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(<><Probe /><Probe /></>); });
  expect(seen!.values).toMatchObject({ autoTitle: false, autoMeetingNotes: false, loopDailyBudget: 5 });
  expect(seen!.timeZone).toBe("Europe/Paris");
  expect(sdk.calls).toEqual(["settings.get"]);
  await act(async () => { await seen!.set({ loopDailyBudget: 2 }); });
  expect(seen!.values!.loopDailyBudget).toBe(2);
  sdk.values = { ...sdk.values, autoTitle: true };
  await act(async () => { sdk.realtime!(); });
  expect(seen!.values!.autoTitle).toBe(true);
  act(() => root.unmount());
});
