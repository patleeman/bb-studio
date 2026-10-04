// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelatedPanel } from "./related-panel";

const state = vi.hoisted(() => ({ sdk: { plugins: { callRpc: vi.fn() } }, navigate: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => state.sdk }));
vi.mock("./presence", () => ({ useStudioPresent: () => true }));
vi.mock("./float", () => ({ useCompanionNavigate: () => state.navigate }));
vi.mock("../ui/icon", () => ({ Icon: () => null }));
vi.mock("./item-links", () => ({ ItemLinkText: ({ text }: any) => text, ItemLinkTextarea: ({ onValueChange, wrapperClassName, ...props }: any) => <textarea {...props} onChange={event => onValueChange(event.target.value)} /> }));

let root: Root, container: HTMLDivElement;
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const open = async () => { await act(async () => { container.querySelector("button")!.click(); await settle(); }); };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.navigate.mockReturnValue(true);
  state.sdk.plugins.callRpc.mockImplementation(async ({ method }) => {
    if (method === "links") return { outgoing: [{ to: { pluginId: "pages", id: "release" }, kind: "reference", source: "manual" }], backlinks: [] };
    if (method === "itemThreads") return { threads: [{ threadId: "review", role: "Review", state: "idle" }] };
    if (method === "comments") return { comments: [] };
    if (method === "versions") return { versions: [] };
    if (method === "itemAt") return { item: { title: "Release notes", href: "/plugins/pages/pages/release" }, kind: null };
    throw new Error(`Unexpected RPC ${method}`);
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(<RelatedPanel ref={{ pluginId: "excalidraw", id: "flow" }} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Related popover", () => {
  it("keeps portaled item and thread links bound to their originating companion", async () => {
    await open();
    const popover = document.querySelector('[data-studio-related-panel]')!;
    expect(container.contains(popover)).toBe(false);
    for (const [href, target] of [["/plugins/pages/pages/release", { kind: "path", path: "/plugins/pages/pages/release" }], ["/threads/review", { kind: "thread", threadId: "review" }]] as const) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      await act(async () => popover.querySelector(`a[href="${href}"]`)!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(state.navigate).toHaveBeenLastCalledWith(target);
    }
  });

  it("retains a comment draft when the collision-aware popover closes and reopens", async () => {
    await open();
    const field = document.querySelector<HTMLTextAreaElement>('[aria-label="New comment"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { set.call(field, "Keep this review note"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await open();
    expect(document.querySelector('[data-studio-related-panel]')).toBeNull();
    await open();
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="New comment"]')?.value).toBe("Keep this review note");
  });
});
