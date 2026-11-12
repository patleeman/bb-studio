// @vitest-environment jsdom
// VS Code as a page in the main view (its nav panel):
// its bar names it, there is no sharing banner, and the page is never blank.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = (method: string, input: unknown) => Promise<unknown>;
const state = vi.hoisted(() => ({
  call: null as unknown as Call,
  calls: [] as { method: string; input: unknown }[],
  open: vi.fn(),
  projects: [] as { id: string; name: string }[],
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
const rpc = { call: (method: string, input: unknown) => { state.calls.push({ method, input }); return state.call(method, input); } };
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpc,
  useRealtime: () => {},
  useBbNavigate: () => ({ toThread: vi.fn() }),
  experimental_Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("sonner", () => ({ toast: state.toast }));
vi.mock("../kit/app/index", () => ({ BAR_BUTTON: "", Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../kit/app/pieces", () => ({ BAR_BUTTON: "", ICON_BUTTON: "", useProjects: () => state.projects }));
// Every Studio view opens things by the one rule (src/ui/studio-open.tsx); these pages ask for the main view.
vi.mock("../ui/studio-open", () => ({ useStudioOpen: () => state.open }));
// The bar goes into BB's header where the panel lends it (item-header.test.tsx); here it is just the bar.
vi.mock("../kit/app/item-header", () => ({ StudioBar: ({ children }: { children: React.ReactNode }) => <div data-studio-bar="">{children}</div> }));
vi.mock("./theme-sync", () => ({ useThemeSync: () => {}, themeChanges: new EventTarget() }));
vi.mock("./file-browser", () => ({ FileBrowser: () => <p>Files</p> }));

import WorkspaceRoute from "./route";
import { CHOOSE_PATH, useCodePageTitle } from "./page-title";

const workspace = (over: object = {}) => ({ id: "cws_1", title: "bb-studio", projectId: "proj_1", threadId: null, folderKey: "project:proj_1", trusted: true, share: true, folders: ["/repo"], archived: false, createdAt: 1, updatedAt: 1, ...over });
const stopped = { state: "stopped", url: null, password: null, error: null };
const running = { state: "running", url: "http://127.0.0.1:4100/?workspace=x", password: "pw", error: null };

let root: Root;
let container: HTMLDivElement;
let submit: ReturnType<typeof vi.spyOn>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const show = async (id: string, extra: React.ReactNode = null) => {
  await act(async () => { root.render(<>{extra}<WorkspaceRoute id={id} /></>); await settle(); });
};
const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent?.trim() === label);
const click = async (element: Element | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); await settle(); });
};
const frame = () => container.querySelector("iframe");
/** The frame's page finished loading: `blank` for the empty document, else another origin's (the editor). */
const frameLoaded = async (blank: boolean) => {
  const iframe = frame()!;
  const page = blank ? { location: { href: "about:blank" } } : { get location(): Location { throw new Error("cross-origin"); } };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, get: () => page });
  await act(async () => { iframe.dispatchEvent(new Event("load")); await settle(); });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.calls = [];
  state.projects = [];
  state.open.mockClear();
  state.toast.mockClear();
  state.toast.error.mockClear();
  state.call = async (method) => {
    if (method === "code.get") return { workspace: workspace(), status: running };
    throw new Error(`unexpected ${method}`);
  };
  // jsdom lays nothing out; the view counts as on screen.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  // Signing in posts a form into the frame, which jsdom can't.
  submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("the page's bar", () => {
  it("says VS Code and the workspace's name with the VS Code icon, and so does BB's title", async () => {
    function Title() {
      const title = useCodePageTitle({ subPath: "cws_1" });
      return <p data-testid="bb-title">{title?.title}|{title?.windowTitle}</p>;
    }
    await show("cws_1", <Title />);
    const bar = container.querySelector("[data-studio-code-title]")!;
    expect(bar.textContent).toBe("VS Code · bb-studio");
    expect(bar.querySelector('[data-icon="Code"]')).not.toBeNull();
    expect(text()).not.toContain("Library");
    expect(container.querySelector('[data-testid="bb-title"]')!.textContent).toBe("VS Code · bb-studio|VS Code · bb-studio");
  });

  it("has no sharing banner; sharing is a checked item in the page's menu, and unchecking it stops it", async () => {
    state.call = async (method, input) => method === "code.get" ? { workspace: workspace(), status: running } : { workspace: workspace(input as object) };
    await show("cws_1");
    expect(text()).not.toMatch(/Agents can see|Stop sharing/);
    await act(async () => {
      container.querySelector('[aria-label="More"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
      await settle();
    });
    const item = document.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    expect(item.textContent).toContain("Share editor context with agents");
    expect(item.getAttribute("aria-checked")).toBe("true");
    await act(async () => { item.click(); await settle(); });
    expect(state.calls).toContainEqual({ method: "code.update", input: { id: "cws_1", share: false } });
  });
});

describe("the editor, opened with no thread", () => {
  it("covers the frame with a loading state until VS Code's page is in it", async () => {
    await show("cws_1");
    expect(frame()).not.toBeNull();
    expect(frame()!.getAttribute("allow")).toBe("clipboard-read http://127.0.0.1:4100; clipboard-write http://127.0.0.1:4100");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Opening VS Code…");
    await frameLoaded(false);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(frame()).not.toBeNull();
  });

  it("signs in again when the frame comes back blank (a kept view moved between panes)", async () => {
    await show("cws_1");
    await frameLoaded(false);
    await frameLoaded(true);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Opening VS Code…");
  });

  it("starts a stopped workspace itself and says it's starting", async () => {
    let finish: (value: unknown) => void = () => {};
    state.call = async (method) => method === "code.get" ? { workspace: workspace(), status: stopped } : new Promise((resolve) => { finish = resolve; });
    await show("cws_1");
    expect(state.calls).toContainEqual({ method: "code.open", input: { id: "cws_1" } });
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Starting VS Code…");
    await act(async () => { finish({ status: running }); await settle(); });
    expect(frame()).not.toBeNull();
  });

  it("says why when the workspace can't start (its folder is gone), with Retry and another workspace", async () => {
    state.call = async (method) => {
      if (method === "code.get") return { workspace: workspace(), status: stopped };
      throw new Error("This workspace's folder is gone: /repo");
    };
    await show("cws_1");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("VS Code couldn't start.");
    expect(text()).toContain("This workspace's folder is gone: /repo");
    expect(frame()).toBeNull();
    const opens = () => state.calls.filter((each) => each.method === "code.open").length;
    expect(opens()).toBe(1);
    await click(button("Retry"));
    expect(opens()).toBe(2);
    await click(button("Choose another workspace"));
    expect(state.open).toHaveBeenCalledWith({ href: CHOOSE_PATH, title: "VS Code" }, { target: "main" });
  });

  it("says so for a workspace that is gone or has no folder, where the page used to be empty", async () => {
    state.call = async () => ({ workspace: null, status: stopped });
    await show("cws_1");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("VS Code couldn't open this workspace.");
    expect(text()).toContain("Workspace not found.");
    expect(button("Retry")).toBeTruthy();
    expect(button("Choose another workspace")).toBeTruthy();

    state.call = async () => ({ workspace: workspace({ id: "cws_2", folders: [] }), status: stopped });
    await show("cws_2");
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("This workspace has no folder to open.");
    expect(button("Choose another workspace")).toBeTruthy();
    expect(state.calls.some((each) => each.method === "code.open")).toBe(false);
  });
});

describe("the picker, when there is nothing to open", () => {
  it("lists the workspaces used before and the projects, and opens the one picked", async () => {
    state.projects = [{ id: "proj_1", name: "Studio" }, { id: "proj_2", name: "Website" }];
    state.call = async (method) => {
      if (method === "code.list") return { workspaces: [{ ...workspace(), missing: false }, { ...workspace({ id: "cws_gone", title: "old-branch", folderKey: "env:env_9" }), missing: true }] };
      if (method === "code.forFolder") return { workspace: workspace({ id: "cws_new" }) };
      throw new Error(`unexpected ${method}`);
    };
    await show("choose");
    expect(container.querySelector("[data-studio-code-title]")!.textContent).toBe("VS Code");
    const rows = [...container.querySelectorAll("li button")] as HTMLButtonElement[];
    // proj_1's folder already has a workspace, so it isn't offered twice.
    expect(rows.map((row) => row.querySelector("span.truncate")!.textContent)).toEqual(["bb-studio", "old-branch", "Website"]);
    expect(rows[1]!.disabled).toBe(true);
    expect(rows[1]!.textContent).toContain("Its folder is gone");
    await click(rows[0]);
    expect(state.open).toHaveBeenLastCalledWith({ href: "/plugins/studio/vscode/cws_1", title: "bb-studio" }, { target: "main" });
    await click(rows[2]);
    expect(state.calls).toContainEqual({ method: "code.forFolder", input: { projectId: "proj_2" } });
    expect(state.open).toHaveBeenLastCalledWith({ href: "/plugins/studio/vscode/cws_new", title: "bb-studio" }, { target: "main" });
  });

  it("says there is nothing yet rather than showing an empty page", async () => {
    state.call = async () => ({ workspaces: [] });
    await show("choose");
    expect(text()).toContain("Nothing to open");
  });
});
