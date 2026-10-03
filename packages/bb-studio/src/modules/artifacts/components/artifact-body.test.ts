// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArtifactBody, type ArtifactVersion } from "./artifact-body";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc, Markdown: ({ content }: { content: string }) => content, experimental_SourceCode: ({ content }: { content: string }) => content }));
vi.mock("@bb-studio/kit/app", () => ({
  EmptyState: ({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) => createElement("section", {}, title, children, actions),
  Icon: () => null, OUTLINE_BUTTON: "button", cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("./artifact-quote", () => ({ AreaBox: () => null, useImageArea: () => ({ imgProps: {}, box: null }) }));
let container: HTMLDivElement;
let root: Root;
const version: ArtifactVersion = { id: "ver_image", number: 1, name: "broken.png", type: "image", size: 4 };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  rpc.call.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(next = version) {
  await act(async () => root.render(createElement(ArtifactBody, { artifactId: "art_test", version: next, view: "preview" })));
}

it("shows image decoding failures, retries the URL, and permits another version", async () => {
  await render();
  const first = container.querySelector("img")!;
  await act(async () => first.dispatchEvent(new Event("error")));
  expect(container.textContent).toContain("Couldn't display this image");
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("download")).toBe("broken.png");
  await act(async () => container.querySelector("button")!.click());
  const retried = container.querySelector("img")!;
  expect(retried).not.toBe(first);
  expect(retried.src).toContain("previewRetry=1");
  await act(async () => retried.dispatchEvent(new Event("error")));
  await render({ ...version, id: "ver_repaired", number: 2 });
  expect(container.querySelector("img")?.src).toContain("version=ver_repaired");
  expect(container.textContent).not.toContain("Couldn't display");
});

it("distinguishes missing text from an empty file and retries through the RPC", async () => {
  rpc.call.mockResolvedValueOnce({ text: null, truncated: false }).mockResolvedValueOnce({ text: "", truncated: false });
  await render({ ...version, type: "text", name: "empty.txt" });
  expect(container.textContent).toContain("File content is unavailable");
  await act(async () => container.querySelector("button")!.click());
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain("File content is unavailable");
});
