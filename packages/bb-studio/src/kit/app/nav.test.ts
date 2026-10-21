// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAppPath, panelHref } from "./nav";

it("gives encoded and decoded routes the same identity", () => {
  const ref = JSON.stringify({ pluginId: "pages", id: "pg_release" });
  const expected = `/plugins/studio-chat/chats/item/${encodeURIComponent(ref)}`;
  expect(panelHref("studio-chat", "chats", `item/${ref}`)).toBe(expected);
  expect(panelHref("studio-chat", "chats", `item/${encodeURIComponent(ref)}`)).toBe(expected);
});

it("preserves subpath boundaries, encoded reserved characters and malformed percent literals", () => {
  expect(panelHref("studio", "studio")).toBe("/plugins/studio/studio");
  expect(panelHref("pages", "pages", "Release notes/100% ready")).toBe("/plugins/pages/pages/Release%20notes/100%25%20ready");
  expect(panelHref("pages", "pages", "folder/a%2Fb%3Fc%23d")).toBe("/plugins/pages/pages/folder/a%2Fb%3Fc%23d");
});

describe("openAppPath", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, "", "/");
  });

  /** A slot element that routes link clicks the way BB's delegate does. */
  function slot(routed: string[]) {
    const root = document.createElement("div");
    root.dataset.bbPluginRoot = "";
    root.addEventListener("click", (event) => {
      const link = (event.target as Element).closest("a[href]");
      if (!link) return;
      event.preventDefault();
      routed.push(link.getAttribute("href")!);
    });
    document.body.append(root);
    return root;
  }

  it("has BB route a link click, leaving no link behind", () => {
    const routed: string[] = [];
    const root = slot(routed);
    const popped = vi.fn();
    window.addEventListener("popstate", popped);
    openAppPath("/plugins/studio/studio/page");
    window.removeEventListener("popstate", popped);
    expect(routed).toEqual(["/plugins/studio/studio/page"]);
    expect(popped).not.toHaveBeenCalled();
    expect(root.querySelector("a")).toBeNull();
  });

  it("points the current entry at the target when replacing, so back skips the page left", () => {
    const routed: string[] = [];
    slot(routed);
    window.history.replaceState({ key: "k" }, "", "/plugins/pages/pages");
    const length = window.history.length;
    openAppPath("/plugins/studio/studio/page", { replace: true });
    expect(routed).toEqual(["/plugins/studio/studio/page"]);
    expect(window.location.pathname).toBe("/plugins/studio/studio/page");
    expect(window.history.state).toEqual({ key: "k" });
    expect(window.history.length).toBe(length);
  });

  it("skips portalled retained views, which BB doesn't listen on", () => {
    const routed: string[] = [];
    const retained = document.createElement("div");
    retained.dataset.bbPluginRoot = "";
    retained.dataset.bbPortaledOverlay = "";
    document.body.append(retained);
    slot(routed);
    openAppPath("/plugins/studio/studio");
    expect(routed).toEqual(["/plugins/studio/studio"]);
  });

  it("falls back to announcing a history change when no slot takes the click", () => {
    const popped = vi.fn();
    window.addEventListener("popstate", popped);
    openAppPath("/plugins/studio/studio");
    window.removeEventListener("popstate", popped);
    expect(window.location.pathname).toBe("/plugins/studio/studio");
    expect(popped).toHaveBeenCalledOnce();
  });

  it("ignores paths outside the app", () => {
    openAppPath("https://example.com");
    expect(window.location.pathname).toBe("/");
  });
});

describe("openAppPath when BB stops propagation", () => {
  it("does not navigate a second time", () => {
    const root = document.createElement("div");
    root.dataset.bbPluginRoot = "";
    root.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
    document.body.append(root);
    const popped = vi.fn();
    window.addEventListener("popstate", popped);
    const before = window.location.pathname;
    openAppPath("/plugins/studio/studio/page");
    window.removeEventListener("popstate", popped);
    document.body.replaceChildren();
    expect(popped).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(before);
  });
});
