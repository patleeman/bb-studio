// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ rpc: vi.fn(async (_method: string, _input: unknown) => ({ found: true, title: null, spec: null })), popOut: vi.fn(async (_options: { path: string }) => true) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ openUrl: () => true, experimental_popOut: calls.popOut }), useRpc: () => ({ call: calls.rpc }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const tabs = vi.hoisted(() => ({ openTabRef: vi.fn(async (_ref: unknown, _title: unknown, _place: unknown) => true), openStudioTab: vi.fn(async () => true) }));
vi.mock("../ui/tab-open", () => tabs);
const nav = vi.hoisted(() => ({ openAppPath: vi.fn() }));
vi.mock("../kit/app/nav", () => nav);
vi.mock("../kit/app/host-sdk", async (original) => ({ ...(await original<typeof import("../kit/app/host-sdk")>()), hasGlobalWorkbench: true, workbenchOf: () => ({ layout: () => ({ panes: [{}] }), open: async () => "key" }) }));
vi.mock("../kit/ui/icon", () => ({ Icon: () => null }));

import { artifactHref } from "../artifacts/shared";
import { designHref } from "../design/shared";
import { drawingHref } from "../draw/shared";
import { ItemDirectiveCard } from "../kit/app/directive-card";
import { miniHref } from "../minis/shared";
import { pagePath } from "../pages/constants";
import { recordingHref } from "../talk/shared/format";
import { useOpenCard, type CardClick } from "./open";
import { parseLink } from "./router";

const CARDS = [
  { directive: "design", kind: "design", href: designHref("dsn_0123456789abcdef"), id: "dsn_0123456789abcdef" },
  { directive: "page", kind: "page", href: pagePath("pg_0123456789abcdef"), id: "pg_0123456789abcdef" },
  { directive: "mini", kind: "app", href: miniHref("mini_0123456789abcdef"), id: "mini_0123456789abcdef" },
  { directive: "artifact", kind: "artifact", href: artifactHref("art_0123456789abcdef"), id: "art_0123456789abcdef" },
  { directive: "drawing", kind: "whiteboard", href: drawingHref("drw_0123456789abcdef"), id: "drw_0123456789abcdef" },
  { directive: "recording", kind: "recording", href: recordingHref("rec_0123456789abcdef"), id: "rec_0123456789abcdef" },
] as const;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.history.replaceState({}, "", "/threads/thr_1");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function Card({ href, alwaysShown = false }: { href: string; alwaysShown?: boolean }) {
  const openCard = useOpenCard("thr_1");
  return <ItemDirectiveCard state="ready" kind="item" icon="x" title="Item" details="Detail" body={<p>Body</p>} alwaysShown={alwaysShown} onOpen={openCard(href, "Item")} onOpenFull={openCard(href, "Item", "main")} />;
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const click = async (selector: string, init: MouseEventInit = {}) => {
  const element = host.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  act(() => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })); });
  await flush();
};

describe("a chat card of every kind", () => {
  for (const card of CARDS) {
    it(`${card.directive}: its link and its directive name the same ${card.kind}`, () => {
      const target = parseLink(card.href, "http://127.0.0.1:38986");
      expect(target).toMatchObject({ type: "entity", ref: { kind: card.kind, id: card.id } });
      if (card.directive !== "recording") expect(parseLink(`::${card.directive}{id="${card.id}"}`)).toMatchObject({ type: "entity", ref: { kind: card.kind, id: card.id } });
    });

    it(`${card.directive}: a click on the header or on the preview opens a workbench tab in its thread`, async () => {
      act(() => root.render(<Card href={card.href} />));
      await click("button");
      expect(calls.rpc).toHaveBeenCalledWith("links.resolve", { kind: card.kind, id: card.id, threadId: "thr_1" });
      expect(tabs.openTabRef).toHaveBeenLastCalledWith({ kind: card.kind, id: card.id }, "Item", { threadId: "thr_1" });
      await click('[data-testid="directive-excerpt"]');
      expect(tabs.openTabRef).toHaveBeenCalledTimes(2);
      expect(nav.openAppPath).not.toHaveBeenCalled();
    });

    it(`${card.directive}: Cmd opens the second pane, Shift a window, and the arrow button the main view`, async () => {
      act(() => root.render(<Card href={card.href} />));
      await click("button", { metaKey: true });
      expect(tabs.openTabRef).toHaveBeenLastCalledWith({ kind: card.kind, id: card.id }, "Item", { threadId: "thr_1", pane: "new" });
      await click("button", { shiftKey: true });
      expect(calls.popOut).toHaveBeenLastCalledWith({ path: card.href, title: "Item" });
      expect(tabs.openTabRef).toHaveBeenCalledTimes(1);
      await click('[data-testid="directive-open-full"]', { metaKey: true });
      expect(nav.openAppPath).toHaveBeenLastCalledWith(card.href);
      expect(tabs.openTabRef).toHaveBeenCalledTimes(1);
    });
  }

  it("an always-shown preview opens on a click anywhere in it and has no collapse button", async () => {
    act(() => root.render(<Card href={CARDS[0].href} alwaysShown />));
    expect(host.querySelector('[data-testid="directive-excerpt"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Hide Item"], button[aria-label="Show Item"]')).toBeNull();
    await click('[data-testid="directive-preview"] p');
    expect(tabs.openTabRef).toHaveBeenLastCalledWith({ kind: "design", id: CARDS[0].id }, "Item", { threadId: "thr_1" });
  });

  it("a collapsed excerpt takes the click itself; what is inside it takes none", () => {
    act(() => root.render(<Card href={CARDS[1].href} />));
    const excerpt = host.querySelector<HTMLElement>('[data-testid="directive-excerpt"]')!;
    expect(excerpt.className).not.toContain("pointer-events-none");
    expect(excerpt.firstElementChild!.className).toContain("pointer-events-none");
  });

  it("passes the modifier keys of a click to the opener", () => {
    const seen: (CardClick | undefined)[] = [];
    act(() => root.render(<ItemDirectiveCard state="ready" kind="item" icon="x" title="Item" body={<p>Body</p>} onOpen={(event) => seen.push(event)} />));
    act(() => { host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
    expect(seen[0]?.shiftKey).toBe(true);
  });
});
