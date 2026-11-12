// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RetainedPanels, retainPanel } from "./retained";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_usePluginId: () => "pages" }));
let roots: Root[];
let elements: HTMLDivElement[];
function mount(element: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  elements.push(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(element));
  return { host, root };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  roots = [];
  elements = [];
});
afterEach(() => {
  act(() => roots.forEach(root => root.unmount()));
  elements.forEach(element => element.remove());
  vi.unstubAllGlobals();
});

it("renders usable main content when there is no overlay, and disposes it after ordinary navigation", () => {
  const dispose = vi.fn();
  function Editor() { useEffect(() => dispose, []); return <textarea defaultValue="Available without the overlay" />; }
  const Main = retainPanel("pages", Editor);
  const main = mount(<Main subPath="one" />);
  expect(main.host.querySelector("textarea")!.value).toBe("Available without the overlay");
  act(() => main.root.render(null));
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(document.querySelector("textarea")).toBeNull();
});
it("keeps the neighboring ordinary editor when splitting remounts its main pane", async () => {
  const disposed = vi.fn();
  function Editor() {
    const [edits, setEdits] = useState(0);
    useEffect(() => disposed, []);
    return <div><textarea defaultValue="Neighbor draft" /><input type="file" /><button onClick={() => setEdits(value => value + 1)}>Edit</button><output>{edits}</output></div>;
  }
  const Main = retainPanel("pages", Editor);
  mount(<RetainedPanels path="pages" render={() => <Editor />} />);
  const main = mount(<Main key="single" subPath="one" />);
  const editor = main.host.querySelector("textarea")!;
  const file = main.host.querySelector("input")!;
  editor.value = "Keep the ordinary main draft too";
  act(() => main.host.querySelector("button")!.click());
  await act(() => main.root.render(<Main key="split" subPath="one" />));
  expect(main.host.querySelector("textarea")).toBe(editor);
  expect(main.host.querySelector("input")).toBe(file);
  expect(editor.value).toBe("Keep the ordinary main draft too");
  expect(main.host.querySelector("output")!.textContent).toBe("1");
  expect(disposed).not.toHaveBeenCalled();
  await act(() => main.root.render(null));
  expect(disposed).not.toHaveBeenCalled();
  expect(document.querySelector("[data-studio-retained-parking] textarea")).toBe(editor);
});
it("returns the same editor, state and scroll when an ordinary route leaves and comes back", async () => {
  let mounts = 0;
  function Editor({ subPath }: { subPath: string }) {
    const [edits, setEdits] = useState(0);
    useEffect(() => { mounts += 1; }, []);
    return <div data-scroll=""><textarea defaultValue={subPath} /><button onClick={() => setEdits(value => value + 1)}>Edit</button><output>{edits}</output></div>;
  }
  const Main = retainPanel("pages", Editor);
  mount(<RetainedPanels path="pages" render={subPath => <Editor subPath={subPath} />} />);
  const main = mount(<Main subPath="one" />);
  const editor = main.host.querySelector("textarea")!;
  editor.value = "Draft kept while I read a thread";
  act(() => main.host.querySelector("button")!.click());
  main.host.querySelector<HTMLElement>("[data-scroll]")!.scrollTop = 240;
  await act(() => main.root.render(<p>A thread</p>));
  expect(main.host.querySelector("textarea")).toBeNull();
  await act(() => main.root.render(<Main subPath="one" />));
  expect(main.host.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Draft kept while I read a thread");
  expect(main.host.querySelector("output")!.textContent).toBe("1");
  expect(main.host.querySelector<HTMLElement>("[data-scroll]")!.scrollTop).toBe(240);
  expect(mounts).toBe(1);
  expect(document.querySelectorAll("textarea")).toHaveLength(1);
});
it("keeps only the most recent left views and disposes older ones", async () => {
  const disposed: string[] = [];
  function Editor({ subPath }: { subPath: string }) { useEffect(() => () => { disposed.push(subPath); }, [subPath]); return <textarea defaultValue={subPath} />; }
  const Main = retainPanel("pages", Editor);
  mount(<RetainedPanels path="pages" render={subPath => <Editor subPath={subPath} />} />);
  const main = mount(<Main subPath="a" />);
  for (const subPath of ["b", "c", "d", "e"]) {
    await act(() => main.root.render(null));
    await act(() => main.root.render(<Main subPath={subPath} />));
  }
  expect(disposed).toEqual(["a"]);
  expect([...document.querySelectorAll("[data-studio-retained-parking] textarea")].map(node => (node as HTMLTextAreaElement).value).sort()).toEqual(["b", "c", "d"]);
});
it("gives two main panes on the same document their own editors", () => {
  function Editor() { return <textarea />; }
  const Main = retainPanel("pages", Editor);
  mount(<RetainedPanels path="pages" render={() => <Editor />} />);
  const first = mount(<Main subPath="one" />);
  const second = mount(<Main subPath="one" />);
  const firstInput = first.host.querySelector("textarea")!;
  const secondInput = second.host.querySelector("textarea")!;
  expect(firstInput).not.toBeNull();
  expect(secondInput).not.toBeNull();
  expect(firstInput).not.toBe(secondInput);
});

it("passes the decoded sub-path of an encoded route", () => {
  const seen: string[] = [];
  const Main = retainPanel("chats", () => null);
  mount(<RetainedPanels path="chats" render={subPath => { seen.push(subPath); return <textarea />; }} />);
  const ref = JSON.stringify({ pluginId: "pages", id: "release" });
  mount(<Main subPath={`item/${ref}`} />);
  expect(seen.at(-1)).toBe(`item/${ref}`);
});

it("renders into Studio's slot with owner context and keeps editor identity through tab movement", async () => {
  const { publishWorkspaceAnchor } = await import("./workspace");
  let mounts = 0;
  function Editor() { useEffect(() => { mounts++; }, []); return <textarea defaultValue="Notes" />; }
  mount(<RetainedPanels path="pages" render={() => <Editor />} />);
  const first = document.createElement("div"), second = document.createElement("div");
  document.body.append(first, second); elements.push(first, second);
  let dispose = () => {};
  act(() => { dispose = publishWorkspaceAnchor({ id: "workspace:one", path: "/plugins/pages/pages/one", element: first }); });
  const editor = first.querySelector("textarea")!;
  expect(editor).not.toBeNull(); editor.value = "Unsaved draft";
  await act(() => { dispose(); dispose = publishWorkspaceAnchor({ id: "workspace:one", path: "/plugins/pages/pages/one", element: second }); });
  expect(second.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Unsaved draft"); expect(mounts).toBe(1);
  act(dispose);
});
