// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ off: new Set<string>(), opened: [] as string[] }));
const rpcCall = vi.hoisted(() =>
  vi.fn(async (method: string, _input?: unknown): Promise<unknown> => {
    if (method === "overview") {
      return {
        providers: [{ pluginId: "notion", name: "Notion", state: "ready", detail: null, panel: null, kinds: [{ id: "notion-page", label: "Notion page", plural: "Notion pages", icon: "Box", create: null }] }],
        items: [
          { pluginId: "talk", kind: "dictation", id: "rec_bbbbbbbb", title: "Memo", updatedAt: 5, projectId: null, archived: false, template: false, href: "/r", icon: null, thumbnailUrl: null, preview: null },
          { pluginId: "notion", kind: "notion-page", id: "np_1", title: "Wiki", updatedAt: 4, projectId: null, archived: false, template: false, href: "/plugins/notion/pages/np_1", icon: null, thumbnailUrl: null, preview: null },
          { pluginId: "pages", kind: "page", id: "pg_1", title: "Plan", updatedAt: 3, projectId: null, archived: false, template: false, href: "/p", icon: null, thumbnailUrl: null, preview: null },
          { pluginId: "design", kind: "design", id: "dsn_0123456789abcdef", title: "Board", updatedAt: 2, projectId: null, archived: false, template: false, href: "/d", icon: null, thumbnailUrl: null, preview: null },
        ],
      };
    }
    if (method === "threadItems") return { threads: [] };
    if (method === "pages.chatPage") return { page: null };
    return {};
  }),
);

// Stable, as BB's are; a new object each render would refetch forever.
const host = vi.hoisted(() => ({ rpc: { call: (method: string, input?: unknown) => rpcCall(method, input) }, sdk: { threads: { get: async () => ({ projectId: null, status: "idle" }) } } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => host.rpc,
  useRealtime: () => {},
  useSdk: () => host.sdk,
}));
vi.mock("../../kit/app/index", () => ({
  ICON_BUTTON: "",
  PRIMARY_BUTTON: "",
  THUMBNAIL: "",
  Icon: () => null,
  ItemTile: () => null,
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
  studioItemProps: () => ({}),
  openAppPath: (path: string) => state.opened.push(path),
}));
vi.mock("../kinds-snapshot", () => ({ appliedKinds: () => ({ off: state.off, routedAway: new Set() }) }));
const view = (name: string, idProp: string) => ({ [name]: (props: Record<string, unknown> & { onBack(): void }) => <button type="button" data-view={name} onClick={props.onBack}>{`${name}:${String(props[idProp])}`}</button> });
vi.mock("../../pages/ui/PagePanel", () => view("PageTab", "pageId"));
vi.mock("../../draw/ui/drawing-editor", () => view("DrawingEditor", "drawingId"));
vi.mock("../../design/ui/design-tab", () => view("TabCanvas", "designId"));
vi.mock("../../dashboards/ui/dashboard-tab", () => view("TabDashboard", "dashboardId"));
vi.mock("../../talk/ui/recordings-panel", () => view("RecordingDetail", "id"));
vi.mock("../../artifacts/ui/artifact-viewer", () => view("ArtifactViewer", "artifactId"));
vi.mock("../../artifacts/ui/save-picker", () => ({ SavePicker: ({ params }: { params: unknown }) => <p data-view="SavePicker">{JSON.stringify(params)}</p> }));

const { StudioTab } = await import("./StudioTab");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.off = new Set();
  state.opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
  // Let the lazy views and the overview settle.
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
}
const shown = () => container.querySelector("[data-view]")?.textContent ?? null;
const row = (title: string) => [...container.querySelectorAll("button")].find((each) => each.textContent?.startsWith(title))!;
const button = (text: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === text)!;

describe("Studio tab", () => {
  it.each([
    [{ kind: "page", id: "pg_1" }, "PageTab:pg_1"],
    [{ kind: "drawing", id: "drw_0123456789abcdef" }, "DrawingEditor:drw_0123456789abcdef"],
    [{ kind: "design", id: "dsn_0123456789abcdef" }, "TabCanvas:dsn_0123456789abcdef"],
    [{ kind: "dashboard", id: "dsh_0123456789abcdef" }, "TabDashboard:dsh_0123456789abcdef"],
    [{ kind: "artifact", id: "art_0123456789abcdef" }, "ArtifactViewer:art_0123456789abcdef"],
    [{ kind: "recording", id: "rec_aaaaaaaa" }, "RecordingDetail:rec_aaaaaaaa"],
    [{ kind: "dictation", id: "rec_bbbbbbbb" }, "RecordingDetail:rec_bbbbbbbb"],
  ])("opens %j in its kind's view", async (params, expected) => {
    await render(<StudioTab threadId="thr_1" params={params} />);
    expect(shown()).toBe(expected);
  });

  it("goes back to the collection, which lists every kind and filters by one", async () => {
    await render(<StudioTab threadId="thr_1" params={{ kind: "page", id: "pg_1" }} />);
    await act(async () => button("PageTab:pg_1").click());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(container.textContent).toContain("Plan");
    expect(container.textContent).toContain("Board");
    await act(async () => button("Designs").click());
    expect(container.textContent).not.toContain("Plan");
    expect(container.textContent).toContain("Board");
  });

  it("hides kinds that are off, and won't open one", async () => {
    state.off = new Set(["design"]);
    await render(<StudioTab threadId="thr_1" params={{ kind: "design", id: "dsn_0123456789abcdef" }} />);
    expect(shown()).toBeNull();
    expect(container.textContent).toContain("Plan");
    expect(container.textContent).not.toContain("Board");
    expect(button("Designs")).toBeUndefined();
  });

  it("keeps dictations out of All, under their chip, and opens them in place", async () => {
    await render(<StudioTab threadId="thr_1" params={null} />);
    expect(container.textContent).not.toContain("Memo");
    await act(async () => button("Dictations").click());
    expect(container.textContent).toContain("Memo");
    await act(async () => row("Memo").click());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(shown()).toBe("RecordingDetail:rec_bbbbbbbb");
  });

  it("lists an add-on's kind with its chip and opens its page in the main area", async () => {
    await render(<StudioTab threadId="thr_1" params={null} />);
    expect(button("Notion pages")).toBeDefined();
    await act(async () => row("Wiki").click());
    expect(state.opened).toEqual(["/plugins/notion/pages/np_1"]);
    expect(shown()).toBeNull();
    expect(container.textContent).toContain("Plan");
  });

  it("opens the save picker from Studio params", async () => {
    await render(<StudioTab threadId="thr_1" params={{ view: "save", seq: 2 }} />);
    expect(shown()).toBe('{"seq":2}');
  });

  it("follows a card that opens it on another item", async () => {
    await render(<StudioTab threadId="thr_1" params={{ kind: "page", id: "pg_1" }} />);
    await render(<StudioTab threadId="thr_1" params={{ kind: "design", id: "dsn_0123456789abcdef" }} />);
    expect(shown()).toBe("TabCanvas:dsn_0123456789abcdef");
  });
});
