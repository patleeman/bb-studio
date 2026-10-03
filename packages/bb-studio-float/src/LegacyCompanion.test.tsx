// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LegacyCompanionOutlet, LegacyCompanionView } from "./LegacyCompanion";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function Editor({ id }: { id: string }) {
  const [edits, setEdits] = useState(0);
  return <div><textarea aria-label={id} defaultValue="" /><input type="file" aria-label={`${id} file`} /><button onClick={() => setEdits(value => value + 1)}>Edit {id}</button><output>{edits}</output></div>;
}

it("moves the same draft, file input, local state, focus and scroll between Float and main", async () => {
  const view = (main: boolean) => <><div data-home><LegacyCompanionView id="one" placement={main ? "main" : "floating"}><Editor id="one" /></LegacyCompanionView></div><div data-main>{main ? <LegacyCompanionOutlet id="one" /> : null}</div></>;
  await act(() => root.render(view(false)));
  const editor = container.querySelector("textarea")!;
  const file = container.querySelector('input[type="file"]')!;
  editor.value = "Keep this draft"; editor.scrollTop = 11; editor.focus();
  await act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(() => root.render(view(true)));
  expect(container.querySelector("[data-main]")!.contains(editor)).toBe(true);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(container.querySelector('input[type="file"]')).toBe(file);
  expect(document.activeElement).toBe(editor);
  expect(editor.value).toBe("Keep this draft"); expect(editor.scrollTop).toBe(11);
  expect(container.querySelector("output")!.textContent).toBe("1");
  await act(() => root.render(view(false)));
  expect(container.querySelector("[data-home]")!.contains(editor)).toBe(true);
  expect(container.querySelector('input[type="file"]')).toBe(file);
  expect(editor.value).toBe("Keep this draft");
});

it("keeps distinct split companions visible and lets a duplicate outlet take the original view", async () => {
  const view = (duplicate: boolean) => <>
    <LegacyCompanionView id="one" placement="main"><Editor id="one" /></LegacyCompanionView>
    <LegacyCompanionView id="two" placement="main"><Editor id="two" /></LegacyCompanionView>
    <div data-first><LegacyCompanionOutlet id="one" /></div><div data-second><LegacyCompanionOutlet id="two" /></div>
    {duplicate ? <div data-duplicate><LegacyCompanionOutlet id="one" /></div> : null}
  </>;
  await act(() => root.render(view(false)));
  const first = container.querySelector('textarea[aria-label="one"]')!;
  const second = container.querySelector('textarea[aria-label="two"]')!;
  expect(container.querySelector("[data-first]")!.contains(first)).toBe(true);
  expect(container.querySelector("[data-second]")!.contains(second)).toBe(true);
  await act(() => root.render(view(true)));
  expect(container.querySelector("[data-duplicate]")!.contains(first)).toBe(true);
  await act(() => container.querySelector<HTMLButtonElement>("[data-first] button")!.click());
  expect(container.querySelector("[data-first]")!.contains(first)).toBe(true);
  expect(container.querySelectorAll("textarea")).toHaveLength(2);
  await act(() => root.render(view(false)));
  expect(container.querySelector("[data-first]")!.contains(first)).toBe(true);
});

it("parks the live view when its main outlet closes and disposes it when its owner closes", async () => {
  const view = (outlet: boolean, owner = true) => <>
    <div data-home>{owner ? <LegacyCompanionView id="one" placement="main"><Editor id="one" /></LegacyCompanionView> : null}</div>
    {outlet ? <LegacyCompanionOutlet id="one" /> : null}
  </>;
  await act(() => root.render(view(true)));
  const editor = container.querySelector("textarea")!;
  await act(() => root.render(view(false)));
  expect(container.querySelector("[data-home]")!.contains(editor)).toBe(true);
  await act(() => root.render(view(true)));
  expect(container.querySelector("[data-legacy-companion-outlet]")!.contains(editor)).toBe(true);
  await act(() => root.render(view(true, false)));
  expect(editor.isConnected).toBe(false); expect(container.querySelector("textarea")).toBeNull();
});
