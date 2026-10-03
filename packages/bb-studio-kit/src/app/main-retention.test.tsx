// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FloatPanels, openFloat, retainPanel, useCompanionNavigate, useInFloat } from "./float";
import { publishFloatBody, setFloatHost } from "./float-registry";

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
  act(() => { roots.forEach(root => root.unmount()); publishFloatBody({ windowKey: "one", element: null }); setFloatHost(null); });
  elements.forEach(element => element.remove());
  vi.unstubAllGlobals();
});
const target = { kind: "path" as const, path: "/plugins/pages/pages/one" };
function floatBody() {
  const host = document.createElement("div");
  elements.push(host);
  document.body.append(host);
  act(() => publishFloatBody({ windowKey: "one", target, element: host, placement: "floating" }));
  return host;
}

it("moves the original main editor, file input, local state, focus, selection and scroll into its first companion", () => {
  let mounts = 0;
  function Editor() {
    const [draft, setDraft] = useState("Unsent");
    useEffect(() => { mounts += 1; }, []);
    return <div data-scroll=""><textarea value={draft} onChange={event => setDraft(event.target.value)} /><input type="file" /><button onClick={() => setDraft("Local state")}>Edit</button></div>;
  }
  const Main = retainPanel("pages", Editor);
  mount(<FloatPanels path="pages" render={() => <Editor />} />);
  const main = mount(<Main subPath="one" />);
  const input = main.host.querySelector("textarea")!;
  const file = main.host.querySelector("input")!;
  const attached = new File(["Notes"], "notes.txt");
  Object.defineProperty(file, "files", { value: [attached] });
  act(() => main.host.querySelector("button")!.click());
  input.focus();
  input.setSelectionRange(2, 7);
  const scroll = main.host.querySelector<HTMLElement>("[data-scroll]")!;
  scroll.scrollTop = 123;
  const body = floatBody();
  expect(body.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("Local state");
  expect(body.querySelector("input")).toBe(file);
  expect(file.files![0]).toBe(attached);
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
  expect(scroll.scrollTop).toBe(123);
  expect(mounts).toBe(1);
  expect(main.host.textContent).toContain("This view is open in a companion.");
});

it("keeps the view alive when its main route leaves, then returns the same editor to a new main pane", () => {
  function Editor({ subPath }: { subPath: string }) { return <textarea defaultValue={subPath} />; }
  const Main = retainPanel("pages", Editor);
  mount(<FloatPanels path="pages" render={subPath => <Editor subPath={subPath} />} />);
  const main = mount(<Main subPath="one" />);
  const input = main.host.querySelector("textarea")!;
  input.value = "Keep across routes";
  const body = floatBody();
  act(() => main.root.render(<Main subPath="two" />));
  expect(body.querySelector("textarea")).toBe(input);
  expect(main.host.querySelector("textarea")!.value).toBe("two");
  act(() => main.root.render(null));
  act(() => main.root.render(<Main subPath="one" />));
  expect(main.host.querySelector("textarea")).toBeNull();
  act(() => publishFloatBody({ windowKey: "one", element: null }));
  expect(main.host.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("Keep across routes");
  expect(document.querySelectorAll("textarea")).toHaveLength(1);
});

it("adopts the focused pane when the same document is open in two main panes", () => {
  function Editor() { return <textarea />; }
  const Main = retainPanel("pages", Editor);
  mount(<FloatPanels path="pages" render={() => <Editor />} />);
  const first = mount(<Main subPath="one" />);
  const second = mount(<Main subPath="one" />);
  const firstInput = first.host.querySelector("textarea")!;
  const secondInput = second.host.querySelector("textarea")!;
  secondInput.value = "Second pane draft";
  secondInput.focus();
  const menu = document.createElement("button");
  elements.push(document.createElement("div"));
  elements.at(-1)!.append(menu);
  document.body.append(elements.at(-1)!);
  menu.focus();
  const body = floatBody();
  expect(body.querySelector("textarea")).toBe(secondInput);
  expect(first.host.querySelector("textarea")).toBe(firstInput);
  expect(second.host.querySelector("textarea")).toBeNull();
});

it("switches asynchronous navigation context without replacing the initial main editor", () => {
  const navigate = vi.fn();
  let go: ReturnType<typeof useCompanionNavigate>;
  function Editor() { go = useCompanionNavigate(); return <textarea data-compact={useInFloat()} />; }
  const Main = retainPanel("pages", Editor);
  act(() => setFloatHost({ open: () => {}, navigate }));
  mount(<FloatPanels path="pages" render={() => <Editor />} />);
  const main = mount(<Main subPath="one" />);
  const input = main.host.querySelector("textarea")!;
  expect(go!({ kind: "thread", threadId: "new" })).toBe(false);
  const body = floatBody();
  expect(go!({ kind: "thread", threadId: "new" })).toBe(true);
  expect(navigate).toHaveBeenCalledWith("one", { kind: "thread", threadId: "new" });
  expect(input.dataset.compact).toBe("true");
  act(() => publishFloatBody({ windowKey: "one", target, element: body, placement: "main" }));
  expect(input.dataset.compact).toBe("false");
  expect(body.querySelector("textarea")).toBe(input);
});

it("preserves a contenteditable selection while moving into a different companion body", () => {
  function Editor() { return <div contentEditable suppressContentEditableWarning>Retain selection</div>; }
  mount(<FloatPanels path="pages" render={() => <Editor />} />);
  const body = floatBody();
  const editor = body.querySelector<HTMLElement>("[contenteditable]")!;
  editor.focus();
  const range = document.createRange();
  range.setStart(editor.firstChild!, 2);
  range.setEnd(editor.firstChild!, 8);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const other = document.createElement("div");
  elements.push(other);
  document.body.append(other);
  act(() => publishFloatBody({ windowKey: "one", target, element: other, placement: "workbench" }));
  expect(other.querySelector("[contenteditable]")).toBe(editor);
  expect(selection.toString()).toBe("tain s");
  expect(document.activeElement).toBe(editor);
});

it("preserves a backward selection across first main adoption and later placement changes", () => {
  function Editor() { return <div contentEditable suppressContentEditableWarning>Retain selection</div>; }
  const Main = retainPanel("pages", Editor);
  mount(<FloatPanels path="pages" render={() => <Editor />} />);
  const main = mount(<Main subPath="one" />);
  const editor = main.host.querySelector<HTMLElement>("[contenteditable]")!;
  const text = editor.firstChild!;
  editor.focus();
  const selection = window.getSelection()!;
  selection.setBaseAndExtent(text, 8, text, 2);
  const body = floatBody();
  const other = document.createElement("div"); elements.push(other); document.body.append(other);
  for (const anchor of [body, other, main.host]) {
    act(() => publishFloatBody({ windowKey: "one", target, element: anchor, placement: "workbench" }));
    expect(anchor.querySelector("[contenteditable]")).toBe(editor);
    expect(selection.anchorNode).toBe(text);
    expect(selection.focusNode).toBe(text);
    expect([selection.anchorOffset, selection.focusOffset]).toEqual([8, 2]);
    expect(document.activeElement).toBe(editor);
  }
});

it("renders usable main content when there is no overlay, and disposes it after ordinary navigation", () => {
  const dispose = vi.fn();
  function Editor() { useEffect(() => dispose, []); return <textarea defaultValue="Available without Float" />; }
  const Main = retainPanel("pages", Editor);
  const main = mount(<Main subPath="one" />);
  expect(main.host.querySelector("textarea")!.value).toBe("Available without Float");
  act(() => main.root.render(null));
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(document.querySelector("textarea")).toBeNull();
});

it("keeps the original editor alive when Float this leaves the main route before its companion body registers", () => {
  let mounts = 0;
  function Editor() { useEffect(() => { mounts += 1; }, []); return <textarea defaultValue="Header move draft" />; }
  const Main = retainPanel("pages", Editor);
  act(() => setFloatHost({ open: () => {} }));
  mount(<FloatPanels path="pages" render={() => <Editor />} />);
  const main = mount(<Main subPath="one" />);
  const input = main.host.querySelector("textarea")!;
  act(() => openFloat(target));
  act(() => main.root.render(null));
  const body = floatBody();
  expect(body.querySelector("textarea")).toBe(input);
  expect(input.value).toBe("Header move draft");
  expect(mounts).toBe(1);
  act(() => publishFloatBody({ windowKey: "one", element: null }));
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
  mount(<FloatPanels path="pages" render={() => <Editor />} />);
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
  expect(disposed).toHaveBeenCalledTimes(1);
});
