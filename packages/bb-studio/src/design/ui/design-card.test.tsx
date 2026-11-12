// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesignView, ScreenView } from "../shared";

const state = vi.hoisted(() => ({ design: undefined as unknown, opened: [] as { link: string; title: string | null; how?: string; shift?: boolean }[] }));
vi.mock("./use-design", () => ({ useDesign: () => ({ design: state.design }) }));
vi.mock("../../links/open", () => ({ useOpenCard: () => (link: string, title: string | null, how?: string) => (event?: { shiftKey?: boolean }) => { state.opened.push({ link, title, how, shift: event?.shiftKey }); } }));
vi.mock("../../kit/app/index", async () => {
  const card = await import("../../kit/app/directive-card");
  return { ItemDirectiveCard: card.ItemDirectiveCard, remember: <T,>(_key: string, value: T) => value };
});
vi.mock("../../kit/ui/icon", () => ({ Icon: () => null }));
vi.mock("../../kit/app/host-sdk", () => ({ hasGlobalWorkbench: true }));
vi.mock("../../kit/app/item-drag", () => ({ linkDragItem: () => null, writeDragItem: () => {} }));

import { DesignCard, PREVIEW_HEIGHT, PREVIEW_SCREENS, previewScreens } from "./design-card";

const screen = (id: string, viewport = "desktop"): ScreenView => ({ id, title: `Screen ${id}`, caption: "", viewport, updatedAt: 1, steps: [] } as unknown as ScreenView);
const design = (rounds: ScreenView[][]): DesignView => ({ id: "dsn_0123456789abcdef", name: "Layout", projectId: null, threadId: null, updatedAt: 1, rounds: rounds.map((screens, index) => ({ id: String(rounds.length - index), screens })), comments: [], review: null } as unknown as DesignView);

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  state.opened = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const props = { attributes: { id: "dsn_0123456789abcdef" }, message: { threadId: "thr_1" } } as unknown as Parameters<typeof DesignCard>[0];
const render = () => act(() => root.render(<DesignCard {...props} />));

it("lists the newest round's screens first, then older rounds, up to the limit", () => {
  const view = design([[screen("3a"), screen("3b")], [screen("2a")], [screen("1a"), screen("1b"), screen("1c"), screen("1d")]]);
  expect(previewScreens(view).map((each) => each.id)).toEqual(["3a", "3b", "2a", "1a", "1b", "1c"]);
  expect(previewScreens(view)).toHaveLength(PREVIEW_SCREENS);
  expect(previewScreens(design([]))).toEqual([]);
});

it("shows every thumbnail whole at the preview height and its own aspect ratio, never as a clipped excerpt", () => {
  state.design = design([[screen("2a", "desktop"), screen("2b", "mobile")], [screen("1a", "400x800")]]);
  render();
  expect(PREVIEW_HEIGHT).toBeGreaterThanOrEqual(180);
  expect(PREVIEW_HEIGHT).toBeLessThanOrEqual(220);
  expect(host.querySelector('[data-testid="directive-excerpt"]')).toBeNull();
  const preview = host.querySelector<HTMLElement>('[data-testid="directive-preview"]')!;
  expect(preview.style.maxHeight).toBe("");
  const thumbs = [...preview.querySelectorAll<HTMLElement>('[data-testid="design-thumb"] > div')];
  expect(thumbs).toHaveLength(3);
  for (const thumb of thumbs) {
    const frame = thumb.querySelector("iframe")!;
    expect(thumb.style.height).toBe(`${PREVIEW_HEIGHT}px`);
    expect(parseFloat(thumb.style.width) / PREVIEW_HEIGHT).toBeCloseTo(parseFloat(frame.style.width) / parseFloat(frame.style.height), 5);
    expect(frame.className).toContain("pointer-events-none");
  }
  expect(parseFloat(thumbs[2]!.style.width)).toBeCloseTo(PREVIEW_HEIGHT / 2, 5);
  expect(preview.firstElementChild!.className).toContain("overflow-x-auto");
});

it("opens in the workbench from the header and from a thumbnail, and in the main view from the arrow", () => {
  state.design = design([[screen("1a")]]);
  render();
  act(() => host.querySelector("button")!.click());
  act(() => { host.querySelector('[data-testid="design-thumb"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  act(() => host.querySelector<HTMLElement>('[data-testid="directive-open-full"]')!.click());
  expect(state.opened.map((each) => each.how)).toEqual([undefined, undefined, "main"]);
  expect(state.opened[1]!.shift).toBe(true);
  expect(new Set(state.opened.map((each) => each.title))).toEqual(new Set(["Layout"]));
  expect(state.opened[0]!.link).toBe(state.opened[2]!.link);
  expect(state.opened[0]!.link.endsWith("/dsn_0123456789abcdef")).toBe(true);
});
