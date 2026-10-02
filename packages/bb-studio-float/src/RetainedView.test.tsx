// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RetainedView } from "./RetainedView";

let container: HTMLDivElement;
let root: Root;
const mounted = vi.fn();
const disposed = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mounted.mockClear();
  disposed.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Editor({ id }: { id: string }) {
  const [edits, setEdits] = useState(0);
  useEffect(() => {
    mounted(id);
    return () => { disposed(id); };
  }, [id]);
  return (
    <section data-editor={id}>
      <textarea aria-label={`${id} draft`} defaultValue="" />
      <input type="file" aria-label={`${id} attachment`} />
      <button type="button" onClick={() => setEdits(edits + 1)}>Edit</button>
      <output>{edits}</output>
    </section>
  );
}

async function render(active: string | null, closed: string[] = []) {
  await act(() => root.render(
    <>{["chat", "page"].filter(id => !closed.includes(id)).map(id => (
      <RetainedView key={id} visible={active === id}><Editor id={id} /></RetainedView>
    ))}</>,
  ));
}

it("retains a draft, attachment, editor state, and scroll while switching, folding, and hiding tabs", async () => {
  await render("chat");
  const editor = container.querySelector<HTMLElement>('[data-editor="chat"]')!;
  const draft = editor.querySelector("textarea")!;
  const attachment = editor.querySelector("input")!;
  const files = [new File(["reference"], "reference.txt", { type: "text/plain" })];
  draft.value = "Unsent draft";
  Object.defineProperty(attachment, "files", { value: files });
  editor.scrollTop = 137;
  await act(() => editor.querySelector("button")!.click());

  await render("page");
  await render(null);
  await render("chat");
  expect(container.querySelector('[data-editor="chat"]')).toBe(editor);
  expect(draft.value).toBe("Unsent draft");
  expect(attachment.files).toBe(files);
  expect(editor.querySelector("output")!.textContent).toBe("1");
  expect(editor.scrollTop).toBe(137);
  expect(mounted.mock.calls).toEqual([["chat"], ["page"]]);
  expect(disposed).not.toHaveBeenCalled();
});

it("does not realize background tabs, and releases a realized view only when its tab closes", async () => {
  await render(null);
  expect(mounted).not.toHaveBeenCalled();
  await render("chat");
  expect(mounted.mock.calls).toEqual([["chat"]]);
  await render(null);
  expect(disposed).not.toHaveBeenCalled();
  await render(null, ["chat"]);
  expect(disposed.mock.calls).toEqual([["chat"]]);
  expect(container.querySelector("textarea")).toBeNull();
});
