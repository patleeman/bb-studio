// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageCard } from "./PageCard";

const state = vi.hoisted(() => ({ page: undefined as unknown, call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => {
  const rpc = { call: state.call };
  return {
    Markdown: ({ content }: { content: string }) => <p>{content}</p>,
    useBbNavigate: () => ({ openThreadPanel: () => true, toPluginPanel: () => {} }),
    useRpc: () => rpc,
  };
});
// Like the kit's: the last value for a key while the new one is undefined.
const shown = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@bb-studio/kit/app", () => ({
  remember: (key: string, value: unknown) => (value === undefined ? shown.get(key) : (shown.set(key, value), value)),
  panelHref: (plugin: string, path: string, sub: string) => `/plugins/${plugin}/${path}/${sub}`,
  ItemDirectiveCard: ({ state, title, body }: { state: string; title?: string; body?: unknown }) =>
    <div data-state={state}>{title}{body as never}</div>,
}));
vi.mock("./PanelShell", () => ({ usePanelPage: () => ({ page: state.page, refetch: () => {} }) }));
vi.mock("./shared", () => ({ relativeTime: () => "now" }));

const page = { id: "pg_remount", title: "Plan", icon: "", updatedAt: 1 };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.call.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = () => act(() => root.render(<PageCard attributes={{ id: page.id }} source="" message={{ id: "m", threadId: "t", turnId: null, projectId: null }} openWorkspaceFile={null} />));

it("shows the last content at once when BB remounts the card", async () => {
  state.page = page;
  state.call.mockResolvedValue({ markdown: "Hello from the page" });
  render();
  await act(async () => {});
  expect(host.textContent).toContain("Hello from the page");

  // A remount: the page's data hasn't arrived yet, and no read is needed.
  act(() => root.unmount());
  root = createRoot(host);
  state.page = undefined;
  state.call.mockReset();
  render();
  expect(host.querySelector("[data-state]")?.getAttribute("data-state")).toBe("ready");
  expect(host.textContent).toContain("Hello from the page");
  state.page = page;
  render();
  await act(async () => {});
  expect(state.call).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Hello from the page");
});
