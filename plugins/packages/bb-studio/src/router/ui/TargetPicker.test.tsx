// @vitest-environment happy-dom
// A chain entry's picker reports values on its own when it opens (a fallback
// for an agent that isn't installed or a retired model). Those must not
// rewrite the saved entry; only what the person picks does.
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Target } from "../contract";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Like BB's picker: on open it falls back from an unoffered provider to one it has; a click picks a model.
  experimental_ProviderModelPicker: ({ onChange }: { onChange(next: { providerId: string; model: string; reasoningLevel: string }): void }) => {
    useEffect(() => { onChange({ providerId: "codex", model: "gpt-5.5-codex", reasoningLevel: "medium" }); }, []);
    return <button type="button" data-testid="fake-picker" onClick={() => onChange({ providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: "medium" })}>pick</button>;
  },
}));
const { TargetPicker } = await import("./RouterSettings");

const missing: Target = { providerId: "acp-antigravity", model: "gemini-3-pro", reasoningLevel: null, label: "Gemini Pro" };
let root: Root, element: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); });

it("keeps an entry for an agent that isn't installed when the picker falls back on open, and takes what the person picks", async () => {
  const changes: Target[] = [];
  await act(async () => { root.render(<TargetPicker target={missing} disabled={false} onAuto={() => undefined} onChange={(next) => changes.push(next)} />); });
  expect(changes).toEqual([]);
  const picker = element.querySelector('[data-testid="fake-picker"]') as HTMLButtonElement;
  await act(async () => {
    picker.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    picker.click();
  });
  expect(changes).toEqual([{ providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: "medium" }]);
});

it("drops a fallback report that comes after the menu closed without a pick", async () => {
  const changes: Target[] = [];
  let clock = 1_000_000;
  await act(async () => { root.render(<TargetPicker target={missing} disabled={false} now={() => clock} onAuto={() => undefined} onChange={(next) => changes.push(next)} />); });
  const picker = element.querySelector('[data-testid="fake-picker"]') as HTMLButtonElement;
  // Opened, then closed without a pick.
  await act(async () => { picker.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  clock += 30_000;
  // Provider states refresh and the picker falls back on its own.
  await act(async () => { picker.click(); });
  expect(changes).toEqual([]);
  // Escape also ends the interaction.
  await act(async () => { picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await act(async () => { picker.click(); });
  expect(changes).toEqual([]);
});

it("counts a pick once: a second report without a new press is dropped", async () => {
  const changes: Target[] = [];
  await act(async () => { root.render(<TargetPicker target={missing} disabled={false} onAuto={() => undefined} onChange={(next) => changes.push(next)} />); });
  const picker = element.querySelector('[data-testid="fake-picker"]') as HTMLButtonElement;
  await act(async () => { picker.dispatchEvent(new Event("pointerdown", { bubbles: true })); picker.click(); });
  await act(async () => { picker.click(); });
  expect(changes).toHaveLength(1);
});
