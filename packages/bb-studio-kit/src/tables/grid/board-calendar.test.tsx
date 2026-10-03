// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Board } from "./board";
import { Calendar } from "./calendar";
import type { Table, View } from "../model";

vi.mock("../../ui/icon", () => ({ Icon: () => null }));
vi.mock("../../app/item-links", () => ({ ItemLinkText: ({ text }: { text: string }) => text }));
let container: HTMLDivElement;
let root: Root;
const opened = vi.fn();
const apply = vi.fn(() => true);
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
const table = {
  id: "dense", title: "Dense table", columns: [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "status", name: "Status", type: "select", options: ["Ready", "Done"] },
    { id: "date", name: "Date", type: "date", options: [] },
  ], views: [], rows: Array.from({ length: 5000 }, (_, index) => ({ id: `r${index}`, values: { name: `Row ${index + 1}`, status: "Ready", date: day } })),
} as unknown as Table;
const view = (type: "board" | "calendar"): View => ({ id: type, name: type, type, groupBy: "status", dateBy: "date", hidden: [], filters: [], sorts: [] });
const render = async (type: "board" | "calendar", rows = table.rows) => act(async () => root.render(type === "board"
  ? <Board table={table} rows={rows} view={view(type)} host={{ openUrl() {}, onError() {} }} apply={apply} onOpenRow={opened} newRowValues={() => ({})} />
  : <Calendar table={table} rows={rows} view={view(type)} apply={apply} onOpenRow={opened} newRowValues={() => ({})} />));
const click = async (label: string) => act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  opened.mockClear(); apply.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

for (const type of ["board", "calendar"] as const) {
  const last = type === "board" ? "Last Ready cards" : `Last rows on ${day}`;
  it(`${type} bounds a 5000-row bucket, reaches its final row, and clamps after filtering`, async () => {
    await render(type);
    expect(container.querySelectorAll("button[draggable]")).toHaveLength(type === "board" ? 50 : 10);
    await click(last);
    const card = [...container.querySelectorAll<HTMLButtonElement>("button[draggable]")].find(button => button.textContent?.includes("Row 5000"))!;
    expect(card).toBeDefined();
    await act(async () => card.click());
    expect(opened).toHaveBeenCalledWith("r4999");
    await render(type, table.rows.slice(0, 3));
    expect(container.querySelectorAll("button[draggable]")).toHaveLength(3);
    expect(container.querySelector(`button[aria-label="${last}"]`)).toBeNull();
    expect(container.textContent).toContain("Row 1");
  });
  it(`${type} preserves drag moves from the final page and clamps after deletion`, async () => {
    await render(type);
    await click(last);
    const card = container.querySelector<HTMLButtonElement>("button[draggable]")!;
    const dataTransfer = { types: ["application/x-table-row"], getData: () => "r4999", setData: vi.fn(), effectAllowed: "" };
    const event = new Event("dragstart", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    await act(async () => card.dispatchEvent(event));
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-table-row", type === "board" ? "r4950" : "r4990");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    const nextDay = `${day.slice(0, 8)}02`;
    const target = type === "board" ? container.querySelector('section[aria-label="Done"]')! : container.querySelector(`button[aria-label="Add a row on ${nextDay}"]`)!.parentElement!.parentElement!;
    await act(async () => target.dispatchEvent(drop));
    expect(apply).toHaveBeenCalledWith({ rows: { update: [{ rowId: "r4999", values: type === "board" ? { status: "Done" } : { date: nextDay } }] } });
    const removed = type === "board" ? 50 : 10;
    await render(type, table.rows.slice(0, -removed));
    expect(container.querySelectorAll("button[draggable]")).toHaveLength(removed);
    expect(container.textContent).toContain(`Row ${5000 - removed}`);
    expect(container.querySelector<HTMLButtonElement>(`button[aria-label="${last}"]`)!.disabled).toBe(true);
  });
}
