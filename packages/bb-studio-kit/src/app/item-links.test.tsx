// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemLinkTextarea } from "./item-links";

const state = vi.hoisted(() => ({ sdk: { plugins: { callRpc: vi.fn() } }, pending: new Map<string, (value: unknown) => void>() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => state.sdk }));
vi.mock("../ui/icon", () => ({ Icon: () => null }));

const item = (title: string) => ({ ref: { pluginId: "pages", id: title.toLowerCase() }, kind: "page", title, href: `/plugins/pages/pages/${title.toLowerCase()}` });
let root: Root, container: HTMLDivElement, value = "";
function Field() {
  const [text, setText] = useState("");
  value = text;
  return <ItemLinkTextarea aria-label="Note" value={text} onValueChange={setText} />;
}
const field = () => container.querySelector("textarea")!;
const type = async (text: string) => {
  const element = field();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, text);
  element.setSelectionRange(text.length, text.length);
  await act(async () => { element.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
};
const answer = async (query: string, titles: string[]) => {
  await act(async () => { state.pending.get(query)!(titles.map(item)); await Promise.resolve(); });
};
const press = async (key: string) => {
  await act(async () => { field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0));
  state.pending.clear();
  state.sdk.plugins.callRpc.mockImplementation(({ input, outputSchema }: { input: { query: string }; outputSchema: { parse(value: unknown): unknown } }) =>
    new Promise(resolve => state.pending.set(input.query, value => resolve(outputSchema.parse(value)))));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(<Field />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("Enter before the typed query's results arrive picks from them, not the earlier list", async () => {
  await type("@ro");
  await answer("ro", ["Roadmap"]);
  await type("@rel");
  await press("Enter");
  expect(value).toBe("@rel");
  await answer("rel", ["Release"]);
  expect(value).toContain("Release");
  expect(value).not.toContain("Roadmap");
});

it("Enter on current results picks the active one at once", async () => {
  await type("@ro");
  await answer("ro", ["Roadmap", "Roster"]);
  await press("ArrowDown");
  await press("Enter");
  expect(value).toContain("Roster");
});
