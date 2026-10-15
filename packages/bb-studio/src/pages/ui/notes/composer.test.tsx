// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: vi.fn(),
  openThreadPanel: vi.fn(() => true),
  split: vi.fn(),
  realtime: [] as ((payload: unknown) => void)[],
  composer: null as unknown as {
    scope: { kind: string; threadId?: string };
    text: string;
    isSubmitting: boolean;
    replace: ReturnType<typeof vi.fn>;
  },
}));
vi.mock("@get-bb/plugin-sdk/app", () => {
  const rpc = { call: state.call };
  const navigate = { openThreadPanel: state.openThreadPanel };
  return {
    useComposer: () => state.composer,
    useRpc: () => rpc,
    useBbNavigate: () => navigate,
    useRealtime: (_channel: string, handler: (payload: unknown) => void) => { state.realtime.push(handler); },
  };
});
vi.mock("@bb-studio/kit/app", () => ({ useOpenTarget: () => ({ open: state.split, anchor: null }) }));
vi.mock("@bb-studio/kit/ui", () => ({ Icon: () => <span />, Tooltip: ({ children }: { children: unknown }) => children }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { clearMovedText, expandLabel, ExpandToPage, NotesInProgress } from "./composer";

const note = {
  pageId: "pg_1", threadId: "thr_1", title: "Notes · Oct 13, 2:05 PM · Weekly sync", state: "open",
  href: "/plugins/studio/studio/pages/pg_1", length: 10, createdAt: 1, updatedAt: 1,
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.call.mockReset();
  state.openThreadPanel.mockReset().mockReturnValue(true);
  state.split.mockReset();
  state.realtime = [];
  state.composer = { scope: { kind: "thread", threadId: "thr_1" }, text: "Ana: ship Friday", isSubmitting: false, replace: vi.fn() };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const rpc = (handlers: Record<string, (input: unknown) => unknown>) =>
  state.call.mockImplementation(async (method: string, input: unknown) => handlers[method]!(input));

describe("helpers", () => {
  it("labels the button by the open note and the draft", () => {
    expect(expandLabel(false, false)).toBe("Expand to page");
    expect(expandLabel(true, false)).toBe("Add to notes in progress");
    expect(expandLabel(true, true)).toBe("Open notes in progress");
  });

  it("clears only the text that moved, keeping attachments and later typing", () => {
    const replace = vi.fn();
    clearMovedText({ replace }, "moved");
    const update = replace.mock.calls[0]![0] as (current: { text: string }) => unknown;
    expect(update({ text: "moved" })).toEqual({ text: "", mentions: [] });
    const later = { text: "moved and more" };
    expect(update(later)).toBe(later);
    clearMovedText({ replace }, "  ");
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("Expand to page", () => {
  it("moves the draft into a new note, clears the composer and opens the note beside the thread", async () => {
    rpc({ "notes.forThread": () => ({ note: null }), "notes.create": () => ({ note, appended: false }) });
    act(() => root.render(<ExpandToPage />));
    await act(async () => {});
    const button = host.querySelector<HTMLButtonElement>("[data-notes-expand]")!;
    expect(button.getAttribute("aria-label")).toBe("Expand to page");

    await act(async () => { button.click(); });
    expect(state.call).toHaveBeenCalledWith("notes.create", expect.objectContaining({ threadId: "thr_1", text: "Ana: ship Friday" }));
    expect(state.composer.replace).toHaveBeenCalledTimes(1);
    expect(state.openThreadPanel).toHaveBeenCalledWith({ actionId: "studio", title: note.title, params: { kind: "page", id: "pg_1" } });
    expect(button.getAttribute("aria-label")).toBe("Add to notes in progress");
  });

  it("opens the note in a split where the thread has no side panel", async () => {
    state.openThreadPanel.mockReturnValue(false);
    rpc({ "notes.forThread": () => ({ note }), "notes.create": () => ({ note, appended: true }) });
    act(() => root.render(<ExpandToPage />));
    await act(async () => {});
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-notes-expand]")!.click(); });
    expect(state.split).toHaveBeenCalledWith({ kind: "path", path: note.href, title: note.title }, "split");
  });

  it("keeps the draft when the page couldn't be made", async () => {
    rpc({ "notes.forThread": () => ({ note: null }), "notes.create": () => { throw new Error("Thread not found"); } });
    act(() => root.render(<ExpandToPage />));
    await act(async () => {});
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-notes-expand]")!.click(); });
    expect(state.composer.replace).not.toHaveBeenCalled();
    expect(state.openThreadPanel).not.toHaveBeenCalled();
  });

  it("isn't offered outside a thread", () => {
    state.composer.scope = { kind: "new-thread" };
    act(() => root.render(<ExpandToPage />));
    expect(host.querySelector("[data-notes-expand]")).toBeNull();
  });
});

describe("Notes in progress", () => {
  it("shows the thread's open note after a reload, and reopens it", async () => {
    rpc({ "notes.forThread": () => ({ note }) });
    act(() => root.render(<NotesInProgress />));
    await act(async () => {});
    const chip = host.querySelector<HTMLElement>("[data-notes-in-progress] button")!;
    expect(chip.textContent).toBe("Notes in progressOct 13, 2:05 PM · Weekly sync");
    act(() => chip.click());
    expect(state.openThreadPanel).toHaveBeenCalledWith({ actionId: "studio", title: note.title, params: { kind: "page", id: "pg_1" } });
  });

  it("goes when the note is resolved", async () => {
    let current: unknown = note;
    rpc({ "notes.forThread": () => ({ note: current }) });
    act(() => root.render(<NotesInProgress />));
    await act(async () => {});
    expect(host.querySelector("[data-notes-in-progress]")).not.toBeNull();
    current = null;
    await act(async () => { for (const handler of state.realtime) handler({ type: "note", pageId: "pg_1", threadId: "thr_1" }); });
    expect(host.querySelector("[data-notes-in-progress]")).toBeNull();
  });
});
