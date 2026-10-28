// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ projectId: null as string | null, calls: [] as { method: string; input: unknown }[] }));
const providers = [
  { pluginId: "pages", name: "Pages", state: "ready", detail: null, panel: null, kinds: [{ id: "page", label: "Page", plural: "Pages", icon: "File", columns: [], actions: [], create: { mode: "rpc" }, canArchive: true, blurb: "" }] },
  { pluginId: "draw", name: "Draw", state: "ready", detail: null, panel: null, kinds: [{ id: "drawing", label: "Drawing", plural: "Drawings", icon: "File", columns: [], actions: [], create: { mode: "rpc" }, canArchive: true, blurb: "" }] },
  { pluginId: "talk", name: "Talk", state: "ready", detail: null, panel: null, kinds: [{ id: "recording", label: "Recording", plural: "Recordings", icon: "File", columns: [], actions: [], create: { mode: "event", event: "talk:new" }, canArchive: true, blurb: "" }] },
];
const rpc = { call: async (method: string, input: unknown) => {
  host.calls.push({ method, input });
  if (method === "overview") return { providers };
  if (method === "templates") return { items: [] };
  if (method === "create") return { item: { href: "/plugins/studio/page/pg_new" } };
  return {};
} };
const sdk = { projects: { list: async () => [{ id: "proj_orbit", name: "Orbit" }] } };
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<object>()),
  useRpc: () => rpc,
  useSdk: () => sdk,
  useBbContext: () => ({ projectId: host.projectId }),
  experimental_Icon: () => null,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../kit/app/nav", async (original) => ({ ...(await original<object>()), openAppPath: vi.fn() }));
const { NewItemMenu } = await import("./NewItemMenu");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host.calls = [];
  host.projectId = null;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });
const key = (target: Element, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const items = () => [...document.querySelectorAll('[role="menuitem"]')];
const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-label="New item"]')!;
async function show() {
  await act(async () => root.render(<NewItemMenu className="" />));
  await settle();
}
async function pick(label: string) {
  trigger().focus();
  await key(trigger(), "Enter");
  await settle();
  const item = items().find((each) => each.textContent?.trim() === label)!;
  await key(item, "Enter");
  await settle();
  return host.calls.find((call) => call.method === "create")?.input;
}

it("is its own labelled button that opens the shared New menu, walks it with the arrow keys and closes on Escape", async () => {
  await show();
  expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
  trigger().focus();
  await key(trigger(), "ArrowDown");
  await settle();
  expect(items().map((each) => each.textContent?.trim())).toEqual(["Page", "Drawing", "Recording", "Record a call"]);
  expect(document.activeElement).toBe(items()[0]);
  // Radix moves focus a task later.
  await key(items()[0]!, "ArrowDown");
  await settle();
  expect(document.activeElement).toBe(items()[1]);
  await key(document.activeElement!, "Escape");
  await settle();
  expect(items()).toHaveLength(0);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger());
});

it("makes the item in the project BB has open, over the library's filter", async () => {
  host.projectId = "proj_open";
  localStorage.setItem("studio:query:all", "project:Orbit");
  await show();
  expect(await pick("Page")).toEqual({ pluginId: "pages", kind: "page", projectId: "proj_open" });
});

it("falls back to the library's Project filter when no project is open", async () => {
  localStorage.setItem("studio:query:all", "project:Orbit");
  await show();
  expect(await pick("Drawing")).toEqual({ pluginId: "draw", kind: "drawing", projectId: "proj_orbit" });
});
