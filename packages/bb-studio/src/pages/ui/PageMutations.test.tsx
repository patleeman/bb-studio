// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ call: vi.fn(), error: vi.fn() }));
const { Pass } = vi.hoisted(() => ({ Pass: ({ children }: { children?: ReactNode }) => children ?? null }));
vi.mock("../../kit/app/index", () => ({ CopyReferenceMenuItem: () => null }));
vi.mock("../../kit/ui/index", () => ({
  Icon: () => <span />,
  DropdownMenu: Pass,
  DropdownMenuContent: Pass,
  DropdownMenuTrigger: Pass,
  DropdownMenuSub: Pass,
  DropdownMenuSubContent: Pass,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, disabled, onSelect }: { children?: ReactNode; disabled?: boolean; onSelect?: () => void }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>{children}</button>
  ),
  DropdownMenuSubTrigger: ({ children, disabled }: { children?: ReactNode; disabled?: boolean }) => <button type="button" disabled={disabled}>{children}</button>,
}));
vi.mock("sonner", () => ({ toast: { error: state.error } }));

import { PageMenu } from "./shared";
import { PageIconPicker } from "./PageIconPicker";
import type { PageMetaView } from "../contract";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.call.mockReset();
  state.error.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const page = { id: "pg_1", title: "Plan", projectId: "proj_1", parentId: null, icon: "📄", position: 0, createdAt: 1, updatedAt: 1, updatedBy: "user", archived: false } as PageMetaView;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent?.includes(label) || each.getAttribute("aria-label") === label)!;

it("shows archive errors and disables metadata actions while the update is pending", async () => {
  let reject!: (error: Error) => void;
  state.call.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  act(() => root.render(<PageMenu page={page} rpc={{ call: state.call } as never} projects={[]} onChanged={() => {}} />));
  await act(async () => button("Archive").click());

  expect(button("Archive").disabled).toBe(true);
  expect(state.call).toHaveBeenCalledOnce();
  await act(async () => { reject(new Error("disk full")); await Promise.resolve(); });
  expect(state.error).toHaveBeenCalledWith("Couldn't update the page", { description: "disk full" });
  expect(button("Archive").disabled).toBe(false);
});

it("shows delete errors", async () => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  state.call.mockRejectedValue(new Error("permission denied"));
  act(() => root.render(<PageMenu page={page} rpc={{ call: state.call } as never} projects={[]} onChanged={() => {}} />));
  await act(async () => button("Delete").click());
  await act(async () => { await Promise.resolve(); });

  expect(state.error).toHaveBeenCalledWith("Couldn't delete the page", { description: "permission denied" });
});

it("shows icon errors and prevents another icon change while pending", async () => {
  let reject!: (error: Error) => void;
  state.call.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  act(() => root.render(<PageIconPicker page={page} rpc={{ call: state.call } as never}><button>Add icon</button></PageIconPicker>));
  await act(async () => button("📄").click());

  expect(button("📄").disabled).toBe(true);
  expect(state.call).toHaveBeenCalledOnce();
  await act(async () => { reject(new Error("database unavailable")); await Promise.resolve(); });
  expect(state.error).toHaveBeenCalledWith("Couldn't change the page icon", { description: "database unavailable" });
  expect(button("📄").disabled).toBe(false);
});
