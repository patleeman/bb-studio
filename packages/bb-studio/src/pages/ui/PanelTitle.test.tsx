// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageMetaView } from "../contract";
import { TitleRecovery } from "./page-title";
import { PanelTitle } from "./PanelTitle";
import type { Rpc } from "./shared";

const pageId = "pg_panel_title";
const page = { id: pageId, title: "OpenAI FDE Role", updatedAt: 1, icon: null } as unknown as PageMetaView;
let root: Root;
let container: HTMLDivElement;
let call: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  call = vi.fn(async (method: string, input: { title?: string }) =>
    method === "pages.update" ? { page: { ...page, title: input.title, updatedAt: 2 } } : { page });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  const recovery = new TitleRecovery(location.origin, pageId);
  for (const draft of recovery.memory()) recovery.remove(draft);
  localStorage.clear(); vi.restoreAllMocks();
});

async function render() { await act(async () => root.render(<PanelTitle page={page} rpc={{ call } as unknown as Rpc} />)); }
const titleButton = () => container.querySelector<HTMLButtonElement>('button[title="Rename page"]');
const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Page title"]');
async function startEditing() { await act(async () => titleButton()!.click()); }
async function type(value: string) {
  const field = input()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function press(key: string) { await act(async () => { input()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }); }
const updates = () => call.mock.calls.filter(([method]) => method === "pages.update");

it("shows the title as a labelled button that opens an input with the title selected", async () => {
  await render();
  expect(titleButton()!.getAttribute("aria-label")).toBe("Rename page: OpenAI FDE Role");
  await startEditing();
  expect(input()!.value).toBe("OpenAI FDE Role");
  expect(input()!.maxLength).toBe(200);
  expect(document.activeElement).toBe(input());
});

it("saves the trimmed title through pages.update on Enter and returns focus", async () => {
  await render();
  await startEditing();
  await type("  Forward Deployed Engineer  ");
  await press("Enter");
  expect(updates()).toEqual([["pages.update", { id: pageId, title: "Forward Deployed Engineer", expectedTitle: "OpenAI FDE Role" }]]);
  expect(input()).toBeNull();
  expect(titleButton()!.textContent).toBe("Forward Deployed Engineer");
  expect(document.activeElement).toBe(titleButton());
});

it("saves on blur", async () => {
  await render();
  await startEditing();
  await type("Renamed on blur");
  await act(async () => input()!.blur());
  expect(updates()).toHaveLength(1);
  expect(updates()[0][1]).toMatchObject({ title: "Renamed on blur" });
});

it("cancels on Escape without saving and returns focus", async () => {
  await render();
  await startEditing();
  await type("Not this");
  await press("Escape");
  expect(updates()).toHaveLength(0);
  expect(titleButton()!.textContent).toBe("OpenAI FDE Role");
  expect(document.activeElement).toBe(titleButton());
});

it("reverts an empty or unchanged title without saving", async () => {
  await render();
  await startEditing();
  await type("   ");
  await press("Enter");
  expect(titleButton()!.textContent).toBe("OpenAI FDE Role");
  await startEditing();
  await press("Enter");
  expect(updates()).toHaveLength(0);
});

it("offers a retry when the save fails", async () => {
  call.mockImplementation(async (method: string) => { if (method === "pages.update") throw new Error("offline"); return { page }; });
  await render();
  await startEditing();
  await type("Will fail");
  await press("Enter");
  expect(container.textContent).toContain("Title not saved.");
  expect([...container.querySelectorAll("button")].some(button => button.textContent === "Retry")).toBe(true);
});
