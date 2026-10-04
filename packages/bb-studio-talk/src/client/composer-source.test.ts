// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { composerPendingKey, composerSource, registerComposerSource } from "./composer-source";

afterEach(() => { document.body.innerHTML = ""; });
const main = { threadId: "thr_main", projectId: "proj_main" };
function prompt(key?: string) {
  const parent = document.createElement("div"), element = document.createElement("div");
  if (key) parent.dataset.floatWindow = key;
  parent.append(element); document.body.append(parent); return element;
}

it("prefers the companion's thread over a stable host's main-thread SDK scope", () => {
  const element = prompt("thread:thr_side");
  registerComposerSource(element, () => ({ kind: "thread", threadId: "thr_main" }));
  expect(composerSource(element, main)).toEqual({ threadId: "thr_side", projectId: null, path: null });
  expect(composerPendingKey(composerSource(element, main))).toBe("thr_side");
});

it("keeps a new companion draft separate from the main thread and uses its selected project", () => {
  const path = "/plugins/pages/pages/pg_source/compose";
  const element = prompt(`path:${path}`);
  registerComposerSource(element, () => ({ kind: "new-thread", projectId: "proj_selected" }));
  const source = composerSource(element, main);
  expect(source).toEqual({ threadId: null, projectId: "proj_selected", path });
  expect(composerPendingKey(source)).toBe(`compose:${path}`);
});

it("reads the latest SDK scope when a main composer is reused, and unregisters it", () => {
  const element = prompt(); let threadId = "thr_a";
  const unregister = registerComposerSource(element, () => ({ kind: "thread", threadId }));
  expect(composerSource(element, main).threadId).toBe("thr_a");
  threadId = "thr_b"; expect(composerSource(element, main).threadId).toBe("thr_b");
  unregister(); expect(composerSource(element, main).threadId).toBe("thr_main");
});
