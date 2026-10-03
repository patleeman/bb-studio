// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Grid } from "./grid";
import type { Table } from "../model";

vi.mock("../../ui/icon", () => ({ Icon: () => null }));
vi.mock("../../app/item-links", () => ({ ItemLinkText: ({ text }: { text: string }) => text }));

let container: HTMLDivElement;
let root: Root;
const apply = vi.fn(() => true);
const table = {
  id: "large", title: "Large table", columns: [{ id: "n", name: "Number", type: "number", options: [] }], views: [],
  rows: Array.from({ length: 1200 }, (_, index) => ({ id: `r${index}`, values: { n: index } })),
} as unknown as Table;
const key = (name: string, options = {}) => container.querySelector('textarea[aria-label="Table cells"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, ...options }));

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  apply.mockClear();
  await act(async () => root.render(<Grid table={table} rows={table.rows} columns={table.columns} view={undefined} host={{ openUrl() {}, onError() {} }} apply={apply} undo={() => {}} redo={() => {}} onColumns={() => {}} onView={() => {}} onOpenRow={() => {}} newRowValues={() => ({})} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("bounds mounted rows while keyboard jumps and clipboard ranges span the full data set", async () => {
  expect(container.querySelectorAll("tbody tr[data-row]").length).toBeLessThan(50);
  expect(container.querySelector('[role="grid"]')?.getAttribute("aria-rowcount")).toBe("1201");
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Table cells"]')!;
  expect(field.tabIndex).toBe(0);
  await act(async () => field.focus());
  await act(async () => key("End", { ctrlKey: true }));
  expect(container.querySelector('[data-cell="1199:0"]')).not.toBeNull();
  expect(document.getElementById(field.getAttribute("aria-activedescendant")!)?.textContent).toBe("1,199");
  expect(container.querySelectorAll("tbody tr[data-row]").length).toBeLessThan(50);
  await act(async () => key("a", { ctrlKey: true }));
  const setData = vi.fn();
  const copy = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(copy, "clipboardData", { value: { setData } });
  await act(async () => field.dispatchEvent(copy));
  expect(setData.mock.calls[0]?.[1].split("\n")).toHaveLength(1200);
  expect(setData.mock.calls[0]?.[1].split("\n").at(-1)).toBe("1199");
});

it("keeps an unsaved cell editor mounted when its row scrolls out of view", async () => {
  await act(async () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Table cells"]')!.focus());
  await act(async () => key("9"));
  const editor = container.querySelector<HTMLInputElement>('input[aria-label="Number"]')!;
  expect(editor.value).toBe("9");
  const scroller = container.querySelector('[role="grid"]')!.parentElement!;
  await act(async () => { scroller.scrollTop = 25_000; scroller.dispatchEvent(new Event("scroll")); });
  expect(container.querySelector('input[aria-label="Number"]')).toBe(editor);
  expect(document.activeElement).toBe(editor);
  expect(container.querySelectorAll("tbody tr[data-row]").length).toBeLessThan(50);
  await act(async () => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(apply).toHaveBeenCalledWith({ rows: { update: [{ rowId: "r0", values: { n: 9 } }] } });
});
