// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notices = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));

const state = vi.hoisted(() => ({ off: new Set<string>(), opened: [] as string[] }));
const fixture = vi.hoisted(() => ({
  items: [
          { pluginId: "talk", kind: "dictation", id: "rec_bbbbbbbb", title: "Memo", updatedAt: 5, projectId: null, archived: false, template: false, href: "/r", icon: null, thumbnailUrl: null, preview: null },
          { pluginId: "notion", kind: "notion-page", id: "np_1", title: "Wiki", updatedAt: 4, projectId: null, archived: false, template: false, href: "/plugins/notion/pages/np_1", icon: null, thumbnailUrl: null, preview: null },
          { pluginId: "pages", kind: "page", id: "pg_1", title: "Plan", updatedAt: 3, projectId: null, archived: false, template: false, href: "/p", icon: null, thumbnailUrl: null, preview: null },
          { pluginId: "design", kind: "design", id: "dsn_0123456789abcdef", title: "Board", updatedAt: 2, projectId: null, archived: false, template: false, href: "/d", icon: null, thumbnailUrl: null, preview: null },
  ],
}));
// The shared library (../StudioPanel.tsx) has its own tests; here it lists the
// items with the thread's host, so the tab's own part is what's tested.
const library = vi.hoisted(() => ({ hosts: [] as { threadId: string; linked: ReadonlySet<string>; projectId: string | null }[] }));
vi.mock("../StudioPanel", () => ({
  StudioLibrary: ({ thread }: { thread: { threadId: string; linked: ReadonlySet<string>; projectId: string | null; onOpen(item: unknown): void; headerActions: React.ReactNode } }) => {
    library.hosts.push(thread);
    return (
      <div data-library="">
        {thread.headerActions}
        {fixture.items.map((item) => <button key={item.id} type="button" onClick={() => thread.onOpen(item)}>{item.title}</button>)}
      </div>
    );
  },
}));
vi.mock("../../kit/app/nav", () => ({ openAppPath: (path: string) => state.opened.push(path) }));
const rpcCall = vi.hoisted(() =>
  vi.fn(async (method: string, _input?: unknown): Promise<unknown> => {
    if (method === "overview") {
      return {
        providers: [{ pluginId: "notion", name: "Notion", state: "ready", detail: null, panel: null, kinds: [{ id: "notion-page", label: "Notion page", plural: "Notion pages", icon: "Box", create: null }] }],
        items: fixture.items,
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
  experimental_useAppPanel: () => ({ openTab: () => false }),
  useBbNavigate: () => ({ toThread: () => {}, openUrl: () => true }),
}));
vi.mock("../../kit/app/index", () => ({
  ICON_BUTTON: "",
  OUTLINE_BUTTON: "",
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

vi.mock("../../minis/ui/mini-view", () => view("TabMini", "miniId"));

const { StudioTab } = await import("./StudioTab");
const { forgetView, loadView, saveView, viewKey } = await import("./view-state");
const { TAB_KINDS } = await import("./model");
const { createEntries } = await import("../create-menu");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.off = new Set();
  state.opened = [];
  localStorage.clear();
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

  it("goes back to Studio's shared library, with this thread's host", async () => {
    await render(<StudioTab threadId="thr_1" params={{ kind: "page", id: "pg_1" }} />);
    await act(async () => button("PageTab:pg_1").click());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(container.querySelector("[data-library]")).not.toBeNull();
    expect(library.hosts.at(-1)).toMatchObject({ threadId: "thr_1", projectId: null });
  });

  it("won't open a kind that is off", async () => {
    state.off = new Set(["design"]);
    await render(<StudioTab threadId="thr_1" params={{ kind: "design", id: "dsn_0123456789abcdef" }} />);
    expect(shown()).toBeNull();
    expect(container.querySelector("[data-library]")).not.toBeNull();
  });

  it("opens a dictation in place", async () => {
    await render(<StudioTab threadId="thr_1" params={null} />);
    await act(async () => row("Memo").click());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(shown()).toBe("RecordingDetail:rec_bbbbbbbb");
  });

  it("opens an add-on's item on its page in the main area", async () => {
    await render(<StudioTab threadId="thr_1" params={null} />);
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    await act(async () => row("Wiki").click());
    expect(state.opened).toEqual(["/plugins/notion/pages/np_1"]);
    expect(shown()).toBeNull();
  });

  it("tells the library which items are this thread's", async () => {
    const original = rpcCall.getMockImplementation()!;
    rpcCall.mockImplementation(async (method, input) => {
      if (method === "threadItems") return { threads: [{ ref: { pluginId: "design", id: "dsn_0123456789abcdef" } }] };
      if (method === "pages.chatPage") return { page: { id: "pg_1" } };
      return original(method, input);
    });
    try {
      await render(<StudioTab threadId="thr_1" params={null} />);
      expect([...library.hosts.at(-1)!.linked]).toEqual(["design:dsn_0123456789abcdef", "pages:pg_1"]);
    } finally { rpcCall.mockImplementation(original); }
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

describe("coming back to the Studio tab", () => {
  // BB unmounts the tab when another tab is selected; a new root is a remount.
  async function remount(node: React.ReactNode) {
    act(() => root.unmount());
    root = createRoot(container);
    await render(node);
  }

  it.each([
    ["page", "pg_1", "PageTab:pg_1"],
    ["drawing", "drw_0123456789abcdef", "DrawingEditor:drw_0123456789abcdef"],
    ["design", "dsn_0123456789abcdef", "TabCanvas:dsn_0123456789abcdef"],
    ["dashboard", "dsh_0123456789abcdef", "TabDashboard:dsh_0123456789abcdef"],
    ["mini", "mini_0123456789abcdef", "TabMini:mini_0123456789abcdef"],
    ["artifact", "art_0123456789abcdef", "ArtifactViewer:art_0123456789abcdef"],
    ["recording", "rec_aaaaaaaa", "RecordingDetail:rec_aaaaaaaa"],
  ])("shows the %s it had open", async (kind, id, expected) => {
    const info = TAB_KINDS.find((each) => each.kind === kind)!;
    expect(info.isId(id)).toBe(true);
    saveView(viewKey("thr_1", null), { target: { view: "item", kind: info.kind, id }, filter: null, scroll: null });
    await render(<StudioTab threadId="thr_1" params={null} />);
    expect(shown()).toBe(expected);
  });

  it("reopens the page picked from the list after a tab switch, per thread", async () => {
    await render(<StudioTab threadId="thr_1" params={null} />);
    await act(async () => row("Plan").click());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(shown()).toBe("PageTab:pg_1");
    await remount(<StudioTab threadId="thr_1" params={null} />);
    expect(shown()).toBe("PageTab:pg_1");
    // Another thread's Studio tab has its own view.
    await remount(<StudioTab threadId="thr_2" params={null} />);
    expect(shown()).toBeNull();
    // Back to the list is remembered too.
    await remount(<StudioTab threadId="thr_1" params={null} />);
    await act(async () => button("PageTab:pg_1").click());
    await remount(<StudioTab threadId="thr_1" params={null} />);
    expect(shown()).toBeNull();
    expect(container.querySelector("[data-library]")).not.toBeNull();
  });

  it("keeps the save picker and an item a card's instance moved on to", async () => {
    await render(<StudioTab threadId="thr_1" params={{ view: "save", seq: 2 }} />);
    await remount(<StudioTab threadId="thr_1" params={{ view: "save", seq: 2 }} />);
    expect(shown()).toBe('{"seq":2}');
    const card = { kind: "page", id: "pg_1" };
    await remount(<StudioTab threadId="thr_1" params={card} />);
    await act(async () => button("PageTab:pg_1").click());
    await act(async () => row("Board").click());
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    await remount(<StudioTab threadId="thr_1" params={card} />);
    expect(shown()).toBe("TabCanvas:dsn_0123456789abcdef");
  });

  it("shows the card's item when a card opens it again, mounted or not", async () => {
    const card = { kind: "page", id: "pg_1" };
    saveView(viewKey("thr_1", card), { target: { view: "list" }, filter: null, scroll: null });
    forgetView(card);
    await render(<StudioTab threadId="thr_1" params={card} />);
    expect(shown()).toBe("PageTab:pg_1");
    await act(async () => button("PageTab:pg_1").click());
    expect(shown()).toBeNull();
    await act(async () => forgetView(card));
    expect(shown()).toBe("PageTab:pg_1");
  });

  it("drops a saved item whose kind was turned off", async () => {
    saveView(viewKey("thr_1", null), { target: { view: "item", kind: "design", id: "dsn_0123456789abcdef" }, filter: null, scroll: null });
    state.off = new Set(["design"]);
    await render(<StudioTab threadId="thr_1" params={null} />);
    expect(shown()).toBeNull();
    expect(container.querySelector("[data-library]")).not.toBeNull();
  });

  it("saves the view's scroll and scrolls it back once its content is there", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"] });
    const tall = { value: 0 };
    const scrolled = new WeakMap<Element, number>();
    const restore = [
      ["scrollHeight", { configurable: true, get: () => tall.value }],
      ["clientHeight", { configurable: true, get: () => 100 }],
      ["scrollTop", { configurable: true, get(this: Element) { return scrolled.get(this) ?? 0; }, set(this: Element, top: number) { scrolled.set(this, Math.min(top, Math.max(0, tall.value - 100))); } }],
    ] as const;
    const before = restore.map(([name]) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)] as const);
    for (const [name, descriptor] of restore) Object.defineProperty(Element.prototype, name, descriptor);
    try {
      saveView(viewKey("thr_1", null), { target: { view: "item", kind: "page", id: "pg_1" }, filter: null, scroll: null });
      await act(async () => root.render(<StudioTab threadId="thr_1" params={null} />));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const page = () => container.querySelector("[data-view]")!;
      expect(page().textContent).toBe("PageTab:pg_1");
      tall.value = 1000;
      page().scrollTop = 420;
      await act(async () => { page().dispatchEvent(new Event("scroll")); await vi.advanceTimersByTimeAsync(300); });
      expect(loadView(viewKey("thr_1", null), TAB_KINDS)?.scroll).toEqual({ path: [0], top: 420 });

      // Back again: the page loads short, then grows; the scroll waits for it.
      tall.value = 0;
      act(() => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<StudioTab threadId="thr_1" params={null} />));
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(page().scrollTop).toBe(0);
      tall.value = 1000;
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(page().scrollTop).toBe(420);

      // Another item starts at the top.
      await act(async () => button("PageTab:pg_1").click());
      expect(loadView(viewKey("thr_1", null), TAB_KINDS)).toMatchObject({ target: { view: "list" }, scroll: null });
    } finally {
      for (const [name, descriptor] of before) {
        if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
        else delete (Element.prototype as unknown as Record<string, unknown>)[name];
      }
      vi.useRealTimers();
    }
  });
});

it("shows thread-link read failures and retries loading instead of showing an empty thread", async () => {
  rpcCall.mockRejectedValueOnce(new Error("overview unavailable"));
  await render(<StudioTab threadId="thr_1" params={{}} />);
  expect(container.textContent).toContain("overview unavailable");
  expect(container.textContent).not.toContain("Loading…");
  await act(async () => button("Retry loading items").click());
  expect(container.textContent).toContain("Plan");
  const original = rpcCall.getMockImplementation()!;
  rpcCall.mockImplementationOnce(original).mockRejectedValueOnce(new Error("links unavailable"));
  await render(<StudioTab threadId="thr_2" params={{}} />);
  expect(container.textContent).toContain("links unavailable");
  await act(async () => button("Retry loading items").click());
  expect(container.textContent).toContain("Plan");
});

it("New offers the shared create list, Record a call and templates included", async () => {
  const original = rpcCall.getMockImplementation()!;
  const providers = [
    { pluginId: "pages", name: "Pages", state: "ready", kinds: [{ id: "page", label: "Page", plural: "Pages", icon: "studio/pages", create: { mode: "rpc" } }] },
    { pluginId: "talk", name: "Talk", state: "ready", kinds: [{ id: "recording", label: "Recording", plural: "Recordings", icon: "talk/talk", create: { mode: "event", event: "talk:new" } }] },
  ];
  const templates = [{ pluginId: "pages", id: "pg_t", title: "Weekly" }];
  rpcCall.mockImplementation(async (method, input) => {
    if (method === "overview") return { ...(await original(method, input) as object), providers };
    if (method === "templates") return { items: templates };
    return original(method, input);
  });
  try {
    await render(<StudioTab threadId="thr_1" params={{}} />);
    await act(async () => (container.querySelector("button[aria-haspopup=menu]") as HTMLButtonElement).click());
    const menu = [...container.querySelectorAll("[role=menuitem]")].map((each) => each.textContent);
    expect(menu).toEqual(createEntries(providers as never, { templates }).map((entry) => entry.label));
    expect(menu).toEqual(["Page", "Recording", "Record a call", "From template: Weekly"]);
  } finally { rpcCall.mockImplementation(original); }
});

it("opens a created item and retries only its failed association", async () => {
  const original = rpcCall.getMockImplementation()!;
  let links = 0;
  rpcCall.mockClear();
  rpcCall.mockImplementation(async (method, input) => {
    if (method === "overview") {
      const result = await original(method, input) as { providers: unknown[] };
      return { ...result, providers: [...result.providers, { pluginId: "pages", name: "Pages", state: "ready", kinds: [{ id: "page", label: "Page", plural: "Pages", icon: "studio/pages", create: { mode: "rpc" } }] }] };
    }
    if (method === "create") return { item: { id: "pg_created" } };
    if (method === "linkItemThread" && ++links === 1) throw new Error("link unavailable");
    return original(method, input);
  });
  try {
    await render(<StudioTab threadId="thr_1" params={{}} />);
    await act(async () => (container.querySelector("button[aria-haspopup=menu]") as HTMLButtonElement).click());
    await act(async () => button("Page").click());
    expect(shown()).toBe("PageTab:pg_created");
    const [message, options] = notices.error.mock.calls.at(-1)!;
    expect(message).toContain("couldn't link");
    expect(options.duration).toBe(Infinity);
    await act(async () => options.action.onClick());
    expect(rpcCall.mock.calls.filter(([method]) => method === "create")).toHaveLength(1);
    expect(rpcCall.mock.calls.filter(([method]) => method === "linkItemThread")).toHaveLength(2);
    expect(rpcCall.mock.calls.filter(([method]) => method === "linkItemThread")[1]?.[1]).toMatchObject({ thread: { ref: { id: "pg_created" }, threadId: "thr_1" } });
  } finally { rpcCall.mockImplementation(original); }
});
