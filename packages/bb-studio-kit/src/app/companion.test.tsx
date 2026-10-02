// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionView, companionWorkbenchAvailable, openCompanion, type CompanionViewProps } from "./companion";
import { FloatPanels, useCompanionNavigate, useInFloat } from "./float";
import { publishFloatBody, setFloatHost } from "./float-registry";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_usePluginId: () => "pages" }));

let root: Root;
let container: HTMLDivElement;
let body: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  body = document.createElement("div");
  document.body.append(container, body);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  publishFloatBody({ windowKey: "page", element: null });
  setFloatHost(null);
  container.remove();
  body.remove();
  vi.unstubAllGlobals();
});

describe("optional native companion host", () => {
  it("navigates the originating companion after a request completes without a current click event", async () => {
    const navigate = vi.fn();
    setFloatHost({ open: () => {}, navigate });
    let go: ReturnType<typeof useCompanionNavigate>;
    function Editor() { go = useCompanionNavigate(); return <textarea defaultValue="Unsent" />; }
    act(() => root.render(<FloatPanels path="pages" render={() => <Editor />} />));
    act(() => publishFloatBody({ windowKey: "page", target: { kind: "path", path: "/plugins/pages/pages/one" }, element: body, placement: "main" }));
    await Promise.resolve();
    const target = { kind: "thread" as const, threadId: "source" };
    expect(go!(target)).toBe(true);
    expect(navigate).toHaveBeenCalledWith("page", target);
    expect(go!({ kind: "path", path: "/unregistered" })).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it("keeps Chat usable on stable BB and only selects native placement when the complete host capability exists", () => {
    const open = vi.fn();
    setFloatHost({ open });
    vi.stubGlobal("__bbPluginRuntime", { pluginSdkApp: {} });
    expect(companionWorkbenchAvailable()).toBe(false);
    expect(openCompanion({ kind: "thread", threadId: "a" })).toBe(true);
    expect(open).toHaveBeenLastCalledWith({ kind: "thread", threadId: "a" }, { placement: "floating" });
    vi.stubGlobal("__bbPluginRuntime", { pluginSdkApp: { experimental_CompanionView: () => null } });
    expect(companionWorkbenchAvailable()).toBe(false);
    vi.stubGlobal("__bbPluginRuntime", { pluginSdkApp: { experimental_CompanionView: () => null, experimental_CompanionOutlet: () => null } });
    expect(openCompanion({ kind: "thread", threadId: "a" })).toBe(true);
    expect(open).toHaveBeenLastCalledWith({ kind: "thread", threadId: "a" }, { placement: "workbench" });
    openCompanion({ kind: "thread", threadId: "a" }, { placement: "floating", minimized: true });
    expect(open).toHaveBeenLastCalledWith({ kind: "thread", threadId: "a" }, { placement: "floating", minimized: true });
  });

  it("renders content directly when stable BB has no native companion API", () => {
    vi.stubGlobal("__bbPluginRuntime", { pluginSdkApp: {} });
    const props: CompanionViewProps = { id: "one", title: "One", placement: "workbench", activation: 1, onSelect: () => {}, onClose: () => {}, onPlacementChange: () => {}, children: <textarea defaultValue="Unsent" /> };
    act(() => root.render(<CompanionView {...props} />));
    expect(container.querySelector("textarea")?.value).toBe("Unsent");
  });

  it("updates the item's placement context without unmounting its plugin portal or editor", () => {
    setFloatHost({ open: () => {} });
    const target = { kind: "path" as const, path: "/plugins/pages/pages/one" };
    function Editor() {
      const compact = useInFloat();
      const [draft, setDraft] = useState("");
      return <textarea data-compact={compact} value={draft} onChange={(event) => setDraft(event.target.value)} />;
    }
    act(() => root.render(<FloatPanels path="pages" render={() => <Editor />} />));
    act(() => publishFloatBody({ windowKey: "page", target, element: body, placement: "floating" }));
    const input = body.querySelector("textarea")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setValue.call(input, "Keep me"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => publishFloatBody({ windowKey: "page", target, element: body, placement: "workbench" }));
    expect(body.querySelector("textarea")).toBe(input);
    expect(input.dataset.compact).toBe("true");
    act(() => publishFloatBody({ windowKey: "page", target, element: body, placement: "main" }));
    expect(body.querySelector("textarea")).toBe(input);
    expect(input.value).toBe("Keep me");
    expect(input.dataset.compact).toBe("false");
  });
});
