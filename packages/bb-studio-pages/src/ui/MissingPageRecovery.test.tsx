// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PagePanel } from "./PagePanel";

const state = vi.hoisted(() => ({ download: vi.fn(), retry: vi.fn(), read: vi.fn(), refetch: vi.fn(), options: [] as unknown[], failed: false, recovered: true }));
vi.mock("./connection", () => ({ PageConnection: class {
  pageId: string;
  status = "missing";
  localSave = state.failed ? "failed" : "saved";
  localError = state.failed ? "Storage unavailable" : null;
  hasRecovery = state.recovered;
  snapshot = "loaded";
  constructor(pageId: string, options: unknown) { this.pageId = pageId; state.options.push(options); }
  subscribe() { return () => {}; }
  destroy() {}
  exportRecovery = state.download;
  retrySave = state.retry;
  retryRecovery = state.read;
} }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toPluginPanel: vi.fn() }), useRpc: () => ({ call: vi.fn() }) }));
vi.mock("@bb-studio/kit/app", () => ({ ThreadItemsPanel: () => null }));
vi.mock("@bb-studio/kit/ui", () => ({ Icon: () => null }));
vi.mock("./shared", () => ({ relativeTime: () => "now" }));
vi.mock("./PanelShell", () => ({
  usePanelPage: () => ({ page: null, refetch: state.refetch }),
  PanelMessage: ({ title }: { title: string }) => <p>{title}</p>,
  PanelShell: () => null,
  OpenInPages: () => null,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.failed = false; state.recovered = true; state.options = [];
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => { root.render(<PagePanel {...({ threadId: "thr_one", params: { pageId: "pg_deleted" } } as any)} />); }); }
async function click(text: string) {
  await act(async () => {
    const button = [...container.querySelectorAll("button")].find(node => node.textContent?.includes(text));
    if (!button) throw new Error(`Missing action: ${text}`);
    button.click();
  });
}

it("exposes existing recovery when deleted-page metadata is null", async () => {
  await render();
  await click("Download recovery file");
  expect(state.download).toHaveBeenCalledOnce();
  expect(state.options).toEqual([{ recoveryOnly: true }]);
  expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  await click("Retry loading page");
  expect(state.refetch).toHaveBeenCalledOnce();
});

it("keeps local-storage retry available without offering a server restore", async () => {
  state.failed = true;
  await render();
  await click("Retry local recovery");
  expect(state.retry).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Keep this view open");
  expect(container.textContent).not.toContain("Restore page");
});

it("retries a failed recovery read rather than writing an empty document", async () => {
  state.failed = true; state.recovered = false;
  await render();
  await click("Retry reading recovery");
  expect(state.read).toHaveBeenCalledOnce();
  expect(state.retry).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Download recovery file");
});
