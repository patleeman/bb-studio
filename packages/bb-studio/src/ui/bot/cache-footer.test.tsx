// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbContext: () => ({ threadId: "thr_1", projectId: null }) }));
vi.mock("./BotCache", () => ({ BotCacheChip: () => <button type="button">chip</button> }));

import { BotCacheFooter, useCacheFooter } from "./cache-footer";
import { withComposerFooter } from "../../kit/app/host-sdk";

let root: Root;
let container: HTMLElement;
function Probe() { const footer = useCacheFooter("thr_1"); return <output>{String(footer.active)}</output>; }
const state = () => container.querySelector("output")?.textContent;

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it("without a footer row the context row keeps the chip", async () => {
  await act(async () => { root.render(<Probe />); });
  expect(state()).toBe("false");
});

it("takes the chip over while mounted and hands it back on unmount", async () => {
  await act(async () => { root.render(<><BotCacheFooter /><Probe /></>); });
  expect(state()).toBe("true");
  expect(container.querySelector("button")?.textContent).toBe("chip");
  await act(async () => { root.render(<Probe />); });
  expect(state()).toBe("false");
});

it("adds footer items without dropping the customization's own fields", () => {
  const component = () => null;
  expect(withComposerFooter({ id: "x", scopes: ["thread"] }, [{ id: "cache", component }])).toEqual({ id: "x", scopes: ["thread"], experimental_footer: [{ id: "cache", component }] });
});
