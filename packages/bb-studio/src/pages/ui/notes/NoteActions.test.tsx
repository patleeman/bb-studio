// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ call: vi.fn(), realtime: [] as ((payload: unknown) => void)[] }));
vi.mock("@get-bb/plugin-sdk/app", () => {
  const rpc = { call: state.call };
  return {
    useRpc: () => rpc,
    useBbNavigate: () => ({ openThreadPanel: () => true }),
    useRealtime: (_channel: string, handler: (payload: unknown) => void) => { state.realtime.push(handler); },
  };
});
const { Pass } = vi.hoisted(() => ({ Pass: ({ children }: { children?: ReactNode }) => children ?? null }));
vi.mock("../../../kit/app/index", () => ({
  BAR_BUTTON: "bar",
  ICON_BUTTON: "icon",
  useOpenTarget: () => ({ open: () => {}, anchor: null }),
  DropdownMenu: Pass,
  DropdownMenuTrigger: Pass,
  DropdownMenuContent: Pass,
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect(): void }) => <button type="button" data-menu-item="" onClick={onSelect}>{children}</button>,
}));
vi.mock("../../../kit/ui/index", () => ({
  Icon: () => <span />,
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogDescription: Pass, DialogFooter: Pass,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { defaultSendMode, NoteActions } from "./NoteActions";

const note = {
  pageId: "pg_1", threadId: "thr_1", title: "Notes · Oct 13, 2:05 PM · Weekly sync", state: "open" as string,
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
  state.realtime = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.getAttribute("aria-label") === label || each.textContent === label)!;

async function show(handlers: Record<string, (input: unknown) => unknown>, onDiscarded = vi.fn()) {
  state.call.mockImplementation(async (method: string, input: unknown) => handlers[method]!(input));
  act(() => root.render(<NoteActions pageId="pg_1" onDiscarded={onDiscarded} />));
  await act(async () => {});
  return onDiscarded;
}

describe("defaultSendMode", () => {
  it("sends short notes as the message and long ones as a summary request", () => {
    expect(defaultSendMode(8_000)).toBe("content");
    expect(defaultSendMode(8_001)).toBe("summarize");
  });
});

describe("NoteActions", () => {
  it("shows nothing on an ordinary page, or a note already sent or kept", async () => {
    await show({ "notes.forPage": () => ({ note: null }) });
    expect(host.querySelector("[data-note-actions]")).toBeNull();
    await show({ "notes.forPage": () => ({ note: { ...note, state: "kept" } }) });
    expect(host.querySelector("[data-note-actions]")).toBeNull();
  });

  it("sends to the thread with the default mode, then goes", async () => {
    await show({ "notes.forPage": () => ({ note }), "notes.send": () => ({ note: { ...note, state: "sent" }, sent: "content" }) });
    expect(host.querySelector("[data-note-actions]")?.textContent).toContain("Temp note");
    await act(async () => { button("Send to thread").click(); });
    expect(state.call).toHaveBeenCalledWith("notes.send", { pageId: "pg_1", mode: "auto" });
    expect(host.querySelector("[data-note-actions]")).toBeNull();
  });

  it("sends a link and a request to summarize when asked", async () => {
    await show({ "notes.forPage": () => ({ note }), "notes.send": () => ({ note: { ...note, state: "sent" }, sent: "summarize" }) });
    const item = [...host.querySelectorAll<HTMLButtonElement>("[data-menu-item]")].find((each) => each.textContent?.startsWith("Send a link"))!;
    await act(async () => { item.click(); });
    expect(state.call).toHaveBeenCalledWith("notes.send", { pageId: "pg_1", mode: "summarize" });
  });

  it("asks for a title to keep it as a page", async () => {
    await show({ "notes.forPage": () => ({ note }), "notes.keep": (input) => ({ note: { ...note, state: "kept", title: (input as { title: string }).title } }) });
    act(() => button("Keep as page").click());
    const input = host.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    expect(input.value).toBe(note.title);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Q4 planning");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Keep page").click(); });
    expect(state.call).toHaveBeenCalledWith("notes.keep", { pageId: "pg_1", title: "Q4 planning" });
    expect(host.querySelector("[data-note-actions]")).toBeNull();
  });

  it("confirms before discarding", async () => {
    const onDiscarded = await show({ "notes.forPage": () => ({ note }), "notes.discard": () => ({ ok: true }) });
    act(() => button("Discard").click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Discard these notes?");
    expect(state.call).not.toHaveBeenCalledWith("notes.discard", expect.anything());
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((each) => each.textContent === "Discard")!;
    await act(async () => { confirm.click(); });
    expect(state.call).toHaveBeenCalledWith("notes.discard", { pageId: "pg_1" });
    expect(onDiscarded).toHaveBeenCalled();
  });
});
