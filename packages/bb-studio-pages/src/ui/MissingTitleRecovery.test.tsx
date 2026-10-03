// @vitest-environment jsdom
import React, { act } from "react";
import { Blob as NativeBlob } from "node:buffer";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MissingTitleRecovery } from "./MissingTitleRecovery";
import { TitleRecovery } from "./page-title";

const pageId = "pg_title_missing";
const prefix = () => `bb-studio-pages:title:${JSON.stringify([location.origin, pageId])}:`;
let root: Root;
let container: HTMLDivElement;
let recovery: TitleRecovery;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  recovery = new TitleRecovery(location.origin, pageId);
  vi.useFakeTimers();
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:recovery"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  for (const draft of recovery.memory()) recovery.remove(draft);
  localStorage.clear(); vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<MissingTitleRecovery pageId={pageId} />)); }
async function click(label: string) {
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click());
}
async function downloaded() {
  const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as unknown as NativeBlob;
  return JSON.parse(await blob.text());
}

it("downloads a title-only draft with origin and page identity without network work", async () => {
  recovery.save({ id: "only-title", title: "My unsaved title", base: "Saved title", at: 1 });
  await render();
  await click("Download title recovery");
  const data = await downloaded();
  expect(data).toMatchObject({ origin: location.origin, pageId, drafts: [{ id: "only-title", title: "My unsaved title", base: "Saved title", at: 1 }] });
  expect(data.browserRecovery.records[prefix() + "only-title"]).toContain("My unsaved title");
  expect(fetch).not.toHaveBeenCalled();
  for (const button of container.querySelectorAll("button")) expect(button.className).toContain("min-h-11");
});

it("keeps corrupt title records exportable and retries reading without replacing them", async () => {
  const corrupt = "{invalid retained data";
  localStorage.setItem(prefix() + "broken", corrupt);
  await render();
  expect(container.textContent).toContain("Could not read all title recovery data");
  await click("Download title recovery");
  expect((await downloaded()).browserRecovery.records[prefix() + "broken"]).toBe(corrupt);
  await click("Retry reading title recovery");
  expect(localStorage.getItem(prefix() + "broken")).toBe(corrupt);
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves a memory-only title and retries local storage without syncing metadata", async () => {
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  expect(() => recovery.save({ id: "memory-title", title: "Only in memory", base: "Before", at: 2 })).toThrow();
  await render();
  expect(container.textContent).toContain("Only in memory");
  expect(container.textContent).toContain("Keep this view open");
  await click("Download title recovery");
  expect((await downloaded()).drafts[0].title).toBe("Only in memory");
  fail.mockRestore();
  await click("Retry local title recovery");
  expect(recovery.hasUnpersisted()).toBe(false);
  expect(localStorage.getItem(prefix() + "memory-title")).toContain("Only in memory");
  expect(container.textContent).not.toContain("Keep this view open");
  expect(fetch).not.toHaveBeenCalled();
});

it("recovers from an unread title store with a read-only retry", async () => {
  recovery.save({ id: "read-title", title: "Read after retry", base: "Before", at: 3 });
  recovery.forgetMemory(recovery.memory()[0]!);
  const unread = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  await render();
  expect(container.textContent).toContain("Retry reading title recovery");
  expect(container.textContent).not.toContain("Download title recovery");
  unread.mockRestore();
  const save = vi.spyOn(Storage.prototype, "setItem");
  await click("Retry reading title recovery");
  expect(container.textContent).toContain("Read after retry");
  expect(save).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
