// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemDirectiveCard, PREVIEW_COLLAPSED_KEY } from "./directive-card";

vi.mock("../ui/icon", () => ({ Icon: () => null }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (onOpen = vi.fn()) => {
  act(() => root.render(<ItemDirectiveCard state="ready" kind="page" icon="x" title="Plan" details="Page" body={<p>Body text</p>} onOpen={onOpen} />));
  return onOpen;
};
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it("shows the body inline and opens the item from its header", () => {
  const onOpen = render();
  expect(host.textContent).toContain("Body text");
  act(() => button("Open Plan").click());
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it("collapses the body and remembers the choice", () => {
  render();
  act(() => button("Hide Plan").click());
  expect(host.textContent).not.toContain("Body text");
  expect(window.localStorage.getItem(PREVIEW_COLLAPSED_KEY)).toBe("true");
  act(() => root.unmount());
  root = createRoot(host);
  render();
  expect(host.textContent).not.toContain("Body text");
  expect(button("Show Plan").getAttribute("aria-expanded")).toBe("false");
});

it("stays a compact link without a body", () => {
  const onOpen = vi.fn();
  act(() => root.render(<ItemDirectiveCard state="ready" kind="page" icon="x" title="Plan" onOpen={onOpen} />));
  expect(host.querySelectorAll("button")).toHaveLength(1);
  act(() => host.querySelector("button")!.click());
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it("remembers a card's last value until the item is gone", async () => {
  const { remember } = await import("./directive-card");
  expect(remember("page:pg_a", undefined)).toBeUndefined();
  expect(remember("page:pg_a", { title: "A" })).toEqual({ title: "A" });
  expect(remember("page:pg_a", undefined)).toEqual({ title: "A" });
  expect(remember("page:pg_a", null)).toBeNull();
  expect(remember("page:pg_a", undefined)).toBeUndefined();
});
