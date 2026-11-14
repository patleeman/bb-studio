// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { effectiveSettings } from "../../settings/schema";

installTestPluginRuntime();

const state = vi.hoisted(() => ({
  values: null as Record<string, unknown> | null,
  set: vi.fn(async (_patch: Record<string, unknown>) => {}),
}));
vi.mock("../../settings/ui/use-settings", () => ({
  useStudioSettings: () => ({ values: state.values, changed: [], timeZone: "America/New_York", defaultTimeZone: "America/New_York", isLoading: false, error: null, set: state.set }),
}));
vi.mock("../../kit/ui/index", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Select: ({ value, onValueChange, children }: { value: string; onValueChange(next: string): void; children: ReactNode }) => (
    <select data-value={value} value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

const { BotAttention, zoneWords } = await import("./BotAttention");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.values = effectiveSettings({});
  state.set.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const zoneSelect = () => host.querySelector('[data-testid="attention-zone"] select') as HTMLSelectElement;

it("picks Todos' time zone: this computer's by default, any IANA zone, and back to this computer", async () => {
  await act(async () => { root.render(<BotAttention botName="Juno" />); });
  const select = zoneSelect();
  expect(select.value).toBe("computer");
  expect(select.options[0]!.textContent).toBe(`This computer · ${zoneWords("America/New_York")}`);
  expect([...select.options].some((option) => option.value === "America/Los_Angeles")).toBe(true);
  expect(host.textContent).not.toContain("STUDIO_LOOP_TIME_ZONE");
  await act(async () => {
    select.value = "America/Los_Angeles";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(state.set).toHaveBeenCalledWith({ todosTimeZone: "America/Los_Angeles" });

  state.values = effectiveSettings({ todosTimeZone: "America/Los_Angeles" });
  await act(async () => { root.render(<BotAttention botName="Juno" />); });
  expect(zoneSelect().value).toBe("America/Los_Angeles");
  await act(async () => {
    zoneSelect().value = "computer";
    zoneSelect().dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(state.set).toHaveBeenLastCalledWith({ todosTimeZone: "" });
});

it("names a zone by its place and its short name", () => {
  expect(zoneWords("America/Los_Angeles")).toMatch(/^America\/Los Angeles \((PST|PDT)\)$/);
  expect(zoneWords("Mars/Olympus")).toBe("Mars/Olympus");
});
