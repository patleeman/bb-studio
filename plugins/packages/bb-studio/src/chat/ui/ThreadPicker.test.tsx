// @vitest-environment jsdom
// Esc in the thread picker's search: the first clears what is typed, and
// only an Escape on the empty field closes the picker.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const sdk = { threads: { list: async () => [{ id: "thr_1", title: "Fix the retry" }], get: async () => null, search: async () => ({ active: { results: [] } }) } };
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk }));
vi.mock("../../kit/app/index", () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "), Icon: () => null }));

import { ThreadPicker } from "./ThreadPicker";

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Find a thread"]')!;
const type = async (text: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const escape = async () => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => { input().dispatchEvent(event); });
  return event;
};
const mount = async (closable: boolean) => {
  await act(async () => { root.render(<ThreadPicker homeThreadId={null} onPick={() => {}} {...(closable ? { onClose } : {})} />); });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onClose.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("clears the search on the first Escape and closes the picker on the second", async () => {
  await mount(true);
  await type("retry");
  expect(input().value).toBe("retry");
  expect((await escape()).defaultPrevented).toBe(true);
  expect(input().value).toBe("");
  expect(onClose).not.toHaveBeenCalled();
  await escape();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("on a page, where there is nothing to close, the second Escape leaves the field", async () => {
  await mount(false);
  input().focus();
  await type("retry");
  await escape();
  expect(input().value).toBe("");
  expect(document.activeElement).toBe(input());
  await escape();
  expect(document.activeElement).not.toBe(input());
});
