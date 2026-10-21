// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { KindsState } from "../../kinds-contract";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc, useRealtime: () => {} }));
vi.mock("../../kit/ui/index", () => ({
  Button: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => React.createElement("button", props),
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
  Select: ({ children }: { children: React.ReactNode }) => React.createElement("div", { "data-select": true }, children),
  SelectTrigger: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("div", props, children),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  SelectItem: ({ children }: { children: React.ReactNode }) => React.createElement("div", { role: "option" }, children),
}));

const { KindsSection } = await import("./KindsSection");

const studio = (pluginId: string, kind: string, label: string) => ({ pluginId, name: "Studio", kindId: kind, label });
const state = (pageOn = true): KindsState => ({
  kinds: [
    { kind: "page", label: "Pages", covers: "Pages and their tab.", on: pageOn, choice: null, active: { pluginId: "notion", name: "Notion", kindId: "notion-page", label: "Notion page" }, reason: "only-replacement", alternatives: [{ pluginId: "notion", name: "Notion", kindId: "notion-page", label: "Notion page" }] },
    { kind: "drawing", label: "Drawings", covers: "Drawings.", on: true, choice: null, active: studio("excalidraw", "drawing", "Drawings"), reason: "built-in", alternatives: [] },
  ],
  frontend: { off: pageOn ? [] : ["page"], routedAway: ["page"] },
});

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpc.call.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test("lists each built-in kind with its switch, and offers alternatives only where they exist", async () => {
  rpc.call.mockImplementation(async (method: string, input: unknown) => method === "kinds.state" ? state() : (expect(input).toEqual({ kind: "page", on: false }), state(false)));
  await act(async () => root.render(React.createElement(KindsSection)));
  const switches = [...container.querySelectorAll('[role="switch"]')];
  expect(switches.map((each) => each.getAttribute("aria-label"))).toEqual(["Pages: turn off", "Drawings: turn off"]);
  expect(container.textContent).toContain("Open and create with");
  expect([...container.querySelectorAll('[role="option"]')].map((each) => each.textContent)).toEqual(["Automatic (Notion)", "Studio", "Notion (Notion page)"]);
  expect(container.textContent).toContain("New pages are made with Notion.");
  await act(async () => (switches[0] as HTMLButtonElement).click());
  expect(rpc.call).toHaveBeenCalledWith("kinds.update", { kind: "page", on: false });
  expect(container.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).toContain("Your pages are kept.");
});
