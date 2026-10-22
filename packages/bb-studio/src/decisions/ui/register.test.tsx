// @vitest-environment jsdom
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { registerDecisionsApp } from "./register";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
const settings = { values: {} };
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpc, useSettings: () => settings,
  experimental_ProviderModelPicker: ({ disabled }: { disabled?: boolean }) => <button disabled={disabled}>Pick model</button>,
}));
vi.mock("../../kit/ui/index", () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: { children: ReactNode; size?: string; variant?: string }) => <button {...props}>{children}</button>,
  Select: ({ value, disabled, onValueChange }: { value: string; disabled?: boolean; onValueChange(value: string): void }) => <select aria-label="Fallback model source" value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}><option value="thread">Thread</option><option value="model">Model</option><option value="off">Off</option></select>,
  SelectContent: () => null, SelectItem: () => null, SelectTrigger: () => null, SelectValue: () => null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ""; rpc.call.mockReset(); });
async function mount(id: string) {
  const sections = new Map<string, ComponentType>();
  registerDecisionsApp({ slots: { settingsSection: (section: { id: string; component: ComponentType }) => sections.set(section.id, section.component) } } as unknown as PluginAppBuilder);
  const Component = sections.get(id)!;
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(<Component />); });
}
async function choose(value: string) {
  await act(async () => {
    const select = document.querySelector("select")!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("shows status RPC errors and can retry", async () => {
  rpc.call.mockRejectedValueOnce(new Error("Status unavailable")).mockResolvedValue({ provider: "auto", routes: [], problems: [] });
  await mount("decisions-jev-connection");
  expect(document.body.textContent).toContain("Status unavailable");
  expect(document.body.textContent).not.toContain("Loading…");
  await act(async () => { [...document.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click(); });
  expect(document.body.textContent).toContain("None configured");
});

it("shows suggestion failures separately from an empty catalog", async () => {
  rpc.call.mockImplementation(async (method) => {
    if (method === "decisions.fallback.get") return { mode: "thread" };
    throw new Error("Catalog unavailable");
  });
  await mount("decisions-fallback-model");
  await choose("model");
  expect(document.body.textContent).toContain("Catalog unavailable");
  expect(document.body.textContent).not.toContain("No available provider");
});

it("prevents another choice while a save is pending, including a failed save", async () => {
  const pending = deferred<unknown>();
  rpc.call.mockImplementation((method) => method === "decisions.fallback.get" ? Promise.resolve({ mode: "thread" }) : pending.promise);
  await mount("decisions-fallback-model");
  await choose("off");
  expect(document.querySelector("select")!.disabled).toBe(true);
  await choose("thread"); // Even a stale/programmatic callback must not send another save.
  expect(rpc.call.mock.calls.filter(([method]) => method === "decisions.fallback.set")).toHaveLength(1);
  await act(async () => { pending.reject(new Error("Save failed")); });
  expect(document.querySelector("select")!.value).toBe("thread");
  expect(document.querySelector("select")!.disabled).toBe(false);
});

it("disables choices while suggesting a model", async () => {
  const pending = deferred<unknown>();
  rpc.call.mockImplementation((method) => method === "decisions.fallback.get" ? Promise.resolve({ mode: "thread" }) : pending.promise);
  await mount("decisions-fallback-model");
  await choose("model");
  expect(document.querySelector("select")!.disabled).toBe(true);
  await choose("off");
  expect(rpc.call.mock.calls.some(([method]) => method === "decisions.fallback.set")).toBe(false);
  await act(async () => { pending.resolve(null); });
  expect(document.querySelector("select")!.disabled).toBe(false);
  expect(document.body.textContent).toContain("No available provider has a model");
});
